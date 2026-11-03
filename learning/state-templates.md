# Learning state

Create missing files from these canonical templates, replacing unknown details only with current evidence:

- [profile.md](templates/profile.md): saved controls, goals, teaching preferences, and links to concept evidence.
- [progress.md](templates/progress.md): topic evidence and task-scoped pending decisions.
- [project-map.md](templates/project-map.md): orientation, canonical design-document links, and task status.

After explicit enablement, set the profile's mode to active. Keep onboarding incomplete until answered or deliberately skipped, then mark it complete. A reset adds its own pending marker so older conversation and backups are not mistaken for fresh answers.

## Learning evidence

In progress.md, give each topic concise Introduced, Demonstrated understanding, and Needs reinforcement bullets. Cite the user's reasoning, predictions, or applications as evidence; the agent's explanation and a user's approval establish no mastery. Topic sections stand alone so only relevant material needs loading. Consolidate repeated observations. profile.md summaries link to this evidence instead of creating another history.

## Pending decisions

Use one separate `## Pending decision` section per task. Include its task name or ticket, affected paths, current proposal, and awaited stage: reasoning, design choice, or permission for a stated implementation scope. Remove only that task's section when resolved. Explicit implementation requests resolve permission for the agreed scope as behavior.md describes.

Record chosen outcomes in the appropriate canonical design document and link from the map. When no appropriate document exists, keep a concise chosen entry in the map until one does; replace it with a link when promoted. Record reasoning evidence under its topic and mark implementation only after verification. Attribute approved AI additions to the agent, keeping unresolved details visibly proposed or unknown. Preserve the exact scope of the user's choice.
