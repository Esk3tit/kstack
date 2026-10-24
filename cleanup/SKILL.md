---
name: cleanup
description: Audit or clean up coding-session processes, preview servers, Docker resources, and finished worktrees. Use for stale agent resources or checking whether a session is safe to archive.
---

# Cleanup

Account for the resources a coding session left behind. A bare invocation produces an inventory and proposed actions. With no authorized cleanup action, stop there. Execute only the resources and actions named by the user's current request or a still-applicable approval; do not extend it to other resources or another delegated brief. Hold resources whose ownership or retention is unresolved. Missing facts are unresolved, not evidence that a resource is unused.

## Identify owners

Use process ancestry, working directories, command references, start times, listening sockets, and the native app's live task/session state. Record the session or task, PID and start time, process group, worktree, and any intentionally retained job. Age and PID 1 parenting are clues, not proof that work has finished.

- In T3, inspect live runs and use app-owned cancellation for an owned task. A completed turn can still have live children or a retained background job.
- For Codex Companion brokers, follow [BROKERS.md](BROKERS.md) to inspect loaded threads and active jobs without starting a broker. An active or busy broker stays running. Use its existing shutdown path for a confirmed finished owner, then verify the captured descendants exited.
- For Python workers and preview servers, check their controller, child processes, jobs, and served paths. An interpreter in one worktree can run with a different working directory.
- For local PRC Docker resources, use `test-prc-locally` and its exact session/compose-project labels. Other projects remain untouched.

Keep raw process arguments and session data local and private. Report relevant identities and state without credentials.

## Remove confirmed leftovers

Immediately before acting, refresh ownership and compare each PID's start time and executable with the captured identity. Request graceful shutdown through the owner first. Wait for its bounded shutdown period, then account for every captured descendant. Escalate to a precise signal only for a verified leftover within the approved scope; a reused PID is a new process.

If the original parent already exited, inspect its captured descendants and process group before declaring cleanup complete. A reused parent PID does not change those children's ownership.

Use process groups only when their membership belongs to the same owner and excludes the current agent, its ancestors, and other work. Preserve running jobs that were explicitly retained. After a hard kill, inventory leftovers on the next cleanup; an exit handler cannot run after SIGKILL.

Done when every selected process/resource is gone or listed with its reason for retention, and unrelated live work remains healthy.

## Retire worktrees

Read `git worktree list --porcelain`, then check each selected checkout's current status, head, branch, live process references, and app/thread binding. Confirm the work is finished. An ancestor of a freshly checked base is evidence of retained commits; a squash merge needs its own merge-state check.

Check installed skill and command links too. A checkout serving live entrypoints stays until those links are repointed and verified.

Inspect ignored files as well as ordinary untracked files. Preserve needed outputs, local prompts, notes, glossaries, and prototypes outside a checkout before removing it, and verify the saved copies. Treat nested worktrees and unsettled thread bindings as retention decisions. Main checkouts, active work, unique commits, and unresolved data stay in place.

Use the project's existing artifact location, such as `~/.local/share/tprm-api/<ticket-or-run>/`, or the existing recap log's directory for otherwise unassigned retained files. Record original and saved paths, verify file hashes and symlink targets, and refresh the source comparison before removal.

Use `git worktree remove` for an approved finished checkout. Keep branches unless branch deletion was also requested. Prune stale metadata only after checking what it names; pruning does not remove existing checkouts.

Done when removed checkouts have a recorded retention decision and preserved artifacts remain available.

## Archive verdict

When asked whether a session is good to archive, report its processes, brokers, servers, Docker containers/volumes/networks, and worktree retention. Distinguish this session's resources from other owners. Say what remains live, why, and where saved artifacts are kept.

A clean verdict requires no unintended owned resources. Intentionally retained live work can remain only when the user's retention decision is recorded and the app's archive action is confirmed to preserve that work. If archive/cancellation behavior is unknown, report that gap before calling the session safe to archive.

Record the executed actions, remaining identities, verification, and any measured resource change in the existing decision log. RSS totals include shared pages and are estimates rather than guaranteed reclaimed RAM.
