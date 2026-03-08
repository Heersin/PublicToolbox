#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Force rustup shims to take precedence over Homebrew rust toolchain.
if [ -d "${HOME}/.cargo/bin" ]; then
  export PATH="${HOME}/.cargo/bin:${PATH}"
fi

if [ -f "${HOME}/.cargo/env" ]; then
  # shellcheck disable=SC1090
  . "${HOME}/.cargo/env"
fi

if [ -x "${HOME}/.cargo/bin/wasm-pack" ]; then
  WASM_PACK_BIN="${HOME}/.cargo/bin/wasm-pack"
elif command -v wasm-pack >/dev/null 2>&1; then
  WASM_PACK_BIN="$(command -v wasm-pack)"
else
  echo "wasm-pack is required. Install with: cargo install wasm-pack" >&2
  exit 1
fi

if command -v rustup >/dev/null 2>&1; then
  if ! rustup target list --installed | grep -q '^wasm32-unknown-unknown$'; then
    rustup target add wasm32-unknown-unknown
  fi
fi

cd "${REPO_ROOT}"
"${WASM_PACK_BIN}" build "${REPO_ROOT}/crates/tool-wasm" \
  --target web \
  --out-dir "${REPO_ROOT}/apps/tools-web/src/wasm/pkg" \
  --out-name tool_wasm \
  --release
