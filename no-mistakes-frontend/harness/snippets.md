# dev-browser auth + recon snippets

Reusable, verified-live templates for driving the **configured frontend app(s)**
with the `dev-browser` CLI. dev-browser runs scripts in a QuickJS sandbox: **no
`process`, no `fs`, no `import`**. Globals available: `browser.getPage(name)`
(persistent named pages), the full Playwright `Page` API, `saveScreenshot`,
`writeFile`, `readFile`.

These templates are **parameterized by the app's config** (`load-config.mjs --app
<name>`): use its `repoPath`, `devUrl`, `devCommand`, `browserProfile`, and its
auth profile (`auth.profiles[app.auth]`: `kind`, `secretsTool`, `secretsScopeDir`,
`keyEnv`, credential env vars). The examples below use shell vars set from those
fields:

```bash
# Resolve once, then set per the app under test (load-config.mjs --app <name>):
APP_DIR=<app.repoPath>            # local checkout / secrets scope
export APP_URL=<app.devUrl>       # e.g. http://localhost:5173
export APP_PROFILE=<app.browserProfile>   # persistent dev-browser profile name
```

(`export` so the inner `bash -lc` / `doppler run` sees them.)

Key facts learned live:
- `--browser <NAME>` keeps a persistent browser profile (cookies + localStorage)
  between runs. Log in ONCE under a name, then every later run reuses the session
  with no creds — see B.
- The QuickJS sandbox cannot read env vars, so creds must be injected by the
  SHELL into the heredoc text. Inject them as JSON via `python3 json.dumps` so
  quoting/special chars are safe. **Never write creds to a file, never echo them.**
- A hosted-login auth profile (e.g. PropelAuth) redirects through the identity
  provider's hosted login, then back to the app origin (which may be a preview
  URL in dev, not localhost). Don't hard-assert the post-login URL is localhost.
- Default per-script timeout is ~30s. Chaining `goto(..., {waitUntil:"networkidle"})`
  after a hosted-login redirect can blow it. Use `domcontentloaded` + an explicit
  `waitForTimeout`, and split heavy steps across runs.

---

## Browser drivers (dev-browser · chrome-devtools-axi)

The templates below are **dev-browser** (the default). The other supported driver is
[`chrome-devtools-axi`](https://github.com/kunchenguid/chrome-devtools-axi) — a command-based CLI
(`npx -y chrome-devtools-axi …`, or a global install) that wraps chrome-devtools-mcp. Same job,
different shape: instead of one QuickJS Playwright script, you issue discrete commands against a
**persistent bridge** (Chrome stays alive between commands), acting on elements by the `@uid` refs a
snapshot returns.

Operation map — translate any template step to the chrome-devtools-axi form:

| Need | dev-browser | chrome-devtools-axi |
| --- | --- | --- |
| Navigate + see the page | `page.goto(url)` then `page.snapshotForAI()` | `chrome-devtools-axi open <url>` (navigates **and** snapshots; refs like `@g1:1`) |
| Re-read current state | `page.snapshotForAI()` | `chrome-devtools-axi snapshot` |
| Locate + click | `getByRole(...).click()` | `chrome-devtools-axi click @<uid>` |
| Fill a field | `getByLabel(...).fill(v)` | `chrome-devtools-axi fill @<uid> <v>` (or `fillform @a=v @b=v`) |
| Key / type | `page.press` / `type` | `press <key>` / `type <text>` |
| Assert via JS (API ground-truth, DOM) | `page.evaluate(fn)` | `chrome-devtools-axi eval "() => (...)"` |
| Screenshot evidence | `saveScreenshot(path)` | `chrome-devtools-axi screenshot <path> [--full-page]` (path resolves against CWD) |
| Multi-step in one shot | one heredoc script | `chrome-devtools-axi run` (script from stdin) |
| Tiered self-heal | `snapshotForAI` → `domCua` → `cua` | `snapshot`/`open` (refs) → `eval` to inspect the DOM → `screenshot` to eyeball; act by `@uid` |

Driver differences to respect:

- **Session persistence:** dev-browser reuses a named profile across separate runs (`--browser NAME`).
  chrome-devtools-axi keeps Chrome alive via its bridge, so a login persists **within a bridge
  session**; there's no cross-session named-profile reuse — log in in the same session you then drive,
  or re-auth per run.
- **Secret handling:** dev-browser injects creds via a stdin heredoc as JSON, never on the command
  line. `fill @uid <secret>` would put the secret in argv (process list / history). For credential
  entry with chrome-devtools-axi, pass the step through **`run`** (script from stdin) so the value
  never lands in argv, or prefer the **bearer-token / API-ground-truth** path that needs no browser
  login at all. **Never** screenshot credential entry; never echo a token.
- **Verification status:** the dev-browser templates below are verified-live. This chrome-devtools-axi
  mapping is derived from its CLI reference — confirm the exact `@uid`/selector behavior on first live
  use for a given app, then treat it as verified for that app.

---

## A. Login (hosted-login auth profile — PropelAuth example)

For an app whose auth profile needs an interactive login (`kind: propelauth` /
`browser-login`). Run from the auth profile's `secretsScopeDir` (here the app's
`repoPath`) so the secrets tool resolves the right scope (worktrees aren't
scoped). The example uses `doppler run` (when `secretsTool=doppler`) and the
`PLAYWRIGHT_*` credential env vars; substitute your profile's secrets tool /
selectors. Creds enter the script via stdin heredoc as JSON — never a file, never
printed. No screenshot during credential entry. Prints `auth-ok user-visible` on
success.

```bash
cd "$APP_DIR"
doppler run -- bash -lc '
BASE="${PLAYWRIGHT_BASE_URL:-$APP_URL}"
EMAIL_JSON=$(printf "%s" "$PLAYWRIGHT_USER_EMAIL" | python3 -c "import json,sys;print(json.dumps(sys.stdin.read()))")
PASS_JSON=$(printf "%s" "$PLAYWRIGHT_USER_PASSWORD" | python3 -c "import json,sys;print(json.dumps(sys.stdin.read()))")
dev-browser --browser "$APP_PROFILE" --headless <<EOF
const page = await browser.getPage("app");
await page.goto("$BASE", { waitUntil: "domcontentloaded" });
await page.getByLabel("Email").fill($EMAIL_JSON);
await page.getByRole("button", { name: "Continue" }).click();
await page.getByLabel("Password").fill($PASS_JSON);
await page.waitForTimeout(1000);
await page.getByRole("button", { name: "Log in with email" }).click();
await page.waitForTimeout(2500);
const ok = await page.getByRole("img", { name: "User" }).isVisible().catch(() => false);
console.log(ok ? "auth-ok user-visible" : "auth-FAILED no-user-img");
EOF'
```

Notes (the selectors below are the PropelAuth example; calibrate to your app):
- The PropelAuth hosted login email box has accessible name `Email Sign in with
  SSO`; `getByLabel("Email")` (substring match) still resolves it.
- Logged-in marker in this example is the user-avatar `img` with accessible name
  `User` (`page.getByRole("img", { name: "User" })`). Use whatever authenticated
  marker your app renders.
- If the hosted login is slow, bump the post-click `waitForTimeout` (2500ms verified).

---

## B. Recon (session already persisted — NO login, NO creds)

After A has run once under `--browser "$APP_PROFILE"`, the session is reused.
This block takes a `PATH` and dumps the accessibility tree via `snapshotForAI()`.
Run from anywhere; the secrets tool is only needed for `PLAYWRIGHT_BASE_URL` (or
use `$APP_URL` directly). No creds in this script at all.

```bash
cd "$APP_DIR"
PATH_TO_VISIT="/"   # e.g. "/organization", "/vendors/123"
doppler run -- bash -lc '
BASE="${PLAYWRIGHT_BASE_URL:-$APP_URL}"
dev-browser --browser "$APP_PROFILE" --headless <<EOF
const page = await browser.getPage("app");
await page.goto("$BASE" + "'"$PATH_TO_VISIT"'", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3000);
console.log("url:", page.url());
const snap = await page.snapshotForAI();
console.log(snap.full);
EOF'
```

Tip: `snapshotForAI().full` can be large — pipe it through `ctx_execute`/
`ctx_search` rather than reading it raw into context. `.slice(0, N)` for a quick peek.

---

## C. No-login app (bearer-env auth profile — internal-tool example)

For an app whose auth profile has `kind: bearer-env` / `noLogin: true` (an
internal tool with no user login flow). Its dev server starts already
authenticated using a static Bearer token (the profile's `keyEnv`) injected by
the secrets tool on every request. So just start the server and drive the browser
straight to a path — skip the entire login dance. Use a SEPARATE persistent
profile (the app's own `browserProfile`).

Start the dev server (use the app's `devCommand` from config):

```bash
cd "$APP_DIR" && doppler run -- <app.devCommand>
# e.g. "doppler run -- npm run dev" — injects the profile's keyEnv; Vite default port 5173
```

Recon a path (no creds, no login):

```bash
cd "$APP_DIR"
PATH_TO_VISIT="/"
dev-browser --browser "$APP_PROFILE" --headless <<EOF
const page = await browser.getPage("arg");
await page.goto("$APP_URL" + "$PATH_TO_VISIT", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3000);
console.log("url:", page.url());
const snap = await page.snapshotForAI();
console.log(snap.full);
EOF
```

For API ground-truth, read the admin Bearer from the profile's `keyEnv` (keep it
out of logs/reports — pipe it directly into the consuming command, never echo it).
Set `KEY_ENV` to the profile's `keyEnv` name:

```bash
cd "$APP_DIR" && doppler run -- bash -lc 'printenv "$KEY_ENV"'   # pipe into the consumer, do not print
```

---

## Capture + audit

The visual harness: multi-viewport `fullPage` screenshots + a taste-NEUTRAL
rendered design-system measurement. The `collectMetrics` body below is the
inline copy of `harness/audit-metrics.js` (keep them in sync). It serializes
across the QuickJS->page bridge as a plain function (no closure) and runs via
`page.evaluate`. Outputs land in `~/.dev-browser/tmp/`:
`look-<SLUG>-{desktop,tablet,mobile}.png` and `audit-<SLUG>.json`.

The app's `devUrl` (e.g. `http://localhost:5173`) IS the app's own Vite dev
server (its title + react-refresh present). For a client-rendered SPA the served
HTML is just a shell — auth/redirect happens client-side. To verify LOCAL
changes, log in with `BASE` forced to the app's `devUrl` (template A, override
BASE — do NOT rely on `PLAYWRIGHT_BASE_URL`, which may point at a preview origin).
Once the app's persistent session exists, the session cookie persists on the
devUrl origin and this block reuses it with no creds.

Set `SLUG` + the authenticated `URL`, then run. Verified live against a Vite dev
server at `http://localhost:5173/` — 3 viewports + audit completed in ONE run
inside the ~30s budget. If a heavier page (more DOM / slower hydration) blows the
timeout, split into two runs: run the viewport loop first (capture), then a
second run with just the `page.evaluate(collectMetrics)` + `writeFile` (audit).

```bash
cd "$APP_DIR"
doppler run -- bash -lc '
BASE="$APP_URL"
SLUG="home"
dev-browser --browser "$APP_PROFILE" --headless <<EOF
const collectMetrics = () => {
  const els = [...document.querySelectorAll("*")].slice(0, 1500);
  const cs = (e) => getComputedStyle(e);
  const fonts = new Set(), colors = new Set();
  const radii = {}, padding = {}, fontSizes = {};
  const emojiRe = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/u;
  let textCount = 0, centeredText = 0, gradientBackdrops = 0, coloredLeftBorders = 0;
  const emojiInText = [];
  for (const e of els) {
    const s = cs(e);
    if (s.fontFamily) fonts.add(s.fontFamily.split(",")[0].trim().replace(/["\x27]/g, ""));
    if (s.color && s.color !== "rgba(0, 0, 0, 0)") colors.add(s.color);
    const bg = s.backgroundColor;
    if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") colors.add(bg);
    if (s.borderRadius && s.borderRadius !== "0px") radii[s.borderRadius] = (radii[s.borderRadius] || 0) + 1;
    for (const p of [s.paddingTop, s.paddingLeft]) if (p && p !== "0px") padding[p] = (padding[p] || 0) + 1;
    if (s.fontSize) fontSizes[s.fontSize] = (fontSizes[s.fontSize] || 0) + 1;
    if (s.backgroundImage && s.backgroundImage.includes("gradient")) gradientBackdrops++;
    if (parseFloat(s.borderLeftWidth) >= 3 && s.borderLeftStyle === "solid"
        && s.borderLeftColor && s.borderLeftColor !== "rgba(0, 0, 0, 0)"
        && parseFloat(s.borderTopWidth) === 0 && parseFloat(s.borderRightWidth) === 0 && parseFloat(s.borderBottomWidth) === 0) {
      coloredLeftBorders++;
    }
    const hasDirectText = [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (hasDirectText) {
      textCount++;
      if (s.textAlign === "center") centeredText++;
      if (emojiRe.test(e.textContent) && emojiInText.length < 10) emojiInText.push((e.textContent || "").trim().slice(0, 30));
    }
  }
  const headings = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].slice(0, 40).map((h) => ({
    tag: h.tagName, text: (h.textContent || "").trim().slice(0, 40), size: cs(h).fontSize, weight: cs(h).fontWeight,
  }));
  const smallTargets = [...document.querySelectorAll("a,button,input,select,textarea,[role=button],[onclick]")]
    .map((e) => ({ e, r: e.getBoundingClientRect() }))
    .filter(({ r }) => r.width > 0 && r.height > 0 && (r.width < 44 || r.height < 44))
    .slice(0, 30)
    .map(({ e, r }) => ({ tag: e.tagName, text: (e.textContent || "").trim().slice(0, 30), w: Math.round(r.width), h: Math.round(r.height) }));
  const lum = (c) => {
    const m = c.match(/\d+(\.\d+)?/g);
    if (!m) return null;
    const [r, g, b] = m.slice(0, 3).map(Number).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const effBg = (e) => { let n = e; while (n) { const b = cs(n).backgroundColor; if (b && b !== "rgba(0, 0, 0, 0)" && b !== "transparent") return b; n = n.parentElement; } return "rgb(255, 255, 255)"; };
  const ratio = (a, b) => { const la = lum(a), lb = lum(b); if (la == null || lb == null) return null; return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); };
  const lowContrast = [];
  const textEls = [...document.querySelectorAll("p,span,a,button,li,td,th,label,h1,h2,h3,h4,h5,h6,div")].slice(0, 800)
    .filter((e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()));
  for (const e of textEls) {
    const s = cs(e); const size = parseFloat(s.fontSize); const weight = parseInt(s.fontWeight) || 400;
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    const r = ratio(s.color, effBg(e));
    if (r != null && r < (large ? 3 : 4.5)) lowContrast.push({ text: (e.textContent || "").trim().slice(0, 30), color: s.color, ratio: Math.round(r * 100) / 100, min: large ? 3 : 4.5 });
    if (lowContrast.length >= 25) break;
  }
  const docW = document.documentElement.clientWidth;
  const overflow = els.filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > docW + 1; })
    .slice(0, 15).map((e) => ({ tag: e.tagName, cls: (e.className && e.className.toString().slice(0, 40)) || "", right: Math.round(e.getBoundingClientRect().right) }));
  const topN = (obj, n) => Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n).map(([value, count]) => ({ value, count }));
  return {
    counts: { fonts: fonts.size, colors: colors.size, radii: Object.keys(radii).length },
    fonts: [...fonts], colors: [...colors], radii: topN(radii, 12),
    spacing: topN(padding, 12), fontSizes: topN(fontSizes, 12),
    headings, smallTargets, lowContrast, overflow,
    slopSignals: {
      centeredTextRatio: textCount ? Math.round((centeredText / textCount) * 100) / 100 : 0,
      centeredText, textCount, gradientBackdrops, coloredLeftBorders,
      emojiInText, dominantRadius: topN(radii, 1)[0] || null,
    },
  };
};
const SLUG = "$SLUG";
const URL = "$BASE/";
const page = await browser.getPage("app");
const viewports = [["desktop",1280,800],["tablet",768,1024],["mobile",375,812]];
for (const [vp, w, h] of viewports) {
  await page.setViewportSize({ width: w, height: h });
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  await saveScreenshot(await page.screenshot({ fullPage: true }), \`look-\${SLUG}-\${vp}.png\`);
  console.log("captured", vp);
}
await page.setViewportSize({ width: 1280, height: 800 });
await page.goto(URL, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);
const metrics = await page.evaluate(collectMetrics);
await writeFile(\`audit-\${SLUG}.json\`, JSON.stringify(metrics, null, 2));
console.log("audit-written fonts", metrics.fonts.length, "colors", metrics.colors.length);
EOF'
```

Verify:

```bash
ls -la ~/.dev-browser/tmp/audit-<SLUG>.json ~/.dev-browser/tmp/look-<SLUG>-*.png
cat ~/.dev-browser/tmp/audit-<SLUG>.json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log('fonts',j.fonts.length,'colors',j.colors.length,'lowContrast',j.lowContrast.length)})"
```

Expect 3 non-zero `look-<SLUG>-*.png` and an `audit-<SLUG>.json` with non-empty
`fonts`/`colors` (example run: fonts 2, colors 10, lowContrast 5).

Notes:
- Inline-string caveats vs `audit-metrics.js`: the heredoc is single-quoted in
  the shell but dev-browser still interprets `\$`, `\`` and `${...}`, so template
  literals are escaped (`\${...}`, `\``) and a literal apostrophe inside the
  `replace` regex is written `\x27` (heredoc can't carry a raw `'`).
- The judge compares these measurements against the app's OWN baseline; the
  snippet encodes no aesthetic opinion (font/color COUNTS, a11y flags, slop
  SIGNALS — never a verdict).
- To audit a different screen, change `SLUG` and the `URL` path (e.g.
  `"$BASE/organization"`).
