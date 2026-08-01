#!/usr/bin/env bash
set -euo pipefail
node scripts/verify-swiss-qr-invoice.mjs
node scripts/verify-invoice-only-swiss-billing.mjs
