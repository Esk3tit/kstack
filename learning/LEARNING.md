# Project learning

For an explicit learning mode, preference, tracking, or reset request, read [MANAGE.md](MANAGE.md) first, including when a task accompanies it.

Otherwise run the read-only helper with the actual absolute working directory, safely quoted:

```sh
python3 ~/.agents/learning/scripts/project_state.py --cwd "<absolute working directory>"
```

Use its returned notes path and profile_status. On an error, explain and pause this entry workflow until the issue is addressed or the user explicitly chooses to proceed without learning.

- **Off** (`missing`, `empty`, or `paused`): continue the caller's ordinary workflow. Leave learning notes untouched and load no other learning references.
- **Active** (`active`): read [behavior.md](behavior.md) and restore the current task as it directs. Use its discussion rules for grilling and its implementation handoff alongside the caller's implementation workflow.
