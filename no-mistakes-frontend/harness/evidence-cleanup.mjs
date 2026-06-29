#!/usr/bin/env node
// Reclaim git-branch evidence: remove a PR's screenshots from the orphan `no-mistakes-evidence`
// branch (run on PR merge/close), prune old runs by age, or drop the branch entirely. Operates via
// git plumbing on a temp index — never checks the branch out, never touches the PR working tree.
// External hosts (s3/gdrive/imgur) manage their own retention; this only touches the orphan branch.
//
//   node evidence-cleanup.mjs --pr <N> [--repo owner/name] [--dry-run]
//   node evidence-cleanup.mjs --prune-days <N> [--repo owner/name] [--dry-run]
//   node evidence-cleanup.mjs --all [--repo owner/name] [--dry-run]

import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const BRANCH = 'no-mistakes-evidence'
const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : undefined }
const has = (n) => process.argv.includes(`--${n}`)
const die = (m) => { console.error(`[evidence-cleanup] ${m}`); process.exit(1) }

const pr = arg('pr')
const pruneDays = arg('prune-days')
const all = has('all')
const dryRun = has('dry-run')
let repo = arg('repo')
if (!pr && !pruneDays && !all) die('one of --pr <N> | --prune-days <N> | --all is required')

const gitCwd = existsSync(join(process.cwd(), '.git')) ? process.cwd()
  : (process.env.NOMISTAKES_REPO_DIR && existsSync(join(process.env.NOMISTAKES_REPO_DIR, '.git')) ? process.env.NOMISTAKES_REPO_DIR : process.cwd())
const git = (a, opts = {}) => execFileSync('git', a, { cwd: gitCwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim()
const gitQuiet = (a, opts = {}) => { try { return git(a, opts) } catch { return '' } }

if (!repo) { const m = gitQuiet(['remote', 'get-url', 'origin']).match(/[:/]([^/:]+\/[^/]+?)(?:\.git)?$/); if (m) repo = m[1] }

const tmpIndex = join(mkdtempSync(join(tmpdir(), 'nm-clean-')), 'index')
const env = { ...process.env, GIT_INDEX_FILE: tmpIndex }

if (!gitQuiet(['fetch', 'origin', BRANCH], { env })) {
  // branch may already be gone or never existed
  if (!gitQuiet(['rev-parse', `origin/${BRANCH}`], { env })) { console.log(`nothing to clean — no ${BRANCH} branch`); process.exit(0) }
}
const parent = gitQuiet(['rev-parse', `origin/${BRANCH}`], { env })
if (!parent) { console.log(`nothing to clean — no ${BRANCH} branch`); process.exit(0) }

function deleteBranch() {
  if (dryRun) { console.log(`[dry-run] would delete branch ${BRANCH}`); return }
  git(['push', 'origin', `:refs/heads/${BRANCH}`], { env })
  console.log(`deleted branch ${BRANCH}`)
}

if (all) { deleteBranch(); process.exit(0) }

// top-level dirs on the branch are the PR ids ("<pr>/<run>/<png>" or "no-pr/<run>/<png>").
const topDirs = [...new Set(git(['ls-tree', '--name-only', `origin/${BRANCH}`], { env }).split('\n').filter(Boolean))]

let toRemove = []
if (pr) {
  toRemove = topDirs.filter((d) => d === String(pr))
  if (!toRemove.length) { console.log(`no evidence for PR ${pr} on ${BRANCH}`); process.exit(0) }
} else if (pruneDays) {
  const cutoff = Number(pruneDays) * 86400
  // age = seconds since the dir's most recent commit; prune dirs older than the window.
  const newestCommit = Number(git(['log', '-1', '--format=%ct', `origin/${BRANCH}`], { env }))
  for (const d of topDirs) {
    const last = Number(gitQuiet(['log', '-1', '--format=%ct', `origin/${BRANCH}`, '--', d], { env }) || '0')
    if (last && (newestCommit - last) > cutoff) toRemove.push(d)
  }
  if (!toRemove.length) { console.log(`nothing older than ${pruneDays}d on ${BRANCH}`); process.exit(0) }
}

console.log(`${dryRun ? '[dry-run] would remove' : 'removing'} from ${BRANCH}: ${toRemove.join(', ')}`)
if (dryRun) process.exit(0)

git(['read-tree', `${parent}^{tree}`], { env })
git(['rm', '-r', '--cached', '--quiet', '--ignore-unmatch', ...toRemove], { env })
const tree = git(['write-tree'], { env })
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'
if (tree === EMPTY_TREE) { deleteBranch(); process.exit(0) }

const commit = git(['commit-tree', tree, '-p', parent, '-m', `no-mistakes evidence cleanup: ${toRemove.join(' ')}`], { env })
git(['push', 'origin', `${commit}:refs/heads/${BRANCH}`], { env })
console.log(`pushed cleanup commit ${commit.slice(0, 9)} to ${BRANCH}`)
