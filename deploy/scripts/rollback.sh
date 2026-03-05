#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<USAGE
Usage:
  $0 --release-id <existing-release-id> --api-image <image-tag>

Example:
  sudo $0 --release-id 20260304_02 --api-image ghcr.io/acme/tools-api:20260304
USAGE
}

RELEASE_ID=""
API_IMAGE=""

while (($#)); do
  case "$1" in
    --release-id)
      RELEASE_ID="$2"
      shift 2
      ;;
    --api-image)
      API_IMAGE="$2"
      shift 2
      ;;
    *)
      usage
      exit 1
      ;;
  esac
done

if [[ -z "$RELEASE_ID" || -z "$API_IMAGE" ]]; then
  usage
  exit 1
fi

RELEASES_DIR="/var/www/tools/releases"
CURRENT_LINK="/var/www/tools/current"
TARGET_RELEASE_DIR="${RELEASES_DIR}/${RELEASE_ID}"
ENV_DIR="/etc/tools-api"
ENV_FILE="${ENV_DIR}/tools-api.env"
SERVICE_NAME="tools-api.service"

if [[ ! -d "$TARGET_RELEASE_DIR" ]]; then
  echo "release does not exist: $TARGET_RELEASE_DIR" >&2
  exit 1
fi

mkdir -p "$ENV_DIR"
ln -sfn "$TARGET_RELEASE_DIR" "$CURRENT_LINK"

echo "TOOLS_API_IMAGE=${API_IMAGE}" > "$ENV_FILE"
echo "RUST_LOG=info" >> "$ENV_FILE"

systemctl daemon-reload
systemctl restart "$SERVICE_NAME"
nginx -t
nginx -s reload
curl -fsS http://127.0.0.1:18080/api/readyz >/dev/null

echo "rollback success: ${RELEASE_ID}"
