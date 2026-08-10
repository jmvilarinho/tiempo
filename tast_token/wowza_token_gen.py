#!/usr/bin/env python3
"""
Wowza SecureToken v2 URL generator / verifier.

Reverse-engineered from a HAR capture of www.camaramar.com:

    https://622a10e8864f7.streamlock.net/live/5_razo.stream/playlist.m3u8
        ?jdtcbrndmrdstarttime=1786342062
        &jdtcbrndmrdendtime=1786343872
        &jdtcbrndmrdhash=v85AOY0SBKLCnHy8SPm1ZgYjXMJEAvE5EMRmEoPnvnE%3D

Scheme identified as Wowza SecureToken v2:
  * token prefix ....... jdtcbrndmrd  (params: <prefix>starttime/endtime/hash)
  * digest ............. SHA-256 (base64 decodes to exactly 32 bytes)
  * validity window .... endtime - starttime = 1810 s
  * the playlist's own chunklist name embeds the same query string,
    base64'd after the "_tk" marker -- see the `decode-tk` command.

Hash construction (Wowza SecureToken v2):

    parts = [shared_secret] + ["<name>=<value>" for every token param except <prefix>hash]
    parts.sort()                                  # plain lexicographic sort
    payload = content_path + "?" + "&".join(parts)
    hash    = base64(sha256(payload))             # optionally URL-safe

`content_path` is <application>/<streamname>, e.g. "live/5_razo.stream" -- no
leading slash and no playlist filename.

NOTE: the shared secret lives in the Wowza server config and is NOT present in
the HAR (the site's backend signs the URL server-side). You must supply it with
--secret. Use `verify` to confirm a candidate secret + settings reproduce the
captured hash before trusting `gen` output.

Usage
-----
  python wowza_token_gen.py info    --har www.camaramar.com2.har
  python wowza_token_gen.py verify  --har www.camaramar.com2.har --secret 'MySecret'
  python wowza_token_gen.py gen     --har www.camaramar.com2.har --secret 'MySecret'
  python wowza_token_gen.py gen     --har www.camaramar.com2.har --secret 'MySecret' \
                                    --count 5 --window 1810 --check
  python wowza_token_gen.py decode-tk 'chunklist_w2049472974_tkamR0...=.m3u8'
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import sys
import time
from dataclasses import dataclass, field
from typing import Iterable
from urllib.parse import parse_qsl, quote, urlencode, urlsplit, urlunsplit

DEFAULT_PREFIX = "jdtcbrndmrd"
DEFAULT_WINDOW = 1810  # seconds, as observed in the capture
DEFAULT_SKEW = 13      # starttime was 13 s behind the request in the capture

HASH_ALGOS = {
    "sha256": hashlib.sha256,
    "sha384": hashlib.sha384,
    "sha512": hashlib.sha512,
}


# --------------------------------------------------------------------------- #
# Token model
# --------------------------------------------------------------------------- #
@dataclass
class TokenConfig:
    """Everything needed to sign a URL for one Wowza application."""

    scheme: str = "https"
    host: str = "622a10e8864f7.streamlock.net"
    content_path: str = "live/5_razo.stream"   # <application>/<streamname>
    playlist: str = "playlist.m3u8"
    prefix: str = DEFAULT_PREFIX
    algo: str = "sha256"
    # The larger capture showed a hash containing '-' and '_' and no '+' or '/',
    # so this deployment emits URL-safe base64. Hashes lacking all four chars are
    # identical under both alphabets, hence ambiguous -- default to URL-safe.
    urlsafe_b64: bool = True
    # Extra token params that participate in the hash (e.g. {"clientip": "1.2.3.4"}).
    # Keys are given WITHOUT the prefix; the prefix is added automatically.
    extra: dict[str, str] = field(default_factory=dict)

    @property
    def base_url(self) -> str:
        path = f"/{self.content_path.strip('/')}/{self.playlist.lstrip('/')}"
        return urlunsplit((self.scheme, self.host, path, "", ""))


def b64_decode_any(text: str) -> bytes:
    """Decode either base64 alphabet. Plain b64decode silently DROPS '-' and '_',
    which would understate the digest length and mis-identify the algorithm."""
    norm = text.replace("-", "+").replace("_", "/")
    return base64.b64decode(norm + "=" * (-len(norm) % 4))


def _b64(digest: bytes, urlsafe: bool) -> str:
    """Wowza base64s the raw digest; URL-safe mode swaps +/ for -_ (padding kept)."""
    enc = base64.urlsafe_b64encode if urlsafe else base64.b64encode
    return enc(digest).decode("ascii")


def compute_hash(cfg: TokenConfig, secret: str, params: dict[str, str]) -> str:
    """
    Wowza SecureToken v2 digest.

    `params` are the *prefixed* token params (minus the hash param itself),
    e.g. {"jdtcbrndmrdstarttime": "1786342062", ...}.
    """
    if cfg.algo not in HASH_ALGOS:
        raise ValueError(f"unsupported algorithm {cfg.algo!r}; pick one of {sorted(HASH_ALGOS)}")

    hash_param = f"{cfg.prefix}hash"
    parts = [secret] + [f"{k}={v}" for k, v in params.items() if k != hash_param]
    parts.sort()  # lexicographic, matching Wowza's Arrays.sort()

    payload = f"{cfg.content_path.strip('/')}?" + "&".join(parts)
    digest = HASH_ALGOS[cfg.algo](payload.encode("utf-8")).digest()
    return _b64(digest, cfg.urlsafe_b64)


def build_params(cfg: TokenConfig, start: int, end: int) -> dict[str, str]:
    """Ordered token params as they appear in the query string (pre-hash)."""
    params = {
        f"{cfg.prefix}starttime": str(start),
        f"{cfg.prefix}endtime": str(end),
    }
    for key, value in cfg.extra.items():
        name = key if key.startswith(cfg.prefix) else f"{cfg.prefix}{key}"
        params[name] = str(value)
    return params


def build_url(cfg: TokenConfig, secret: str, start: int, end: int) -> tuple[str, dict[str, str]]:
    """Return (signed_url, all_params_including_hash)."""
    params = build_params(cfg, start, end)
    params[f"{cfg.prefix}hash"] = compute_hash(cfg, secret, params)
    # quote_via=quote so the trailing '=' of the base64 hash becomes %3D,
    # exactly as the captured URL had it.
    query = urlencode(params, quote_via=quote, safe="")
    parts = urlsplit(cfg.base_url)
    return urlunsplit((parts.scheme, parts.netloc, parts.path, query, "")), params


# --------------------------------------------------------------------------- #
# HAR parsing
# --------------------------------------------------------------------------- #
@dataclass
class Sample:
    """A signed URL observed in the capture -- the ground truth for `verify`."""

    url: str
    cfg: TokenConfig
    params: dict[str, str]   # token params incl. hash, values URL-decoded
    hash_value: str


def _detect_prefix(query_names: Iterable[str]) -> str | None:
    """Token params are <prefix>starttime / <prefix>endtime / <prefix>hash."""
    for name in query_names:
        if name.endswith("starttime"):
            return name[: -len("starttime")]
    return None


def parse_har(path: str, prefix: str | None = None) -> list[Sample]:
    with open(path, "r", encoding="utf-8-sig") as fh:
        har = json.load(fh)

    samples: list[Sample] = []
    for entry in har.get("log", {}).get("entries", []):
        url = entry.get("request", {}).get("url", "")
        parts = urlsplit(url)
        if not parts.query:
            continue

        # parse_qsl URL-decodes values, so the '%3D' padding comes back as '='.
        qs = dict(parse_qsl(parts.query, keep_blank_values=True))
        found = prefix or _detect_prefix(qs)
        if not found or f"{found}hash" not in qs:
            continue

        segments = [seg for seg in parts.path.split("/") if seg]
        playlist = segments[-1] if segments else "playlist.m3u8"
        content_path = "/".join(segments[:-1])

        raw_hash = qs[f"{found}hash"]
        digest_len = len(b64_decode_any(raw_hash))
        algo = {32: "sha256", 48: "sha384", 64: "sha512"}.get(digest_len, "sha256")

        samples.append(
            Sample(
                url=url,
                cfg=TokenConfig(
                    scheme=parts.scheme,
                    host=parts.netloc,
                    content_path=content_path,
                    playlist=playlist,
                    prefix=found,
                    algo=algo,
                    # '+' or '/' proves standard; otherwise URL-safe (either
                    # proven by '-'/'_', or ambiguous and defaulted per above).
                    urlsafe_b64=not ("+" in raw_hash or "/" in raw_hash),
                    extra={
                        k[len(found):]: v
                        for k, v in qs.items()
                        if k.startswith(found)
                        and k[len(found):] not in ("starttime", "endtime", "hash")
                    },
                ),
                params=qs,
                hash_value=raw_hash,
            )
        )
    return samples


def decode_tk(name: str) -> str:
    """Recover the query string embedded in a Wowza chunklist_..._tk<b64>.m3u8 name."""
    marker = "_tk"
    idx = name.find(marker)
    if idx == -1:
        raise ValueError("no '_tk' marker found in name")
    blob = name[idx + len(marker):]
    for suffix in (".m3u8", ".ts", ".m4s"):
        if blob.endswith(suffix):
            blob = blob[: -len(suffix)]
            break
    blob += "=" * (-len(blob) % 4)
    return base64.b64decode(blob).decode("utf-8", "replace")


# --------------------------------------------------------------------------- #
# Optional live check
# --------------------------------------------------------------------------- #
def check_url(url: str, timeout: float = 10.0) -> str:
    """GET the signed URL and summarise the result. Requires network access."""
    import urllib.error
    import urllib.request

    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                          "AppleWebKit/537.36 (KHTML, like Gecko) "
                          "Chrome/151.0.0.0 Safari/537.36",
            "Accept": "*/*",
            "Origin": "https://www.camaramar.com",
            "Referer": "https://www.camaramar.com/",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read(400).decode("utf-8", "replace").strip()
            ctype = resp.headers.get("Content-Type", "?")
            head = body.splitlines()[0] if body else ""
            return f"HTTP {resp.status} [{ctype}] {head}"
    except urllib.error.HTTPError as exc:
        return f"HTTP {exc.code} {exc.reason}"
    except Exception as exc:  # noqa: BLE001 - report any transport failure verbatim
        return f"ERROR {type(exc).__name__}: {exc}"


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #
def cfg_from_args(args: argparse.Namespace) -> tuple[TokenConfig, Sample | None]:
    """Seed config from the HAR when given, then apply explicit overrides."""
    sample: Sample | None = None
    if getattr(args, "har", None):
        samples = parse_har(args.har, getattr(args, "prefix", None))
        if not samples:
            sys.exit(f"no tokenised URLs found in {args.har}")
        sample = samples[args.index] if args.index < len(samples) else samples[0]
        cfg = sample.cfg
    else:
        cfg = TokenConfig()

    for attr in ("scheme", "host", "content_path", "playlist", "prefix", "algo"):
        value = getattr(args, attr, None)
        if value:
            setattr(cfg, attr, value)
    if getattr(args, "urlsafe", False):
        cfg.urlsafe_b64 = True
    if getattr(args, "standard_b64", False):
        cfg.urlsafe_b64 = False
    for pair in getattr(args, "param", None) or []:
        key, _, value = pair.partition("=")
        cfg.extra[key] = value
    return cfg, sample


def cmd_info(args: argparse.Namespace) -> int:
    samples = parse_har(args.har, args.prefix)
    if not samples:
        sys.exit(f"no tokenised URLs found in {args.har}")

    for i, s in enumerate(samples):
        start = int(s.params.get(f"{s.cfg.prefix}starttime", 0))
        end = int(s.params.get(f"{s.cfg.prefix}endtime", 0))
        print(f"[{i}] {s.url}")
        print(f"     host ............ {s.cfg.host}")
        print(f"     content path .... {s.cfg.content_path}")
        print(f"     playlist ........ {s.cfg.playlist}")
        print(f"     token prefix .... {s.cfg.prefix}")
        print(f"     starttime ....... {start}  ({time.strftime('%Y-%m-%d %H:%M:%SZ', time.gmtime(start))})")
        print(f"     endtime ......... {end}  ({time.strftime('%Y-%m-%d %H:%M:%SZ', time.gmtime(end))})")
        print(f"     window .......... {end - start} s")
        print(f"     hash ............ {s.hash_value}")
        print(f"     algorithm ....... {s.cfg.algo} ({len(b64_decode_any(s.hash_value))} bytes), "
              f"base64={'url-safe' if s.cfg.urlsafe_b64 else 'standard'}")
        if s.cfg.extra:
            print(f"     extra params .... {s.cfg.extra}")
        print(f"     hash payload .... {s.cfg.content_path}?<SECRET>&"
              + "&".join(sorted(f"{k}={v}" for k, v in s.params.items()
                                if k != f'{s.cfg.prefix}hash')))
        print()
    return 0


def cmd_verify(args: argparse.Namespace) -> int:
    """Confirm a candidate secret + settings reproduce the captured hash."""
    cfg, sample = cfg_from_args(args)
    if sample is None:
        sys.exit("verify requires --har with a captured signed URL")

    token_params = {k: v for k, v in sample.params.items() if k != f"{cfg.prefix}hash"}
    expected = sample.hash_value

    tried: list[tuple[str, bool, str]] = []
    for algo in ([cfg.algo] if not args.try_all else list(HASH_ALGOS)):
        for urlsafe in ([cfg.urlsafe_b64] if not args.try_all else (False, True)):
            probe = TokenConfig(**{**cfg.__dict__, "algo": algo, "urlsafe_b64": urlsafe})
            got = compute_hash(probe, args.secret, token_params)
            tried.append((f"{algo}/{'url-safe' if urlsafe else 'standard'}", got == expected, got))

    print(f"expected: {expected}")
    for label, ok, got in tried:
        print(f"  {'MATCH  ' if ok else 'no     '} {label:<18} {got}")

    if any(ok for _, ok, _ in tried):
        print("\nSecret and parameters confirmed -- `gen` output will be valid.")
        return 0
    print("\nNo match. The secret is wrong, or the content path / token prefix /\n"
          "hash inputs differ (e.g. Wowza is configured to fold the client IP into\n"
          "the hash -- retry with --param clientip=<ip>).")
    return 1


def cmd_gen(args: argparse.Namespace) -> int:
    cfg, sample = cfg_from_args(args)

    now = int(time.time())
    start = args.start if args.start is not None else now - args.skew
    window = args.window
    if window is None:
        window = DEFAULT_WINDOW
        if sample is not None:
            s = int(sample.params.get(f"{cfg.prefix}starttime", 0))
            e = int(sample.params.get(f"{cfg.prefix}endtime", 0))
            if e > s:
                window = e - s

    for i in range(args.count):
        offset = i * args.step
        s_time = start + offset
        e_time = (args.end if args.end is not None else s_time + window)
        url, params = build_url(cfg, args.secret, s_time, e_time)

        if args.verbose:
            print(f"# start={s_time} end={e_time} window={e_time - s_time}s "
                  f"hash={params[f'{cfg.prefix}hash']}")
        print(url)
        if args.check:
            print(f"  -> {check_url(url)}")
    return 0


def cmd_decode_tk(args: argparse.Namespace) -> int:
    print(decode_tk(args.name))
    return 0


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(
        description="Generate / verify Wowza SecureToken v2 signed playlist URLs.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    sub = p.add_subparsers(dest="command", required=True)

    def add_har(sp: argparse.ArgumentParser, required: bool = False) -> None:
        sp.add_argument("--har", required=required, help="HAR capture to read the URL template from")
        sp.add_argument("--index", type=int, default=0, help="which tokenised entry to use (default 0)")
        sp.add_argument("--prefix", help=f"token param prefix (default autodetected, e.g. {DEFAULT_PREFIX})")

    def add_cfg(sp: argparse.ArgumentParser) -> None:
        sp.add_argument("--scheme", choices=("https", "http"),
                        help="URL scheme (default https; use http for a local mock)")
        sp.add_argument("--host", help="streaming host, e.g. 622a10e8864f7.streamlock.net")
        sp.add_argument("--content-path", dest="content_path",
                        help="<application>/<streamname>, e.g. live/5_razo.stream")
        sp.add_argument("--playlist", help="playlist file (default playlist.m3u8)")
        sp.add_argument("--algo", choices=sorted(HASH_ALGOS), help="digest (default autodetected)")
        sp.add_argument("--urlsafe", action="store_true", help="force URL-safe base64 (-_)")
        sp.add_argument("--standard-b64", dest="standard_b64", action="store_true",
                        help="force standard base64 (+/)")
        sp.add_argument("--param", action="append", metavar="NAME=VALUE",
                        help="extra token param folded into the hash, prefix added "
                             "automatically (repeatable), e.g. --param clientip=1.2.3.4")

    sp = sub.add_parser("info", help="show the token layout found in a HAR")
    add_har(sp, required=True)
    sp.set_defaults(func=cmd_info)

    sp = sub.add_parser("verify", help="check a candidate secret against the captured hash")
    add_har(sp, required=True)
    add_cfg(sp)
    sp.add_argument("--secret", required=True, help="Wowza SecureToken shared secret")
    sp.add_argument("--try-all", action="store_true",
                    help="try every digest x base64 variant")
    sp.set_defaults(func=cmd_verify)

    sp = sub.add_parser("gen", help="generate freshly signed URLs")
    add_har(sp)
    add_cfg(sp)
    sp.add_argument("--secret", required=True, help="Wowza SecureToken shared secret")
    sp.add_argument("--start", type=int, help="starttime epoch (default: now - skew)")
    sp.add_argument("--end", type=int, help="endtime epoch (default: start + window)")
    sp.add_argument("--window", type=int,
                    help=f"validity seconds (default: from HAR, else {DEFAULT_WINDOW})")
    sp.add_argument("--skew", type=int, default=DEFAULT_SKEW,
                    help=f"seconds to backdate starttime (default {DEFAULT_SKEW}, as captured)")
    sp.add_argument("--count", type=int, default=1, help="how many URLs to emit")
    sp.add_argument("--step", type=int, default=0, help="seconds to advance start per URL")
    sp.add_argument("--check", action="store_true", help="GET each URL and report the response")
    sp.add_argument("-v", "--verbose", action="store_true", help="print token fields as comments")
    sp.set_defaults(func=cmd_gen)

    sp = sub.add_parser("decode-tk", help="decode a chunklist_..._tk<b64>.m3u8 name")
    sp.add_argument("name", help="chunklist file name or full URL")
    sp.set_defaults(func=cmd_decode_tk)

    args = p.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
