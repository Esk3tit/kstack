#!/usr/bin/env bash
set -uo pipefail

# no-mistakes: resolve a shared Porter preview env from a branch name.
# Auto-detects which frontend app (from the project config app-map) is deployed, then
# resolves the frontend URL + the co-located backend API URL from the same namespace.
#
# Both ClusterIPs are only reachable over the un-sandboxed VPN network — run this
# (and anything hitting the URLs) WITHOUT the sandbox.
#
# Usage:   resolve-preview.sh <branch> [--json]
# Output (default): human-readable; (--json): {frontend,app,feSvc,auth,namespace,feUrl,apiUrl}
# Exit:    0 ok | 2 porter-auth | 3 frontend-undetected | 4 service-resolution-failed | 1 usage/config

H="${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/skills/no-mistakes}"

BRANCH="${1:-}"
JSON=0; [ "${2:-}" = "--json" ] && JSON=1
[ -z "$BRANCH" ] && { echo "usage: resolve-preview.sh <branch> [--json]" >&2; exit 1; }

CFG_EXPORT="$(node "$H/harness/load-config.mjs" --export 2>&1)" || {
  echo "error: no-mistakes config did not resolve: $CFG_EXPORT" >&2; exit 1; }
eval "$CFG_EXPORT"

APP_MAP="$(node "$H/harness/load-config.mjs" --app-map 2>&1)" || {
  echo "error: could not read app-map from config: $APP_MAP" >&2; exit 1; }

PROJECT="${PORTER_PROJECT:-}"
CLUSTER="${PORTER_CLUSTER:-}"
if [ -z "$PROJECT" ] || [ -z "$CLUSTER" ]; then
  echo "error: PORTER_PROJECT/PORTER_CLUSTER unset — set preview.porter.{project,cluster} in config" >&2; exit 1
fi
API_SVC="${NMF_API_SVC:-}"
[ -z "$API_SVC" ] && { echo "error: NMF_API_SVC unset — set the backend app's previewService in config" >&2; exit 1; }
API_PORT="${NMF_API_PORT:-8090}"
FE_PORT="${NMF_FE_PORT:-3000}"

command -v porter >/dev/null 2>&1 || { echo "error: porter CLI not on PATH" >&2; exit 1; }

is_auth_error() { echo "$1" | grep -qiE 'session has expired|auth login|unauthorized|not authenticated'; }

# Frontend candidates come from the config app-map (slug|service|auth|kind); only one
# frontend is deployed for a given branch, so detection order doesn't matter.
detect_frontend() {
  local app svc auth kind out ns
  while IFS='|' read -r app svc auth kind; do
    [ "$kind" = frontend ] || continue
    [ -n "$app" ] || continue
    out="$(porter app manifests "$app" --project "$PROJECT" --cluster "$CLUSTER" -x "$BRANCH" 2>&1)"
    if is_auth_error "$out"; then echo "AUTH"; return 2; fi
    ns="$(echo "$out" | awk '/namespace:/ {print $2; exit}')"
    if [ -n "$ns" ]; then
      printf '%s\t%s\t%s\t%s\n' "$app" "$svc" "$auth" "$ns"
      return 0
    fi
  done <<EOF
$APP_MAP
EOF
  return 3
}

DET="$(detect_frontend)"; rc=$?
if [ "$rc" -eq 2 ] || [ "$DET" = "AUTH" ]; then
  echo "porter session expired/unauthorized — run: porter auth login" >&2; exit 2
fi
if [ "$rc" -ne 0 ] || [ -z "$DET" ]; then
  echo "no configured frontend deployment found for branch '$BRANCH' (frontend undetected)" >&2; exit 3
fi

APP="$(echo "$DET" | cut -f1)"
FE_SVC="$(echo "$DET" | cut -f2)"
AUTH="$(echo "$DET" | cut -f3)"
NS="$(echo "$DET" | cut -f4)"
# Friendly display name = the app's config "name"; fall back to the porter slug.
FRONTEND="$(node "$H/harness/load-config.mjs" --app "$APP" 2>/dev/null | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).name' 2>/dev/null)"
[ -z "$FRONTEND" ] && FRONTEND="$APP"

clusterip() {  # svc -> clusterIP, or empty
  porter kubectl -- get svc "$1" -n "$NS" -o jsonpath='{.spec.clusterIP}' 2>/dev/null
}

FE_IP="$(clusterip "$FE_SVC")"
API_IP="$(clusterip "$API_SVC")"
if [ -z "$FE_IP" ] || [ -z "$API_IP" ]; then
  echo "failed to resolve service ClusterIPs in $NS (fe='$FE_SVC'->'$FE_IP' api='$API_SVC'->'$API_IP')" >&2
  exit 4
fi
FE_URL="http://$FE_IP:$FE_PORT"
API_URL="http://$API_IP:$API_PORT"

if [ "$JSON" -eq 1 ]; then
  printf '{"frontend":"%s","app":"%s","feSvc":"%s","auth":"%s","namespace":"%s","feUrl":"%s","apiUrl":"%s"}\n' \
    "$FRONTEND" "$APP" "$FE_SVC" "$AUTH" "$NS" "$FE_URL" "$API_URL"
else
  echo "frontend : $FRONTEND (porter app $APP, auth=$AUTH)"
  echo "namespace: $NS"
  echo "fe  url  : $FE_URL  (svc $FE_SVC)"
  echo "api url  : $API_URL  (svc $API_SVC)"
fi
