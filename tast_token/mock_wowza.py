#!/usr/bin/env python3
"""
Local mock of Wowza's SecureToken v2 gate -- a real end-to-end test target.

Why this exists: against the live camaramar edge, every generated URL returns 403
because the shared secret lives on their server and cannot be recovered from a
capture (the hash is SHA-256 output). So there is no way to test the signer
against that host. This server plays the role of the edge: you choose the secret,
it validates tokens exactly as Wowza does, and it serves real HLS video through
the gate. The full generate -> validate -> play loop works offline.

It validates EVERY request (playlist, chunklist, segments), and on rejection
returns a diagnostic explaining precisely which check failed -- which is the part
a real edge deliberately won't tell you.

Usage
-----
  # generate test video (first run only) and serve
  python mock_wowza.py --secret 'myTestSecret'

  Then open http://localhost:8088/  -- it serves wowza_token_player.html
  same-origin over localhost, so WebCrypto is available and there is no CORS.
  Host is prefilled as localhost:8088; enter the same secret and press
  "Generate & play".

  # sign a URL from the CLI against this server
  python wowza_token_gen.py gen --host localhost:8088 --content-path live/test.stream \
      --secret 'myTestSecret' --check

  # useful experiments
  --window 20        token expires mid-playback; segment requests start 403ing
  --skew -60         starttime in the future -> "not yet valid"
  --clientip         require the client IP in the hash, like
                     SecureTokenIncludeClientIPInHash=true

GET /token returns a freshly signed URL as JSON, mirroring the
`data-stream-refresh-url` endpoint the real site exposes.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import threading
import time
from dataclasses import replace
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qsl, urlsplit

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
try:
    from wowza_token_gen import TokenConfig, b64_decode_any, build_url, compute_hash
except ImportError:
    sys.exit("mock_wowza.py needs wowza_token_gen.py in the same directory.")

HERE = os.path.dirname(os.path.abspath(__file__))
MEDIA_DIR = os.path.join(HERE, "mock_hls")
PLAYER = os.path.join(HERE, "wowza_token_player.html")

CFG: TokenConfig
SECRET = ""
REQUIRE_CLIENT_IP = False
LENIENT_B64 = False
VERBOSE = True


# --------------------------------------------------------------------------- #
# Test media
# --------------------------------------------------------------------------- #
def ensure_media(duration: int, regen: bool) -> None:
    """Render a test-pattern HLS ladder with ffmpeg (once, then cached).

    Skipped entirely when MEDIA_DIR already holds a chunklist -- that is how
    --media-dir serves real footage (e.g. the segments extract_captured_hls.py
    lifts out of a HAR) instead of a synthetic test pattern.
    """
    chunklist = os.path.join(MEDIA_DIR, "chunklist.m3u8")
    if os.path.exists(chunklist) and not regen:
        segs = len([f for f in os.listdir(MEDIA_DIR) if f.endswith(".ts")])
        total = sum(os.path.getsize(os.path.join(MEDIA_DIR, f))
                    for f in os.listdir(MEDIA_DIR) if f.endswith(".ts"))
        print(f"[media] serving {MEDIA_DIR} ({segs} segments, "
              f"{total / 1048576:.1f} MiB)")
        return

    if not shutil.which("ffmpeg"):
        sys.exit("ffmpeg not found on PATH -- cannot generate test video.\n"
                 "Install ffmpeg, or drop your own chunklist.m3u8 + *.ts into "
                 f"{MEDIA_DIR}")

    if regen and os.path.isdir(MEDIA_DIR):
        shutil.rmtree(MEDIA_DIR)
    os.makedirs(MEDIA_DIR, exist_ok=True)

    print(f"[media] rendering {duration}s test pattern with ffmpeg...")
    cmd = [
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
        "-f", "lavfi", "-i", f"testsrc2=size=1280x720:rate=30:duration={duration}",
        "-f", "lavfi", "-i", f"sine=frequency=440:duration={duration}",
        "-shortest",
        "-c:v", "libx264", "-preset", "veryfast", "-tune", "zerolatency",
        "-g", "60", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "64k",
        "-f", "hls", "-hls_time", "2", "-hls_playlist_type", "vod",
        "-hls_segment_filename", os.path.join(MEDIA_DIR, "seg_%03d.ts"),
        chunklist,
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0 or not os.path.exists(chunklist):
        sys.exit(f"ffmpeg failed:\n{proc.stderr[-2000:]}")
    segs = sorted(f for f in os.listdir(MEDIA_DIR) if f.endswith(".ts"))
    print(f"[media] ok -- {len(segs)} segments in {MEDIA_DIR}")


# --------------------------------------------------------------------------- #
# Token validation (the Wowza side)
# --------------------------------------------------------------------------- #
def classify_hash_difference(got: str, expected: str) -> tuple[str, bool, str]:
    """
    Explain WHY two base64 digests differ. Returns (kind, same_bytes, message).

    Comparing 44-character strings by eye is hopeless, and the two most common
    faults -- a lost '=' and the wrong base64 alphabet -- both leave the digest
    bytes intact. Naming them turns a dead end into a one-line fix.
    """
    def canon(s: str) -> bytes | None:
        try:
            return b64_decode_any(s)
        except Exception:                                     # noqa: BLE001
            return None

    cg, ce = canon(got), canon(expected)
    same_bytes = cg is not None and cg == ce

    if same_bytes:
        pad_only = got.rstrip("=") == expected.rstrip("=")
        alpha_only = (got.replace("-", "+").replace("_", "/")
                      == expected.replace("-", "+").replace("_", "/"))
        if pad_only and got.rstrip("=") == expected.rstrip("="):
            if len(got) != len(expected):
                return ("padding", True,
                        "base64 PADDING differs -- the digest bytes are identical, so "
                        "your SECRET IS CORRECT.\n"
                        f"      the received hash is missing {len(expected) - len(got)} "
                        "trailing '=' character(s).\n"
                        "      percent-encode it as %3D in the query string, or pass "
                        "--lenient-base64 to accept it.")
            return ("padding", True, "base64 padding differs")
        if alpha_only:
            return ("alphabet", True,
                    "base64 ALPHABET differs -- the digest bytes are identical, so your "
                    "secret is correct.\n"
                    f"      you sent {'url-safe(-_)' if ('-' in got or '_' in got) else 'standard(+/)'}, "
                    f"expected {'url-safe(-_)' if ('-' in expected or '_' in expected) else 'standard(+/)'}.")
        return ("encoding", True,
                "same digest bytes, different base64 encoding (padding and alphabet)")

    return ("different", False,
            "hash mismatch -- the digests differ in their BYTES, so the secret or one "
            "of the hashed inputs is wrong (secret, content path, prefix, or a param "
            "such as the client IP).")


def validate(query: str, content_path: str, client_ip: str) -> tuple[bool, str]:
    """Mirror Wowza's checks. Returns (ok, human-readable reason)."""
    params = dict(parse_qsl(query, keep_blank_values=True))
    token = {k: v for k, v in params.items() if k.startswith(CFG.prefix)}

    p_start, p_end = f"{CFG.prefix}starttime", f"{CFG.prefix}endtime"
    p_hash = f"{CFG.prefix}hash"

    missing = [p for p in (p_start, p_end, p_hash) if p not in token]
    if missing:
        return False, f"missing token param(s): {', '.join(missing)}"

    try:
        start, end = int(token[p_start]), int(token[p_end])
    except ValueError:
        return False, "starttime/endtime are not integers"

    now = int(time.time())
    if now < start:
        return False, f"not yet valid -- starttime is {start - now}s in the future"
    if now > end:
        return False, f"expired {now - end}s ago (window was {end - start}s)"

    signed = {k: v for k, v in token.items() if k != p_hash}
    if REQUIRE_CLIENT_IP:
        signed[f"{CFG.prefix}clientip"] = client_ip

    probe = TokenConfig(**{**CFG.__dict__, "content_path": content_path})
    expected = compute_hash(probe, SECRET, signed)
    got = token[p_hash]

    if got != expected:
        kind, same_bytes, why = classify_hash_difference(got, expected)

        if same_bytes and LENIENT_B64:
            return True, (f"accepted under --lenient-base64 despite a {kind} "
                          f"difference ({end - now}s remaining)")

        # Keep the legacy wording so the alphabet case stays greppable.
        if kind == "alphabet":
            why = "base64 alphabet mismatch -- " + why

        return False, (f"{why}\n"
                       f"      expected: {expected}\n"
                       f"      received: {got}\n"
                       f"      payload : {content_path}?<SECRET>&"
                       + "&".join(sorted(f"{k}={v}" for k, v in signed.items())))

    left = end - now
    return True, f"valid, {left}s remaining"


# --------------------------------------------------------------------------- #
# HTTP
# --------------------------------------------------------------------------- #
class Handler(BaseHTTPRequestHandler):
    server_version = "MockWowza/1.0"
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *a):  # quieter default log; we print our own
        pass

    def _say(self, msg: str, ok: bool = True) -> None:
        if VERBOSE:
            mark = "OK  " if ok else "403 "
            # flush so the log stays live even when stdout is piped to a file
            print(f"[{time.strftime('%H:%M:%S')}] {mark} {msg}", flush=True)

    def _send(self, code: int, body: bytes, ctype: str, extra: dict | None = None) -> None:
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        # Permissive CORS so the player also works when opened from file://
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Range")
        self.send_header("Access-Control-Expose-Headers", "Content-Length, Content-Type")
        self.send_header("Cache-Control", "no-cache")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def do_OPTIONS(self):
        self._send(204, b"", "text/plain")

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        parts = urlsplit(self.path)
        path, query = parts.path, parts.query
        client_ip = self.client_address[0]

        # --- the player page itself, served over localhost (secure context) ---
        if path in ("/", "/index.html", "/player", "/wowza_token_player.html"):
            if not os.path.exists(PLAYER):
                return self._send(404, b"wowza_token_player.html not found", "text/plain")
            with open(PLAYER, "rb") as fh:
                html = fh.read()

            # Drive the form from THIS server's actual config. Hardcoding these was a
            # bug: the page was prefilled with a different content path than the server
            # enforced, so the hash covered the wrong payload and every attempt 403'd
            # in a way that looked like a bad secret.
            prefill = {
                "scheme": "http",
                "host": self.headers.get("Host", f"localhost:{self.server.server_address[1]}"),
                "path": CFG.content_path,
                "playlist": CFG.playlist,
                "prefix": CFG.prefix,
                "algo": {"sha256": "SHA-256", "sha384": "SHA-384",
                         "sha512": "SHA-512"}[CFG.algo],
                "b64": "url" if CFG.urlsafe_b64 else "std",
                "extra": f"clientip={client_ip}" if REQUIRE_CLIENT_IP else "",
            }
            inject = """
<script>
(function () {
  var pre = %s;
  Object.keys(pre).forEach(function (k) {
    var el = document.getElementById(k);
    if (el) el.value = pre[k];
  });
  var b = document.createElement("div");
  b.className = "card";
  b.style.cssText = "border-color:var(--ok);margin-bottom:16px";
  b.innerHTML = "<h2 style='color:var(--ok)'>Local mock edge &mdash; settings are prefilled" +
    "</h2><div class='mono' style='font-size:12px;line-height:1.7'>" +
    "target &nbsp;&nbsp;&nbsp;&nbsp;<b>" + pre.scheme + "://" + pre.host + "/" + pre.path + "/" + pre.playlist + "</b><br>" +
    "token &nbsp;&nbsp;&nbsp;&nbsp;prefix <b>" + pre.prefix + "</b>, " + pre.algo +
    ", base64 <b>" + (pre.b64 === "url" ? "url-safe" : "standard") + "</b><br>" +
    "secret &nbsp;&nbsp;&nbsp;the value this server was started with " +
    "(<span class='muted'>--secret</span>) &mdash; it must match exactly, including punctuation" +
    "</div>";
  var wrap = document.querySelector(".wrap");
  if (wrap) wrap.parentNode.insertBefore(b, wrap);
})();
</script>
""" % json.dumps(prefill)
            html = html.replace(b"</body>", inject.encode("utf-8") + b"</body>")
            self._say(f"served player page to {client_ip} "
                      f"(prefilled {CFG.content_path}, prefix {CFG.prefix})")
            return self._send(200, html, "text/html; charset=utf-8")

        # --- convenience signer, like the site's data-stream-refresh-url ---
        if path == "/token":
            q = dict(parse_qsl(query))
            window = int(q.get("window", 1810))
            now = int(time.time())

            # With ?url=<encoded> this behaves like the signing endpoint a real
            # deployment needs: the caller names the stream it wants and the
            # secret never leaves the server. Without it, sign our own path (the
            # original behaviour, kept so existing callers still work).
            cfg = CFG
            requested = q.get("url", "")
            if requested:
                parts = urlsplit(requested)
                segs = [s for s in parts.path.split("/") if s]
                playlist = segs[-1] if segs and segs[-1].endswith(".m3u8") else "playlist.m3u8"
                if segs and segs[-1].endswith(".m3u8"):
                    segs = segs[:-1]
                if len(segs) != 2:
                    self._say(f"/token: cannot read <app>/<stream> from {requested!r}",
                              ok=False)
                    return self._send(
                        400,
                        json.dumps({"error": "url must look like "
                                             "<host>/<app>/<stream>/playlist.m3u8"}).encode(),
                        "application/json")
                cfg = replace(CFG, content_path="/".join(segs), playlist=playlist)

            url, params = build_url(cfg, SECRET, now - 5, now - 5 + window)
            url = url.replace(f"https://{cfg.host}", f"http://{self.headers.get('Host')}")
            body = json.dumps({"url": url, "expires_at": now - 5 + window,
                               "params": params}, indent=2).encode()
            self._say(f"issued a fresh signed URL via /token for {cfg.content_path}")
            return self._send(200, body, "application/json")

        # --- everything under the streaming app is token-gated ---
        m = re.match(r"^/(?P<cp>[^/]+/[^/]+)/(?P<file>[^/]+)$", path)
        if not m:
            return self._send(404, b"not found\n", "text/plain")

        content_path, fname = m.group("cp"), m.group("file")
        ok, reason = validate(query, content_path, client_ip)
        if not ok:
            self._say(f"{content_path}/{fname} rejected -- {reason}", ok=False)
            return self._send(403, f"403 Forbidden\n{reason}\n".encode(),
                              "text/plain; charset=utf-8")

        self._say(f"{content_path}/{fname} accepted ({reason})")

        # Master playlist -> point at the chunklist, carrying the token forward.
        if fname.endswith(".m3u8") and fname.startswith("playlist"):
            body = ("#EXTM3U\n#EXT-X-VERSION:3\n"
                    "#EXT-X-STREAM-INF:BANDWIDTH=2198547,CODECS=\"avc1.4d002a,mp4a.40.2\","
                    "RESOLUTION=1280x720\n"
                    f"chunklist.m3u8?{query}\n")
            return self._send(200, body.encode(), "application/vnd.apple.mpegurl")

        # Media playlist -> rewrite each segment URI to carry the token too, so
        # every segment request is validated (this is what makes expiry visible
        # mid-playback).
        if fname.endswith(".m3u8"):
            src = os.path.join(MEDIA_DIR, "chunklist.m3u8")
            if not os.path.exists(src):
                return self._send(404, b"media not generated\n", "text/plain")
            out = []
            with open(src, "r", encoding="utf-8") as fh:
                for line in fh:
                    line = line.rstrip("\n")
                    out.append(f"{line}?{query}" if line.endswith(".ts") else line)
            return self._send(200, ("\n".join(out) + "\n").encode(),
                              "application/vnd.apple.mpegurl")

        # Segments
        if fname.endswith(".ts"):
            seg = os.path.join(MEDIA_DIR, os.path.basename(fname))
            if not os.path.exists(seg):
                return self._send(404, b"segment not found\n", "text/plain")
            with open(seg, "rb") as fh:
                return self._send(200, fh.read(), "video/mp2t")

        return self._send(404, b"not found\n", "text/plain")


def main() -> int:
    global CFG, SECRET, REQUIRE_CLIENT_IP, VERBOSE, LENIENT_B64, MEDIA_DIR

    ap = argparse.ArgumentParser(description="Local Wowza SecureToken v2 mock edge.")
    ap.add_argument("--secret", default="mockTestSecret",
                    help="shared secret this server enforces (default mockTestSecret)")
    ap.add_argument("--port", type=int, default=8088)
    ap.add_argument("--bind", default=None,
                    help="extra address to listen on besides the loopbacks, e.g. "
                         "the private IP that Live Server uses (172.25.48.1) or "
                         "0.0.0.0 for every interface. Needed because Chrome blocks "
                         "requests from a private-IP page to loopback (Private "
                         "Network Access), so the signer must share the page's address.")
    ap.add_argument("--prefix", default="jdtcbrndmrd", help="token param prefix")
    ap.add_argument("--content-path", default="live/test.stream",
                    help="<app>/<stream> this server serves (default live/test.stream)")
    ap.add_argument("--algo", default="sha256", choices=("sha256", "sha384", "sha512"))
    ap.add_argument("--standard-b64", action="store_true",
                    help="enforce standard base64 (+/) instead of URL-safe")
    ap.add_argument("--lenient-base64", action="store_true",
                    help="accept a hash whose digest bytes are right but whose base64 "
                         "padding or alphabet differs (a real edge would refuse)")
    ap.add_argument("--clientip", action="store_true",
                    help="fold the client IP into the hash, like "
                         "SecureTokenIncludeClientIPInHash=true")
    ap.add_argument("--duration", type=int, default=60, help="test video length (s)")
    ap.add_argument("--regen", action="store_true", help="re-render the test video")
    ap.add_argument("--media-dir", default=None,
                    help="serve an existing chunklist.m3u8 + *.ts from this "
                         "directory instead of an ffmpeg test pattern, e.g. the "
                         "real footage extract_captured_hls.py pulls out of a HAR")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args()

    if args.media_dir:
        MEDIA_DIR = os.path.abspath(os.path.join(HERE, args.media_dir))
        if not os.path.exists(os.path.join(MEDIA_DIR, "chunklist.m3u8")):
            sys.exit(f"--media-dir {MEDIA_DIR} has no chunklist.m3u8.\n"
                     "Build one first:  python extract_captured_hls.py <capture.har> "
                     f"--out {args.media_dir}")

    SECRET = args.secret
    REQUIRE_CLIENT_IP = args.clientip
    LENIENT_B64 = args.lenient_base64
    VERBOSE = not args.quiet
    CFG = TokenConfig(
        host=f"localhost:{args.port}",
        content_path=args.content_path,
        prefix=args.prefix,
        algo=args.algo,
        urlsafe_b64=not args.standard_b64,
    )

    ensure_media(args.duration, args.regen)

    # Listen on BOTH loopbacks. "localhost" resolves to ::1 first on Windows, so an
    # IPv4-only bind costs every request a ~2s fallback stall -- enough to make the
    # browser player stutter on each segment. Two loopback listeners avoid that
    # without exposing the port beyond this machine.
    servers = [ThreadingHTTPServer(("127.0.0.1", args.port), Handler)]
    bound = ["127.0.0.1"]
    try:
        class V6(ThreadingHTTPServer):
            address_family = socket.AF_INET6
        servers.append(V6(("::1", args.port), Handler))
        bound.append("[::1]")
    except OSError as exc:
        print(f"[warn] no IPv6 loopback listener ({exc}); use 127.0.0.1, not localhost")

    if args.bind and args.bind not in ("127.0.0.1", "::1"):
        try:
            servers.append(ThreadingHTTPServer((args.bind, args.port), Handler))
            bound.append(args.bind)
        except OSError as exc:
            sys.exit(f"cannot bind {args.bind}:{args.port} -- {exc}")

    for s in servers[1:]:
        threading.Thread(target=s.serve_forever, daemon=True).start()
    srv = servers[0]

    print()
    print(f"  Mock Wowza edge on http://localhost:{args.port}  (bound: {', '.join(bound)})")
    print(f"  secret ......... {SECRET!r}")
    print(f"  content path ... {CFG.content_path}")
    print(f"  token prefix ... {CFG.prefix}   digest {CFG.algo}   "
          f"base64 {'url-safe' if CFG.urlsafe_b64 else 'standard'}")
    print(f"  client IP in hash: {REQUIRE_CLIENT_IP}")
    print(f"  lenient base64 ..: {LENIENT_B64}")
    print()
    print(f"  player ......... http://localhost:{args.port}/")
    print(f"  fresh token .... http://localhost:{args.port}/token")
    print()
    print("  Ctrl-C to stop.")
    print()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
