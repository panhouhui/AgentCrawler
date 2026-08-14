#!/usr/bin/env bash
set -euo pipefail

# OpenCrow Install Script
# Usage: curl -fsSL https://opencrow.dev/install.sh | bash

REPO="https://github.com/gokhantos/opencrow.git"
INSTALL_DIR="${HOME}/.opencrow"
BIN_DIR="${INSTALL_DIR}/bin"
CLI_WRAPPER="${BIN_DIR}/opencrow"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
info()  { printf "\033[1;34m==>\033[0m %s\n" "$1"; }
ok()    { printf "\033[1;32m==>\033[0m %s\n" "$1"; }
warn()  { printf "\033[1;33m==>\033[0m %s\n" "$1"; }
err()   { printf "\033[1;31m==>\033[0m %s\n" "$1" >&2; }

# ---------------------------------------------------------------------------
# OS detection
# ---------------------------------------------------------------------------
detect_os() {
  case "$(uname -s)" in
    Darwin) echo "macos" ;;
    Linux)  echo "linux" ;;
    *)
      err "Unsupported OS: $(uname -s)"
      err "Windows users: install WSL first, then re-run this script."
      exit 1
      ;;
  esac
}

OS="$(detect_os)"
info "Detected OS: ${OS}"

# ---------------------------------------------------------------------------
# Check / install Bun
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
  echo ""
}

BUN="$(resolve_bun)"

if [ -z "$BUN" ]; then
  info "Bun not found. Installing..."
  curl -fsSL https://bun.sh/install | bash
  export PATH="${HOME}/.bun/bin:${PATH}"
  BUN="$(resolve_bun)"
  if [ -z "$BUN" ]; then
    err "Failed to install Bun. Please install manually: https://bun.sh"
    exit 1
  fi
  ok "Bun installed: ${BUN}"
else
  ok "Bun found: ${BUN}"
fi

# ---------------------------------------------------------------------------
# Check Docker (warn only — needed for setup, not install)
# ---------------------------------------------------------------------------
if command -v docker >/dev/null 2>&1; then
  ok "Docker found"
else
  warn "Docker not found. You'll need it for 'opencrow setup' (PostgreSQL + Qdrant)."
  warn "Install Docker: https://docs.docker.com/get-docker/"
fi

# ---------------------------------------------------------------------------
# Clone or update repo
# ---------------------------------------------------------------------------
if [ -d "${INSTALL_DIR}/.git" ]; then
  info "Existing installation found. Updating..."
  git -C "${INSTALL_DIR}" pull origin master
else
  info "Cloning OpenCrow to ${INSTALL_DIR}..."
  git clone "${REPO}" "${INSTALL_DIR}"
fi

# ---------------------------------------------------------------------------
# Install dependencies
# ---------------------------------------------------------------------------
info "Installing dependencies..."
(cd "${INSTALL_DIR}" && "${BUN}" install)

# ---------------------------------------------------------------------------
# Create CLI wrapper
# ---------------------------------------------------------------------------
mkdir -p "${BIN_DIR}"

cat > "${CLI_WRAPPER}" << 'WRAPPER'
#!/usr/bin/env bash
set -euo pipefail

OPENCROW_DIR="${HOME}/.opencrow"

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
  echo "Error: bun not found" >&2
  exit 1
}

BUN="$(resolve_bun)"
exec "${BUN}" run "${OPENCROW_DIR}/src/cli.ts" "$@"
WRAPPER

chmod +x "${CLI_WRAPPER}"

# ---------------------------------------------------------------------------
# Symlink to PATH
# ---------------------------------------------------------------------------
SYMLINK_TARGET="/usr/local/bin/opencrow"

if [ -w "/usr/local/bin" ] || [ -w "$(dirname "${SYMLINK_TARGET}")" ]; then
  ln -sf "${CLI_WRAPPER}" "${SYMLINK_TARGET}" 2>/dev/null && \
    ok "Symlinked: ${SYMLINK_TARGET} -> ${CLI_WRAPPER}" || \
    warn "Could not create symlink at ${SYMLINK_TARGET}"
else
  if command -v sudo >/dev/null 2>&1; then
    info "Creating symlink (requires sudo)..."
    sudo ln -sf "${CLI_WRAPPER}" "${SYMLINK_TARGET}" 2>/dev/null && \
      ok "Symlinked: ${SYMLINK_TARGET} -> ${CLI_WRAPPER}" || \
      warn "Could not create symlink. Add ${BIN_DIR} to your PATH manually."
  else
    warn "Could not create symlink. Add this to your shell profile:"
    warn "  export PATH=\"${BIN_DIR}:\$PATH\""
  fi
fi

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
echo ""
ok "OpenCrow installed successfully!"
echo ""
echo "  Next steps:"
echo "    opencrow setup      Interactive setup wizard"
echo "    opencrow doctor     Check system health"
echo "    opencrow --help     Show all commands"
echo ""
