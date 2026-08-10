#!/usr/bin/env python3
"""
Dead-simple static server for watching the captured stream. No tokens, no secret.

This exists because the token machinery and the video playback are two separate
problems, and debugging them together is what made everything look broken. Here
there is nothing to authenticate: it serves files and sets the right MIME types.

  python serve_stream.py

Then open the URL it prints. If the video does not play here, the problem is the
media or the browser -- not tokens, not hashes, not hls.js.

Use mock_wowza.py instead when you specifically want to test token validation.
"""

from __future__ import annotations

import argparse
import os
import socket
import sys
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))

# SimpleHTTPRequestHandler guesses from the Windows registry, which routinely
# hands back the wrong type for .m3u8 and .ts. A browser given text/plain for a
# playlist just shows the text, and given video/vnd.dlna.mpeg-tts for a segment
# may refuse it outright -- both look like "the stream is broken".
EXTRA_TYPES = {
    ".m3u8": "application/vnd.apple.mpegurl",
    ".ts": "video/mp2t",
    ".mp4": "video/mp4",
    ".js": "application/javascript",
    ".html": "text/html; charset=utf-8",
}


class Handler(SimpleHTTPRequestHandler):
    # HTTP/1.1 so the browser can reuse one connection for 29 segments instead
    # of reconnecting each time. Requires an accurate Content-Length on every
    # response, which both branches below set.
    protocol_version = "HTTP/1.1"

    _range_reply = False        # set while emitting a 206/416, to avoid a dup header

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=HERE, **kw)

    def guess_type(self, path):
        ext = os.path.splitext(str(path))[1].lower()
        if ext in EXTRA_TYPES:
            return EXTRA_TYPES[ext]
        return super().guess_type(path)

    def do_GET(self):
        if self.path in ("/", "/index.html"):
            self.path = "/stream_test.html"
        if self.headers.get("Range"):
            if self.serve_range():
                return
        return super().do_GET()

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        # Announced on plain responses too -- the browser only issues a Range
        # request if a previous response said ranges were supported.
        if not self._range_reply:
            self.send_header("Accept-Ranges", "bytes")
        super().end_headers()

    # SimpleHTTPRequestHandler does NOT implement Range -- it answers 200 with
    # the whole body and ignores the header. Advertising Accept-Ranges without
    # this method is worse than staying silent: the browser believes it, seeks
    # in the 76 MiB MP4, receives the file from byte 0 instead of the requested
    # offset, and the scrub bar misbehaves for no visible reason.
    def serve_range(self) -> bool:
        path = self.translate_path(self.path)
        if not os.path.isfile(path):
            return False                      # let the base class 404 it
        try:
            size = os.path.getsize(path)
            start, end = self.parse_range(self.headers["Range"], size)
        except ValueError:
            self._range_reply = True
            self.send_response(416)
            self.send_header("Content-Range", f"bytes */{os.path.getsize(path)}")
            self.send_header("Content-Length", "0")
            self.send_header("Accept-Ranges", "bytes")
            self.end_headers()
            return True

        length = end - start + 1
        self._range_reply = True
        self.send_response(206)
        self.send_header("Content-Type", self.guess_type(path))
        self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Content-Length", str(length))
        self.send_header("Accept-Ranges", "bytes")
        self.end_headers()
        with open(path, "rb") as f:
            f.seek(start)
            remaining = length
            while remaining > 0:
                chunk = f.read(min(256 * 1024, remaining))
                if not chunk:
                    break
                self.wfile.write(chunk)
                remaining -= len(chunk)
        return True

    @staticmethod
    def parse_range(header: str, size: int) -> tuple[int, int]:
        """Single-range 'bytes=a-b' / 'bytes=a-' / 'bytes=-n'. Raises on garbage."""
        if not header.startswith("bytes=") or "," in header:
            raise ValueError("unsupported range")
        spec = header[6:].strip()
        first, _, last = spec.partition("-")
        if not first:                                   # suffix: last N bytes
            n = int(last)
            if n <= 0:
                raise ValueError("empty suffix range")
            start, end = max(0, size - n), size - 1
        else:
            start = int(first)
            end = int(last) if last else size - 1
        if start >= size or start > end:
            raise ValueError("range not satisfiable")
        return start, min(end, size - 1)

    def log_message(self, fmt, *args):
        if VERBOSE:
            sys.stderr.write("  %s\n" % (fmt % args))


VERBOSE = True


def main() -> int:
    global VERBOSE
    ap = argparse.ArgumentParser(description="Serve the captured stream, no auth.")
    ap.add_argument("--port", type=int, default=8090)
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args()
    VERBOSE = not args.quiet

    page = os.path.join(HERE, "stream_test.html")
    if not os.path.exists(page):
        sys.exit("stream_test.html is missing from this directory.")

    media = os.path.join(HERE, "captured_hls")
    mp4 = os.path.join(media, "captured_stream.mp4")
    chunk = os.path.join(media, "chunklist.m3u8")

    print()
    print(f"  Static stream server on http://localhost:{args.port}/")
    print()
    for label, path in (("MP4 ", mp4), ("HLS ", chunk),
                        ("hls.js", os.path.join(HERE, "hls.min.js"))):
        if os.path.exists(path):
            mb = os.path.getsize(path) / 1048576
            print(f"  {label:7s} ok    {os.path.relpath(path, HERE)} ({mb:.1f} MiB)")
        else:
            print(f"  {label:7s} MISSING  {os.path.relpath(path, HERE)}")
    print()
    print("  Open the URL above. Ctrl-C to stop.")
    print()

    servers = [ThreadingHTTPServer(("127.0.0.1", args.port), Handler)]
    try:
        class V6(ThreadingHTTPServer):
            address_family = socket.AF_INET6
        servers.append(V6(("::1", args.port), Handler))
    except OSError:
        pass                              # IPv6 unavailable; IPv4 alone is fine.

    for s in servers[1:]:
        threading.Thread(target=s.serve_forever, daemon=True).start()
    try:
        servers[0].serve_forever()
    except KeyboardInterrupt:
        print("\n  stopped")
    return 0


if __name__ == "__main__":
    sys.exit(main())
