# Codex Companion brokers

Use this reference only when the inventory contains Companion brokers. Locate the installed source from the broker process's actual `app-server-broker.mjs` path; read its protocol and lifecycle helpers before using a different plugin version.

The existing `lib/broker-lifecycle.mjs` provides `loadBrokerSession(cwd)`, `sendBrokerShutdown(endpoint)`, and state cleanup. Loading session metadata is read-only. Connecting through a helper that ensures a session can start a new broker, so avoid that path during inventory.

The current broker accepts newline-delimited JSON-RPC over its recorded endpoint. Relevant read calls are:

- `thread/loaded/list`, params `{}`: `result.data` contains loaded thread IDs.
- `thread/read`, params `{"threadId":"<id>","includeTurns":false}`: inspect `result.thread.status.type` for each ID.
- A busy response or active thread is a hold. Check the app's active tasks and the workspace's outstanding Companion jobs too; an idle thread alone does not prove the whole owner finished.

For an authorized finished owner, use the plugin's existing shutdown path. `broker/shutdown` acknowledges shutdown; the acknowledgement is not proof that the process tree exited. Capture descendant identities first, wait for exit, and inspect any remaining captured descendants before escalation.

Keep session metadata for intentionally retained work. Let the plugin recreate its own broker on the next legitimate invocation; cleanup does not delete durable Codex conversations. Preserve native T3/provider processes that are not owned by this Companion broker.
