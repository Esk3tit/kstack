#!/usr/bin/env node
// Resolve and project the per-project no-mistakes config (.no-mistakes.json).
// Discovery: walk up from --cwd for .no-mistakes.json; else ~/.no-mistakes/<project>.json
// (project from --project or $NO_MISTAKES_PROJECT, default "config").
// Modes: --path | --json | --get <dotpath> | --export | --app-map | --app <name>
// Also importable: `import { discover, validate, withDefaults, exportLines } from './load-config.mjs'`.
// Zero-dependency. The skills supply the method; this file supplies the targets.

import { readFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { pathToFileURL } from 'node:url'

export const expandHome = (p) => (typeof p === 'string' && p.startsWith('~') ? join(homedir(), p.slice(1)) : p)

export function discover(cwd, project) {
  let dir = resolve(cwd)
  while (true) {
    const candidate = join(dir, '.no-mistakes.json')
    if (existsSync(candidate)) return candidate
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  const central = join(homedir(), '.no-mistakes', `${project}.json`)
  if (existsSync(central)) return central
  return null
}

export function validationErrors(cfg) {
  const errs = []
  if (!cfg || typeof cfg !== 'object') return ['config is not an object']
  if (!cfg.project) errs.push('missing required "project"')
  if (!cfg.db || typeof cfg.db !== 'object') errs.push('missing required "db"')
  else {
    if (!cfg.db.platform) errs.push('missing required "db.platform"')
    if (cfg.db.adapter && !['sql', 'convex', 'firestore'].includes(cfg.db.adapter))
      errs.push(`db.adapter must be sql|convex|firestore (got "${cfg.db.adapter}")`)
  }
  if (!Array.isArray(cfg.apps) || cfg.apps.length === 0) errs.push('"apps" must be a non-empty array')
  else cfg.apps.forEach((a, i) => {
    if (!a.name) errs.push(`apps[${i}] missing "name"`)
    if (!['frontend', 'backend'].includes(a.kind)) errs.push(`apps[${i}] "kind" must be frontend|backend`)
    if (a.auth && cfg.auth?.profiles && !cfg.auth.profiles[a.auth])
      errs.push(`apps[${i}] auth "${a.auth}" not found in auth.profiles`)
  })
  return errs
}

const PLATFORM_ADAPTER = {
  neon: 'sql', supabase: 'sql', planetscale: 'sql', postgres: 'sql', mysql: 'sql',
  convex: 'convex', firebase: 'firestore',
}

// Defaults applied after load so prose/scripts can rely on them.
export function withDefaults(cfg) {
  const db = cfg.db || {}
  db.adapter ||= PLATFORM_ADAPTER[db.platform] || 'sql'
  db.previewBranchPattern ||= 'preview-pr-{pr}'
  db.connStringEnv ||= 'NMB_DATABASE_URL'
  db.migrations ||= 'none'
  db.mcp = { runSql: 'run_sql', describeBranch: 'describe_branch', getConnectionString: 'get_connection_string', ...(db.mcp || {}) }
  if (db.adapter === 'convex') {
    db.convex = {
      deploymentEnv: 'CONVEX_DEPLOYMENT', deployKeyEnv: 'CONVEX_DEPLOY_KEY', previewNamePattern: 'pr-{pr}',
      runCmd: 'npx convex run', dataCmd: 'npx convex data',
      ...(db.convex || {}),
      mcp: { server: 'Convex', runOneoffQuery: 'runOneoffQuery', data: 'data', run: 'run', ...(db.convex?.mcp || {}) },
    }
  }
  if (db.adapter === 'firestore') {
    db.firestore = {
      credsEnv: 'GOOGLE_APPLICATION_CREDENTIALS', emulatorHostEnv: 'FIRESTORE_EMULATOR_HOST', isolation: 'emulator',
      ...(db.firestore || {}),
      mcp: { server: 'Firebase', getDocument: 'firestore_get_document', queryCollection: 'firestore_query_collection', ...(db.firestore?.mcp || {}) },
    }
  }
  cfg.db = db
  const pv = cfg.preview || {}
  pv.platform ||= 'none'
  pv.apiPort ??= 8090
  pv.fePort ??= 3000
  cfg.preview = pv
  cfg.apps = (cfg.apps || []).map((a) => {
    const repoBase = a.repo ? a.repo.split('/').pop() : a.name
    a.repoPath ||= cfg.checkoutBase ? join(expandHome(cfg.checkoutBase), repoBase) : undefined
    a.noLogin ??= cfg.auth?.profiles?.[a.auth]?.noLogin ?? false
    return a
  })
  return cfg
}

export function getPath(obj, dotted) {
  return dotted.split('.').reduce((o, k) => (o == null ? o : o[k]), obj)
}

function shq(v) { return `'${String(v).replace(/'/g, `'\\''`)}'` }

export function exportLines(cfg, cfgPath) {
  const out = []
  const set = (k, v) => { if (v !== undefined && v !== null && v !== '') out.push(`export ${k}=${shq(expandHome(v))}`) }
  set('NM_CONFIG_PATH', cfgPath)
  set('NM_PROJECT', cfg.project)
  set('NM_ORG', cfg.org)
  set('NM_REPO_OWNER', cfg.repoOwner)
  set('NM_CHECKOUT_BASE', cfg.checkoutBase)
  // db
  set('NM_DB_PLATFORM', cfg.db.platform)
  set('NM_DB_ADAPTER', cfg.db.adapter)
  set('NM_DB_PROJECT_ID', cfg.db.projectId)
  set('NM_DB_LOCAL_BRANCH', cfg.db.localBranch)
  set('NM_DB_PREVIEW_PATTERN', cfg.db.previewBranchPattern)
  set('NM_DB_CONN_ENV', cfg.db.connStringEnv)
  set('NM_DB_MIGRATIONS', cfg.db.migrations)
  set('NM_DB_MIGRATIONS_TABLE', cfg.db.migrationsVersionTable)
  set('NM_DB_MCP_RUN_SQL', cfg.db.mcp.runSql)
  set('NM_DB_MCP_DESCRIBE_BRANCH', cfg.db.mcp.describeBranch)
  set('NM_DB_MCP_GET_CONN', cfg.db.mcp.getConnectionString)
  if (cfg.db.adapter === 'convex') {
    const c = cfg.db.convex
    set('NM_CONVEX_DEPLOYMENT_ENV', c.deploymentEnv)
    set('NM_CONVEX_URL_ENV', c.urlEnv)
    set('NM_CONVEX_DEPLOY_KEY_ENV', c.deployKeyEnv)
    set('NM_CONVEX_PREVIEW_PATTERN', c.previewNamePattern)
    set('NM_CONVEX_RUN_CMD', c.runCmd)
    set('NM_CONVEX_DATA_CMD', c.dataCmd)
    set('NM_CONVEX_MCP_ONEOFF', c.mcp.runOneoffQuery)
  }
  if (cfg.db.adapter === 'firestore') {
    const f = cfg.db.firestore
    set('NM_FIRESTORE_CREDS_ENV', f.credsEnv)
    set('NM_FIRESTORE_EMULATOR_HOST_ENV', f.emulatorHostEnv)
    set('NM_FIRESTORE_ISOLATION', f.isolation)
    set('NM_FIRESTORE_MCP_GET_DOC', f.mcp.getDocument)
  }
  // preview (NMF_* / PORTER_* are the names existing scripts already read)
  set('NM_PREVIEW_PLATFORM', cfg.preview.platform)
  set('NMF_API_PORT', cfg.preview.apiPort)
  set('NMF_FE_PORT', cfg.preview.fePort)
  if (cfg.preview.porter) {
    set('PORTER_PROJECT', cfg.preview.porter.project)
    set('PORTER_CLUSTER', cfg.preview.porter.cluster)
  }
  const backendApp = cfg.apps.find((a) => a.kind === 'backend')
  if (backendApp) set('NMF_API_SVC', backendApp.previewService)
  // auth
  set('NM_API_KEY_HEADER', cfg.auth?.apiKeyHeader)
  return out.join('\n')
}

// app-map: one "slug|service|auth|kind" line per app, for resolve-preview.sh detection.
export function appMap(cfg) {
  return cfg.apps
    .filter((a) => a.previewSlug)
    .map((a) => `${a.previewSlug}|${a.previewService || ''}|${a.auth || ''}|${a.kind}`)
    .join('\n')
}

export function loadConfig({ cwd = process.cwd(), project, configPath } = {}) {
  const proj = project || process.env.NO_MISTAKES_PROJECT || 'config'
  const path = configPath || discover(cwd, proj)
  if (!path) return { path: null, cfg: null, errors: [`no .no-mistakes.json found walking up from ${cwd}, and no ~/.no-mistakes/${proj}.json`] }
  let raw
  try { raw = JSON.parse(readFileSync(path, 'utf8')) }
  catch (e) { return { path, cfg: null, errors: [`could not read/parse ${path}: ${e.message}`] } }
  const errors = validationErrors(raw)
  if (errors.length) return { path, cfg: null, errors }
  return { path, cfg: withDefaults(raw), errors: [] }
}

function runCli() {
  const args = process.argv.slice(2)
  const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }
  const has = (name) => args.includes(name)
  const fail = (msg) => { process.stderr.write(`no-mistakes config: ${msg}\n`); process.exit(2) }

  const { path, cfg, errors } = loadConfig({ cwd: opt('--cwd') || process.cwd(), project: opt('--project'), configPath: opt('--config') })
  if (!cfg) fail(`${errors.join('\n  - ')}\nSee no-mistakes/config/README.md.`)

  if (has('--path')) { process.stdout.write(path + '\n'); return }
  if (has('--json')) { process.stdout.write(JSON.stringify(cfg, null, 2) + '\n'); return }
  if (has('--app-map')) { process.stdout.write(appMap(cfg) + '\n'); return }
  if (opt('--app')) {
    const a = cfg.apps.find((x) => x.name === opt('--app') || x.previewSlug === opt('--app'))
    if (!a) fail(`no app "${opt('--app')}" in config`)
    process.stdout.write(JSON.stringify(a, null, 2) + '\n'); return
  }
  if (opt('--get')) {
    const v = getPath(cfg, opt('--get'))
    if (v === undefined) process.exit(1)
    process.stdout.write((typeof v === 'object' ? JSON.stringify(v) : String(v)) + '\n'); return
  }
  process.stdout.write(exportLines(cfg, path) + '\n')
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) runCli()
