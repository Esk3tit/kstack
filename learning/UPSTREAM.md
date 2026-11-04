# Source and local adaptations

Adapted from [nykooi1/vibe-wise](https://github.com/nykooi1/vibe-wise/tree/eefb53df406ab89e31444684ff32c1df205221f8), revision `eefb53df406ab89e31444684ff32c1df205221f8`. Its MIT notice is in [LICENSE](LICENSE).

The project-boundary lookup, confirmed reset, state format, and regression cases originate there. Kstack directly maintains this shared module; small patches connect Matt Pocock's existing skills to the same small mode-check guide. Off-mode work loads no other learning references and leaves notes untouched. Active mode loads teaching and task restoration; explicit control or reset requests load management guidance. Privacy instructions load before learning-note writes. Canonical template files serve both setup and reset.

Local changes use .learning for new notes, preserve legacy notes in place, honor explicit off controls, restrict markerless activation to legacy directories, keep notes private by default, and preserve saved mode and tracking choices through reset. The project map links to canonical design documents, with concise chosen entries only when no appropriate document exists.

The unused Claude-specific session-event adapter and its registration protocol are omitted. No startup hook is installed; both hosts read state at the existing skill entry points. Notes remain isolated within the nearest Git checkout. Reset backs up all original bytes but replaces the three notes individually; a replacement error requires inspecting the active files and reported backup.
