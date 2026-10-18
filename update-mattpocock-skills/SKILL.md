---
name: update-mattpocock-skills
description: "Update the mattpocock skills installed with npx skills: check upstream for breaking changes, then reapply the local patches you pick."
disable-model-invocation: true
---

# /update-mattpocock-skills

Skills from `mattpocock/skills` are installed globally with `npx skills` into `~/.agents/skills/` (symlinked from `~/.claude/skills/`) and tracked in `~/.agents/.skill-lock.json`. An update overwrites each skill folder, wiping our **patches**: the local edits listed in [PATCHES.md](PATCHES.md), stored in `patches/`. This skill updates without losing a patch or missing a breaking change.

Steps 1 to 3 only read. Nothing on disk changes until the user confirms in step 4.

## 1. Find what changed upstream

Clone `https://github.com/mattpocock/skills.git` into a scratch directory. For every lock entry whose `source` is `mattpocock/skills`:

- **updated**: the lock's `skillFolderHash` (the upstream git tree SHA of the skill's folder) differs from `git rev-parse HEAD:<folder of skillPath>`;
- **removed or renamed**: the folder no longer exists at upstream `HEAD`;
- **unchanged**: otherwise.

Note upstream skills we have not installed as **new** (report only).

Then look for **unrecorded edits**: extract each installed skill's upstream version (`git archive <skillFolderHash>`), apply its PATCHES.md patches in order, and `diff -r` against `~/.agents/skills/<name>`. Any leftover difference is a local edit nobody recorded. Write it up as a new patch candidate.

Done when every installed mattpocock skill is classed updated, removed or unchanged, and every local difference maps to a patch.

## 2. Read for breaking changes

For the range from the installed version to upstream `HEAD`, read the commit log of each updated or removed skill's folder, the release notes (`gh release list -R mattpocock/skills`, then `gh release view`), and any CHANGELOG. A **breaking change** is anything our setup must adapt to:

- a skill, or a file a skill reads or writes, renamed or removed. Precedent: v1.3.0 renamed `CONTEXT.md`/`CONTEXT-MAP.md` to `GLOSSARY.md`/`GLOSSARY-MAP.md`, which meant migrating TPRM-API, AI-ARG and AI-TPRM;
- new setup a skill now expects (`/setup-matt-pocock-skills`, `docs/agents/*.md` in our repos);
- a renamed skill or changed arguments for a skill that our own material calls by name. Grep `~/PromptArmor/kstack`, `~/.claude/CLAUDE.md`, `~/.claude/skills`, and each repo's `CLAUDE.md`/`AGENTS.md` for the names.

Done when every updated or removed skill has its commits read and either a concrete migration (file, repo, change) or "no impact".

## 3. Judge each patch against the new upstream

For every patch in PATCHES.md, read its target skill's new upstream text and give a verdict:

- **reapply**: upstream does not do what the patch does, and the patch applies cleanly (`patch --dry-run -p1` on a scratch copy of the new upstream folder, with earlier patches for the same skill applied first);
- **rewrite**: still needed, but the hunks no longer apply. The same intent has to be re-expressed on the new text;
- **drop**: upstream now does the same thing (quote the upstream lines that do it), or the target skill is gone.

Done when every patch has a verdict and the evidence for it.

## 4. Confirm with the user

Show, in plain language:

- updated, removed and new skills;
- each breaking change with its proposed migration;
- each patch: what it does in one simple sentence (from PATCHES.md), its verdict, and the evidence.

Then ask with AskUserQuestion: which patches to reapply (multi-select, recommended ones first), which migrations to apply, and whether to run the update now. When the user declines the update, stop here.

## 5. Update

1. Back up the lock and every updated skill folder to `~/.local/share/skill-backups/<date>/`.
2. Run `npx skills update <every updated mattpocock skill> -g`, naming exactly the skills reviewed in steps 1 to 4. `npx skills check -g` and a bare `update` touch every global skill, including other sources' (langfuse, gh-axi), so they are never used here. Confirm afterwards that no lock entry from another source changed. Remove skills deleted upstream with `npx skills remove <name> -g -y`, since an update never removes them.
3. Apply the chosen patches in number order to the skills the update refreshed; a skill that did not change upstream still carries its patches and is left alone. Carry out each **rewrite** by editing the skill by hand to the same intent.
4. Apply the chosen migrations.

## 6. Refresh the patch set

- Regenerate each kept patch from its own before-and-after snapshots: the new upstream folder with the earlier-numbered patches for that skill applied, against that plus this patch alone. Keep `a/` and `b/` path prefixes so `-p1` keeps working. Check that applying the kept patches in order reproduces the installed folder, and that each patch alone carries only its own change.
- Delete the files and PATCHES.md entries of patches the user dropped or chose not to reapply.
- Re-run step 1's unrecorded-edits check.

Done when every installed skill equals its new upstream version plus its kept patches, with no difference left over.

## 7. Report

List the skills updated and removed, the migrations applied, each patch's outcome (reapplied, rewritten, dropped), and the backup location.
