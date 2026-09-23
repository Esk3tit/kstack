#!/usr/bin/env node
// Interactive (and CI-friendly) generator for a project's .no-mistakes.json.
// Flow: detect stack -> idempotency gate -> prompt with detected defaults -> validate -> write.
// Zero-dependency (node:util/readline/tty/fs). Non-interactive via --yes/--preset/flags or non-TTY.
//
//   node setup.mjs [--cwd <dir>] [--output <path>] [--central] [--preset <platform>]
//                  [--project <name>] [--org <name>] [--repo-owner <o>] [--checkout-base <dir>]
//                  [--yes] [--force] [--no-color] [--help]

import { parseArgs } from 'node:util'
import { createInterface } from 'node:readline/promises'
import readline from 'node:readline'
import { writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { homedir } from 'node:os'
import { stdin as input, stdout as output } from 'node:process'
import { detect } from './detect.mjs'
import { buildConfig, presetFor, PRESETS, PLATFORM_ORDER } from './presets.mjs'
import { withDefaults, validationErrors } from './load-config.mjs'

let values
try {
  ({ values } = parseArgs({
    allowPositionals: true,
    allowNegative: true,
    options: {
      cwd: { type: 'string' },
      output: { type: 'string', short: 'o' },
      central: { type: 'boolean', default: false },
      preset: { type: 'string', short: 'p' },
      project: { type: 'string' },
      org: { type: 'string' },
      'repo-owner': { type: 'string' },
      'checkout-base': { type: 'string' },
      yes: { type: 'boolean', short: 'y', default: false },
      force: { type: 'boolean', short: 'f', default: false },
      color: { type: 'boolean', default: true },
      help: { type: 'boolean', short: 'h', default: false },
    },
  }))
} catch (e) {
  process.stderr.write(`setup: ${e.message}\nRun with --help.\n`); process.exit(2)
}

const useColor = values.color && !('NO_COLOR' in process.env) && Boolean(output.isTTY)
const wrap = (o, c) => (s) => (useColor ? `\x1b[${o}m${s}\x1b[${c}m` : String(s))
const C = { bold: wrap(1, 22), dim: wrap(2, 22), red: wrap(31, 39), green: wrap(32, 39), cyan: wrap(36, 39), yellow: wrap(33, 39) }

function help() {
  output.write(`${C.bold('no-mistakes setup')} — generate a project's .no-mistakes.json

Usage: node setup.mjs [options]

  --cwd <dir>            project dir to inspect (default: cwd)
  -o, --output <path>    where to write (default: <cwd>/.no-mistakes.json)
  --central              write to ~/.no-mistakes/<project>.json instead
  -p, --preset <plat>    DB platform: ${PLATFORM_ORDER.join(' | ')}
  --project <name>       project id (default: detected)
  --org <name>           org / display name
  --repo-owner <o>       default GitHub owner for PR posting
  --checkout-base <dir>  base dir for app repo checkouts
  -y, --yes              non-interactive: accept detected/flag defaults
  -f, --force            overwrite an existing config without asking
  --no-color             disable ANSI color
  -h, --help             this help
`)
}
if (values.help) { help(); process.exit(0) }

const interactive = !values.yes && Boolean(input.isTTY && output.isTTY)
const isCI = process.env.CI != null && process.env.CI !== '' && process.env.CI !== 'false'
const canPrompt = interactive && !isCI

function fail(msg) { output.write(`${C.red('✗')} ${msg}\n`); process.exit(1) }

// ---- zero-dep prompts (all guard on TTY) ----
async function text(message, def) {
  if (!canPrompt) return def
  const rl = createInterface({ input, output })
  try {
    const a = (await rl.question(`${C.cyan('?')} ${message}${def ? C.dim(` (${def})`) : ''} `)).trim()
    return a === '' ? def : a
  } finally { rl.close() }
}

async function confirm(message, fallback = false) {
  if (!canPrompt) return fallback
  const rl = createInterface({ input, output })
  try {
    const a = (await rl.question(`${C.cyan('?')} ${message} ${C.dim(fallback ? '(Y/n)' : '(y/N)')} `)).trim().toLowerCase()
    if (a === '') return fallback
    return /^y(es)?$/.test(a)
  } finally { rl.close() }
}

function select(message, choices, startIndex = 0) {
  return new Promise((res) => {
    if (!canPrompt) return res(choices[startIndex])
    let i = Math.max(0, startIndex)
    const draw = () => {
      output.write('\x1b[?25l')
      output.write(`${C.cyan('?')} ${message}\n`)
      choices.forEach((c, idx) => output.write(`${idx === i ? C.cyan('❯ ' + c.label) : '  ' + c.label}\n`))
      output.write(`\x1b[${choices.length + 1}A`)
    }
    const done = () => {
      output.write(`\x1b[${choices.length + 1}B\x1b[?25h`)
      input.setRawMode(false); input.removeListener('keypress', onKey); input.pause()
    }
    const onKey = (_s, key) => {
      if (!key) return
      if (key.name === 'up' || (key.name === 'k')) { i = (i - 1 + choices.length) % choices.length; draw() }
      else if (key.name === 'down' || key.name === 'j') { i = (i + 1) % choices.length; draw() }
      else if (key.name === 'return') { done(); res(choices[i]) }
      else if (key.ctrl && key.name === 'c') { done(); output.write('Cancelled.\n'); process.exit(130) }
    }
    readline.emitKeypressEvents(input)
    input.setRawMode(true); input.resume(); input.on('keypress', onKey)
    draw()
  })
}

// ---- run ----
const cwd = resolve(values.cwd || process.cwd())
const det = detect(cwd)

output.write(`\n${C.bold('no-mistakes setup')} ${C.dim('— ' + cwd)}\n\n`)
output.write(`${C.dim('Detected:')}\n`)
output.write(`  db        ${det.db ? `${C.green(det.db.platform)} ${C.dim(`[${det.db.level}${det.db.confident ? ', confident' : ''}] ` + det.db.why.join('; '))}` : C.yellow('none')}\n`)
if (det.candidates.length > 1) output.write(`  also      ${C.dim(det.candidates.slice(1).map((c) => `${c.platform}[${c.level}]`).join(', '))}\n`)
output.write(`  framework ${det.framework ? C.green(det.framework.name) + C.dim(` (${det.framework.devUrl})`) : C.dim('none')}\n`)
output.write(`  pkg mgr   ${det.packageManager ? C.green(det.packageManager) : C.dim('?')}${det.monorepo ? C.dim(`  monorepo: ${det.monorepo}`) : ''}\n`)
output.write(`  git       ${det.git ? C.green(det.git.slug) : C.dim('none')}\n\n`)

// platform
let platform = values.preset || (det.db?.confident ? det.db.platform : null)
if (!platform) {
  if (!canPrompt) fail(`could not confidently detect the DB platform — pass --preset <${PLATFORM_ORDER.join('|')}> (or run interactively).`)
  const start = det.db ? PLATFORM_ORDER.indexOf(det.db.platform) : 0
  const choice = await select('Which database / BaaS platform?', PLATFORM_ORDER.map((p) => ({ value: p, label: `${PRESETS[p].label}` })), start < 0 ? 0 : start)
  platform = choice.value
}
if (!PRESETS[platform]) fail(`unknown platform "${platform}". One of: ${PLATFORM_ORDER.join(', ')}`)
const preset = presetFor(platform)
output.write(`${C.dim('→ platform:')} ${C.bold(platform)} ${C.dim('— ' + preset.note)}\n\n`)

// identity
const project = values.project || await text('Project id', det.projectName)
const org = values.org || det.git?.owner
const repoOwner = values['repo-owner'] || det.git?.owner
const checkoutBase = values['checkout-base'] || (det.gitRoot ? dirname(det.gitRoot) : undefined)

// apps (starter; user/agent refines)
const apps = []
const repo = det.git?.slug
if (det.framework) {
  apps.push({ name: project, kind: 'frontend', ...(repo ? { repo } : {}), devUrl: det.framework.devUrl, browserProfile: `no-mistakes-${project}` })
}
const wantBackend = det.framework
  ? await confirm('Is there a separate backend API to verify (besides the frontend)?', false)
  : true
if (wantBackend) {
  const beUrl = await text('Backend API base URL', det.framework ? 'http://localhost:8090' : (det.framework?.devUrl || 'http://localhost:3000'))
  apps.push({ name: det.framework ? `${project}-api` : project, kind: 'backend', ...(repo ? { repo } : {}), devUrl: beUrl })
}
if (!apps.length) apps.push({ name: project, kind: 'backend', ...(repo ? { repo } : {}), devUrl: 'http://localhost:3000' })

// auth skeleton by platform adapter
const authProfiles = {}
if (platform === 'supabase') authProfiles.supabase = { kind: 'supabase-jwt', secretsTool: 'dotenv', env: { url: 'SUPABASE_URL', anonKey: 'SUPABASE_ANON_KEY', serviceKey: 'SUPABASE_SERVICE_ROLE_KEY' }, testEmailEnv: 'TEST_USER_EMAIL' }
else if (platform === 'firebase') authProfiles.firebase = { kind: 'firebase-idtoken', secretsTool: 'env', env: { creds: 'GOOGLE_APPLICATION_CREDENTIALS' } }
else if (platform === 'convex') authProfiles.convex = { kind: 'bearer-env', keyEnv: 'CONVEX_DEPLOY_KEY' }
if (Object.keys(authProfiles).length) for (const a of apps) a.auth ||= Object.keys(authProfiles)[0]

const cfg = buildConfig({ platform, project, org, repoOwner, checkoutBase, apps, authProfiles })

// validate (raw) + show normalized
const errs = validationErrors(cfg)
if (errs.length) fail(`generated config is invalid:\n  - ${errs.join('\n  - ')}`)
const normalized = withDefaults(structuredClone(cfg))

// output path + idempotency
let outPath
if (values.central) {
  outPath = join(homedir(), '.no-mistakes', `${project}.json`)
} else {
  outPath = values.output ? resolve(values.output) : join(cwd, '.no-mistakes.json')
}
if (existsSync(outPath) && !values.force) {
  if (!canPrompt) fail(`${outPath} already exists — pass --force to overwrite (or remove it).`)
  const ok = await confirm(`${C.yellow(outPath)} already exists. Overwrite it?`, false)
  if (!ok) { output.write(`To start over, remove ${outPath} and run setup again.\n`); process.exit(1) }
}

output.write(`\n${C.dim('Will write')} ${C.bold(outPath)}:\n`)
output.write(`  db.platform=${normalized.db.platform}  db.adapter=${C.bold(normalized.db.adapter)}  apps=${cfg.apps.map((a) => `${a.name}:${a.kind}`).join(', ')}\n\n`)
if (!await confirm('Write this configuration?', true)) { output.write('Aborted.\n'); process.exit(1) }

mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, JSON.stringify(cfg, null, 2) + '\n')
output.write(`\n${C.green('✓')} wrote ${outPath}\n\n`)
output.write(`${C.bold('Next steps')}\n`)
output.write(`  1. Review & fill placeholders (auth env vars, app repos, preview platform) in ${outPath}\n`)
output.write(`  2. Verify it loads:  ${C.cyan(`node ~/.claude/skills/no-mistakes/harness/load-config.mjs --export`)}\n`)
if (normalized.db.adapter !== 'sql') output.write(`  3. ${C.yellow('Non-SQL adapter')} (${normalized.db.adapter}): read-after-write uses ${normalized.db.adapter === 'convex' ? 'convex run / runOneoffQuery' : 'firestore_get_document / Admin SDK'}, not SQL. See the backend skill's §4.\n`)
output.write(`  ${normalized.db.adapter !== 'sql' ? '4' : '3'}. Run a verification:  invoke the ${C.cyan('no-mistakes')} skill on a change/PR.\n`)
