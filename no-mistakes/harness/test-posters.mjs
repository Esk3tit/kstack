// Checks the posters' --run and --print-command modes without touching GitHub: a real post either has
// no --pr or runs with PATH=/nonexistent, so nothing reaches gh. Run: node --test no-mistakes/harness/test-posters.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync, existsSync, realpathSync } from 'node:fs';
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
  // realpath: macOS's temp dir is a symlink, and the posters print real paths.
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'nm-posters-')));
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

const VALID_CONFIG = { project: 'acme', db: { platform: 'supabase' }, apps: [{ name: 'api', kind: 'backend' }], auth: { apiKeyHeader: 'x-acme-key' } };

function config(dir, cfg = VALID_CONFIG, name = '.no-mistakes.json') {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  writeFileSync(path, typeof cfg === 'string' ? cfg : JSON.stringify(cfg));
  return path;
}

// A gh that records each call and fails, for asserting a post never reached GitHub.
function ghStub(home) {
  const bin = join(home, 'bin');
  const log = join(home, 'gh-calls.log');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'gh'), `#!/bin/sh\necho "$*" >> '${log}'\nexit 1\n`, { mode: 0o755 });
  return { PATH: bin, calls: () => (existsSync(log) ? readFileSync(log, 'utf8') : '') };
}

test('the evidence poster prints a bare command and its allow rule', () => {
  const { home, work } = sandbox();
  frontendRun(home);
  // A copy at a plain path, so the line is bare wherever this checkout lives.
  const script = join(home, 'skills', 'harness', 'post-evidence.mjs');
  mkdirSync(dirname(script), { recursive: true });
  cpSync(POSTERS.evidence, script);
  const r = node(script, ['--print-command', '--pr', '25', '--run', RUN, '--repo', REPO], { home, cwd: work });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), `node ${script} --pr 25 --run ${RUN} --repo ${REPO}`);
  assert.ok(r.stderr.includes(`allow rule: Bash(node ${script}:*)`), r.stderr);
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
  results: { files: ['post-results.mjs', 'load-config.mjs'], args: ['--pr', '25', '--run', RUN, '--repo', REPO], setup: (home) => { backendRun(home); config(join(home, 'work')); } },
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

test('a missing run, or a PR without --repo, stops before printing', () => {
  const { home, work } = sandbox();
  let r = node(POSTERS.evidence, ['--print-command', '--pr', '25', '--run', RUN, '--repo', REPO], { home, cwd: work });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /run-dir not found/);
  frontendRun(home);
  for (const args of [['--pr', '25'], ['--pr', 'x', '--repo', REPO], ['--repo', 'acme']]) {
    r = node(POSTERS.evidence, ['--print-command', '--run', RUN, ...args], { home, cwd: work });
    assert.equal(r.status, 1, args.join(' '));
    assert.match(r.stderr, /needs --run <id>, plus --pr <N> --repo owner\/name/);
    assert.equal(r.stdout, '');
  }
});

// The print-first flow must reach the same local summary a direct post writes.
function printThenRun(script, args, opts) {
  const printed = node(script, ['--print-command', ...args], opts);
  assert.equal(printed.status, 0, printed.stderr);
  const words = shellWords(printed.stdout.trim());
  assert.equal(words[0], script);
  return { printed, posted: node(script, words.slice(1), { ...opts, env: { PATH: '/nonexistent', ...opts.env } }) };
}

for (const [name, makeRun] of [['evidence', frontendRun], ['results', backendRun]]) {
  test(`with no PR, the ${name} poster prints a command that saves the local summary`, () => {
    const { home } = sandbox();
    const dir = makeRun(home);
    const cwd = join(home, 'no-git');
    config(cwd);
    const { printed, posted } = printThenRun(POSTERS[name], ['--run', RUN], { home, cwd });
    assert.doesNotMatch(printed.stdout, / --pr | --repo /);
    assert.match(posted.stdout, /pr_post=no-pr/);
    assert.ok(existsSync(join(dir, 'summary.md')));
  });
}

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

// A post needs the run's config to know which header to redact: without one, nothing reaches gh,
// whether the print step or a direct post finds that out, and summary.md is kept.
function assertBlocked(home, dir, args, opts, why) {
  const gh = ghStub(home);
  const env = { ...opts.env, PATH: gh.PATH };
  const printed = node(POSTERS.results, ['--print-command', ...args], { ...opts, env });
  assert.equal(printed.status, 1, printed.stderr);
  assert.match(printed.stdout, /^pr_post=failed$/m);
  assert.doesNotMatch(printed.stdout, /^node /m);
  assert.match(printed.stderr, why);
  assert.ok(existsSync(join(dir, 'summary.md')));
  const posted = node(POSTERS.results, args, { ...opts, env });
  assert.equal(posted.status, 1);
  assert.match(posted.stdout, /pr_post=failed/);
  assert.match(posted.stderr, why);
  assert.equal(gh.calls(), '');
}

test('a selected config that does not load blocks the post and keeps the local summary', () => {
  const { home, work } = sandbox();
  const dir = backendRun(home);
  const bad = config(home, '{oops', 'bad.json');
  assertBlocked(home, dir, ['--pr', '25', '--run', RUN, '--repo', REPO], { home, cwd: work, env: { NM_CONFIG_PATH: bad } }, /bad\.json does not load/);
  assertBlocked(home, dir, ['--pr', '25', '--run', RUN, '--repo', REPO, '--config', bad], { home, cwd: work }, /bad\.json does not load/);
});

const BROKEN_CONFIGS = {
  'fails validation': { project: 'acme', auth: { apiKeyHeader: 'x-acme-key' } },
  'has a null app': { ...VALID_CONFIG, apps: [null] },
  'has a string preview': { ...VALID_CONFIG, preview: 'x' },
};
for (const [name, cfg] of Object.entries(BROKEN_CONFIGS)) {
  test(`a found config that ${name} is named and blocks the post`, () => {
    const { home } = sandbox();
    const dir = backendRun(home);
    const project = join(home, 'project');
    config(project, cfg);
    assertBlocked(home, dir, ['--pr', '25', '--run', RUN, '--repo', REPO], { home, cwd: project }, /project\/\.no-mistakes\.json does not load/);
  });
}

test('with no config found, the results poster posts nothing and keeps the summary, PR or not', () => {
  const { home, work } = sandbox();
  const dir = backendRun(home);
  assertBlocked(home, dir, ['--pr', '25', '--run', RUN, '--repo', REPO], { home, cwd: work }, /no \.no-mistakes\.json found/);
  assertBlocked(home, dir, ['--run', RUN], { home, cwd: work }, /no \.no-mistakes\.json found/);
});

test('the printer takes the loader\'s --project and --cwd, and names the config they select', () => {
  const { home, work } = sandbox();
  backendRun(home);
  const central = config(join(home, '.no-mistakes'), VALID_CONFIG, 'acme.json');
  let r = node(POSTERS.results, ['--print-command', '--pr', '25', '--run', RUN, '--repo', REPO, '--project', 'acme'], { home, cwd: work });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(shellWords(r.stdout.trim()).slice(-2), ['--config', central]);
  const local = config(join(home, 'project'));
  r = node(POSTERS.results, ['--print-command', '--pr', '25', '--run', RUN, '--repo', REPO, '--cwd', join(home, 'project')], { home, cwd: work });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(shellWords(r.stdout.trim()).slice(-2), ['--config', local]);
});

test('every skill line that loads the config stops its block when the config does not load', () => {
  const { home } = sandbox();
  const lines = [];
  for (const skill of ['no-mistakes', 'no-mistakes-frontend', 'no-mistakes-backend', 'no-mistakes-a11y']) {
    for (const doc of ['SKILL.md', 'harness/snippets.md']) {
      const file = join(repoRoot, skill, doc);
      if (!existsSync(file)) continue;
      for (const line of readFileSync(file, 'utf8').split('\n'))
        if (/^(NM_ENV=|eval ).*load-config\.mjs" --export/.test(line)) lines.push({ where: `${skill}/${doc}`, line, dir: join(repoRoot, skill) });
    }
  }
  assert.ok(lines.length >= 7, `found ${lines.length} loader lines`);
  for (const [cfg, ok] of [['{oops', false], [VALID_CONFIG, true]]) {
    const project = join(home, ok ? 'good' : 'bad');
    config(project, cfg);
    for (const { where, line, dir } of lines) {
      const r = spawnSync('bash', ['-c', `${line}\necho reached`], {
        cwd: project, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: home, H: dir, A: dir } });
      assert.equal(r.stdout.includes('reached'), ok, `${where}: ${line}\n${r.stderr}`);
    }
  }
});

test('the four copies of load-config.mjs are identical', () => {
  const copies = ['no-mistakes', 'no-mistakes-frontend', 'no-mistakes-backend', 'no-mistakes-a11y']
    .map((skill) => readFileSync(join(repoRoot, skill, 'harness', 'load-config.mjs'), 'utf8'));
  for (const c of copies.slice(1)) assert.equal(c, copies[0]);
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

const MALFORMED = {
  evidence: { root: '.no-mistakes', file: 'results.json', args: ['--pr', '25', '--repo', REPO],
    bad: [null, [], { cases: [null] }, { revision: 'abc1234', cases: [{ name: 'a', pass: false }], howToTest: [null] }] },
  results: { root: '.no-mistakes-backend', file: 'results.json', bad: [null, [], { cases: [null] }, { cases: 'x' }], args: ['--pr', '25', '--repo', REPO] },
  fullstack: { root: '.no-mistakes', file: 'fullstack/results.json', bad: [null, [], { frontend: 'x' }, { roundtrip: [null] }, { roundtrip: {} }], args: [] },
};
for (const [name, { root, file, bad, args }] of Object.entries(MALFORMED)) {
  test(`the ${name} poster refuses malformed results before printing`, () => {
    const { home, work } = sandbox();
    config(work);
    const path = join(home, root, RUN, file);
    mkdirSync(dirname(path), { recursive: true });
    for (const results of bad) {
      writeFileSync(path, JSON.stringify(results));
      const r = node(POSTERS[name], ['--print-command', '--run', RUN, ...args], { home, cwd: work });
      assert.equal(r.status, 1, JSON.stringify(results));
      assert.equal(r.stdout, '', JSON.stringify(results));
      assert.match(r.stderr, /results/, JSON.stringify(results));
      assert.doesNotMatch(r.stderr, /TypeError/, JSON.stringify(results));
    }
  });
}

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
  assert.deepEqual(shellWords(r.stdout.trim()), [POSTERS.fullstack, '--run', RUN]);
  const missing = node(POSTERS.fullstack, ['--print-command', '--run', '20990101-000000-1'], { home, cwd: work });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /fullstack\/results\.json/);
});
