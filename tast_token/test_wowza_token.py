#!/usr/bin/env python3
"""
Automated test suite for the Wowza SecureToken v2 tooling.

Self-contained: picks a free port, boots mock_wowza.py itself, runs everything,
tears the server down again. No manual setup, no fixed ports to collide with.

    python test_wowza_token.py           # run all
    python test_wowza_token.py -v        # verbose
    python test_wowza_token.py TestEdgeAcceptance   # one class

Covers:
  * hash construction (sorting, both base64 alphabets, unicode secrets)
  * HAR parsing and format autodetection
  * edge acceptance/rejection: valid, wrong secret, expired, not-yet-valid,
    missing params, wrong content path, wrong prefix, wrong alphabet
  * the full HLS chain: playlist -> chunklist -> segment
  * mid-playback expiry
  * the /token signing endpoint
  * JS <-> Python parity for the browser page (both WebCrypto and the pure-JS
    fallback), skipped if node is unavailable
  * the client emulator end to end

Regression tests for bugs found during development, each named for its cause:
  * test_regression_urlsafe_digest_length -- b64decode silently drops '-'/'_',
    which understated digest length and could mis-identify the algorithm
  * test_regression_player_page_prefill -- the page was prefilled with a
    hardcoded content path instead of the server's, so hashes covered the wrong
    payload and every attempt 403'd, looking like a bad secret
  * test_regression_localhost_not_slow -- an IPv4-only bind made every
    'localhost' request pay a ~2s IPv6 fallback stall
  * test_regression_ambiguous_base64_defaults_urlsafe -- a hash with none of
    +/-_ is alphabet-ambiguous; this deployment uses url-safe, so that is the
    default rather than standard
"""

from __future__ import annotations

import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.error
import urllib.parse as up
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from wowza_token_gen import (  # noqa: E402
    TokenConfig, b64_decode_any, build_url, compute_hash, decode_tk, parse_har,
)

SECRET = "test-Secret-42."          # punctuation included on purpose
CONTENT_PATH = "live/5_razo.stream"
PREFIX = "jdtcbrndmrd"
HAR_SMALL = os.path.join(HERE, "www.camaramar.com2.har")
HAR_LARGE = os.path.join(HERE, "www.camaramar.com.har")

PORT = 0
PROC: subprocess.Popen | None = None
BASE = ""

HAS_NODE = subprocess.run(["node", "--version"], capture_output=True).returncode == 0


def free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def setUpModule() -> None:
    """Boot the mock edge on a free port."""
    global PORT, PROC, BASE
    PORT = free_port()
    BASE = f"http://127.0.0.1:{PORT}"
    PROC = subprocess.Popen(
        [sys.executable, os.path.join(HERE, "mock_wowza.py"),
         "--secret", SECRET, "--port", str(PORT),
         "--content-path", CONTENT_PATH, "--prefix", PREFIX, "--quiet"],
        cwd=HERE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
    )
    # Generous deadline: the first ever run renders test video with ffmpeg.
    deadline = time.time() + 180
    while time.time() < deadline:
        if PROC.poll() is not None:
            raise RuntimeError(f"mock_wowza died on startup:\n{PROC.stdout.read()}")
        s = socket.socket()
        s.settimeout(0.5)
        try:
            s.connect(("127.0.0.1", PORT))
            s.close()
            return
        except OSError:
            s.close()
    raise RuntimeError("mock_wowza never started listening")


def wait_for_port(port: int, proc: subprocess.Popen, timeout: float = 60) -> None:
    """Block until a mock server is accepting connections on `port`."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        if proc.poll() is not None:
            raise RuntimeError(f"mock_wowza exited with {proc.returncode} on startup")
        s = socket.socket()
        s.settimeout(0.5)
        try:
            s.connect(("127.0.0.1", port))
            s.close()
            return
        except OSError:
            s.close()
    raise RuntimeError(f"mock_wowza never listened on {port}")


def tearDownModule() -> None:
    if PROC and PROC.poll() is None:
        PROC.terminate()
        try:
            PROC.wait(timeout=10)
        except subprocess.TimeoutExpired:
            PROC.kill()


def cfg(**over) -> TokenConfig:
    base = dict(scheme="http", host=f"127.0.0.1:{PORT}", content_path=CONTENT_PATH,
                playlist="playlist.m3u8", prefix=PREFIX, algo="sha256", urlsafe_b64=True)
    base.update(over)
    return TokenConfig(**base)


def get(url: str, timeout: float = 20.0) -> tuple[int, bytes]:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


# --------------------------------------------------------------------------- #
class TestHashConstruction(unittest.TestCase):
    """Pure algorithm -- no server involved."""

    def test_payload_shape_and_sorting(self):
        c = cfg()
        params = {f"{PREFIX}starttime": "1786342062", f"{PREFIX}endtime": "1786343872"}
        # 'zzz' sorts after both params; 'AAA' before. Either way the digest must
        # be stable and the payload must be contentPath + '?' + sorted parts.
        for secret in ("zzz-secret", "AAA-secret"):
            h = compute_hash(c, secret, params)
            self.assertEqual(len(b64_decode_any(h)), 32)

    def test_hash_is_deterministic(self):
        c = cfg()
        p = {f"{PREFIX}starttime": "1", f"{PREFIX}endtime": "2"}
        self.assertEqual(compute_hash(c, SECRET, p), compute_hash(c, SECRET, p))

    def test_hash_param_excluded_from_its_own_digest(self):
        c = cfg()
        p = {f"{PREFIX}starttime": "1", f"{PREFIX}endtime": "2"}
        with_hash = dict(p, **{f"{PREFIX}hash": "should-be-ignored"})
        self.assertEqual(compute_hash(c, SECRET, p), compute_hash(c, SECRET, with_hash))

    def test_alphabets_differ_only_in_two_chars(self):
        u, s = cfg(urlsafe_b64=True), cfg(urlsafe_b64=False)
        p = {f"{PREFIX}starttime": "1786342062", f"{PREFIX}endtime": "1786343872"}
        for i in range(60):
            p[f"{PREFIX}starttime"] = str(1786342062 + i)
            hu, hs = compute_hash(u, SECRET, p), compute_hash(s, SECRET, p)
            if hs != hu:
                self.assertEqual(hs.replace("+", "-").replace("/", "_"), hu)
                self.assertEqual(b64_decode_any(hu), b64_decode_any(hs))
                return
        self.skipTest("no digest with +/ found in 60 tries")

    def test_unicode_secret(self):
        c = cfg()
        p = {f"{PREFIX}starttime": "1", f"{PREFIX}endtime": "2"}
        h = compute_hash(c, "clave-secreta-ñ-€", p)
        self.assertEqual(len(b64_decode_any(h)), 32)
        self.assertNotEqual(h, compute_hash(c, "clave-secreta-n-E", p))

    def test_digest_sizes(self):
        for algo, size in (("sha256", 32), ("sha384", 48), ("sha512", 64)):
            h = compute_hash(cfg(algo=algo), SECRET,
                             {f"{PREFIX}starttime": "1", f"{PREFIX}endtime": "2"})
            self.assertEqual(len(b64_decode_any(h)), size, algo)

    def test_url_encoding_of_padding(self):
        url, _ = build_url(cfg(), SECRET, 1786342062, 1786343872)
        self.assertIn("%3D", url, "base64 padding must be percent-encoded")
        self.assertNotIn("=&", url)

    def test_regression_urlsafe_digest_length(self):
        """b64decode drops '-'/'_' -- must use b64_decode_any."""
        urlsafe = "RPd8zmtnIpi6wJf_Ha6lCcM5Asoy-JOOplyqriKFO_U="
        self.assertEqual(len(b64_decode_any(urlsafe)), 32)
        import base64
        naive = len(base64.b64decode(urlsafe))
        self.assertNotEqual(naive, 32, "if this passes, the bug can't recur")


class TestHarParsing(unittest.TestCase):
    def setUp(self):
        if not os.path.exists(HAR_SMALL):
            self.skipTest("capture files not present")

    def test_detects_format_from_small_har(self):
        s = parse_har(HAR_SMALL)[0]
        self.assertEqual(s.cfg.prefix, PREFIX)
        self.assertEqual(s.cfg.content_path, CONTENT_PATH)
        self.assertEqual(s.cfg.playlist, "playlist.m3u8")
        self.assertEqual(s.cfg.algo, "sha256")
        self.assertEqual(len(b64_decode_any(s.hash_value)), 32)

    def test_window_is_1810(self):
        s = parse_har(HAR_SMALL)[0]
        start = int(s.params[f"{PREFIX}starttime"])
        end = int(s.params[f"{PREFIX}endtime"])
        self.assertEqual(end - start, 1810)

    def test_regression_ambiguous_base64_defaults_urlsafe(self):
        """The small capture's hash has none of +/-_; must default to url-safe."""
        s = parse_har(HAR_SMALL)[0]
        self.assertNotRegex(s.hash_value, r"[-_+/]")
        self.assertTrue(s.cfg.urlsafe_b64)

    def test_large_har_hash_proves_urlsafe(self):
        if not os.path.exists(HAR_LARGE):
            self.skipTest("large capture not present")
        hashes = [s.hash_value for s in parse_har(HAR_LARGE)]
        self.assertTrue(any("-" in h or "_" in h for h in hashes),
                        "expected a url-safe hash in the large capture")
        for h in hashes:
            self.assertNotRegex(h, r"[+/]")

    def test_decode_tk(self):
        name = ("chunklist_w1118803148_tkamR0Y2JybmRtcmRzdGFydHRpbWU9MTc4NjM0MTg3OSZqZHRj"
                "YnJuZG1yZGVuZHRpbWU9MTc4NjM0MzY4OSZqZHRjYnJuZG1yZGhhc2g9UlBkOHptdG5JcGk2"
                "d0pmX0hhNmxDY001QXNveS1KT09wbHlxcmlLRk9fVT0=.m3u8")
        decoded = decode_tk(name)
        self.assertIn(f"{PREFIX}starttime=1786341879", decoded)
        self.assertIn(f"{PREFIX}hash=RPd8zmtnIpi6wJf_Ha6lCcM5Asoy-JOOplyqriKFO_U=", decoded)

    def test_spec_matches_capture(self):
        spec_path = os.path.join(HERE, "token_spec.json")
        if not os.path.exists(spec_path):
            self.skipTest("token_spec.json not present")
        with open(spec_path, encoding="utf-8") as fh:
            spec = json.load(fh)
        s = parse_har(HAR_SMALL)[0]
        self.assertEqual(spec["token"]["param_prefix"], s.cfg.prefix)
        self.assertEqual(spec["content"]["content_path"], s.cfg.content_path)
        self.assertEqual(spec["token"]["digest"], s.cfg.algo)
        self.assertEqual(spec["token"]["base64_alphabet"], "url-safe")
        self.assertEqual(spec["timing"]["window_seconds"], 1810)
        self.assertIsNone(spec["shared_secret"])


class TestEdgeAcceptance(unittest.TestCase):
    def test_valid_token_accepted(self):
        now = int(time.time())
        url, _ = build_url(cfg(), SECRET, now - 13, now + 1800)
        code, body = get(url)
        self.assertEqual(code, 200)
        self.assertTrue(body.startswith(b"#EXTM3U"))

    def test_wrong_secret_rejected(self):
        now = int(time.time())
        url, _ = build_url(cfg(), SECRET + "x", now - 13, now + 1800)
        code, body = get(url)
        self.assertEqual(code, 403)
        self.assertIn(b"hash mismatch", body)

    def test_expired_token_rejected(self):
        now = int(time.time())
        url, _ = build_url(cfg(), SECRET, now - 3600, now - 1800)
        code, body = get(url)
        self.assertEqual(code, 403)
        self.assertIn(b"expired", body)

    def test_future_token_rejected(self):
        now = int(time.time())
        url, _ = build_url(cfg(), SECRET, now + 600, now + 2400)
        code, body = get(url)
        self.assertEqual(code, 403)
        self.assertIn(b"not yet valid", body)

    def test_missing_params_rejected(self):
        code, body = get(f"{BASE}/{CONTENT_PATH}/playlist.m3u8?foo=1")
        self.assertEqual(code, 403)
        self.assertIn(b"missing token param", body)

    def test_no_query_rejected(self):
        code, _ = get(f"{BASE}/{CONTENT_PATH}/playlist.m3u8")
        self.assertEqual(code, 403)

    def test_wrong_content_path_rejected(self):
        """Signing the wrong path is the bug that looked like a bad secret."""
        now = int(time.time())
        c = cfg(content_path="live/test.stream")
        url, params = build_url(c, SECRET, now - 13, now + 1800)
        # aim the request at the real path but keep the wrongly-signed hash
        wrong = url.replace("live/test.stream", CONTENT_PATH)
        code, body = get(wrong)
        self.assertEqual(code, 403)
        self.assertIn(b"hash mismatch", body)

    def test_wrong_prefix_rejected(self):
        now = int(time.time())
        url, _ = build_url(cfg(prefix="otroprefijo"), SECRET, now - 13, now + 1800)
        code, body = get(url)
        self.assertEqual(code, 403)
        self.assertIn(b"missing token param", body)

    def test_wrong_alphabet_rejected_with_hint(self):
        now = int(time.time())
        for i in range(80):
            url, params = build_url(cfg(urlsafe_b64=False), SECRET, now - 13 - i, now + 1800)
            h = params[f"{PREFIX}hash"]
            if "+" in h or "/" in h:
                code, body = get(url)
                self.assertEqual(code, 403)
                self.assertIn(b"base64 alphabet mismatch", body)
                return
        self.skipTest("no digest with +/ found in 80 tries")

    def test_tampered_hash_rejected(self):
        now = int(time.time())
        url, params = build_url(cfg(), SECRET, now - 13, now + 1800)
        h = params[f"{PREFIX}hash"]
        flipped = ("A" if h[0] != "A" else "B") + h[1:]
        code, _ = get(url.replace(up.quote(h, safe=""), up.quote(flipped, safe="")))
        self.assertEqual(code, 403)

    def test_extended_window_not_honoured_without_resigning(self):
        """Moving endtime without re-signing must fail -- no window extension."""
        now = int(time.time())
        url, params = build_url(cfg(), SECRET, now - 13, now + 60)
        tampered = url.replace(f"{PREFIX}endtime={now + 60}",
                               f"{PREFIX}endtime={now + 999999}")
        code, body = get(tampered)
        self.assertEqual(code, 403)
        self.assertIn(b"hash mismatch", body)


class TestBase64Diagnostics(unittest.TestCase):
    """A lost '=' and a swapped alphabet both leave the digest bytes intact.
    Both must be named explicitly, because the strings are 44 chars long and the
    difference is invisible when eyeballed."""

    GOOD = "rj02tspcWaDwn5L3_aC76HDnk-3I2MiPxrCFI_UlRPo="

    def test_classify_padding_loss(self):
        from mock_wowza import classify_hash_difference
        kind, same, msg = classify_hash_difference(self.GOOD.rstrip("="), self.GOOD)
        self.assertEqual(kind, "padding")
        self.assertTrue(same)
        self.assertIn("SECRET IS CORRECT", msg)

    def test_classify_alphabet_swap(self):
        from mock_wowza import classify_hash_difference
        standard = self.GOOD.replace("-", "+").replace("_", "/")
        kind, same, msg = classify_hash_difference(standard, self.GOOD)
        self.assertEqual(kind, "alphabet")
        self.assertTrue(same)

    def test_classify_genuine_mismatch(self):
        from mock_wowza import classify_hash_difference
        other = "X" + self.GOOD[1:]
        kind, same, _ = classify_hash_difference(other, self.GOOD)
        self.assertEqual(kind, "different")
        self.assertFalse(same)

    def test_classify_survives_malformed_input(self):
        from mock_wowza import classify_hash_difference
        kind, same, _ = classify_hash_difference("!!!not base64!!!", self.GOOD)
        self.assertEqual(kind, "different")
        self.assertFalse(same)

    def test_unpadded_hash_rejected_but_explained(self):
        """The reported bug: correct secret, '=' lost in transit."""
        now = int(time.time())
        url, _ = build_url(cfg(), SECRET, now - 13, now + 1800)
        self.assertIn("%3D", url)
        code, body = get(url.replace("%3D", ""))
        self.assertEqual(code, 403, "a real edge compares strings, so this must fail")
        text = body.decode()
        self.assertIn("PADDING differs", text)
        self.assertIn("SECRET IS CORRECT", text)
        self.assertNotIn("differ in their BYTES", text)


class TestLenientBase64(unittest.TestCase):
    """--lenient-base64 accepts digests that are right but encoded differently."""

    proc: subprocess.Popen | None = None
    port = 0

    @classmethod
    def setUpClass(cls):
        cls.port = free_port()
        cls.proc = subprocess.Popen(
            [sys.executable, os.path.join(HERE, "mock_wowza.py"),
             "--secret", SECRET, "--port", str(cls.port),
             "--content-path", CONTENT_PATH, "--prefix", PREFIX,
             "--lenient-base64", "--quiet"],
            cwd=HERE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        deadline = time.time() + 120
        while time.time() < deadline:
            s = socket.socket()
            s.settimeout(0.5)
            try:
                s.connect(("127.0.0.1", cls.port))
                s.close()
                return
            except OSError:
                s.close()
        raise RuntimeError("lenient mock never started")

    @classmethod
    def tearDownClass(cls):
        if cls.proc and cls.proc.poll() is None:
            cls.proc.terminate()
            try:
                cls.proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                cls.proc.kill()

    def _cfg(self):
        return cfg(host=f"127.0.0.1:{self.port}")

    def test_unpadded_accepted_when_lenient(self):
        now = int(time.time())
        url, _ = build_url(self._cfg(), SECRET, now - 13, now + 1800)
        code, body = get(url.replace("%3D", ""))
        self.assertEqual(code, 200)
        self.assertTrue(body.startswith(b"#EXTM3U"))

    def test_wrong_alphabet_accepted_when_lenient(self):
        now = int(time.time())
        for i in range(80):
            url, params = build_url(cfg(host=f"127.0.0.1:{self.port}", urlsafe_b64=False),
                                    SECRET, now - 13 - i, now + 1800)
            h = params[f"{PREFIX}hash"]
            if "+" in h or "/" in h:
                code, _ = get(url)
                self.assertEqual(code, 200, "lenient mode should accept the other alphabet")
                return
        self.skipTest("no digest with +/ found in 80 tries")

    def test_genuinely_wrong_secret_still_rejected_when_lenient(self):
        """Leniency must extend to encoding only, never to the digest itself."""
        now = int(time.time())
        url, _ = build_url(self._cfg(), SECRET + "x", now - 13, now + 1800)
        code, body = get(url)
        self.assertEqual(code, 403)
        self.assertIn(b"differ in their BYTES", body)


class TestHlsChain(unittest.TestCase):
    def test_playlist_chunklist_segment(self):
        now = int(time.time())
        url, _ = build_url(cfg(), SECRET, now - 13, now + 1800)
        code, body = get(url)
        self.assertEqual(code, 200)

        variants = [l.strip() for l in body.decode().splitlines()
                    if l.strip() and not l.startswith("#")]
        self.assertTrue(variants, "master playlist listed no variant")
        chunk_url = up.urljoin(url, variants[0])

        code, cb = get(chunk_url)
        self.assertEqual(code, 200, "chunklist refused")
        media = cb.decode()
        segs = [l.strip() for l in media.splitlines()
                if l.strip() and not l.startswith("#")]
        self.assertGreater(len(segs), 1, "expected several segments")

        code, sb = get(up.urljoin(chunk_url, segs[0]))
        self.assertEqual(code, 200, "segment refused")
        self.assertGreater(len(sb), 10_000)
        self.assertEqual(sb[:1], bytes([0x47]), "not a valid MPEG-TS sync byte")

    def test_segment_requires_its_own_valid_token(self):
        now = int(time.time())
        url, _ = build_url(cfg(), SECRET, now - 13, now + 1800)
        _, body = get(url)
        chunk_url = up.urljoin(url, body.decode().strip().splitlines()[-1])
        _, cb = get(chunk_url)
        seg = [l for l in cb.decode().splitlines() if l.strip() and not l.startswith("#")][0]
        seg_url = up.urljoin(chunk_url, seg)
        # strip the query -> segment must be refused
        code, _ = get(seg_url.split("?")[0])
        self.assertEqual(code, 403)

    def test_expiry_takes_effect_mid_playback(self):
        now = int(time.time())
        url, _ = build_url(cfg(), SECRET, now - 5, now + 2)
        code, body = get(url)
        self.assertEqual(code, 200, "should be valid at first")
        chunk_url = up.urljoin(url, body.decode().strip().splitlines()[-1])
        time.sleep(3.5)
        code, body = get(chunk_url)
        self.assertEqual(code, 403, "should be refused once expired")
        self.assertIn(b"expired", body)


class TestTokenEndpoint(unittest.TestCase):
    def test_token_endpoint_issues_playable_url(self):
        code, body = get(f"{BASE}/token")
        self.assertEqual(code, 200)
        data = json.loads(body)
        self.assertIn("url", data)
        self.assertGreater(data["expires_at"], int(time.time()))
        code, pl = get(data["url"])
        self.assertEqual(code, 200)
        self.assertTrue(pl.startswith(b"#EXTM3U"))

    def test_token_endpoint_honours_window(self):
        code, body = get(f"{BASE}/token?window=45")
        self.assertEqual(code, 200)
        data = json.loads(body)
        q = dict(up.parse_qsl(up.urlsplit(data["url"]).query))
        span = int(q[f"{PREFIX}endtime"]) - int(q[f"{PREFIX}starttime"])
        self.assertEqual(span, 45)


class TestPlayerPage(unittest.TestCase):
    def test_page_is_served(self):
        code, body = get(f"{BASE}/")
        self.assertEqual(code, 200)
        self.assertIn(b"Wowza SecureToken", body)

    def _prefill(self) -> dict:
        import re
        _, body = get(f"{BASE}/")
        m = re.search(r"var pre = (\{.*?\});", body.decode("utf-8", "replace"), re.S)
        self.assertIsNotNone(m, "server did not inject its config into the page")
        return json.loads(m.group(1))

    def test_regression_player_page_prefill(self):
        """The page must be prefilled with the server's OWN config, not literals."""
        pre = self._prefill()
        self.assertEqual(pre["path"], CONTENT_PATH)
        self.assertEqual(pre["prefix"], PREFIX)
        self.assertEqual(pre["scheme"], "http")
        self.assertEqual(pre["b64"], "url")
        self.assertEqual(pre["algo"], "SHA-256")
        self.assertIn(str(PORT), pre["host"])

    def test_token_built_from_prefill_is_accepted(self):
        """End-to-end proof that 'Generate & play' works with the served values."""
        pre = self._prefill()
        c = TokenConfig(scheme=pre["scheme"], host=pre["host"], content_path=pre["path"],
                        playlist=pre["playlist"], prefix=pre["prefix"],
                        algo=pre["algo"].lower().replace("-", ""),
                        urlsafe_b64=(pre["b64"] == "url"))
        now = int(time.time())
        url, _ = build_url(c, SECRET, now - 13, now + 1810 - 13)
        code, body = get(url)
        self.assertEqual(code, 200, f"prefilled values produced a rejected token: {url}")
        self.assertTrue(body.startswith(b"#EXTM3U"))

    def test_regression_empty_secret_aborts(self):
        """An empty secret must ABORT, not warn-and-continue.

        Signing with "" yields a well-formed URL, a guaranteed 403, and an
        hls.js networkError that pushes the actual cause out of view. The page
        must refuse to request anything at all.
        """
        _, body = get(f"{BASE}/")
        src = body.decode("utf-8", "replace")

        gen = src.split("function generate()", 1)
        self.assertEqual(len(gen), 2, "generate() not found in the served page")
        head = gen[1][:900]

        self.assertIn("Promise.reject", head,
                      "generate() does not abort when the secret is empty")
        self.assertNotIn("the edge will reject the URL", head,
                         "empty secret still only warns instead of aborting")
        # The abort must come before any hashing work is scheduled.
        self.assertLess(head.index("Promise.reject"), head.index("buildUrl"),
                        "the empty-secret guard runs after the URL is built")

    def test_every_generate_caller_handles_rejection(self):
        """generate() now rejects, so no call site may leave it unhandled."""
        _, body = get(f"{BASE}/")
        src = body.decode("utf-8", "replace")
        for line_no, line in enumerate(src.splitlines(), 1):
            if "generate()" in line and "function generate()" not in line:
                self.assertTrue(
                    ".catch(" in line or "return generate()" in line
                    or "current ? Promise.resolve(current) : generate()" in line,
                    f"line {line_no} calls generate() without handling rejection: "
                    f"{line.strip()}")


CAPTURED = os.path.join(HERE, "captured_hls")


@unittest.skipUnless(os.path.exists(os.path.join(CAPTURED, "chunklist.m3u8")),
                     "captured_hls/ not built -- run extract_captured_hls.py")
class TestCapturedMedia(unittest.TestCase):
    """The real footage rebuilt from the HAR must be a valid, ordered ladder."""

    @classmethod
    def setUpClass(cls):
        with open(os.path.join(CAPTURED, "manifest.json"), encoding="utf-8") as f:
            cls.man = json.load(f)
        with open(os.path.join(CAPTURED, "chunklist.m3u8"), encoding="utf-8") as f:
            cls.m3u8 = f.read()

    def test_every_segment_is_real_mpeg_ts(self):
        """A truncated HAR body would fail deep inside the player, not here."""
        for item in self.man["items"]:
            p = os.path.join(CAPTURED, item["file"])
            self.assertTrue(os.path.exists(p), f"{item['file']} listed but missing")
            self.assertEqual(os.path.getsize(p), item["bytes"])
            with open(p, "rb") as f:
                head = f.read(188 * 3)
            self.assertEqual(head[0], 0x47, f"{item['file']} lacks the TS sync byte")
            # Packet boundaries must keep sync, or the body was mangled in export.
            for n in (1, 2):
                self.assertEqual(head[n * 188], 0x47,
                                 f"{item['file']} lost sync at packet {n}")

    def test_segments_are_in_stream_sequence_order(self):
        """Wowza's seq is stream-global, so a multi-session capture still sorts."""
        seqs = [i["seq"] for i in self.man["items"] if i["seq"] is not None]
        self.assertGreater(len(seqs), 1, "no numbered segments to order")
        self.assertEqual(seqs, sorted(seqs), "segments are out of stream order")
        self.assertEqual(len(seqs), len(set(seqs)), "duplicate sequence numbers")

    def test_discontinuity_marks_every_gap(self):
        """Missing a tag makes the player stall on the timestamp jump."""
        seqs = [i["seq"] for i in self.man["items"] if i["seq"] is not None]
        gaps = sum(1 for a, b in zip(seqs, seqs[1:]) if b != a + 1)
        tags = self.m3u8.count("#EXT-X-DISCONTINUITY")
        self.assertEqual(tags, gaps,
                         f"{gaps} sequence gaps but {tags} discontinuity tags")
        self.assertEqual(self.man["discontinuities"], gaps)

    def test_chunklist_is_well_formed_vod(self):
        lines = self.m3u8.splitlines()
        self.assertEqual(lines[0], "#EXTM3U")
        self.assertIn("#EXT-X-ENDLIST", lines)
        self.assertIn("#EXT-X-PLAYLIST-TYPE:VOD", lines)
        listed = [l for l in lines if l.endswith(".ts")]
        self.assertEqual(len(listed), len(self.man["items"]))
        # Every #EXTINF must be followed by a segment, or the player mis-times.
        extinf = [i for i, l in enumerate(lines) if l.startswith("#EXTINF:")]
        self.assertEqual(len(extinf), len(listed))
        for i in extinf:
            self.assertTrue(lines[i + 1].endswith(".ts"),
                            f"#EXTINF at line {i + 1} is not followed by a segment")
        # TARGETDURATION must not undercut any #EXTINF, per RFC 8216.
        target = next(int(l.split(":")[1]) for l in lines
                      if l.startswith("#EXT-X-TARGETDURATION:"))
        for l in lines:
            if l.startswith("#EXTINF:"):
                self.assertLessEqual(float(l.split(":")[1].rstrip(",")), target)

    def test_captured_media_is_served_through_the_token_gate(self):
        """The real footage must still require a valid token, like anything else."""
        d = tempfile.mkdtemp()
        port = free_port()
        # Reuse the already-built ladder; only the smallest segment, to stay quick.
        smallest = min(self.man["items"], key=lambda i: i["bytes"])
        shutil.copy(os.path.join(CAPTURED, "chunklist.m3u8"), d)
        for item in self.man["items"]:
            open(os.path.join(d, item["file"]), "wb").close()
        with open(os.path.join(d, smallest["file"]), "wb") as f:
            with open(os.path.join(CAPTURED, smallest["file"]), "rb") as src:
                f.write(src.read())

        proc = subprocess.Popen(
            [sys.executable, os.path.join(HERE, "mock_wowza.py"),
             "--secret", SECRET, "--port", str(port),
             "--content-path", CONTENT_PATH, "--media-dir", d, "--quiet"],
            stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
        try:
            wait_for_port(port, proc)
            c = cfg(scheme="http", host=f"127.0.0.1:{port}")
            now = int(time.time())
            url, _ = build_url(c, SECRET, now - 13, now + 1810)

            code, body = get(url)
            self.assertEqual(code, 200, "signed request to captured media refused")
            code, body = get(url.replace("playlist.m3u8", "chunklist.m3u8"))
            self.assertEqual(code, 200)
            self.assertIn(b"#EXT-X-ENDLIST", body)

            # And unsigned must still be refused -- real content is not a bypass.
            plain = url.split("?")[0]
            code, _ = get(plain)
            self.assertIn(code, (401, 403),
                          "captured media served without a token")
        finally:
            proc.terminate()
            proc.wait(timeout=10)
            shutil.rmtree(d, ignore_errors=True)


@unittest.skipUnless(os.path.exists(os.path.join(HERE, "serve_stream.py")),
                     "serve_stream.py not present")
class TestStreamServer(unittest.TestCase):
    """The no-auth playback server: MIME types and Range, the two things that
    silently break <video> without producing a useful error."""

    @classmethod
    def setUpClass(cls):
        cls.port = free_port()
        cls.proc = subprocess.Popen(
            [sys.executable, os.path.join(HERE, "serve_stream.py"),
             "--port", str(cls.port), "--quiet"],
            cwd=HERE, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
        wait_for_port(cls.port, cls.proc)
        cls.base = f"http://127.0.0.1:{cls.port}"

    @classmethod
    def tearDownClass(cls):
        cls.proc.terminate()
        try:
            cls.proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            cls.proc.kill()

    def head(self, path: str, headers: dict | None = None):
        # Return the header object itself, not dict(...) -- http.server emits
        # "Content-type" with a lowercase t, and a plain dict lookup for
        # "Content-Type" silently returns None.
        req = urllib.request.Request(self.base + path, headers=headers or {})
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                return r.status, r.headers, r.read()
        except urllib.error.HTTPError as e:
            return e.code, e.headers, e.read()

    def test_root_serves_the_test_page(self):
        code, hdrs, body = self.head("/")
        self.assertEqual(code, 200)
        self.assertIn(b"Prueba de stream", body)
        self.assertIn("text/html", hdrs.get("Content-Type", ""))

    def test_playlist_mime_type(self):
        """text/plain makes the browser display the playlist instead of playing it."""
        code, hdrs, _ = self.head("/captured_hls/chunklist.m3u8")
        if code == 404:
            self.skipTest("captured_hls not built")
        self.assertEqual(code, 200)
        self.assertEqual(hdrs.get("Content-Type"), "application/vnd.apple.mpegurl")

    def test_segment_mime_type(self):
        code, hdrs, _ = self.head("/captured_hls/cap_000.ts")
        if code == 404:
            self.skipTest("captured_hls not built")
        self.assertEqual(hdrs.get("Content-Type"), "video/mp2t")

    def test_regression_range_requests_are_honoured(self):
        """SimpleHTTPRequestHandler ignores Range while we advertise support.

        Advertising Accept-Ranges and then answering 200 with the whole body is
        worse than silence: the browser seeks, gets byte 0, and the scrub bar
        misbehaves with no error anywhere.
        """
        target = "/captured_hls/captured_stream.mp4"
        code, hdrs, _ = self.head(target)
        if code == 404:
            self.skipTest("captured_stream.mp4 not built")
        self.assertEqual(hdrs.get("Accept-Ranges"), "bytes",
                         "server does not advertise range support")
        size = int(hdrs["Content-Length"])

        code, hdrs, body = self.head(target, {"Range": "bytes=1000000-1000099"})
        self.assertEqual(code, 206, "Range request was not honoured")
        self.assertEqual(hdrs.get("Content-Range"), f"bytes 1000000-1000099/{size}")
        self.assertEqual(len(body), 100)

        # And the bytes must come from that offset, not from the start.
        with open(os.path.join(HERE, "captured_hls", "captured_stream.mp4"), "rb") as f:
            f.seek(1000000)
            self.assertEqual(body, f.read(100), "206 body is from the wrong offset")

    def test_suffix_range(self):
        target = "/captured_hls/captured_stream.mp4"
        code, hdrs, _ = self.head(target)
        if code == 404:
            self.skipTest("captured_stream.mp4 not built")
        size = int(hdrs["Content-Length"])
        code, hdrs, body = self.head(target, {"Range": "bytes=-500"})
        self.assertEqual(code, 206)
        self.assertEqual(len(body), 500)
        self.assertEqual(hdrs.get("Content-Range"),
                         f"bytes {size - 500}-{size - 1}/{size}")

    def test_unsatisfiable_range_is_416(self):
        code, hdrs, _ = self.head("/captured_hls/captured_stream.mp4",
                                  {"Range": "bytes=99999999999-"})
        if code == 404:
            self.skipTest("captured_stream.mp4 not built")
        self.assertEqual(code, 416)
        self.assertTrue(hdrs.get("Content-Range", "").startswith("bytes */"))

    def test_accept_ranges_sent_exactly_once(self):
        """A duplicated header is a protocol smell and confuses some players."""
        for hdrs_in in ({}, {"Range": "bytes=0-99"}):
            req = urllib.request.Request(
                self.base + "/captured_hls/captured_stream.mp4", headers=hdrs_in)
            try:
                with urllib.request.urlopen(req, timeout=20) as r:
                    vals = r.headers.get_all("Accept-Ranges") or []
            except urllib.error.HTTPError:
                self.skipTest("captured_stream.mp4 not built")
            self.assertEqual(len(vals), 1,
                             f"Accept-Ranges sent {len(vals)} times for {hdrs_in}")

    def test_page_references_only_local_assets(self):
        """No CDN: the page must work with the network unplugged."""
        with open(os.path.join(HERE, "stream_test.html"), encoding="utf-8") as f:
            src = f.read()
        for bad in ("http://cdn", "https://cdn", "unpkg.com", "jsdelivr",
                    "googleapis.com"):
            self.assertNotIn(bad, src, f"page still references {bad}")


class TestPerformance(unittest.TestCase):
    def test_regression_localhost_not_slow(self):
        """An IPv4-only bind cost ~2s per request via 'localhost' (IPv6 first)."""
        try:
            socket.getaddrinfo("localhost", PORT, type=socket.SOCK_STREAM)
        except socket.gaierror:
            self.skipTest("localhost does not resolve")
        times = []
        for _ in range(3):
            t = time.time()
            code, _ = get(f"http://localhost:{PORT}/token")
            if code != 200:
                self.skipTest("token endpoint unavailable over localhost")
            times.append(time.time() - t)
        best = min(times)
        self.assertLess(best, 0.5,
                        f"'localhost' requests are slow ({best:.2f}s) -- "
                        "IPv6 loopback listener missing?")


@unittest.skipUnless(HAS_NODE, "node not available")
class TestJsPythonParity(unittest.TestCase):
    """The browser page must produce byte-identical hashes to the Python tool."""

    RUNNER = r"""
const fs=require('fs'), vm=require('vm');
const html=fs.readFileSync(process.argv[2],'utf8');
const core=html.split('// ---8<--- TOKEN CORE START')[1]
               .split('// ---8<--- TOKEN CORE END')[0];
function load(withSubtle){
  const mod={exports:{}};
  const sb={module:mod,TextEncoder,Buffer,console,
    btoa:s=>Buffer.from(s,'binary').toString('base64'),
    atob:s=>Buffer.from(s,'base64').toString('binary')};
  if(withSubtle) sb.crypto=globalThis.crypto;
  vm.createContext(sb);
  vm.runInContext(core.slice(core.indexOf('(function')),sb);
  return mod.exports.WowzaToken;
}
const vectors=JSON.parse(fs.readFileSync(process.argv[3],'utf8'));
(async()=>{
  const out=[];
  for(const mode of [true,false]){
    const WT=load(mode);
    for(const v of vectors){
      const tag={name:v.name,mode:mode?'webcrypto':'purejs'};
      try{
        const r=await WT.buildUrl(v.cfg,v.secret,v.start,v.end);
        out.push(Object.assign(tag,{url:r.url}));
      }catch(e){
        out.push(Object.assign(tag,{error:e.message}));
      }
    }
  }
  console.log(JSON.stringify(out));
})();
"""

    def test_parity_across_both_crypto_paths(self):
        page = os.path.join(HERE, "wowza_token_player.html")
        if not os.path.exists(page):
            self.skipTest("player page not present")

        cases = [
            ("basic", cfg(), SECRET, 1786342062, 1786343872),
            ("urlsafe-off", cfg(urlsafe_b64=False), "RoundTrip!S3cret", 1786342612, 1786344422),
            ("unicode", cfg(), "clave-secreta-ñ-€", 1786342062, 1786343872),
            ("extra-clientip", cfg(extra={"clientip": "203.0.113.9"}), SECRET, 1, 2),
            ("secret-sorts-last", cfg(extra={"aaa": "1"}), "zzz-last", 1786342062, 1786343872),
            ("sha512", cfg(algo="sha512"), SECRET, 1786342062, 1786343872),
        ]

        vectors, expected, algos = [], {}, {}
        for name, c, secret, start, end in cases:
            url, _ = build_url(c, secret, start, end)
            expected[name] = url
            algos[name] = c.algo
            vectors.append({
                "name": name, "secret": secret, "start": start, "end": end,
                "cfg": {"scheme": c.scheme, "host": c.host, "contentPath": c.content_path,
                        "playlist": c.playlist, "prefix": c.prefix,
                        "algo": c.algo.upper().replace("SHA", "SHA-"),
                        "urlsafe": c.urlsafe_b64,
                        "extra": [{"name": k, "value": v} for k, v in c.extra.items()]},
            })

        with tempfile.TemporaryDirectory() as td:
            runner = os.path.join(td, "runner.js")
            vecs = os.path.join(td, "vectors.json")
            with open(runner, "w", encoding="utf-8") as fh:
                fh.write(self.RUNNER)
            with open(vecs, "w", encoding="utf-8") as fh:
                json.dump(vectors, fh, ensure_ascii=False)
            proc = subprocess.run(["node", runner, page, vecs],
                                  capture_output=True, text=True, encoding="utf-8")
        self.assertEqual(proc.returncode, 0, f"node failed:\n{proc.stderr}")
        results = json.loads(proc.stdout)
        self.assertEqual(len(results), len(cases) * 2, "expected both crypto paths")
        checked = 0
        for r in results:
            name, mode = r["name"], r["mode"]
            # The in-page fallback deliberately implements SHA-256 only, so a
            # non-SHA-256 vector must fail there with a clear explanation rather
            # than silently producing a wrong digest.
            if mode == "purejs" and algos[name] != "sha256":
                self.assertIn("error", r, f"{name} should have been refused via purejs")
                self.assertIn("WebCrypto unavailable", r["error"])
                continue
            self.assertNotIn("error", r, f"{name} errored via {mode}: {r.get('error')}")
            self.assertEqual(r["url"], expected[name],
                             f"{name} mismatched via {mode}")
            checked += 1
        self.assertGreaterEqual(checked, len(cases), "too few parity comparisons")

    def test_js_token_accepted_by_the_edge(self):
        """A hash computed by the page's JS must satisfy the server."""
        page = os.path.join(HERE, "wowza_token_player.html")
        if not os.path.exists(page):
            self.skipTest("player page not present")
        now = int(time.time())
        c = cfg()
        vectors = [{"name": "live", "secret": SECRET, "start": now - 13, "end": now + 1800,
                    "cfg": {"scheme": c.scheme, "host": c.host, "contentPath": c.content_path,
                            "playlist": c.playlist, "prefix": c.prefix, "algo": "SHA-256",
                            "urlsafe": True, "extra": []}}]
        with tempfile.TemporaryDirectory() as td:
            runner = os.path.join(td, "runner.js")
            vecs = os.path.join(td, "vectors.json")
            with open(runner, "w", encoding="utf-8") as fh:
                fh.write(self.RUNNER)
            with open(vecs, "w", encoding="utf-8") as fh:
                json.dump(vectors, fh)
            proc = subprocess.run(["node", runner, page, vecs],
                                  capture_output=True, text=True, encoding="utf-8")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        for r in json.loads(proc.stdout):
            code, body = get(r["url"])
            self.assertEqual(code, 200, f"JS-signed URL rejected via {r['mode']}")
            self.assertTrue(body.startswith(b"#EXTM3U"))


class TestClientEmulator(unittest.TestCase):
    def _run(self, *args, timeout=90):
        return subprocess.run(
            [sys.executable, os.path.join(HERE, "client_emulator.py"),
             "--base", BASE, *args],
            capture_output=True, text=True, cwd=HERE, timeout=timeout,
            encoding="utf-8", errors="replace")

    def test_plays_a_whole_session(self):
        p = self._run("--fast", "--max-seconds", "30")
        self.assertEqual(p.returncode, 0, p.stdout[-1500:])
        self.assertIn("edge rejections  : 0", p.stdout)
        self.assertRegex(p.stdout, r"segments fetched : [1-9]")

    def test_expiry_without_renewal_is_refused(self):
        p = self._run("--window", "12", "--no-refresh", "--max-seconds", "40")
        self.assertIn("403", p.stdout)
        self.assertIn("expired", p.stdout)


if __name__ == "__main__":
    unittest.main(verbosity=2)
