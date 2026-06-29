#!/usr/bin/env bash
# Wire up Google Drive as the no-mistakes evidence host (via rclone). Free alternative to S3.
# Usage: REMOTE=gdrive FOLDER=no-mistakes-evidence bash gdrive-evidence-setup.sh
set -u

REMOTE="${NM_EVIDENCE_GDRIVE_REMOTE:-${REMOTE:-gdrive}}"
FOLDER="${NM_EVIDENCE_GDRIVE_FOLDER:-${FOLDER:-no-mistakes-evidence}}"

if ! command -v rclone >/dev/null 2>&1; then
  echo "rclone not found. Install it, then re-run:"
  echo "  macOS:  brew install rclone"
  echo "  other:  https://rclone.org/install/"
  exit 1
fi

if ! rclone listremotes 2>/dev/null | grep -qx "${REMOTE}:"; then
  echo "rclone remote '${REMOTE}:' is not configured."
  echo "Create a Google Drive remote (interactive, one time):"
  echo "  rclone config        # n) new remote -> name: ${REMOTE} -> storage: drive -> follow the OAuth flow"
  echo "Then re-run this script."
  exit 1
fi

echo "Verifying '${REMOTE}:' is reachable…"
if ! rclone lsd "${REMOTE}:" >/dev/null 2>&1; then
  echo "Could not list '${REMOTE}:'. Re-auth with: rclone config reconnect ${REMOTE}:"
  exit 1
fi
rclone mkdir "${REMOTE}:${FOLDER}" >/dev/null 2>&1 || true
echo "ok — Drive remote '${REMOTE}:' reachable, folder '${FOLDER}' ready."
echo
echo "Add this to your .no-mistakes.json (evidence block):"
cat <<EOF
  "evidence": {
    "backend": "gdrive",
    "fallback": "git-branch",
    "gdrive": { "remote": "${REMOTE}", "folder": "${FOLDER}" }
  }
EOF
echo
echo "Screenshots upload to Drive, are shared anyone-with-link, and embed as"
echo "https://lh3.googleusercontent.com/d/<id> (inline in the PR). PUBLIC link — dev/test screenshots only."
