#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_DIR="$ROOT_DIR/admin-panel/netlify/functions"

if rg -n "disabled_at" "$TARGET_DIR"; then
  echo "FAIL: stale disabled_at reference found in admin runtime functions"
  exit 1
fi

echo "PASS: admin runtime functions do not reference disabled_at"
