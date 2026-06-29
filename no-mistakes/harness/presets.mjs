// Per-platform presets for no-mistakes setup. Each preset prefills the schema's `db` block
// (adapter + MCP/CLI tool names + branch/preview model) and carries a one-line note. The setup
// wizard merges: base <- preset.db <- user answers. Zero-dependency.

export const PRESETS = {
  neon: {
    label: 'Neon (serverless Postgres, branch-per-PR)',
    db: {
      platform: 'neon', adapter: 'sql',
      previewBranchPattern: 'preview-pr-{pr}', connStringEnv: 'NMB_DATABASE_URL',
      mcp: { server: 'Neon', runSql: 'run_sql', describeBranch: 'describe_branch', getConnectionString: 'get_connection_string' },
    },
    note: 'SQL read-after-write via Neon MCP run_sql against the per-PR branch (preview-pr-<N>).',
  },
  supabase: {
    label: 'Supabase (Postgres + branching)',
    db: {
      platform: 'supabase', adapter: 'sql',
      previewBranchPattern: 'preview-{pr}', connStringEnv: 'NMB_DATABASE_URL',
      mcp: { server: 'Supabase', runSql: 'execute_sql', describeBranch: 'get_branch', getConnectionString: 'get_connection_string' },
    },
    note: 'Read with the SERVICE-ROLE key or the direct postgres connection — the anon key is RLS-gated and masks freshly-written rows (false negatives).',
  },
  planetscale: {
    label: 'PlanetScale (MySQL, dev/prod branches)',
    db: {
      platform: 'planetscale', adapter: 'sql',
      previewBranchPattern: '{pr}', connStringEnv: 'NMB_DATABASE_URL',
      mcp: { server: 'PlanetScale', runSql: 'planetscale_execute_read_query', describeBranch: 'list_branches', getConnectionString: 'get_connection_string' },
    },
    note: 'SQL (MySQL) read via the PlanetScale MCP read-query tool or `pscale connect`/`pscale shell` against the branch.',
  },
  postgres: {
    label: 'Plain Postgres (self/managed, psql)',
    db: {
      platform: 'postgres', adapter: 'sql', connStringEnv: 'NMB_DATABASE_URL', previewBranchPattern: 'preview-pr-{pr}',
      mcp: { server: '', runSql: 'run_sql', getConnectionString: 'get_connection_string' },
    },
    note: 'No managed branching — read via `psql "$NMB_DATABASE_URL" -c "SELECT…"`. Per-PR isolation is manual unless you script it.',
  },
  mysql: {
    label: 'Plain MySQL (self/managed)',
    db: {
      platform: 'mysql', adapter: 'sql', connStringEnv: 'NMB_DATABASE_URL', previewBranchPattern: 'preview-pr-{pr}',
      mcp: { server: '', runSql: 'run_sql', getConnectionString: 'get_connection_string' },
    },
    note: 'Read via `mysql -e "SELECT…"`. Per-PR isolation is manual unless you script it.',
  },
  convex: {
    label: 'Convex (document DB — NON-SQL)',
    db: {
      platform: 'convex', adapter: 'convex',
      convex: {
        deploymentEnv: 'CONVEX_DEPLOYMENT', urlEnv: 'CONVEX_URL', deployKeyEnv: 'CONVEX_DEPLOY_KEY',
        previewNamePattern: 'pr-{pr}', runCmd: 'npx convex run', dataCmd: 'npx convex data',
        mcp: { server: 'Convex', runOneoffQuery: 'runOneoffQuery', data: 'data', run: 'run' },
      },
    },
    note: 'NON-SQL: prove persistence by calling a query function (`npx convex run`/ConvexHttpClient) or the Convex MCP runOneoffQuery and asserting on returned documents. Target the preview deployment (--preview-name pr-<N>).',
  },
  firebase: {
    label: 'Firebase / Firestore (document DB — NON-SQL)',
    db: {
      platform: 'firebase', adapter: 'firestore',
      firestore: {
        credsEnv: 'GOOGLE_APPLICATION_CREDENTIALS', emulatorHostEnv: 'FIRESTORE_EMULATOR_HOST', isolation: 'emulator',
        mcp: { server: 'Firebase', getDocument: 'firestore_get_document', queryCollection: 'firestore_query_collection' },
      },
    },
    note: 'NON-SQL: read the document by path via the Admin SDK (.doc(path).get()) or the Firebase MCP firestore_get_document. No DB branching — isolate per-PR via a separate project or the emulator.',
  },
}

export const PLATFORM_ORDER = ['neon', 'supabase', 'planetscale', 'convex', 'firebase', 'postgres', 'mysql']

export function presetFor(platform) {
  return PRESETS[platform] || PRESETS.postgres
}

// Build a complete starter config from a chosen platform + answers. Deep-merges preset.db under base.
export function buildConfig({ platform, project, org, repoOwner, checkoutBase, apps, authProfiles, evidence }) {
  const preset = presetFor(platform)
  const cfg = {
    $schema: 'https://raw.githubusercontent.com/promptarmor/kstack/master/no-mistakes/config/no-mistakes.schema.json',
    project,
    db: { ...preset.db },
  }
  if (org) cfg.org = org
  if (repoOwner) cfg.repoOwner = repoOwner
  if (checkoutBase) cfg.checkoutBase = checkoutBase
  cfg.evidence = evidence || { backend: 'local' }
  if (authProfiles && Object.keys(authProfiles).length) cfg.auth = { profiles: authProfiles }
  cfg.apps = apps && apps.length ? apps : [{ name: project, kind: 'frontend' }]
  return cfg
}
