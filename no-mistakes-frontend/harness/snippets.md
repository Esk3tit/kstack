# agent-browser templates

Verified-live templates for driving the **configured frontend app(s)** with the
`agent-browser` CLI: one command per action against the run's own browser session,
elements addressed by the `@eN` refs a snapshot returns. The full command
reference is `agent-browser skills get core`.

The templates are **parameterized by the app's config** (`load-config.mjs --app
<name>`): its `repoPath`, `devUrl`, `devCommand`, `browserProfile`, and its auth
profile (`auth.profiles[app.auth]`: `kind`, `secretsTool`, `secretsScopeDir`,
`keyEnv`, credential env vars). Set these once per run:

```bash
APP_DIR=<app.repoPath>                  # local checkout
export APP_URL=<app.devUrl>             # e.g. http://localhost:5173
export AGENT_BROWSER_SESSION="<app.browserProfile>-$RUN"   # one browser per run; `agent-browser close` at the end
EV=~/.no-mistakes/$RUN                  # evidence dir
# Run a function from a harness file in the page; prints its JSON result.
in_page() { { echo '(() => {'; cat "$1"; echo "return $2;"; echo '})()'; } | agent-browser eval --stdin; }
```

Key facts learned live:
- Each run owns its browser session, so parallel runs never drive each other's page. A login app
  logs in once per run (A); the login lasts for the whole run.
- A hosted login (e.g. PropelAuth) redirects client-side a moment after `open`, then back to the app
  origin (which may be a preview URL in dev). Wait on the URL or text you expect, never a fixed delay.
- Refs go stale after the page changes: `snapshot -i` again, then act. `find role|label|text …`
  needs no snapshot.
- Each command has its own ~25s timeout; there is no per-script cap.

---

## A. Login (hosted-login auth profile — PropelAuth example)

For an app whose auth profile needs an interactive login (`kind: propelauth` /
`browser-login`). Run under the auth profile's secrets tool and scope (here
`doppler run` from its `secretsScopeDir`). A Python step reads the credentials from
the environment and pipes the commands to `batch` as JSON on stdin, so they never
appear in argv, shell history, or a file. Prints `login-ok` or the failing step.

```bash
cd <auth profile secretsScopeDir>
doppler run -- python3 - <<'PY' | agent-browser batch --bail --json | python3 -c 'import json,sys; r=json.load(sys.stdin); bad=[i for i,x in enumerate(r) if not x["success"]]; print(f"login-FAILED at step {bad[0]}" if bad else "login-ok")'
import json, os
url = os.environ["APP_URL"].rstrip("/")
print(json.dumps([
    ["open", url],
    ["wait", "--url", "**/login**"],
    ["find", "label", "Email", "fill", os.environ["PLAYWRIGHT_USER_EMAIL"]],
    ["find", "role", "button", "click", "--name", "Continue"],
    ["wait", "input[type=password]"],
    ["fill", "input[type=password]", os.environ["PLAYWRIGHT_USER_PASSWORD"]],
    ["find", "role", "button", "click", "--name", "Log in with email"],
    ["wait", "--url", url + "/**"],
]))
PY
agent-browser wait --text "My Organization"   # the app's logged-in marker
```

- `batch --json` echoes every command with its arguments, credentials included. Pipe it only into
  the summary filter above; never print it or save it.
- No `snapshot`, `screenshot`, or recording while credentials sit in the form: a snapshot prints
  field values.
- Wait for the password field before filling it. PropelAuth renders it after **Continue**, and an
  early fill lands in the email box.

---

## B. Recon (after A, or a no-login app — no creds)

```bash
agent-browser open "$APP_URL/<path>"          # e.g. /organization, /vendors/123
agent-browser wait --text "<text the screen renders>"
agent-browser snapshot -i -c                  # interactive elements with @eN refs
```

`snapshot` (no `-i`) returns the full tree; pipe large output through `ctx_execute`/`ctx_search`
rather than reading it raw. `agent-browser read` returns the rendered page as text.

---

## C. No-login app (bearer-env auth profile — internal-tool example)

For an app whose auth profile has `kind: bearer-env` / `noLogin: true`. Its dev server
starts already authenticated (the profile's `keyEnv` injected by the secrets tool), so
start it and use B directly:

```bash
cd "$APP_DIR" && doppler run -- <app.devCommand>   # e.g. "npm run dev"; Vite default port 5173
```

For API ground-truth, send the profile's `keyEnv` as the Bearer. The header goes to curl on stdin
(`-H @-`), so the token never reaches argv or output:

```bash
export KEY_ENV=<profile keyEnv> API_URL=<backend devUrl or preview apiUrl>
cd "$APP_DIR" && doppler run -- bash -c 'printf "Authorization: Bearer %s" "${!KEY_ENV}" | curl -sf -H @- "$API_URL/<path>"'
```

---

## D. Record a clip

Bring the page to the start state first (logged in, data loaded). Record only the action under
review and its outcome:

```bash
agent-browser record start "$EV/<case-slug>.mp4" --cursor
agent-browser wait 1000                               # show the start state
agent-browser find role button click --name "Save"   # the action under review
agent-browser wait --text "Saved"                     # its outcome, not just the click
agent-browser wait 1500                               # hold the result long enough to read
agent-browser record stop --json
```

- Without the two holds a fast action records as a fraction of a second that shows nothing.
- `record stop` before `close`, even on failure, or ffmpeg never flushes the file.
- `--cursor` draws the pointer so a reviewer sees what was clicked. Use `--fps 60` for drag,
  animation, or scroll.
- Stretches with no repaint can be shortened, so a clip does not prove timing. Measure timing claims
  separately.
- Check the clip: `ffprobe -v error -show_entries format=duration -of compact <clip>`, then pull
  frames across the whole clip (`ffmpeg -ss <t> -i <clip> -frames:v 1 f.png`) and look at them.

---

## Capture + audit

Multi-viewport screenshots plus a taste-NEUTRAL rendered design-system measurement from
`harness/audit-metrics.js`. Wait on the screen's own text, not a fixed delay.

```bash
SLUG=home; URL="$APP_URL/"
for vp in "desktop 1280 800" "tablet 768 1024" "mobile 375 812"; do
  read -r name w h <<<"$vp"
  agent-browser set viewport "$w" "$h"
  agent-browser open "$URL" && agent-browser wait --text "<text the screen renders>"
  agent-browser screenshot --full "$EV/look-$SLUG-$name.png"
done
agent-browser set viewport 1280 800
in_page "$H/harness/audit-metrics.js" 'collectMetrics()' > "$EV/audit-$SLUG.json"
node -e 'const j=require(process.argv[1]);console.log("fonts",j.fonts.length,"colors",j.colors.length,"lowContrast",j.lowContrast.length)' "$EV/audit-$SLUG.json"
```

Expect three non-empty `look-<SLUG>-*.png` and non-empty `fonts`/`colors` (AI-ARG home: fonts 4,
colors 52). The judge compares these against the app's OWN baseline; the measurement encodes no
aesthetic opinion (counts, a11y flags, slop SIGNALS — never a verdict).
