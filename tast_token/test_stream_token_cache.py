#!/usr/bin/env python3
"""
Test the SecureToken cookie cache added to c:\\extrahd\\tiempo\\index.js.

It runs the real functions from index.js in node, under a minimal fake DOM
(document.cookie, location, fetch), so what is tested is the shipped code rather
than a re-implementation of it. The questions worth answering:

  * does a second call inside 15 minutes reuse the cookie instead of signing again
    (the whole point of the change),
  * does it stop reusing after 15 minutes,
  * does it refuse a cached token that is about to expire even within the TTL,
  * do concurrent cameras collapse into ONE signing request,
  * does everything degrade to the original URL when the signer is off or broken,
  * does the cookie survive a base64 hash full of '=' and '/' characters.

  python test_stream_token_cache.py
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest

INDEX_JS = r"C:\extrahd\tiempo\index.js"
HAS_NODE = subprocess.run(["node", "--version"], capture_output=True).returncode == 0

# Pull only what we need out of index.js. The file is 1500+ lines of jQuery-era
# globals; evaluating all of it in node would fail on DOM access at load time.
HARNESS = r"""
const fs = require('fs');
const vm = require('vm');

const src = fs.readFileSync(process.argv[2], 'utf8');

function grab(sig) {
  // Slice a function/const declaration out of the file by brace matching, so the
  // test runs the real source and not a copy that can drift away from it.
  const at = src.indexOf(sig);
  if (at === -1) throw new Error('not found in index.js: ' + sig);
  // A const declaration is one line. Brace-matching it would swallow the rest of
  // the module (the first '{' found belongs to a later function), which shows up
  // as "Identifier already declared" rather than as a missing piece.
  if (sig.startsWith('const ')) {
    const end = src.indexOf('\n', at);
    return src.slice(at, end + 1);
  }
  let i = src.indexOf('{', at), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(at, i);
}

const pieces = [
  'function setCookie(', 'function getCookie(', 'function eraseCookie(',
  'const STREAM_TOKEN_TTL_MIN', 'const STREAM_TOKEN_COOKIE',
  'const STREAM_TOKEN_MARGIN_S', 'const STREAM_TOKEN_MAX_ENTRIES',
  'function streamTokenKey(', 'function readStreamTokenCache(',
  'function writeStreamTokenCache(', 'function streamTokenParts(',
  'function streamTokenBuildURL(', 'function streamTokenEndtime(',
  'function getCachedStreamURL(', 'function cacheStreamURL(',
  'async function getSignedStreamURL(',
].map(grab).join('\n\n');

const cfg = JSON.parse(process.argv[3]);

// --- minimal fake DOM ---------------------------------------------------- //
let cookieJar = {};
let now = cfg.now * 1000;
let signCalls = [];

const sandbox = {
  console: { log() {}, warn() {}, error() {} },
  URL, URLSearchParams, JSON, Math, parseInt, encodeURIComponent,
  decodeURIComponent, Object, Date: class extends Date {
    constructor(...a) { if (a.length) super(...a); else super(now); }
    static now() { return now; }
    getTime() { return super.getTime(); }
  },
  location: { href: 'https://user.github.io/tiempo/' },
  proxyHostStreamToken: cfg.signer,
  streamTokenInFlight: {},
  document: {
    get cookie() {
      return Object.keys(cookieJar).map(k => k + '=' + cookieJar[k]).join('; ');
    },
    set cookie(v) {
      const [pair] = v.split(';');
      const i = pair.indexOf('=');
      const name = pair.slice(0, i).trim(), value = pair.slice(i + 1);
      if (/Expires=Thu, 01 Jan 1970/.test(v)) delete cookieJar[name];
      else cookieJar[name] = value;
    }
  },
  async fetch(url) {
    signCalls.push(url);
    if (cfg.mode === 'http_error') return { ok: false, status: 502 };
    if (cfg.mode === 'throw') throw new Error('network down');
    if (cfg.mode === 'no_url') return { ok: true, json: async () => ({ nope: 1 }) };
    // The real caller does proxyHostStreamToken + encodeURIComponent(url), and
    // the signer prefix itself contains '=' ("?type=streamtoken&url="). Split on
    // the LAST '=' -- an encoded URL has none of its own (they become %3D).
    const target = decodeURIComponent(url.slice(url.lastIndexOf('=') + 1));
    const start = Math.floor(now / 1000) - 13;
    const end = start + (cfg.window || 1810);
    // A realistic hash: URL-safe base64 with padding, percent-encoded.
    const hash = cfg.hash || 'rj02tspcWaDwn5L3_aC76HDnk-3I2MiPxrCFI_UlRPo%3D';
    const signed = target + '?jdtcbrndmrdstarttime=' + start +
      '&jdtcbrndmrdendtime=' + end + '&jdtcbrndmrdhash=' + hash;
    return { ok: true, json: async () => ({ url: signed, expires_at: end }) };
  },
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(pieces, sandbox);

// Function declarations become properties of the context's global object, but
// const/let do not -- they live in the script's lexical scope, so
// sandbox.STREAM_TOKEN_COOKIE reads back undefined. Evaluate it inside instead.
const COOKIE_NAME = vm.runInContext('STREAM_TOKEN_COOKIE', sandbox);

// --- scripted steps ------------------------------------------------------ //
(async () => {
  const out = [];
  for (const step of cfg.steps) {
    if (step.advance) { now += step.advance * 1000; out.push({ advanced: step.advance }); continue; }
    if (step.concurrent) {
      const before = signCalls.length;
      const urls = await Promise.all(step.concurrent.map(u =>
        sandbox.getSignedStreamURL(u)));
      out.push({ urls, signCalls: signCalls.length - before });
      continue;
    }
    const before = signCalls.length;
    const url = await sandbox.getSignedStreamURL(step.get);
    out.push({
      url,
      signed: url !== step.get,
      signCalls: signCalls.length - before,
      cookie: cookieJar[COOKIE_NAME] || null,
      cookieBytes: (cookieJar[COOKIE_NAME] || '').length,
    });
  }
  console.log(JSON.stringify({ steps: out, totalSignCalls: signCalls.length,
                               cookieJar }));
})().catch(e => { console.log(JSON.stringify({ error: e.message })); });
"""

LIVE = "https://622a10e8864f7.streamlock.net/live/31_coroso.stream/playlist.m3u8"
LIVE2 = "https://622a10e8864f7.streamlock.net/live/61_perbes.stream/playlist.m3u8"
OPEN = "https://s61.ipcamlive.com/streams/3dfzg63etbyh0kjsl/stream.m3u8"


@unittest.skipUnless(HAS_NODE, "node not available")
@unittest.skipUnless(os.path.exists(INDEX_JS), f"{INDEX_JS} not found")
class TestStreamTokenCache(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.runner = os.path.join(tempfile.mkdtemp(), "harness.js")
        with open(cls.runner, "w", encoding="utf-8") as f:
            f.write(HARNESS)

    def run_js(self, steps, signer="https://lambda/?type=streamtoken&url=",
               mode="ok", now=1786350000, window=1810, hash_=None):
        cfg = {"steps": steps, "signer": signer, "mode": mode, "now": now,
               "window": window}
        if hash_:
            cfg["hash"] = hash_
        p = subprocess.run(["node", self.runner, INDEX_JS, json.dumps(cfg)],
                           capture_output=True, text=True, encoding="utf-8")
        self.assertEqual(p.returncode, 0, f"node failed:\n{p.stderr}")
        data = json.loads(p.stdout.strip().splitlines()[-1])
        self.assertNotIn("error", data, data.get("error", ""))
        return data

    # ------------------------------------------------------------------ #
    def test_first_call_signs_and_stores_the_cookie(self):
        d = self.run_js([{"get": LIVE}])
        s = d["steps"][0]
        self.assertEqual(s["signCalls"], 1, "did not ask the signer")
        self.assertTrue(s["signed"], "returned the unsigned URL")
        self.assertIn("jdtcbrndmrdhash=", s["url"])
        self.assertIsNotNone(s["cookie"], "nothing was cached")
        self.assertIn("31_coroso.stream", s["cookie"])

    def test_second_call_within_15_min_reuses_the_cookie(self):
        """The whole point of the change: no signing on every request."""
        d = self.run_js([{"get": LIVE}, {"advance": 14 * 60}, {"get": LIVE}])
        first, _, third = d["steps"]
        self.assertEqual(first["signCalls"], 1)
        self.assertEqual(third["signCalls"], 0,
                         "signed again inside the 15-minute TTL")
        self.assertEqual(first["url"], third["url"], "did not reuse the same URL")
        self.assertEqual(d["totalSignCalls"], 1)

    def test_cache_expires_after_15_min(self):
        d = self.run_js([{"get": LIVE}, {"advance": 15 * 60 + 5}, {"get": LIVE}])
        self.assertEqual(d["steps"][2]["signCalls"], 1,
                         "kept using a token past the 15-minute TTL")
        self.assertEqual(d["totalSignCalls"], 2)

    def test_token_near_expiry_is_refused_even_inside_the_ttl(self):
        """A short signer window must not be papered over by the 15-min TTL.

        With a 600s window and a 300s margin, the entry is only usable for ~300s
        even though the cache TTL says 900s.
        """
        d = self.run_js([{"get": LIVE}, {"advance": 400}, {"get": LIVE}],
                        window=600)
        self.assertEqual(d["steps"][2]["signCalls"], 1,
                         "served a token with less than the safety margin left")

    def test_concurrent_cameras_sign_once_per_stream(self):
        """Four cameras loading together must not fire four identical signings."""
        d = self.run_js([{"concurrent": [LIVE, LIVE, LIVE, LIVE]}])
        self.assertEqual(d["steps"][0]["signCalls"], 1,
                         f"{d['steps'][0]['signCalls']} signings for one stream")
        urls = d["steps"][0]["urls"]
        self.assertEqual(len(set(urls)), 1, "concurrent callers got different URLs")

    def test_distinct_streams_are_cached_separately(self):
        d = self.run_js([{"get": LIVE}, {"get": LIVE2}, {"get": LIVE},
                         {"get": LIVE2}])
        self.assertEqual(d["totalSignCalls"], 2, "streams share a cache entry")
        self.assertNotEqual(d["steps"][0]["url"], d["steps"][1]["url"])
        self.assertEqual(d["steps"][2]["signCalls"], 0)
        self.assertEqual(d["steps"][3]["signCalls"], 0)

    def test_open_cameras_are_never_sent_to_the_signer(self):
        """ipcamlive/xunta cameras carry no token; signing them wastes a round trip."""
        d = self.run_js([{"get": OPEN}])
        self.assertEqual(d["steps"][0]["signCalls"], 0,
                         "asked the signer for a token-free camera")
        self.assertEqual(d["steps"][0]["url"], OPEN, "modified an open URL")

    def test_disabled_signer_returns_the_url_untouched(self):
        """With proxyHostStreamToken null the site must behave exactly as before."""
        d = self.run_js([{"get": LIVE}], signer=None)
        self.assertEqual(d["steps"][0]["signCalls"], 0)
        self.assertEqual(d["steps"][0]["url"], LIVE)
        self.assertIsNone(d["steps"][0]["cookie"])

    def test_signer_failures_fall_back_to_the_original_url(self):
        for mode in ("http_error", "throw", "no_url"):
            with self.subTest(mode=mode):
                d = self.run_js([{"get": LIVE}], mode=mode)
                s = d["steps"][0]
                self.assertEqual(s["url"], LIVE,
                                 f"{mode}: did not fall back to the plain URL")
                self.assertIsNone(s["cookie"],
                                  f"{mode}: cached a failed signing")

    def test_failed_signing_is_retried_not_cached(self):
        d = self.run_js([{"get": LIVE}, {"get": LIVE}], mode="http_error")
        self.assertEqual(d["totalSignCalls"], 2,
                         "a failure was cached and never retried")

    def test_cookie_survives_a_hash_full_of_awkward_characters(self):
        """Standard base64 brings '+', '/' and '='; all break naive cookies.

        The hash arrives percent-encoded, as any correct signer emits it -- an
        unencoded '+' in a query string legitimately decodes to a space, so a
        raw hash would be a malformed URL rather than a case to support.
        """
        raw = "ab+cd/ef=gh=="
        d = self.run_js([{"get": LIVE}, {"advance": 60}, {"get": LIVE}],
                        hash_="ab%2Bcd%2Fef%3Dgh%3D%3D")
        self.assertEqual(d["steps"][2]["signCalls"], 0,
                         "cookie round trip lost the entry")
        self.assertEqual(d["steps"][0]["url"], d["steps"][2]["url"],
                         "URL came back mangled from the cookie")
        # And the value must decode back to the original bytes.
        import urllib.parse
        q = urllib.parse.parse_qs(urllib.parse.urlsplit(d["steps"][2]["url"]).query)
        self.assertEqual(q["jdtcbrndmrdhash"][0].replace(" ", "+"), raw,
                         "the hash did not survive the round trip")
        self.assertNotIn(";", d["steps"][0]["cookie"],
                         "unescaped ';' would truncate the cookie")
        self.assertNotIn(",", d["steps"][0]["cookie"],
                         "unescaped ',' is rejected by some cookie parsers")

    def test_cookie_stays_small_enough_for_the_4kb_domain_budget(self):
        """This domain already stores pagina, praiasItems, poboacionsItems and
        nombresCompeticion; the token cache must not evict them."""
        streams = [f"https://622a10e8864f7.streamlock.net/live/{i}_cam.stream/"
                   f"playlist.m3u8" for i in range(12)]
        d = self.run_js([{"get": u} for u in streams])
        biggest = max(s["cookieBytes"] for s in d["steps"])
        self.assertLess(biggest, 2048,
                        f"token cookie grew to {biggest} B, crowding the 4 KB budget")

    def test_entries_are_capped(self):
        streams = [f"https://622a10e8864f7.streamlock.net/live/{i}_cam.stream/"
                   f"playlist.m3u8" for i in range(20)]
        d = self.run_js([{"get": u} for u in streams])
        cookie = d["steps"][-1]["cookie"]
        import urllib.parse
        entries = json.loads(urllib.parse.unquote(cookie))
        self.assertLessEqual(len(entries), 12,
                             f"cache holds {len(entries)} entries, cap is 12")

    def test_cache_key_ignores_the_query_string(self):
        """Signed URLs differ every time; keying on them would never hit."""
        d = self.run_js([{"get": LIVE}, {"advance": 60},
                         {"get": LIVE + "?foo=1"}])
        self.assertEqual(d["steps"][2]["signCalls"], 0,
                         "a differing query string missed the cache")


if __name__ == "__main__":
    unittest.main(verbosity=2)
