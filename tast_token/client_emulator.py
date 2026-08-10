#!/usr/bin/env python3
"""
Emulate the camaramar client's tokenised-HLS lifecycle.

Reproduces exactly what the browser does in www.camaramar.com.har -- no more:

  1. Obtain a signed URL from the page/backend. The client never signs anything;
     it is handed a finished string (in the capture, the `data-stream-src`
     attribute of the <video> element, server-rendered by Laravel).
  2. GET the master playlist.
  3. GET the chunklist. Wowza rewrites it so the token rides along
     base64-embedded after `_tk` in the FILENAME, not as query params.
  4. GET each media segment in turn, paced by its #EXTINF duration.
  5. Before `data-stream-refresh-at` (300 s ahead of `data-stream-expires-at`
     in the capture), ask the backend for a fresh URL and swap it in.
  6. Meanwhile the Livewire component polls `$refresh` every 20 s.

Running this makes one thing concrete: at no point does the client receive,
derive, or possess the shared secret. It only ever consumes URLs the server
already signed. That is why the secret cannot be recovered from a capture --
the emulation is the demonstration.

Point it at the local mock edge (default), or at any Wowza whose secret you
hold. It deliberately does not authenticate to, or scrape, any third-party site.

Usage
-----
  # against the mock edge on 8089
  python client_emulator.py --base http://localhost:8089

  # watch a renewal happen: short window, short lead
  python client_emulator.py --base http://localhost:8089 --window 45 --refresh-lead 20

  # let the token expire instead of renewing, to see the edge start refusing
  python client_emulator.py --base http://localhost:8089 --window 20 --no-refresh

  # replay a URL you already hold (e.g. one you were legitimately issued)
  python client_emulator.py --url 'https://host/live/x.stream/playlist.m3u8?...'

  --fast   ignore #EXTINF pacing and fetch as quickly as possible
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
import urllib.error
import urllib.parse as up
import urllib.request

# Header set copied from the capture, so the request shape matches the browser's.
BROWSER_HEADERS = {
    "User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                   "(KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36"),
    "Accept": "*/*",
    "Accept-Language": "es-ES,es;q=0.9",
    "Origin": "https://www.camaramar.com",
    "Referer": "https://www.camaramar.com/",
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "cross-site",
    "DNT": "1",
}

POLL_INTERVAL = 20        # wire:poll.visible.20000ms from the capture
DEFAULT_LEAD = 300        # expires_at - refresh_at in the capture


class Stats:
    def __init__(self) -> None:
        self.segments = 0
        self.bytes = 0
        self.renewals = 0
        self.rejections = 0
        self.polls = 0


def log(msg: str, kind: str = "") -> None:
    tag = {"ok": "  ok ", "err": " 403 ", "warn": "  ! ", "net": "  -> "}.get(kind, "     ")
    print(f"[{time.strftime('%H:%M:%S')}]{tag}{msg}", flush=True)


def fetch(url: str, timeout: float = 15.0) -> tuple[int, bytes, str]:
    """GET with the captured browser headers. Returns (status, body, reason)."""
    req = urllib.request.Request(url, headers=BROWSER_HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read(), ""
    except urllib.error.HTTPError as e:
        body = e.read()
        # The mock edge explains its refusals; a real edge just says Forbidden.
        reason = ""
        txt = body.decode("utf-8", "replace").strip().splitlines()
        if len(txt) > 1:
            reason = txt[1].strip()
        return e.code, body, reason
    except Exception as e:                                    # noqa: BLE001
        return 0, b"", f"{type(e).__name__}: {e}"


# --------------------------------------------------------------------------- #
# Step 1 -- obtain a signed URL, the way the page does
# --------------------------------------------------------------------------- #
def get_signed_url(base: str, window: int | None) -> tuple[str, int]:
    """
    Ask the backend to sign a URL, mirroring `data-stream-refresh-url`.
    Returns (url, expires_at). The client contributes nothing to the signature.
    """
    q = f"?window={window}" if window else ""
    code, body, reason = fetch(f"{base.rstrip('/')}/token{q}")
    if code != 200:
        raise SystemExit(f"could not obtain a signed URL: HTTP {code} {reason}")
    data = json.loads(body)
    return data["url"], int(data["expires_at"])


def parse_expiry(url: str) -> int:
    """Read endtime straight out of the URL, as the page reads data-stream-expires-at."""
    q = dict(up.parse_qsl(up.urlsplit(url).query))
    for k, v in q.items():
        if k.endswith("endtime"):
            return int(v)
    # Wowza's derived URIs carry the token inside the filename instead.
    m = re.search(r"_tk([A-Za-z0-9+/=_-]{20,})", url)
    if m:
        import base64
        b = m.group(1) + "=" * (-len(m.group(1)) % 4)
        inner = dict(up.parse_qsl(base64.b64decode(b).decode()))
        for k, v in inner.items():
            if k.endswith("endtime"):
                return int(v)
    return 0


# --------------------------------------------------------------------------- #
# Steps 2-4 -- walk the HLS ladder
# --------------------------------------------------------------------------- #
def load_ladder(url: str, st: Stats) -> tuple[list[tuple[str, float]], str] | None:
    """master playlist -> chunklist -> [(segment_url, duration), ...]"""
    code, body, reason = fetch(url)
    if code != 200:
        st.rejections += 1
        log(f"master playlist refused: HTTP {code} {reason}", "err")
        return None
    text = body.decode("utf-8", "replace")
    log(f"master playlist ok ({len(text)}b)", "ok")

    variants = [l.strip() for l in text.splitlines()
                if l.strip() and not l.startswith("#")]
    if not variants:
        log("no variants in master playlist", "warn")
        return None
    chunk_url = up.urljoin(url, variants[0])

    shown = variants[0]
    if "_tk" in shown:
        log(f"chunklist carries the token in its filename: {shown[:70]}...")
    code, body, reason = fetch(chunk_url)
    if code != 200:
        st.rejections += 1
        log(f"chunklist refused: HTTP {code} {reason}", "err")
        return None
    media = body.decode("utf-8", "replace")
    log(f"chunklist ok -- {'VOD' if '#EXT-X-ENDLIST' in media else 'live'}", "ok")

    segs: list[tuple[str, float]] = []
    dur = 0.0
    for line in media.splitlines():
        line = line.strip()
        if line.startswith("#EXTINF:"):
            try:
                dur = float(line.split(":", 1)[1].rstrip(","))
            except ValueError:
                dur = 2.0
        elif line and not line.startswith("#"):
            segs.append((up.urljoin(chunk_url, line), dur))
    log(f"{len(segs)} segments listed")
    return segs, chunk_url


# --------------------------------------------------------------------------- #
# Main loop
# --------------------------------------------------------------------------- #
def run(args: argparse.Namespace) -> int:
    st = Stats()

    if args.url:
        url, expires = args.url, parse_expiry(args.url)
        log("using the URL supplied on the command line (already signed)")
    else:
        url, expires = get_signed_url(args.base, args.window)
        log(f"backend signed a URL for us; expires_at={expires}", "ok")

    lead = args.refresh_lead
    refresh_at = expires - lead
    now = int(time.time())
    log(f"window {expires - now}s remaining; will renew at T-{lead}s "
        f"({'disabled' if args.no_refresh else f'in {refresh_at - now}s'})")
    log("note: the client received a finished signature and holds no secret")
    print()

    started = time.time()
    next_poll = started + POLL_INTERVAL
    idx = 0
    ladder = load_ladder(url, st)
    if not ladder:
        return 1
    segs, _ = ladder

    while True:
        now = time.time()
        if args.max_seconds and now - started > args.max_seconds:
            log(f"reached --max-seconds {args.max_seconds}", "warn")
            break

        # Livewire's wire:poll.visible.20000ms -- the component re-renders and the
        # server decides whether we still get a stream at all.
        if now >= next_poll:
            st.polls += 1
            next_poll = now + POLL_INTERVAL
            log(f"livewire $refresh poll #{st.polls} (every {POLL_INTERVAL}s)")

        # Renew ahead of expiry, as data-stream-refresh-at instructs.
        if not args.no_refresh and not args.url and now >= refresh_at:
            log(f"T-{int(expires - now)}s: renewing before expiry", "warn")
            url, expires = get_signed_url(args.base, args.window)
            refresh_at = expires - lead
            st.renewals += 1
            log(f"renewed; new expiry in {int(expires - time.time())}s", "ok")
            ladder = load_ladder(url, st)
            if not ladder:
                break
            segs, idx = ladder[0], 0
            continue

        if idx >= len(segs):
            log("reached the end of the segment list", "ok")
            break

        seg_url, dur = segs[idx]
        t0 = time.time()
        code, body, reason = fetch(seg_url)
        dt = time.time() - t0
        name = seg_url.split("/")[-1].split("?")[0]
        if len(name) > 46:
            name = name[:22] + "..." + name[-18:]

        if code == 200:
            st.segments += 1
            st.bytes += len(body)
            log(f"segment {idx + 1}/{len(segs)} {name} "
                f"{len(body) / 1024:.0f}KB in {dt * 1000:.0f}ms", "ok")
        else:
            st.rejections += 1
            log(f"segment {idx + 1} refused: HTTP {code} {reason}", "err")
            left = expires - int(time.time())
            if left <= 0:
                log(f"token expired {-left}s ago -- this is what the edge does "
                    f"when the client fails to renew in time", "warn")
                break
            if code == 0:
                break
        idx += 1

        if not args.fast and dur:
            target = t0 + dur
            while time.time() < target:
                time.sleep(min(0.25, target - time.time()))

    print()
    log("=== client session summary ===")
    log(f"segments fetched : {st.segments}")
    log(f"bytes            : {st.bytes:,} ({st.bytes / 1048576:.2f} MiB)")
    log(f"token renewals   : {st.renewals}")
    log(f"edge rejections  : {st.rejections}")
    log(f"livewire polls   : {st.polls}")
    log(f"wall clock       : {time.time() - started:.1f}s")
    return 0 if st.segments and not st.rejections else 1


def main() -> int:
    ap = argparse.ArgumentParser(description="Emulate the tokenised-HLS client lifecycle.")
    ap.add_argument("--base", default="http://localhost:8089",
                    help="backend that signs URLs (default the local mock edge)")
    ap.add_argument("--url", help="use this already-signed URL instead of asking a backend")
    ap.add_argument("--window", type=int, help="token lifetime to request, seconds")
    ap.add_argument("--refresh-lead", type=int, default=DEFAULT_LEAD,
                    help=f"renew this many seconds before expiry (capture used {DEFAULT_LEAD})")
    ap.add_argument("--no-refresh", action="store_true",
                    help="never renew -- let the token expire mid-playback")
    ap.add_argument("--fast", action="store_true", help="ignore #EXTINF pacing")
    ap.add_argument("--max-seconds", type=int, default=120, help="stop after N seconds")
    return run(ap.parse_args())


if __name__ == "__main__":
    sys.exit(main())
