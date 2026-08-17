#!/usr/bin/env zsh

set -euo pipefail

STRICT=${1:-}
if [[ "${STRICT}" != "--strict" ]]; then
  STRICT=""
fi

missing_count=0

warn() {
  echo "⚠️  $1"
}

ok() {
  echo "✅ $1"
}

if ! command -v node >/dev/null 2>&1; then
  warn "node is not available; skip impeccable CLI checks."
  missing_count=$((missing_count + 1))
else
  ok "node: $(node --version)"
fi

if ! command -v npm >/dev/null 2>&1; then
  warn "npm is not available; skip npm/npx-based checks."
  missing_count=$((missing_count + 1))
else
  ok "npm: $(npm --version)"
fi

if ! command -v npx >/dev/null 2>&1; then
  warn "npx is not available; cannot verify 'impeccable' CLI cache."
  missing_count=$((missing_count + 1))
else
  ok "npx is available"
  if ! npx --version >/dev/null 2>&1; then
    warn "npx exists but is not runnable."
    missing_count=$((missing_count + 1))
  fi

  if ! npx --no-install impeccable --help >/dev/null 2>&1; then
    warn "impeccable CLI is not available in local npm cache."
    warn "To enable one-command local detection, run: npm i -g impeccable"
    missing_count=$((missing_count + 1))
  else
    ok "impeccable CLI is available via npm cache (`npx impeccable --help`)"
  fi
fi

if [[ "${STRICT}" == "--strict" && ${missing_count} -gt 0 ]]; then
  echo "❌ strict preflight requires all optional dependencies."
  exit 1
fi

if [[ ${missing_count} -gt 0 ]]; then
  echo "ℹ️  imm-ui-review still works without these optional deps; fallback review remains active."
fi

exit 0
