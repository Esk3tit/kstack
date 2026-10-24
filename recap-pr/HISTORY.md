# Session history backfill

Read this when backfilling decisions for a branch or ticket. The decision log remains the primary record. Search the relevant app and provider histories, retain timestamps and source identities, and report unreadable or truncated coverage under Attention.

## T3

Prefer the available `t3_thread_list`, search, and paginated `t3_thread_read` tools. Resolve the relevant repository's project ID with `t3_project_list`; search and list default to the caller's project, which can be different. Search the ticket and branch, include settled threads, and follow pagination. Recover truncated text before treating an answer as complete. Use the originating thread/message identity for inherited items; a fork is not another user decision.

## Native Codex

JSONL is a legacy source, not a complete index. Modern Codex sessions can have no rollout file while retaining messages in SQLite.

1. Open the local `~/.codex/state_*.sqlite` and `~/.codex/thread_history_*.sqlite` files read-only, using SQLite URI `mode=ro` and `PRAGMA query_only=ON`. Inspect `sqlite_master` and `PRAGMA table_info` before querying; private schemas can change. Use the version that actually contains the relevant records. Prefer a supported native history interface if one is available.
2. Find matching `threads` by the actual branch, ticket, title, cwd, or session ID. Current schemas include `id`, `git_branch`, `title`, `cwd`, `source`, and `rollout_path`. Include archived sessions. Do not read a recorded rollout path as proof that the file exists.
3. For selected IDs, read bounded pages of `thread_items` with `item_type = 'userMessage'`, ordered by `created_at_ms`, `rollout_ordinal`, and `item_id`. Parse `item_json.content` text blocks and retain the item ID, thread ID, and timestamp. Filter by the branch's work period when known. Continue until the selected range is covered; report a stopped or capped read.
4. Use existing JSONL under both `~/.codex/sessions/` and `~/.codex/archived_sessions/` when the database lacks that history. Check for `.jsonl.zst` counterparts before reporting a rollout unavailable; stream decompression with the installed zstd reader only when needed. Read `session_meta`, user-role response items, and user-message events. Deduplicate repeated representations of the same item.

Select only relevant columns and sessions; keep tool outputs and reasoning out of a user-decision backfill. A provider's user-role message can be a delegated brief or injected instruction. Verify human authorship against T3 or the original exchange before treating it as a settled answer.

Async answer messages can repeat the agent's question followed by the user's chosen option. Attribute only the answer to the human; correlate the call ID and T3 `createdBy` metadata where available.

## Native Claude Code

Search `~/.claude/projects/*/*.jsonl` by branch, ticket, cwd, or session ID, then read the matching exchanges. Keep timestamps and UUIDs. Tool results, sidechains, injected metadata, resumed summaries, and agent-to-agent messages are context rather than new human decisions. Deduplicate inherited UUIDs.

## Coverage and dedupe

Correlate T3 provider references with native session/item IDs where available. Merge only confirmed mirrors or inherited copies; identical short answers in different exchanges can be separate decisions. If IDs cannot establish duplication, retain the source references and resolve it from the exchange rather than a fuzzy text heuristic.

Record the searched source, selected sessions, covered time range, pagination completion, and any missing source or unsupported schema. Keep extracted history local. A schema mismatch or missing file is an explicit coverage gap, never evidence that no decision was made.
