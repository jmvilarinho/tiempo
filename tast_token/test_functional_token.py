#!/usr/bin/env python3
"""
Functional end-to-end test: generate a token, then actually play the real video.

Unit tests check the hash in isolation. This one proves the whole chain works
together on real media, which is the thing that kept appearing broken:

    generate token -> master playlist -> chunklist -> every segment
    -> bytes are genuine MPEG-TS -> ffmpeg decodes them

and just as importantly, that the gate still refuses what it should. A signed
URL that plays is only half the result; if an unsigned one also plays, the token
is decoration.

It boots its own mock edge on a free port, so it never depends on a server you
already have running, and it cleans up after itself.

  python test_functional_token.py                    # full run
  python test_functional_token.py --media-dir captured_hls   # explicit media
  python test_functional_token.py --no-decode        # skip the ffmpeg stage
  python test_functional_token.py -v                 # per-segment detail

Exit code 0 = every check passed. Anything else = a real failure, and the
report says which stage and why.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse as up
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from wowza_token_gen import TokenConfig, build_url, compute_hash  # noqa: E402

SECRET = "madrid007."          # the local mock's secret; override with --secret
CONTENT_PATH = "live/5_razo.stream"
PREFIX = "jdtcbrndmrd"
TS_PACKET = 188

GREEN, RED, YELLOW, DIM, RESET = "\033[32m", "\033[31m", "\033[33m", "\033[90m", "\033[0m"
if os.name == "nt" and not os.environ.get("WT_SESSION"):
    try:                                   # enable ANSI on legacy consoles
        import ctypes
        ctypes.windll.kernel32.SetConsoleMode(
            ctypes.windll.kernel32.GetStdHandle(-11), 7)
    except Exception:                                          # noqa: BLE001
        GREEN = RED = YELLOW = DIM = RESET = ""


class Report:
    def __init__(self, verbose: bool) -> None:
        self.verbose = verbose
        self.passed = 0
        self.failed: list[tuple[str, str]] = []
        self.skipped: list[str] = []

    def stage(self, name: str) -> None:
        print(f"\n{name}")
        print("-" * max(len(name), 40))

    def ok(self, what: str, detail: str = "") -> None:
        self.passed += 1
        print(f"  {GREEN}PASS{RESET}  {what}" + (f"  {DIM}{detail}{RESET}" if detail else ""))

    def fail(self, what: str, why: str) -> None:
        self.failed.append((what, why))
        print(f"  {RED}FAIL{RESET}  {what}")
        print(f"        {RED}{why}{RESET}")

    def skip(self, what: str, why: str) -> None:
        self.skipped.append(what)
        print(f"  {YELLOW}SKIP{RESET}  {what}  {DIM}{why}{RESET}")

    def note(self, msg: str) -> None:
        if self.verbose:
            print(f"        {DIM}{msg}{RESET}")

    def check(self, what: str, cond: bool, why: str, detail: str = "") -> bool:
        if cond:
            self.ok(what, detail)
        else:
            self.fail(what, why)
        return cond


def free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


def fetch(url: str, timeout: float = 30.0) -> tuple[int, bytes, str]:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            return r.status, r.read(), r.headers.get("Content-Type", "")
    except urllib.error.HTTPError as e:
        return e.code, e.read(), e.headers.get("Content-Type", "")
    except Exception as e:                                     # noqa: BLE001
        return 0, str(e).encode(), ""


def is_mpeg_ts(body: bytes) -> tuple[bool, str]:
    """MPEG-TS is 188-byte packets, each beginning with the 0x47 sync byte."""
    if len(body) < TS_PACKET:
        return False, f"only {len(body)} bytes, shorter than one TS packet"
    if body[0] != 0x47:
        return False, f"first byte is 0x{body[0]:02x}, not the 0x47 sync byte"
    for n in (1, 2, 5, 20):
        off = n * TS_PACKET
        if off < len(body) and body[off] != 0x47:
            return False, f"lost sync at packet {n} (offset {off})"
    return True, ""


# --------------------------------------------------------------------------- #
def start_edge(port: int, media_dir: str | None) -> subprocess.Popen:
    cmd = [sys.executable, os.path.join(HERE, "mock_wowza.py"),
           "--secret", SECRET, "--port", str(port),
           "--content-path", CONTENT_PATH, "--prefix", PREFIX, "--quiet"]
    if media_dir:
        cmd += ["--media-dir", media_dir]
    proc = subprocess.Popen(cmd, cwd=HERE, stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT, text=True)
    deadline = time.time() + 180          # first run may render with ffmpeg
    while time.time() < deadline:
        if proc.poll() is not None:
            raise SystemExit(f"mock edge died on startup:\n{proc.stdout.read()}")
        s = socket.socket()
        s.settimeout(0.4)
        try:
            s.connect(("127.0.0.1", port))
            s.close()
            return proc
        except OSError:
            s.close()
    raise SystemExit("mock edge never started listening")


def main() -> int:
    global SECRET                 # must precede any use of SECRET in this scope
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--media-dir", default=None,
                    help="serve this HLS directory (default: captured_hls if it "
                         "exists, else an ffmpeg test pattern)")
    ap.add_argument("--no-decode", action="store_true",
                    help="skip the ffmpeg decode stage")
    ap.add_argument("--max-segments", type=int, default=0,
                    help="only fetch the first N segments (0 = all)")
    ap.add_argument("--secret", default=SECRET,
                    help=f"secret the mock enforces and the test signs with "
                         f"(default {SECRET!r})")
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args()

    SECRET = args.secret
    r = Report(args.verbose)

    media = args.media_dir
    if media is None:
        cap = os.path.join(HERE, "captured_hls")
        if os.path.exists(os.path.join(cap, "chunklist.m3u8")):
            media = "captured_hls"

    port = free_port()
    print(f"{DIM}mock edge on 127.0.0.1:{port}   media: "
          f"{media or 'ffmpeg test pattern'}   secret: {SECRET!r}{RESET}")
    proc = start_edge(port, media)
    tmp = tempfile.mkdtemp(prefix="functest_")

    cfg = TokenConfig(scheme="http", host=f"127.0.0.1:{port}",
                      content_path=CONTENT_PATH, prefix=PREFIX,
                      algo="sha256", urlsafe_b64=True)

    try:
        # ---------------------------------------------------------------- #
        r.stage("1. Token generation")
        now = int(time.time())
        start, end = now - 13, now - 13 + 1810      # capture's own timing
        # build_url returns (url, params) -- the hash lives in params, and the
        # URL's own copy is percent-encoded, so read it from params.
        url, params_out = build_url(cfg, SECRET, start, end)
        hash_b64 = params_out[f"{PREFIX}hash"]
        q = dict(up.parse_qsl(up.urlsplit(url).query))

        r.check("URL carries all three token params",
                {f"{PREFIX}starttime", f"{PREFIX}endtime", f"{PREFIX}hash"} <= set(q),
                f"params present: {sorted(q)}")
        r.check("window is 1810s, as captured",
                int(q[f"{PREFIX}endtime"]) - int(q[f"{PREFIX}starttime"]) == 1810,
                "window differs from the captured 1810s")
        r.check("hash decodes to a 32-byte SHA-256 digest",
                len(base64.urlsafe_b64decode(hash_b64 + "=" * (-len(hash_b64) % 4))) == 32,
                "digest is not 32 bytes")
        r.check("hash uses the URL-safe alphabet",
                "+" not in hash_b64 and "/" not in hash_b64,
                f"hash contains standard-base64 characters: {hash_b64}")
        r.check("'=' padding is percent-encoded in the URL",
                "%3D" in url or not hash_b64.endswith("="),
                "raw '=' left in the query string")
        r.note(f"url = {url}")

        # Recompute independently, to catch build_url agreeing with itself.
        payload = f"{CONTENT_PATH}?" + "&".join(sorted([
            SECRET, f"{PREFIX}starttime={start}", f"{PREFIX}endtime={end}"]))
        manual = base64.urlsafe_b64encode(
            hashlib.sha256(payload.encode()).digest()).decode()
        r.check("hash matches an independent SHA-256 of the sorted payload",
                manual == hash_b64,
                f"expected {manual}, builder produced {hash_b64}")
        r.note(f"payload = {payload.replace(SECRET, '<SECRET>')}")

        # ---------------------------------------------------------------- #
        r.stage("2. The gate refuses what it must")
        plain = url.split("?")[0]
        code, _, _ = fetch(plain)
        r.check("unsigned request refused", code in (401, 403),
                f"served with no token at all (HTTP {code})", f"HTTP {code}")

        bad = url[:-8] + ("A" if url[-8] != "A" else "B") + url[-7:]
        code, _, _ = fetch(bad)
        r.check("tampered hash refused", code in (401, 403),
                f"accepted a modified hash (HTTP {code})", f"HTTP {code}")

        exp_url, _ = build_url(cfg, SECRET, now - 4000, now - 2000)
        code, _, _ = fetch(exp_url)
        r.check("expired window refused", code in (401, 403),
                f"accepted an expired token (HTTP {code})", f"HTTP {code}")

        fut_url, _ = build_url(cfg, SECRET, now + 600, now + 2400)
        code, _, _ = fetch(fut_url)
        r.check("not-yet-valid window refused", code in (401, 403),
                f"accepted a future token (HTTP {code})", f"HTTP {code}")

        wrong_url, _ = build_url(cfg, SECRET + "x", start, end)
        code, _, _ = fetch(wrong_url)
        r.check("wrong secret refused", code in (401, 403),
                f"accepted a hash signed with the wrong secret (HTTP {code})",
                f"HTTP {code}")

        # ---------------------------------------------------------------- #
        r.stage("3. Master playlist")
        code, body, ctype = fetch(url)
        if not r.check("signed playlist accepted", code == 200,
                       f"HTTP {code}: {body[:200]!r}", f"HTTP {code}"):
            raise SystemExit(1)
        text = body.decode("utf-8", "replace")
        r.check("Content-Type is an HLS playlist", "mpegurl" in ctype.lower(),
                f"got {ctype!r}", ctype)
        r.check("body is an M3U8", text.startswith("#EXTM3U"),
                f"body starts {text[:40]!r}")
        variants = [l.strip() for l in text.splitlines()
                    if l.strip() and not l.startswith("#")]
        if not r.check("declares at least one variant", bool(variants),
                       "no variant lines in the master playlist"):
            raise SystemExit(1)
        r.note(f"variant = {variants[0][:90]}")

        # ---------------------------------------------------------------- #
        r.stage("4. Chunklist")
        chunk_url = up.urljoin(url, variants[0])
        code, body, ctype = fetch(chunk_url)
        if not r.check("chunklist accepted with the propagated token", code == 200,
                       f"HTTP {code}: {body[:200]!r}", f"HTTP {code}"):
            raise SystemExit(1)
        media_txt = body.decode("utf-8", "replace")
        segs: list[tuple[str, float]] = []
        dur = 0.0
        for line in media_txt.splitlines():
            line = line.strip()
            if line.startswith("#EXTINF:"):
                try:
                    dur = float(line.split(":", 1)[1].rstrip(","))
                except ValueError:
                    dur = 0.0
            elif line and not line.startswith("#"):
                segs.append((up.urljoin(chunk_url, line), dur))
        if not r.check("chunklist lists segments", bool(segs),
                       "no segment lines found"):
            raise SystemExit(1)
        total_dur = sum(d for _, d in segs)
        r.ok(f"{len(segs)} segments listed", f"{total_dur:.0f}s of media")
        gaps = media_txt.count("#EXT-X-DISCONTINUITY")
        if gaps:
            r.ok(f"{gaps} discontinuity marker(s) present",
                 "capture had sliding-window gaps")

        # ---------------------------------------------------------------- #
        r.stage("5. Segments through the gate")
        wanted = segs[:args.max_segments] if args.max_segments else segs
        got_bytes = 0
        bad_ts: list[str] = []
        refused: list[str] = []
        cat = os.path.join(tmp, "all.ts")

        with open(cat, "wb") as out:
            for i, (seg_url, _d) in enumerate(wanted, 1):
                name = os.path.basename(up.urlsplit(seg_url).path)
                code, sbody, sctype = fetch(seg_url)
                if code != 200:
                    refused.append(f"{name}: HTTP {code}")
                    continue
                ok, why = is_mpeg_ts(sbody)
                if not ok:
                    bad_ts.append(f"{name}: {why}")
                    continue
                out.write(sbody)
                got_bytes += len(sbody)
                r.note(f"segment {i}/{len(wanted)} {name[:40]} "
                       f"{len(sbody)/1024:.0f}KB [{sctype}]")

        r.check("every segment served", not refused,
                "refused: " + "; ".join(refused[:4]),
                f"{len(wanted) - len(refused)}/{len(wanted)}")
        r.check("every segment is genuine MPEG-TS", not bad_ts,
                "malformed: " + "; ".join(bad_ts[:4]),
                f"{got_bytes/1048576:.1f} MiB")

        # A segment must need its own token, not just the playlist's.
        if wanted:
            naked = wanted[0][0].split("?")[0]
            if "_tk" in naked:
                # Token lives in the filename here; strip it to make it unsigned.
                d, f = os.path.split(naked)
                naked = f"{d}/{f.split('_tk')[0]}_0.ts"
            code, _, _ = fetch(naked)
            r.check("segment refused without its own token", code in (401, 403, 404),
                    f"a segment was served unsigned (HTTP {code})", f"HTTP {code}")

        # ---------------------------------------------------------------- #
        r.stage("6. The bytes are really playable video")
        if args.no_decode:
            r.skip("ffmpeg decode", "--no-decode")
        elif not shutil.which("ffmpeg"):
            r.skip("ffmpeg decode", "ffmpeg not on PATH")
        elif got_bytes == 0:
            r.fail("ffmpeg decode", "no segment bytes were collected")
        else:
            probe = subprocess.run(
                ["ffprobe", "-v", "error", "-select_streams", "v:0",
                 "-show_entries", "stream=codec_name,width,height,r_frame_rate",
                 "-of", "default=noprint_wrappers=1:nokey=1", cat],
                capture_output=True, text=True)
            fields = [l for l in probe.stdout.split() if l]
            r.check("ffprobe finds a video stream",
                    probe.returncode == 0 and len(fields) >= 3,
                    f"ffprobe said: {probe.stderr.strip()[:200] or 'no video stream'}",
                    " ".join(fields[:4]))

            dec = subprocess.run(
                ["ffmpeg", "-v", "error", "-i", cat, "-f", "null", "-"],
                capture_output=True, text=True)
            # Timestamp discontinuities are expected: the capture has gaps.
            errs = [l for l in dec.stderr.splitlines()
                    if l.strip() and "discontinuity" not in l.lower()]
            r.check("decodes with no errors", dec.returncode == 0 and not errs,
                    "ffmpeg reported: " + " | ".join(errs[:3]),
                    f"{got_bytes/1048576:.1f} MiB decoded")

        # ---------------------------------------------------------------- #
        r.stage("7. Renewal, as the page does before expiry")
        code, tbody, _ = fetch(f"http://127.0.0.1:{port}/token")
        if code != 200:
            r.skip("/token endpoint", f"HTTP {code}")
        else:
            import json
            data = json.loads(tbody)
            r.check("/token returns a fresh signed URL",
                    "url" in data and "expires_at" in data,
                    f"unexpected payload: {tbody[:150]!r}")
            code2, body2, _ = fetch(data["url"])
            r.check("the renewed URL plays", code2 == 200,
                    f"renewed URL refused (HTTP {code2})", f"HTTP {code2}")
            r.check("renewed token differs from the first",
                    data["url"] != url, "the server reissued an identical URL")

    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
        shutil.rmtree(tmp, ignore_errors=True)

    # ------------------------------------------------------------------- #
    print()
    print("=" * 52)
    total = r.passed + len(r.failed)
    if r.failed:
        print(f"{RED}FAILED{RESET}  {r.passed}/{total} checks passed, "
              f"{len(r.failed)} failed"
              + (f", {len(r.skipped)} skipped" if r.skipped else ""))
        print()
        for what, why in r.failed:
            print(f"  {RED}x{RESET} {what}\n      {why}")
        return 1
    print(f"{GREEN}OK{RESET}      all {r.passed} checks passed"
          + (f", {len(r.skipped)} skipped" if r.skipped else ""))
    print()
    print("  A token generated locally opened the real video through the gate,")
    print("  and every unsigned, tampered, expired and mis-signed variant was")
    print("  refused. Token generation and playback both work.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
