#!/usr/bin/env bash
set -uo pipefail

# no-mistakes: resolve a shared Porter preview env from a branch name.
# Auto-detects which frontend is deployed (ai-arg vs ai-tprm-v2), then resolves the
# frontend URL + the co-located TPRM-API URL from the same namespace.
#
# Both ClusterIPs are only reachable over the un-sandboxed VPN network — run this
# (and anything hitting the URLs) WITHOUT the sandbox.
#
# Usage:   resolve-preview.sh <branch> [--json]
# Output (default): human-readable; (--json): {frontend,app,feSvc,auth,namespace,feUrl,apiUrl}
# Exit:    0 ok | 2 porter-auth | 3 frontend-undetected | 4 service-resolution-failed | 1 usage

BRANCH="${1:-}"
JSON=0; [ "${2:-}" = "--json" ] && JSON=1
[ -z "$BRANCH" ] && { echo "usage: resolve-preview.sh <branch> [--json]" >&2; exit 1; }

PROJECT="${PORTER_PROJECT:-8417}"
CLUSTER="${PORTER_CLUSTER:-3429}"
API_SVC="${NMF_API_SVC:-tprm-api-tprm-api}"
API_PORT="${NMF_API_PORT:-8090}"
FE_PORT="${NMF_FE_PORT:-3000}"

command -v porter >/dev/null 2>&1 || { echo "error: porter CLI not on PATH" >&2; exit 1; }

is_auth_error() { echo "$1" | grep -qiE 'session has expired|auth login|unauthorized|not authenticated'; }

# Frontend app -> (service name, auth model). Detection order doesn't matter; only one
# of these is deployed for a given branch.
detect_frontend() {
  local app svc auth out ns
  for spec in "ai-arg|ai-arg-auto-report-gen-frontend|moffitt" "ai-tprm-v2|ai-tprm-v2-ai-tprm-v2|propelauth"; do
    app="${spec%%|*}"; rest="${spec#*|}"; svc="${rest%%|*}"; auth="${rest##*|}"
    out="$(porter app manifests "$app" --project "$PROJECT" --cluster "$CLUSTER" -x "$BRANCH" 2>&1)"
    if is_auth_error "$out"; then echo "AUTH"; return 2; fi
    ns="$(echo "$out" | awk '/namespace:/ {print $2; exit}')"
    if [ -n "$ns" ]; then
      printf '%s\t%s\t%s\t%s\n' "$app" "$svc" "$auth" "$ns"
      return 0
    fi
  done
  return 3
}

DET="$(detect_frontend)"; rc=$?
if [ "$rc" -eq 2 ] || [ "$DET" = "AUTH" ]; then
  echo "porter session expired/unauthorized — run: porter auth login" >&2; exit 2
fi
if [ "$rc" -ne 0 ] || [ -z "$DET" ]; then
  echo "no ai-arg or ai-tprm-v2 deployment found for branch '$BRANCH' (frontend undetected)" >&2; exit 3
fi

APP="$(echo "$DET" | cut -f1)"
FE_SVC="$(echo "$DET" | cut -f2)"
AUTH="$(echo "$DET" | cut -f3)"
NS="$(echo "$DET" | cut -f4)"
[ "$APP" = "ai-arg" ] && FRONTEND="AI-ARG" || FRONTEND="AI-TPRM"

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
