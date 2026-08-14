#!/usr/bin/env bash
# OpenCrow Guardian — crash-loop detection & automatic rollback
# Runs OUTSIDE TypeScript, so even if all .ts files are broken, this still works.
# State lives in ~/.opencrow/ (survives git reset).

set -uo pipefail
# NOTE: set -e is intentionally omitted — we need to capture non-zero exit
# codes from bun to record crashes. With -e, the script exits immediately
# on bun failure and record_crash is never called.

OPENCROW_STATE="${HOME}/.opencrow"
CRASHLOG="${OPENCROW_STATE}/crashlog"
KNOWN_GOOD="${OPENCROW_STATE}/known-good-commit"
ROLLBACK_LOG="${OPENCROW_STATE}/rollback.log"
CRASH_THRESHOLD=3
CRASH_WINDOW=60  # seconds
SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

mkdir -p "${OPENCROW_STATE}"

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
# Crash-log helpers
# ---------------------------------------------------------------------------
record_crash() {
  echo "$(date +%s)" >> "${CRASHLOG}"
  trim_crashlog
}

trim_crashlog() {
  if [ -f "${CRASHLOG}" ]; then
    tail -n 20 "${CRASHLOG}" > "${CRASHLOG}.tmp" && mv "${CRASHLOG}.tmp" "${CRASHLOG}"
  fi
}

count_recent_crashes() {
  if [ ! -f "${CRASHLOG}" ]; then
    echo 0
    return
  fi
  local cutoff=$(( $(date +%s) - CRASH_WINDOW ))
  # Use awk to safely handle non-integer lines
  awk -v cutoff="$cutoff" '$1 ~ /^[0-9]+$/ && $1 >= cutoff { count++ } END { print count+0 }' "${CRASHLOG}"
}

# ---------------------------------------------------------------------------
# Hash helper (macOS has shasum, Linux has sha256sum)
# ---------------------------------------------------------------------------
compute_hash() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256
  else
    cat
  fi
}

# ---------------------------------------------------------------------------
# Rollback logic
# ---------------------------------------------------------------------------
do_rollback() {
  local reason="$1"
  local target=""

  if [ -f "${KNOWN_GOOD}" ]; then
    target="$(tr -d '[:space:]' < "${KNOWN_GOOD}")"
  fi

  # Validate commit hash format
  if [ -n "$target" ] && ! echo "$target" | grep -qE '^[0-9a-f]{7,40}$'; then
    echo "GUARDIAN: Invalid commit hash in known-good-commit: ${target}" >&2
    target=""
  fi

  local current
  current="$(git -C "${SCRIPT_DIR}" rev-parse HEAD 2>/dev/null || echo "")"

  # If known-good is the same as current (or empty), fall back to HEAD~3
  if [ -z "$target" ] || [ "$target" = "$current" ]; then
    target="$(git -C "${SCRIPT_DIR}" rev-parse HEAD~3 2>/dev/null || echo "")"
    if [ -z "$target" ]; then
      echo "GUARDIAN: No rollback target available, cannot recover" >&2
      return 1
    fi
  fi

  echo "GUARDIAN: Rolling back to ${target} (reason: ${reason})" >&2

  # Save a diff of uncommitted work before stashing
  git -C "${SCRIPT_DIR}" diff HEAD > "${OPENCROW_STATE}/pre-rollback-$(date +%s).diff" 2>/dev/null || true

  # Stash any dirty work
  git -C "${SCRIPT_DIR}" stash --include-untracked 2>/dev/null || true

  # Check if lockfile will change (need bun install after)
  local old_lock
  old_lock="$(git -C "${SCRIPT_DIR}" show HEAD:bun.lock 2>/dev/null | compute_hash 2>/dev/null || echo "none")"

  git -C "${SCRIPT_DIR}" reset --hard -- "$target"

  local new_lock
  new_lock="$(git -C "${SCRIPT_DIR}" show HEAD:bun.lock 2>/dev/null | compute_hash 2>/dev/null || echo "none")"

  if [ "$old_lock" != "$new_lock" ]; then
    echo "GUARDIAN: bun.lock changed, running bun install" >&2
    (cd "${SCRIPT_DIR}" && "${BUN}" install --frozen-lockfile 2>/dev/null || "${BUN}" install)
  fi

  # Write rollback event as NDJSON (use jq if available, manual escape otherwise)
  local timestamp
  timestamp="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  local reason_safe="${reason//\"/\\\"}"
  if command -v jq >/dev/null 2>&1; then
    jq -nc --arg ts "$timestamp" --arg from "$current" --arg to "$target" --arg reason "$reason" \
      '{timestamp: $ts, from: $from, to: $to, reason: $reason}' >> "${ROLLBACK_LOG}"
  else
    printf '{"timestamp":"%s","from":"%s","to":"%s","reason":"%s"}\n' \
      "$timestamp" "$current" "$target" "$reason_safe" >> "${ROLLBACK_LOG}"
  fi

  # Clear crash counter to give a fresh window
  rm -f "${CRASHLOG}"

  echo "GUARDIAN: Rollback complete" >&2
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

# Check for crash loop BEFORE starting OpenCrow
crashes="$(count_recent_crashes)"
if [ "$crashes" -ge "$CRASH_THRESHOLD" ]; then
  echo "GUARDIAN: Crash loop detected (${crashes} crashes in ${CRASH_WINDOW}s)" >&2
  do_rollback "crash-loop: ${crashes} crashes in ${CRASH_WINDOW}s"
fi

# Build Tailwind CSS if source is newer than output
TW_SRC="${SCRIPT_DIR}/src/web/ui/tailwind.css"
TW_OUT="${SCRIPT_DIR}/src/web/ui/tailwind-out.css"
if [ ! -f "${TW_OUT}" ] || [ "${TW_SRC}" -nt "${TW_OUT}" ]; then
  echo "GUARDIAN: Building Tailwind CSS" >&2
  "${BUN}" x @tailwindcss/cli -i "${TW_SRC}" -o "${TW_OUT}" --minify 2>/dev/null || true
fi

# Run OpenCrow — capture exit code without -e interference
echo "GUARDIAN: Starting OpenCrow via ${BUN}" >&2
"${BUN}" run "${SCRIPT_DIR}/src/index.ts" || exit_code=$?
exit_code=${exit_code:-0}

if [ "$exit_code" -ne 0 ]; then
  echo "GUARDIAN: OpenCrow exited with code ${exit_code}" >&2
  record_crash
fi

exit "$exit_code"
