#!/usr/bin/env bash
set -euo pipefail

# Idempotent setup for the no-mistakes evidence S3 bucket. Creates a FULLY PRIVATE
# bucket (no public objects, block-public-access fully on) and expires objects
# under the no-mistakes/ prefix after a bounded retention window. Inline PR
# rendering is served by short-lived presigned URLs, not public read. Safe to re-run.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Defaults come from the resolved project config. The skill's step 0 already
# exports these; source them here too so this setup is runnable standalone.
# An explicitly pre-set env var still wins (only sourced when unset).
H="${CLAUDE_PLUGIN_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
if [ -z "${NM_EVIDENCE_BUCKET:-}" ] && [ -f "$H/harness/load-config.mjs" ]; then
  eval "$(node "$H/harness/load-config.mjs" --export 2>/dev/null || true)"
fi

BUCKET="${NM_EVIDENCE_BUCKET:-no-mistakes}"
# Default to the CLI's configured region (so the bucket lands where the rest of
# the org's buckets are, and presigned URLs — which use the CLI default region —
# match the bucket region with no cross-region redirect). Falls back to us-west-2.
REGION="${AWS_REGION:-$(aws configure get region 2>/dev/null || echo us-west-2)}"
PREFIX="${NM_EVIDENCE_PREFIX:-no-mistakes}"
EXPIRE_DAYS="${NM_EVIDENCE_EXPIRE_DAYS:-30}"

command -v aws >/dev/null 2>&1 || { echo "error: aws CLI not found on PATH" >&2; exit 1; }

echo ">> bucket=$BUCKET region=$REGION prefix=$PREFIX/ expire_days=$EXPIRE_DAYS"

# Create bucket (idempotent). us-east-1 rejects a LocationConstraint; all other
# regions require one.
if aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
  echo ">> bucket already exists; skipping create"
else
  echo ">> creating bucket"
  if [ "$REGION" = "us-east-1" ]; then
    create_out="$(aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" 2>&1)" || true
  else
    create_out="$(aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" \
      --create-bucket-configuration "LocationConstraint=$REGION" 2>&1)" || true
  fi
  if [ -n "${create_out:-}" ]; then
    case "$create_out" in
      *BucketAlreadyOwnedByYou*|*BucketAlreadyExists*) echo ">> bucket already owned/exists; continuing" ;;
      *Location*|"") : ;;
      *) echo "$create_out" >&2; echo "error: create-bucket failed" >&2; exit 1 ;;
    esac
  fi
fi

# Block-public-access: fully ON. The bucket holds NO public objects; inline
# rendering uses presigned URLs, so nothing here needs anonymous read.
echo ">> enforcing block-public-access (fully private bucket)"
aws s3api put-public-access-block --bucket "$BUCKET" \
  --public-access-block-configuration \
    "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"

# Lifecycle: expire objects under the prefix after EXPIRE_DAYS (bounds storage
# and residual exposure).
LIFECYCLE_JSON="$(cat <<EOF
{
  "Rules": [
    {
      "ID": "expire-no-mistakes-evidence",
      "Status": "Enabled",
      "Filter": { "Prefix": "${PREFIX}/" },
      "Expiration": { "Days": ${EXPIRE_DAYS} }
    }
  ]
}
EOF
)"
echo ">> applying lifecycle expiry (${EXPIRE_DAYS}d) on ${PREFIX}/"
aws s3api put-bucket-lifecycle-configuration --bucket "$BUCKET" --lifecycle-configuration "$LIFECYCLE_JSON"

# Persist native-S3 config so post-evidence.mjs uploads + presigns inline FOREVER
# with no per-session env var. The harness reads this file on every run.
mkdir -p "$HOME/.no-mistakes"
cat > "$HOME/.no-mistakes/evidence.json" <<EOF
{"backend":"s3","bucket":"${BUCKET}","region":"${REGION}","prefix":"${PREFIX}","expiresIn":604800}
EOF

UPLOAD_CMD="aws s3 cp \"\$NM_FILE\" \"s3://${BUCKET}/${PREFIX}/\$NM_NAME\" --content-type image/png >&2 && aws s3 presign \"s3://${BUCKET}/${PREFIX}/\$NM_NAME\" --expires-in 604800"

echo
echo "================================================================"
echo "  Inline PR evidence is now ENABLED persistently"
echo "  (config written to ~/.no-mistakes/evidence.json) — no env var needed."
echo "----------------------------------------------------------------"
echo "  bucket      : $BUCKET"
echo "  region      : $REGION"
echo "  prefix      : $PREFIX/"
echo "  access      : PRIVATE (block-public-access fully on; no public objects)"
echo "  urls        : presigned, 7-day max expiry (--expires-in 604800)"
echo "  expiry      : $EXPIRE_DAYS days lifecycle"
echo "  config      : ~/.no-mistakes/evidence.json (native S3 backend)"
echo "----------------------------------------------------------------"
echo "  Future runs upload to S3 + presign inline automatically. Nothing"
echo "  else to do. Delete ~/.no-mistakes/evidence.json to revert to the"
echo "  orphan-branch click-through default."
echo
echo "  OPTIONAL advanced override — supply your OWN uploader instead of the"
echo "  native S3 backend by exporting (takes precedence over the config file):"
echo
echo "  export NOMISTAKES_EVIDENCE_UPLOAD_CMD='${UPLOAD_CMD}'"
echo "================================================================"
