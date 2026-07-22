#!/usr/bin/env node
// Zero-dependency tech-stack detector for no-mistakes setup.
// Tiered-confidence model (HIGH = own SDK dep / dedicated config file; MED = ORM+driver or env+host;
// LOW = env/host alone). Auto-pick only when exactly one platform is HIGH and strictly ahead.
// Importable: `import { detect } from './detect.mjs'`. CLI: node detect.mjs [--cwd <dir>] [--json]

import { readFileSync, existsSync, statSync, realpathSync } from 'node:fs'
import { dirname, join, resolve, basename } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

const RANK = { HIGH: 3, MED: 2, LOW: 1 }

const fileExists = (p) => { try { return statSync(p).isFile() } catch { return false } }
const dirExists = (p) => { try { return statSync(p).isDirectory() } catch { return false } }
const readText = (p) => { try { return readFileSync(p, 'utf8') } catch { return null } }
const readJSON = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return null } }

function findUp(name, from, stopAt) {
  let dir = resolve(from)
  while (true) {
    const c = join(dir, name)
    if (existsSync(c)) return c
    if (dir === stopAt) break
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

function gitRoot(from) {
  let dir = resolve(from)
  while (true) {
    if (existsSync(join(dir, '.git'))) return dir
    const parent = dirname(dir)
    if (parent === dir) return resolve(from)
    dir = parent
  }
}

function allDeps(pkg) {
  if (!pkg) return {}
  return { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies, ...pkg.optionalDependencies }
}

// Parse env files for KEYS and connection hosts only — never capture secret values.
function readEnv(root) {
  const keys = new Set()
  const hosts = {}
  for (const f of ['.env', '.env.local', '.env.development', '.env.development.local']) {
    const txt = readText(join(root, f))
    if (!txt) continue
    for (const line of txt.split('\n')) {
      const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=(.*)$/i)
      if (!m) continue
      const key = m[1]
      keys.add(key)
      const val = m[2].trim().replace(/^["']|["']$/g, '')
      if (/(_URL|DATABASE_URL|DATABASE_URL_UNPOOLED)$/i.test(key) && /:\/\//.test(val)) {
        try { hosts[key] = new URL(val).hostname } catch { /* ignore */ }
      }
    }
  }
  return { keys: [...keys], hosts }
}

function gitRemote(root) {
  const cfg = readText(join(root, '.git', 'config'))
  if (!cfg) return null
  const m = cfg.match(/url\s*=\s*(.+)/)
  if (!m) return null
  const url = m[1].trim()
  const gh = url.match(/github\.com[:/]([^/]+)\/([^/.]+)(?:\.git)?/)
  if (!gh) return null
  return { owner: gh[1], repo: gh[2], slug: `${gh[1]}/${gh[2]}` }
}

const FRAMEWORKS = [
  { name: 'next', dep: ['next'], config: ['next.config.js', 'next.config.mjs', 'next.config.ts'], kind: 'frontend', devPort: 3000 },
  { name: 'nuxt', dep: ['nuxt'], config: ['nuxt.config.ts', 'nuxt.config.js'], kind: 'frontend', devPort: 3000 },
  { name: 'astro', dep: ['astro'], config: ['astro.config.mjs', 'astro.config.ts'], kind: 'frontend', devPort: 4321 },
  { name: 'remix', dep: ['@remix-run/dev', '@remix-run/react'], config: ['remix.config.js'], kind: 'frontend', devPort: 3000 },
  { name: 'sveltekit', dep: ['@sveltejs/kit'], config: ['svelte.config.js'], kind: 'frontend', devPort: 5173 },
  { name: 'angular', dep: ['@angular/core'], config: ['angular.json'], kind: 'frontend', devPort: 4200 },
  { name: 'expo', dep: ['expo'], config: ['app.json', 'app.config.ts'], kind: 'frontend', devPort: 8081 },
  { name: 'vite', dep: ['vite'], config: ['vite.config.ts', 'vite.config.js'], kind: 'frontend', devPort: 5173 },
]

function detectFramework(deps, dir) {
  // own config or own dep; vite is the fallback (superseded by the meta-frameworks above).
  for (const fw of FRAMEWORKS) {
    const hasConfig = fw.config.some((c) => fileExists(join(dir, c)))
    const hasDep = fw.dep.some((d) => deps[d])
    if (hasConfig || hasDep) return { name: fw.name, kind: fw.kind, devUrl: `http://localhost:${fw.devPort}`, via: hasConfig ? 'config' : 'dep' }
  }
  return null
}

function detectPackageManager(root) {
  const locks = [
    ['bun.lock', 'bun'], ['bun.lockb', 'bun'], ['deno.lock', 'deno'],
    ['pnpm-lock.yaml', 'pnpm'], ['yarn.lock', 'yarn'],
    ['package-lock.json', 'npm'], ['npm-shrinkwrap.json', 'npm'],
  ]
  for (const [f, pm] of locks) if (fileExists(join(root, f))) return pm
  const pkg = readJSON(join(root, 'package.json'))
  if (pkg?.packageManager) return String(pkg.packageManager).split('@')[0]
  return null
}

function detectMonorepo(root) {
  const markers = [
    ['pnpm-workspace.yaml', 'pnpm'], ['turbo.json', 'turbo'], ['nx.json', 'nx'],
    ['lerna.json', 'lerna'], ['rush.json', 'rush'],
  ]
  for (const [f, tool] of markers) if (fileExists(join(root, f))) return tool
  const pkg = readJSON(join(root, 'package.json'))
  if (pkg?.workspaces) return 'workspaces'
  return null
}

function detectOrm(deps, dir) {
  if (deps['prisma'] || deps['@prisma/client']) {
    const schema = readText(join(dir, 'prisma', 'schema.prisma')) || readText(findUp(join('prisma', 'schema.prisma'), dir, dir) || '')
    const m = schema && schema.match(/provider\s*=\s*"([^"]+)"/)
    return { name: 'prisma', engine: m ? m[1] : null }
  }
  if (deps['drizzle-orm'] || deps['drizzle-kit']) {
    let dialect = null
    for (const c of ['drizzle.config.ts', 'drizzle.config.js', 'drizzle.config.json']) {
      const txt = readText(join(dir, c))
      const m = txt && txt.match(/dialect\s*[:=]\s*["']([^"']+)["']/)
      if (m) { dialect = m[1]; break }
    }
    return { name: 'drizzle', engine: dialect }
  }
  return null
}

function detectDb(deps, dir, root, env) {
  const sig = (platform, level, why) => ({ platform, level, why })
  const found = []
  // Convex
  if (fileExists(join(dir, 'convex.json')) || dirExists(join(dir, 'convex')) || dirExists(join(root, 'convex'))) found.push(sig('convex', 'HIGH', 'convex/ dir or convex.json'))
  if (deps['convex']) found.push(sig('convex', 'HIGH', 'dep convex'))
  if (env.keys.some((k) => /CONVEX_URL$|CONVEX_DEPLOYMENT$/.test(k))) found.push(sig('convex', 'LOW', 'CONVEX_* env'))
  // Supabase
  if (fileExists(join(root, 'supabase', 'config.toml')) || fileExists(join(dir, 'supabase', 'config.toml'))) found.push(sig('supabase', 'HIGH', 'supabase/config.toml'))
  if (deps['@supabase/supabase-js'] || deps['@supabase/ssr']) found.push(sig('supabase', 'HIGH', 'dep @supabase/*'))
  if (env.keys.some((k) => /SUPABASE_URL$|SUPABASE_ANON_KEY$/.test(k))) found.push(sig('supabase', 'LOW', 'SUPABASE_* env'))
  // Neon
  if (deps['@neondatabase/serverless']) found.push(sig('neon', 'HIGH', 'dep @neondatabase/serverless'))
  if (Object.values(env.hosts).some((h) => /\.neon\.tech$/.test(h))) found.push(sig('neon', 'MED', 'DATABASE_URL host *.neon.tech'))
  // PlanetScale
  if (deps['@planetscale/database']) found.push(sig('planetscale', 'HIGH', 'dep @planetscale/database'))
  if (Object.values(env.hosts).some((h) => /\.psdb\.cloud$/.test(h))) found.push(sig('planetscale', 'MED', 'DATABASE_URL host *.psdb.cloud'))
  // Firebase
  if (fileExists(join(root, 'firebase.json')) || fileExists(join(root, '.firebaserc'))) found.push(sig('firebase', 'HIGH', 'firebase.json/.firebaserc'))
  if (deps['firebase'] || deps['firebase-admin']) found.push(sig('firebase', 'HIGH', 'dep firebase(-admin)'))
  if (env.keys.some((k) => /FIREBASE_/.test(k))) found.push(sig('firebase', 'LOW', 'FIREBASE_* env'))
  // plain Postgres / MySQL (only if no managed signal already won)
  const managed = new Set(found.map((f) => f.platform))
  if ((deps['pg'] || deps['postgres'] || deps['postgres.js']) && !managed.has('neon') && !managed.has('supabase')) found.push(sig('postgres', 'MED', 'dep pg/postgres, no managed signal'))
  if ((deps['mysql2'] || deps['mysql']) && !managed.has('planetscale')) found.push(sig('mysql', 'MED', 'dep mysql2/mysql, no managed signal'))
  return found
}

export function detect(cwd = process.cwd()) {
  const dir = resolve(cwd)
  const root = gitRoot(dir)
  const pkgPath = findUp('package.json', dir, root)
  const pkg = pkgPath ? readJSON(pkgPath) : null
  const deps = allDeps(pkg)
  const env = readEnv(root)
  const orm = detectOrm(deps, dir)

  const signals = detectDb(deps, dir, root, env)
  // collapse to per-platform best level + reasons
  const byPlatform = {}
  for (const s of signals) {
    const cur = byPlatform[s.platform]
    if (!cur || RANK[s.level] > RANK[cur.level]) byPlatform[s.platform] = { platform: s.platform, level: s.level, why: [s.why] }
    else cur.why.push(s.why)
  }
  // ORM can lift a plain-DB candidate's confidence / disambiguate engine
  if (orm?.engine) {
    const eng = orm.engine.toLowerCase()
    const plat = /postgres|cockroach/.test(eng) ? 'postgres' : /mysql/.test(eng) ? 'mysql' : null
    if (plat && byPlatform[plat]) { byPlatform[plat].level = byPlatform[plat].level === 'LOW' ? 'MED' : byPlatform[plat].level; byPlatform[plat].why.push(`${orm.name} dialect ${orm.engine}`) }
  }
  const candidates = Object.values(byPlatform).sort((a, b) => RANK[b.level] - RANK[a.level])
  const highs = candidates.filter((c) => c.level === 'HIGH')
  const top = candidates[0] || null
  const confident = highs.length === 1 && (candidates.length === 1 || RANK[highs[0].level] > RANK[candidates[1].level])

  const framework = detectFramework(deps, dir)
  const remote = gitRemote(root)

  return {
    cwd: dir,
    gitRoot: root,
    projectName: remote?.repo || basename(root),
    db: top ? { platform: top.platform, level: top.level, why: top.why, confident } : null,
    candidates,
    framework,
    orm,
    packageManager: detectPackageManager(root),
    monorepo: detectMonorepo(root),
    git: remote,
    envKeysSeen: env.keys,
    envHosts: env.hosts,
    hasPackageJson: !!pkg,
  }
}

// The skill dir is often a symlink (~/.claude/skills/... → real checkout), so
// argv[1] (the link path) and import.meta.url (the resolved real path) differ.
// Compare realpaths so the CLI still runs when invoked through the symlink.
const isMain = (() => {
  if (!process.argv[1]) return false
  try {
    return (
      realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])
    )
  } catch {
    return import.meta.url === pathToFileURL(process.argv[1]).href
  }
})()
if (isMain) {
  const args = process.argv.slice(2)
  const i = args.indexOf('--cwd')
  const cwd = i >= 0 ? args[i + 1] : process.cwd()
  process.stdout.write(JSON.stringify(detect(cwd), null, 2) + '\n')
}
