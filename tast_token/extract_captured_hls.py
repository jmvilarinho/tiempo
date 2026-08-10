#!/usr/bin/env python3
"""
Rebuild the ORIGINAL video from a HAR capture, as a playable local HLS ladder.

The point: you do not need the shared secret to watch what you already captured.
DevTools stored the media bodies inside the HAR, so the real 1080p segments are
sitting in that file -- already decrypted, already delivered, already yours. This
script lifts them out and writes a chunklist that plays them back in order.

What it does
------------
  1. Walks the HAR for responses whose mimeType is video/mp2t (or whose path ends
     in .ts) and whose body survived the export.
  2. Verifies each body really is MPEG-TS (first byte must be the 0x47 sync byte)
     -- HAR exports silently truncate large bodies, and a half-written segment
     would fail deep inside the player instead of here.
  3. Recovers each segment's media-sequence number. Wowza embeds the token in the
     FILENAME of derived URIs, so the name looks like
       media_w<sessionid>_tk<base64(querystring)>_<seq>.ts
     The <seq> is stream-global, not per-session: a capture spanning several
     token renewals still sorts into one correct timeline.
  4. Emits a VOD chunklist ordered by <seq>, inserting #EXT-X-DISCONTINUITY
     wherever the capture skipped segments -- which it always does, because the
     browser only ever held a sliding window of the live stream.

Usage
-----
  python extract_captured_hls.py www.camaramar.com3.har
  python extract_captured_hls.py capture.har --out captured_hls --report

Then serve it:
  python mock_wowza.py --secret 'madrid007.' --port 8089 \
      --content-path live/5_razo.stream --media-dir captured_hls
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import re
import sys
import urllib.parse as up

# media_w<sessionid>_tk<base64>_<seq>.ts  -- Wowza's derived-URI naming.
SEG_NAME = re.compile(r"^media_w(\d+)_tk([A-Za-z0-9\-_=]+?)_(\d+)\.ts$")
TS_SYNC = 0x47
TS_PACKET = 188


def decode_body(content: dict) -> bytes | None:
    text = content.get("text")
    if text is None:
        return None
    if content.get("encoding") == "base64":
        try:
            return base64.b64decode(text)
        except Exception:                                      # noqa: BLE001
            return None
    return text.encode("utf-8", "replace")


def decode_tk(tk: str) -> str:
    """Un-base64 the token Wowza stuffed into the filename."""
    b = tk + "=" * (-len(tk) % 4)
    try:
        return base64.urlsafe_b64decode(b).decode("utf-8", "replace")
    except Exception:                                          # noqa: BLE001
        return ""


def looks_like_ts(body: bytes) -> tuple[bool, str]:
    """MPEG-TS is a stream of 188-byte packets each starting with 0x47."""
    if not body:
        return False, "empty body (HAR exported no content)"
    if body[0] != TS_SYNC:
        return False, f"first byte 0x{body[0]:02x}, expected 0x47"
    if len(body) % TS_PACKET:
        # Not fatal -- players tolerate it -- but it means a truncated export.
        return True, f"length {len(body)} is not a multiple of 188 (truncated?)"
    # Spot-check a few packet boundaries; a corrupted body fails here.
    for n in (1, 2, 10, 100):
        off = n * TS_PACKET
        if off < len(body) and body[off] != TS_SYNC:
            return False, f"lost sync at packet {n} (offset {off})"
    return True, ""


def collect(har_path: str) -> tuple[list[dict], list[dict], list[str]]:
    with open(har_path, "r", encoding="utf-8", errors="replace") as f:
        har = json.load(f)
    entries = har.get("log", {}).get("entries", [])

    segs: list[dict] = []
    lists: list[dict] = []
    skipped: list[str] = []

    for i, e in enumerate(entries):
        url = (e.get("request") or {}).get("url", "")
        content = (e.get("response") or {}).get("content") or {}
        mime = (content.get("mimeType") or "").lower()
        path = up.urlsplit(url).path
        name = os.path.basename(path)

        is_ts = "mp2t" in mime or path.endswith(".ts")
        is_list = "mpegurl" in mime or path.endswith(".m3u8")
        if not (is_ts or is_list):
            continue

        body = decode_body(content)
        rec = {"index": i, "url": url, "name": name, "mime": mime,
               "declared": content.get("size", 0), "body": body,
               "started": e.get("startedDateTime", "")}

        if is_list:
            lists.append(rec)
            continue

        ok, why = looks_like_ts(body or b"")
        if not ok:
            skipped.append(f"[{i}] {name[:44]}: {why}")
            continue
        if why:
            skipped.append(f"[{i}] {name[:44]}: WARN {why}")

        m = SEG_NAME.match(name)
        if m:
            rec["session"] = m.group(1)
            rec["seq"] = int(m.group(3))
            rec["token"] = decode_tk(m.group(2))
        else:
            # Un-tokenised or differently-named segment: fall back to capture
            # order so it still plays, just without cross-session ordering.
            rec["session"] = "?"
            rec["seq"] = None
            rec["token"] = ""
        segs.append(rec)

    return segs, lists, skipped


def target_duration(lists: list[dict]) -> tuple[float, int]:
    """Take #EXTINF and #EXT-X-TARGETDURATION from the captured chunklists."""
    extinf, target = 10.0, 11
    for r in lists:
        if not r["body"]:
            continue
        txt = r["body"].decode("utf-8", "replace")
        for line in txt.splitlines():
            if line.startswith("#EXT-X-TARGETDURATION:"):
                try:
                    target = int(line.split(":", 1)[1])
                except ValueError:
                    pass
            elif line.startswith("#EXTINF:"):
                try:
                    extinf = float(line.split(":", 1)[1].rstrip(","))
                except ValueError:
                    pass
    return extinf, target


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Rebuild a playable HLS ladder from the media inside a HAR.")
    ap.add_argument("har", help="HAR capture containing the .ts bodies")
    ap.add_argument("--out", default="captured_hls", help="output directory")
    ap.add_argument("--report", action="store_true",
                    help="print a per-session breakdown")
    args = ap.parse_args()

    if not os.path.exists(args.har):
        sys.exit(f"no such file: {args.har}")

    size = os.path.getsize(args.har) / 1048576
    print(f"[har] reading {args.har} ({size:.1f} MiB) -- large captures take a moment")
    segs, lists, skipped = collect(args.har)
    print(f"[har] {len(segs)} usable TS segments, {len(lists)} playlist responses")

    if skipped:
        print(f"[har] {len(skipped)} segment(s) unusable:")
        for s in skipped[:12]:
            print(f"        {s}")
        if len(skipped) > 12:
            print(f"        ... and {len(skipped) - 12} more")

    if not segs:
        sys.exit("No usable media in this HAR. DevTools omits response bodies "
                 "unless the capture was taken with them enabled, and it drops\n"
                 "large ones regardless. Re-record with 'Preserve log' on, or "
                 "use the bigger capture if you have one.")

    # Stream-global sequence order; unnumbered segments trail in capture order.
    numbered = [s for s in segs if s["seq"] is not None]
    unnumbered = [s for s in segs if s["seq"] is None]
    numbered.sort(key=lambda s: s["seq"])
    unnumbered.sort(key=lambda s: s["started"])
    ordered = numbered + unnumbered

    if args.report and numbered:
        by_sess: dict[str, list[dict]] = {}
        for s in numbered:
            by_sess.setdefault(s["session"], []).append(s)
        print(f"\n[report] {len(by_sess)} Wowza session(s) in this capture")
        for sess, items in sorted(by_sess.items(), key=lambda kv: kv[1][0]["seq"]):
            seqs = [s["seq"] for s in items]
            mib = sum(len(s["body"]) for s in items) / 1048576
            print(f"  w{sess:<12} {len(items):2d} segs  seq {seqs[0]}-{seqs[-1]}  {mib:5.1f} MiB")
            tok = items[0]["token"]
            if tok:
                pairs = dict(up.parse_qsl(tok))
                st = next((v for k, v in pairs.items() if k.endswith("starttime")), "?")
                en = next((v for k, v in pairs.items() if k.endswith("endtime")), "?")
                print(f"                 token window {st} -> {en}")

    os.makedirs(args.out, exist_ok=True)
    extinf, target = target_duration(lists)

    m3u8 = ["#EXTM3U", "#EXT-X-VERSION:3",
            f"#EXT-X-TARGETDURATION:{target}",
            "#EXT-X-MEDIA-SEQUENCE:0",
            "#EXT-X-PLAYLIST-TYPE:VOD"]

    manifest = []
    prev_seq: int | None = None
    gaps = 0
    total = 0

    for n, s in enumerate(ordered):
        fn = f"cap_{n:03d}.ts"
        with open(os.path.join(args.out, fn), "wb") as f:
            f.write(s["body"])
        total += len(s["body"])

        # The browser held a sliding window, so the capture is full of holes.
        # Without this tag the player tries to decode across a timestamp jump
        # and stalls or shows a frozen frame instead of continuing.
        if prev_seq is not None and s["seq"] is not None and s["seq"] != prev_seq + 1:
            m3u8.append("#EXT-X-DISCONTINUITY")
            gaps += 1
        prev_seq = s["seq"] if s["seq"] is not None else prev_seq

        m3u8.append(f"#EXTINF:{extinf:.1f},")
        m3u8.append(fn)
        manifest.append({"file": fn, "seq": s["seq"], "session": s["session"],
                         "bytes": len(s["body"]), "started": s["started"],
                         "url": s["url"]})

    m3u8.append("#EXT-X-ENDLIST")
    m3u8.append("")

    with open(os.path.join(args.out, "chunklist.m3u8"), "w",
              encoding="utf-8", newline="\n") as f:
        f.write("\n".join(m3u8))
    with open(os.path.join(args.out, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump({"source_har": os.path.basename(args.har),
                   "segments": len(ordered), "bytes": total,
                   "discontinuities": gaps, "extinf": extinf,
                   "target_duration": target, "items": manifest}, f, indent=2)

    secs = len(ordered) * extinf
    print(f"\n[out] {args.out}/chunklist.m3u8")
    print(f"[out] {len(ordered)} segments, {total:,} bytes ({total/1048576:.2f} MiB), "
          f"~{secs:.0f}s of video, {gaps} discontinuit{'y' if gaps == 1 else 'ies'}")
    print("\nServe it through the token gate with:")
    print(f"  python mock_wowza.py --secret 'madrid007.' --port 8089 \\\n"
          f"      --content-path live/5_razo.stream --media-dir {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
