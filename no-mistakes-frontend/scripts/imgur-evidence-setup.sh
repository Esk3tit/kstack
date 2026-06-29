#!/usr/bin/env bash
# Wire up imgur (anonymous) as the no-mistakes evidence host. Free; direct i.imgur.com links
# render inline reliably. Anonymous uploads are PUBLIC — dev/test screenshots only.
# Usage: IMGUR_CLIENT_ID=xxxx bash imgur-evidence-setup.sh
set -u

CLIENT_ID_ENV="${NM_EVIDENCE_IMGUR_CLIENT_ID_ENV:-IMGUR_CLIENT_ID}"
CLIENT_ID="${!CLIENT_ID_ENV:-}"

if [ -z "$CLIENT_ID" ]; then
  echo "No imgur Client-ID in \$${CLIENT_ID_ENV}."
  echo "Get one (free, no account review): https://api.imgur.com/oauth2/addclient"
  echo "  - Register an application -> authorization type: 'OAuth 2 without a callback URL'"
  echo "  - Copy the Client ID, then export it (add to your shell profile / secrets store):"
  echo "      export ${CLIENT_ID_ENV}=<your-client-id>"
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then echo "curl not found"; exit 1; fi

echo "Verifying imgur Client-ID…"
code=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Client-ID ${CLIENT_ID}" https://api.imgur.com/3/credits)
if [ "$code" != "200" ]; then
  echo "imgur rejected the Client-ID (HTTP ${code}). Double-check \$${CLIENT_ID_ENV}."
  exit 1
fi
echo "ok — imgur Client-ID valid."
echo
echo "Add this to your .no-mistakes.json (evidence block):"
cat <<EOF
  "evidence": {
    "backend": "imgur",
    "fallback": "git-branch",
    "imgur": { "clientIdEnv": "${CLIENT_ID_ENV}" }
  }
EOF
echo
echo "Screenshots upload anonymously to imgur; direct i.imgur.com links embed inline in the PR."
echo "PUBLIC host — dev/test screenshots only, never customer data."
