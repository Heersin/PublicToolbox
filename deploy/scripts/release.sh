#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<USAGE
Usage:
  $0 --release-id <id> --dist-dir <path> --api-image <image-tag> [--domain tools.domain.xxx]

Example:
  sudo $0 --release-id 20260305_01 --dist-dir /tmp/tools-dist --api-image ghcr.io/acme/tools-api:20260305
USAGE
}

RELEASE_ID=""
DIST_DIR=""
API_IMAGE=""
DOMAIN="tools.domain.xxx"

while (($#)); do
  case "$1" in
    --release-id)
      RELEASE_ID="$2"
      shift 2
      ;;
    --dist-dir)
      DIST_DIR="$2"
      shift 2
      ;;
    --api-image)
      API_IMAGE="$2"
      shift 2
      ;;
    --domain)
      DOMAIN="$2"
      shift 2
      ;;
    *)
      usage
      exit 1
      ;;
  esac
done

if [[ -z "$RELEASE_ID" || -z "$DIST_DIR" || -z "$API_IMAGE" ]]; then
  usage
  exit 1
fi

if [[ ! -d "$DIST_DIR" ]]; then
  echo "dist dir not found: $DIST_DIR" >&2
  exit 1
fi

RELEASES_DIR="/var/www/tools/releases"
CURRENT_LINK="/var/www/tools/current"
TARGET_RELEASE_DIR="${RELEASES_DIR}/${RELEASE_ID}"
ENV_DIR="/etc/tools-api"
ENV_FILE="${ENV_DIR}/tools-api.env"
SERVICE_NAME="tools-api.service"

mkdir -p "$RELEASES_DIR" "$ENV_DIR"

PREV_RELEASE=""
if [[ -L "$CURRENT_LINK" ]]; then
  PREV_RELEASE="$(readlink "$CURRENT_LINK")"
fi

PREV_IMAGE=""
if [[ -f "$ENV_FILE" ]]; then
  PREV_IMAGE="$(grep '^TOOLS_API_IMAGE=' "$ENV_FILE" | head -n1 | cut -d '=' -f2- || true)"
fi

rm -rf "$TARGET_RELEASE_DIR"
mkdir -p "$TARGET_RELEASE_DIR"
cp -R "$DIST_DIR"/. "$TARGET_RELEASE_DIR"/
ln -sfn "$TARGET_RELEASE_DIR" "$CURRENT_LINK"

echo "TOOLS_API_IMAGE=${API_IMAGE}" > "$ENV_FILE"
echo "RUST_LOG=info" >> "$ENV_FILE"

systemctl daemon-reload
systemctl restart "$SERVICE_NAME"

nginx -t
nginx -s reload

if ! curl -fsS http://127.0.0.1:18080/api/readyz >/dev/null; then
  echo "API health check failed, rolling back" >&2
  if [[ -n "$PREV_RELEASE" ]]; then
    ln -sfn "$PREV_RELEASE" "$CURRENT_LINK"
  fi
  if [[ -n "$PREV_IMAGE" ]]; then
    echo "TOOLS_API_IMAGE=${PREV_IMAGE}" > "$ENV_FILE"
    echo "RUST_LOG=info" >> "$ENV_FILE"
  fi
  systemctl restart "$SERVICE_NAME" || true
  nginx -s reload || true
  exit 1
fi

if ! curl -fsS -H "Host: ${DOMAIN}" http://127.0.0.1/ >/dev/null; then
  echo "Site health check failed, rolling back" >&2
  if [[ -n "$PREV_RELEASE" ]]; then
    ln -sfn "$PREV_RELEASE" "$CURRENT_LINK"
  fi
  if [[ -n "$PREV_IMAGE" ]]; then
    echo "TOOLS_API_IMAGE=${PREV_IMAGE}" > "$ENV_FILE"
    echo "RUST_LOG=info" >> "$ENV_FILE"
  fi
  systemctl restart "$SERVICE_NAME" || true
  nginx -s reload || true
  exit 1
fi

echo "release success: ${RELEASE_ID}"
