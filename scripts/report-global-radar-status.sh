#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT_DIR}/env/Crawler_env/AgentStatusReport_env"
LOCK_FILE="${ROOT_DIR}/test/agent-status-report.lock"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Agent status report env file missing: ${ENV_FILE}" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

: "${KAN_AGENT_STATUS_REPORT_SECRET:?KAN_AGENT_STATUS_REPORT_SECRET is required}"
: "${KAN_AGENT_STATUS_REPORT_KEY:=global-radar-hk}"
: "${KAN_AGENT_STATUS_DISPLAY_NAME:=全域雷达⭐️-hk}"

mkdir -p "${ROOT_DIR}/test"

flock -n "${LOCK_FILE}" docker exec \
  -e KAN_AGENT_STATUS_REPORT_SECRET="${KAN_AGENT_STATUS_REPORT_SECRET}" \
  -e KAN_AGENT_STATUS_DISPLAY_NAME="${KAN_AGENT_STATUS_DISPLAY_NAME}" \
  agentcrawler-standalone \
  sh -lc "cd /app && bun run scripts/report-kan-agent-status.ts --platform global-radar --report-key '${KAN_AGENT_STATUS_REPORT_KEY}'"
