#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# ua-vendor-setup.sh
#
# Clone and build Understand-Anything as a Maestro vendor dependency.
# Installs to ~/.maestro/vendor/ua/ and builds the @understand-anything/core
# package so downstream Maestro tools can reference its type definitions
# and runtime utilities.
#
# Usage:
#   bash scripts/ua-vendor-setup.sh [--force] [--tag <tag>]
#
# Options:
#   --force    Reinstall even if already built
#   --tag      Git tag or branch to checkout after clone (default: pinned commit)
# ---------------------------------------------------------------------------
set -euo pipefail

UA_DIR="${HOME}/.maestro/vendor/ua"
UA_REPO="https://github.com/Lum1104/Understand-Anything.git"
UA_PLUGIN_DIR="${UA_DIR}/understand-anything-plugin"
UA_COMMIT="26edf61856fa476e466bda1814819a266a293c47"

FORCE=false
TAG=""

# Parse arguments
while [ $# -gt 0 ]; do
  case "$1" in
    --force) FORCE=true; shift ;;
    --tag)   TAG="$2"; shift 2 ;;
    *)       shift ;;
  esac
done

if [ -d "$UA_PLUGIN_DIR/packages/core/dist" ] && [ "$FORCE" = false ]; then
  echo "UA vendor already installed at $UA_DIR"
  echo "Run with --force to reinstall"
  exit 0
fi

# --- Step 1: Clone ---
echo "==> Cloning Understand-Anything repository..."
mkdir -p "$UA_DIR"

if [ -d "$UA_DIR/.git" ]; then
  echo "    Updating existing clone..."
  cd "$UA_DIR" && git pull --ff-only || echo "    Warning: git pull failed, continuing with existing clone"
else
  if ! git clone "$UA_REPO" "$UA_DIR"; then
    echo ""
    echo "ERROR: Failed to clone repository."
    echo "  URL: $UA_REPO"
    echo ""
    echo "Possible causes:"
    echo "  - No internet connection"
    echo "  - GitHub is unreachable (try a mirror or VPN)"
    echo "  - git is not installed or not in PATH"
    echo ""
    exit 1
  fi
fi

# --- Step 2: Checkout pinned version ---
CHECKOUT_REF="${TAG:-$UA_COMMIT}"
echo "==> Checking out version $CHECKOUT_REF..."
cd "$UA_DIR"
git checkout "$CHECKOUT_REF" 2>/dev/null || echo "    Warning: checkout of $CHECKOUT_REF failed, using current HEAD"

# --- Step 3: Install dependencies ---
echo "==> Installing dependencies..."
cd "$UA_PLUGIN_DIR"

# Auto-approve tree-sitter native builds before install
pnpm config set onlyBuiltDependencies "esbuild,tree-sitter-c,tree-sitter-c-sharp,tree-sitter-cpp,tree-sitter-go,tree-sitter-java,tree-sitter-javascript,tree-sitter-php,tree-sitter-python,tree-sitter-ruby,tree-sitter-rust,tree-sitter-typescript" --location project 2>/dev/null || true

pnpm install --frozen-lockfile 2>/dev/null || pnpm install

# --- Step 4: Build core ---
echo "==> Building @understand-anything/core..."
cd "$UA_PLUGIN_DIR"
pnpm --filter @understand-anything/core build

# --- Done ---
echo ""
echo "==> Done. UA vendor installed successfully at $UA_DIR"
exit 0
