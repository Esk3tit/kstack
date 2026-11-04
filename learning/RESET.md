# Reset project learning

Use only for an explicit request to reset this project's learning history. Keep the reset in the main conversation. This replaces the three learning notes and restarts onboarding while preserving the saved active or paused mode; a missing profile stays off. The project's source and canonical design documents remain outside the reset. Reset requires exclusive access to these notes: pause note writers in other sessions before preview and keep them paused through the result. If exclusive access cannot be established, stop. The helper detects stale snapshots but does not lock out concurrent saves.

1. Run the read-only preview with the actual absolute working directory, safely quoted:

   ```sh
   python3 ~/.agents/learning/scripts/reset.py --cwd "<absolute working directory>"
   ```

   On an error, explain and stop. If no notes exist, explain that there is nothing to reset. Do not substitute deletion commands or select another state directory.
2. Apply [the privacy guide](PRIVACY.md) to the preview's selected directory before resetting. If that changes a note, obtain a fresh preview. Show the returned absolute project/state paths, all files that will be replaced or created, the mode after reset, and the backup parent. Read the existing map/progress when present and identify any map-only chosen but unimplemented designs and pending decisions that will leave the active notes. Explain that their originals remain in the backup; preserve desired decisions in canonical project documents before resetting if the user requests it, then obtain a fresh preview. Ask the user to choose Cancel or Reset learning for that named project and confirm that other sessions have stopped writing its notes. Wait for explicit confirmation; the reset request itself or permission to use tools does not confirm the preview.
3. After confirmation, use the original working directory and exact preview token:

   ```sh
   python3 ~/.agents/learning/scripts/reset.py --cwd "<original working directory>" --confirm "<preview confirmation>"
   ```

   If notes or target changed, preview again and obtain fresh confirmation. If reset fails, report the error and backup path, inspect active notes, and stop; replacement is per file, so partial failure can leave a mixture of old and fresh notes. Never claim success or begin onboarding after a failed reset.
4. On success, show the backup path and preserved mode. Resume the shared LEARNING.md guide with incomplete onboarding; a paused project remains paused until explicitly enabled. Discard previous learning claims, teaching preferences, and pending decisions; the backups are historical data. When learning is active, inspect current code and canonical documents to rebuild the orientation map, and ask only for new onboarding answers.
