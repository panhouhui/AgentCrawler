#!/usr/bin/env bash
# OpenCrow Web Guardian — lightweight wrapper for the web UI process.
# No rollback needed: the web process is stateless and can restart freely.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# ---------------------------------------------------------------------------
# Resolve bun binary
# ---------------------------------------------------------------------------
resolve_bun() {
  if command -v bun >/dev/null 2>&1; then
    command -v bun
    return
  fi
  local candidates=(
    "${HOME}/.bun/bin/bun"
    "/usr/local/bin/bun"
    "/usr/bin/bun"
  )
  for c in "${candidates[@]}"; do
    if [ -x "$c" ]; then
      echo "$c"
      return
    fi
  done
  echo "FATAL: bun not found" >&2
  exit 1
}

BUN="$(resolve_bun)"

# ---------------------------------------------------------------------------
# Main — just run the web process. Systemd/launchd handle restart-on-failure.
# ---------------------------------------------------------------------------
echo "GUARDIAN-WEB: Starting OpenCrow Web via ${BUN}" >&2
exec "${BUN}" run "${SCRIPT_DIR}/src/web-index.ts"
