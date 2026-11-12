// Checks the posters' --run and --print-command modes without touching GitHub: no case passes --pr
// to a real post, so nothing reaches gh. Run with: node --test no-mistakes/harness/test-posters.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const POSTERS = {
  evidence: join(repoRoot, 'no-mistakes-frontend', 'harness', 'post-evidence.mjs'),
  results: join(repoRoot, 'no-mistakes-backend', 'harness', 'post-results.mjs'),
  fullstack: join(repoRoot, 'no-mistakes', 'harness', 'post-fullstack.mjs'),
};
const RUN = '20261112-010700-4242';
const REPO = 'acme/api';

function sandbox() {
  const home = mkdtempSync(join(tmpdir(), 'nm-posters-'));
  const work = join(home, 'work');
  mkdirSync(work);
  return { home, work };
}

function node(script, args, { home, cwd, env = {} }) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: home, ...env },
  });
}

// What the shell makes of a printed line: its words after `node`, as one argument each.
function shellWords(line) {
  assert.match(line, /^node /);
  const out = execFileSync('bash', ['-c', `set -- ${line.slice(5)}; printf '%s\\0' "$@"`], { encoding: 'utf8' });
  return out.split('\0').slice(0, -1);
}

function frontendRun(home, root = '.no-mistakes') {
  const dir = join(home, root, RUN);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'results.json'), JSON.stringify({ revision: 'abc1234', cases: [{ name: 'save', pass: false }] }));
  return dir;
}

function backendRun(home) {
  const dir = join(home, '.no-mistakes-backend', RUN);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'results.json'), JSON.stringify({
    revision: 'abc1234', cases: [{ name: 'create', pass: true, request: 'POST /x\nx-acme-key: sk_live_secretvalue123\n' }],
  }));
  return dir;
}

function fullstackRun(home) {
  const dir = join(home, '.no-mistakes', RUN, 'fullstack');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'results.json'), JSON.stringify({ overall: 'PASS', frontend: { repo: REPO }, backend: { repo: 'acme/web' } }));
  return dir;
}

function config(dir, apiKeyHeader = 'x-acme-key') {
  mkdirSync(dir, { recursive: true });
  const cfg = { project: 'acme', db: { platform: 'supabase' }, apps: [{ name: 'api', kind: 'backend' }], auth: { apiKeyHeader } };
  const path = join(dir, '.no-mistakes.json');
  writeFileSync(path, JSON.stringify(cfg));
  return path;
}

test('the evidence poster prints a bare command and its allow rule', () => {
  const { home, work } = sandbox();
  frontendRun(home);
  const r = node(POSTERS.evidence, ['--print-command', '--pr', '25', '--run', RUN, '--repo', REPO], { home, cwd: work });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), `node ${POSTERS.evidence} --pr 25 --run ${RUN} --repo ${REPO}`);
  assert.match(r.stderr, new RegExp(`allow rule: Bash\\(node ${POSTERS.evidence.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\*\\)`));
});

test('the a11y marker reads its own run root and keeps the marker in the command', () => {
  const { home, work } = sandbox();
  frontendRun(home, '.no-mistakes-a11y');
  const r = node(POSTERS.evidence, ['--print-command', '--marker', 'no-mistakes-a11y', '--pr', '25', '--run', RUN, '--repo', REPO], { home, cwd: work });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(shellWords(r.stdout.trim()).slice(1), ['--pr', '25', '--run', RUN, '--repo', REPO, '--marker', 'no-mistakes-a11y']);
});

const ODD_INSTALL = {
  evidence: { files: ['post-evidence.mjs'], args: ['--pr', '25', '--run', RUN, '--repo', REPO], setup: (home) => frontendRun(home) },
  results: { files: ['post-results.mjs', 'load-config.mjs'], args: ['--pr', '25', '--run', RUN, '--repo', REPO], setup: (home) => backendRun(home) },
  fullstack: { files: ['post-fullstack.mjs'], args: ['--run', RUN], setup: (home) => fullstackRun(home) },
};
for (const [name, { files, args, setup }] of Object.entries(ODD_INSTALL)) {
  test(`the ${name} poster quotes a script path the shell would split or expand, and the rule matches it`, () => {
    const { home, work } = sandbox();
    setup(home);
    const odd = join(home, "Jane's $skills dir", 'harness');
    mkdirSync(odd, { recursive: true });
    for (const f of files) cpSync(join(dirname(POSTERS[name]), f), join(odd, f));
    const script = join(odd, files[0]);
    const r = node(script, ['--print-command', ...args], { home, cwd: work });
    assert.equal(r.status, 0, r.stderr);
    const line = r.stdout.trim();
    assert.equal(shellWords(line)[0], script);
    const spelled = line.slice(5, line.indexOf(` ${args[0]} `));
    assert.notEqual(spelled, script, 'the path needed quoting');
    assert.ok(r.stderr.includes(`allow rule: Bash(node ${spelled}:*)`), 'rule spells the path as the command does');
  });
}

test('run ids that are not plain names are refused', () => {
  const { home, work } = sandbox();
  for (const bad of ['../etc', 'a b', '$HOME', '.hidden', 'x/y']) {
    const r = node(POSTERS.evidence, ['--print-command', '--pr', '25', '--run', bad, '--repo', REPO], { home, cwd: work });
    assert.equal(r.status, 1, bad);
    assert.match(r.stderr, /--run takes a run id/, bad);
  }
});

test('a missing run or missing --repo stops before printing', () => {
  const { home, work } = sandbox();
  let r = node(POSTERS.evidence, ['--print-command', '--pr', '25', '--run', RUN, '--repo', REPO], { home, cwd: work });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /run-dir not found/);
  frontendRun(home);
  r = node(POSTERS.evidence, ['--print-command', '--pr', '25', '--run', RUN], { home, cwd: work });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /needs --pr <N> --run <id> --repo owner\/name/);
  assert.equal(r.stdout, '');
});

test('--run finds the evidence run without a PR, writing the local summary', () => {
  const { home, work } = sandbox();
  const dir = frontendRun(home);
  const r = node(POSTERS.evidence, ['--run', RUN, '--repo', REPO], { home, cwd: work });
  assert.match(r.stdout, /pr_post=no-pr/);
  assert.ok(existsSync(join(dir, 'summary.md')));
});

test('the results poster names the selected config, quoted, and that config redacts its header', () => {
  const { home, work } = sandbox();
  const dir = backendRun(home);
  const cfgPath = config(join(home, "Client's App"));
  const r = node(POSTERS.results, ['--print-command', '--pr', '25', '--run', RUN, '--repo', REPO], { home, cwd: work, env: { NM_CONFIG_PATH: cfgPath } });
  assert.equal(r.status, 0, r.stderr);
  const words = shellWords(r.stdout.trim());
  assert.deepEqual(words.slice(1), ['--pr', '25', '--run', RUN, '--repo', REPO, '--config', cfgPath]);
  // The same words minus --pr post nothing and show what the post would carry.
  const post = node(POSTERS.results, ['--run', RUN, '--repo', REPO, '--config', cfgPath], { home, cwd: work });
  assert.match(post.stdout, /pr_post=no-pr/);
  assert.match(readFileSync(join(dir, 'summary.md'), 'utf8'), /x-acme-key: «redacted»/);
});

test('without an exported path, the results poster finds the config from the project folder', () => {
  const { home } = sandbox();
  backendRun(home);
  const project = join(home, 'project');
  const cfgPath = config(project);
  const r = node(POSTERS.results, ['--print-command', '--pr', '25', '--run', RUN, '--repo', REPO], { home, cwd: project });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(shellWords(r.stdout.trim()).slice(-2), ['--config', cfgPath]);
});

test('a selected config that does not load blocks the post but keeps the local summary', () => {
  const { home, work } = sandbox();
  const dir = backendRun(home);
  const bad = join(home, 'bad.json');
  writeFileSync(bad, '{oops');
  const printed = node(POSTERS.results, ['--print-command', '--pr', '25', '--run', RUN, '--repo', REPO], { home, cwd: work, env: { NM_CONFIG_PATH: bad } });
  assert.equal(printed.status, 1);
  assert.match(printed.stderr, /does not load/);
  assert.equal(printed.stdout, '');
  // --pr is given, but the config check stops it before any gh call.
  const posted = node(POSTERS.results, ['--pr', '25', '--run', RUN, '--repo', REPO, '--config', bad], { home, cwd: work, env: { PATH: '/nonexistent' } });
  assert.equal(posted.status, 1);
  assert.match(posted.stdout, /pr_post=failed/);
  assert.match(posted.stderr, /does not load/);
  assert.ok(existsSync(join(dir, 'summary.md')));
});

test('a discovered config that does not load is named, not reported missing', () => {
  const { home } = sandbox();
  backendRun(home);
  const project = join(home, 'project');
  mkdirSync(project);
  writeFileSync(join(project, '.no-mistakes.json'), JSON.stringify({ project: 'acme', auth: { apiKeyHeader: 'x-acme-key' } }));
  const printed = node(POSTERS.results, ['--print-command', '--pr', '25', '--run', RUN, '--repo', REPO], { home, cwd: project });
  assert.equal(printed.status, 1);
  assert.match(printed.stderr, /does not load/);
  const posted = node(POSTERS.results, ['--run', RUN, '--repo', REPO], { home, cwd: project });
  assert.match(posted.stdout, /pr_post=no-pr/);
  assert.match(posted.stderr, /\.no-mistakes\.json does not load/);
  assert.doesNotMatch(posted.stderr, /no \.no-mistakes\.json found/);
});

test('an exported header and the config\'s header are both redacted', () => {
  const { home, work } = sandbox();
  const dir = join(home, '.no-mistakes-backend', RUN);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'results.json'), JSON.stringify({ revision: 'abc1234', cases: [{
    name: 'create', pass: true, request: 'POST /x\nx-acme-key: sk_live_secretvalue123\nx-old-key: sk_live_othersecret456\n' }] }));
  const cfgPath = config(join(home, 'acme'));
  const r = node(POSTERS.results, ['--run', RUN, '--repo', REPO, '--config', cfgPath], { home, cwd: work, env: { NM_API_KEY_HEADER: 'x-old-key' } });
  assert.match(r.stdout, /pr_post=no-pr/);
  const summary = readFileSync(join(dir, 'summary.md'), 'utf8');
  assert.match(summary, /x-acme-key: «redacted»/);
  assert.match(summary, /x-old-key: «redacted»/);
});

test('a relative config path is printed absolute', () => {
  const { home } = sandbox();
  backendRun(home);
  const project = join(home, 'project');
  const cfgPath = config(project);
  const r = node(POSTERS.results, ['--print-command', '--pr', '25', '--run', RUN, '--repo', REPO, '--config', '.no-mistakes.json'], { home, cwd: project });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(shellWords(r.stdout.trim()).slice(-2), ['--config', cfgPath]);
});

test('--print-command refuses --run-dir and --results, which its printed line would drop', () => {
  const { home, work } = sandbox();
  const dir = frontendRun(home);
  const r = node(POSTERS.evidence, ['--print-command', '--pr', '25', '--run', RUN, '--run-dir', dir, '--repo', REPO], { home, cwd: work });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /takes --run, not --run-dir/);
  const f = node(POSTERS.fullstack, ['--print-command', '--run', RUN, '--results', join(dir, 'results.json')], { home, cwd: work });
  assert.equal(f.status, 1);
  assert.match(f.stderr, /takes --run, not --results/);
});

test('--print-command validates the results as the post would, and prints nothing when they fail', () => {
  const { home, work } = sandbox();
  const dir = frontendRun(home);
  writeFileSync(join(dir, 'results.json'), JSON.stringify({ status: 'PASS', cases: [{ name: 'save', pass: true }] }));
  const r = node(POSTERS.evidence, ['--print-command', '--pr', '25', '--run', RUN, '--repo', REPO], { home, cwd: work });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /results\.status only takes "BLOCKED"/);
  assert.equal(r.stdout, '');
});

test('an unknown marker is fine when --run-dir names the run', () => {
  const { home, work } = sandbox();
  const dir = frontendRun(home);
  const r = node(POSTERS.evidence, ['--marker', 'custom', '--run', RUN, '--run-dir', dir, '--results', join(dir, 'results.json'), '--repo', REPO], { home, cwd: work });
  assert.match(r.stdout, /pr_post=no-pr/);
});

test('the fullstack poster reads its results from the frontend run', () => {
  const { home, work } = sandbox();
  fullstackRun(home);
  const r = node(POSTERS.fullstack, ['--print-command', '--run', RUN], { home, cwd: work });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), `node ${POSTERS.fullstack} --run ${RUN}`);
  const missing = node(POSTERS.fullstack, ['--print-command', '--run', '20990101-000000-1'], { home, cwd: work });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /fullstack\/results\.json/);
});
