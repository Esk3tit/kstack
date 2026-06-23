# dev-browser auth + recon snippets

Reusable, verified-live templates for driving the PromptArmor frontends with the
`dev-browser` CLI. dev-browser runs scripts in a QuickJS sandbox: **no `process`,
no `fs`, no `import`**. Globals available: `browser.getPage(name)` (persistent
named pages), the full Playwright `Page` API, `saveScreenshot`, `writeFile`,
`readFile`.

Key facts learned live:
- `--browser <NAME>` keeps a persistent browser profile (cookies + localStorage)
  between runs. Log in ONCE under a name, then every later run reuses the session
  with no creds — see B.
- The QuickJS sandbox cannot read env vars, so creds must be injected by the
  SHELL into the heredoc text. Inject them as JSON via `python3 json.dumps` so
  quoting/special chars are safe. **Never write creds to a file, never echo them.**
- AI-TPRM dev redirects through PropelAuth's hosted login, then back to the
  configured app origin (a Porter preview URL in dev, not localhost). Don't
  hard-assert the post-login URL is localhost.
- Default per-script timeout is ~30s. Chaining `goto(..., {waitUntil:"networkidle"})`
  after PropelAuth redirects can blow it. Use `domcontentloaded` + an explicit
  `waitForTimeout`, and split heavy steps across runs.

---

## A. AI-TPRM login (PropelAuth)

Run from the AI-TPRM repo so Doppler resolves `PLAYWRIGHT_*` creds. Creds enter the
script via stdin heredoc as JSON — never a file, never printed. No screenshot
during credential entry. Prints `auth-ok user-visible` on success.

```bash
cd ~/PromptArmor/AI-TPRM
doppler run -- bash -lc '
BASE="${PLAYWRIGHT_BASE_URL:-http://localhost:5173}"
EMAIL_JSON=$(printf "%s" "$PLAYWRIGHT_USER_EMAIL" | python3 -c "import json,sys;print(json.dumps(sys.stdin.read()))")
PASS_JSON=$(printf "%s" "$PLAYWRIGHT_USER_PASSWORD" | python3 -c "import json,sys;print(json.dumps(sys.stdin.read()))")
dev-browser --browser no-mistakes-tprm --headless <<EOF
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

Notes:
- The hosted login email box has accessible name `Email Sign in with SSO`;
  `getByLabel("Email")` (substring match) still resolves it.
- Logged-in marker is the user-avatar `img` with accessible name `User`
  (`page.getByRole("img", { name: "User" })`).
- If PropelAuth is slow, bump the post-click `waitForTimeout` (2500ms verified).

---

## B. Recon (session already persisted — NO login, NO creds)

After A has run once under `--browser no-mistakes-tprm`, the session is reused.
This block takes a `PATH` and dumps the accessibility tree via `snapshotForAI()`.
Run from anywhere; Doppler only needed for `PLAYWRIGHT_BASE_URL` (or hardcode the
app origin). No creds in this script at all.

```bash
cd ~/PromptArmor/AI-TPRM
PATH_TO_VISIT="/"   # e.g. "/organization", "/vendors/123"
doppler run -- bash -lc '
BASE="${PLAYWRIGHT_BASE_URL:-http://localhost:5173}"
dev-browser --browser no-mistakes-tprm --headless <<EOF
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

## C. AI-ARG (internal Knightwing — NO login)

AI-ARG has no user login flow. Its dev server starts already authenticated using a
static Bearer token (`VITE_PROMPTARMOR_MOFFITT_KEY`) injected by Doppler on every
request. So just start the server and drive the browser straight to a path —
skip the entire login dance. Use a SEPARATE persistent profile, `no-mistakes-arg`.

Start the dev server (AI-ARG uses npm, not pnpm):

```bash
cd ~/PromptArmor/AI-ARG && doppler run -- npm run dev
# (npm run dev == "doppler run -- vite"; Vite default port 5173)
```

Recon a path (no creds, no login):

```bash
cd ~/PromptArmor/AI-ARG
ARG_BASE="http://localhost:5173"
PATH_TO_VISIT="/"
dev-browser --browser no-mistakes-arg --headless <<EOF
const page = await browser.getPage("arg");
await page.goto("$ARG_BASE" + "'"$PATH_TO_VISIT"'", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3000);
console.log("url:", page.url());
const snap = await page.snapshotForAI();
console.log(snap.full);
EOF
```

For API ground-truth, read the admin Bearer token from Doppler (keep it out of
logs/reports — pipe directly into the consuming command, never echo it):

```bash
cd ~/PromptArmor/AI-ARG && doppler run -- bash -lc 'echo "$VITE_PROMPTARMOR_MOFFITT_KEY"'
```

---

## Capture + audit

The visual harness: multi-viewport `fullPage` screenshots + a taste-NEUTRAL
rendered design-system measurement. The `collectMetrics` body below is the
inline copy of `harness/audit-metrics.js` (keep them in sync). It serializes
across the QuickJS->page bridge as a plain function (no closure) and runs via
`page.evaluate`. Outputs land in `~/.dev-browser/tmp/`:
`look-<SLUG>-{desktop,tablet,mobile}.png` and `audit-<SLUG>.json`.

Origin: localhost:5173 IS the AI-TPRM Vite dev server (title "PromptArmor",
react-refresh present). It's a client-rendered SPA, so the served HTML is just
a shell — auth/redirect happens client-side. To verify LOCAL changes, log in
with `BASE` forced to `http://localhost:5173` (template A, override BASE — do
NOT rely on `PLAYWRIGHT_BASE_URL`, which points at a Porter preview). Once the
`no-mistakes-tprm` session exists, the session cookie persists on the localhost
origin and this block reuses it with no creds.

Set `SLUG` + the authenticated `URL`, then run. Verified live against
`http://localhost:5173/` — 3 viewports + audit completed in ONE run inside the
~30s budget. If a heavier page (more DOM / slower hydration) blows the timeout,
split into two runs: run the viewport loop first (capture), then a second run
with just the `page.evaluate(collectMetrics)` + `writeFile` (audit).

```bash
cd ~/PromptArmor/AI-TPRM
doppler run -- bash -lc '
BASE="http://localhost:5173"
SLUG="tprm-home"
dev-browser --browser no-mistakes-tprm --headless <<EOF
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
`fonts`/`colors`. Verified `tprm-home`: fonts 2, colors 10, lowContrast 5.

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
