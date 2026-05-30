# ---------------------------------------------------------------------------
# ua-vendor-setup.ps1
#
# Clone and build Understand-Anything as a Maestro vendor dependency.
# Installs to ~/.maestro/vendor/ua/ and builds the @understand-anything/core
# package so downstream Maestro tools can reference its type definitions
# and runtime utilities.
#
# Usage:
#   pwsh scripts/ua-vendor-setup.ps1 [-Force] [-Tag <tag>]
#
# Parameters:
#   -Force    Reinstall even if already built
#   -Tag      Git tag or branch to checkout after clone (default: pinned commit)
# ---------------------------------------------------------------------------
param(
    [switch]$Force,
    [string]$Tag = ""
)

$ErrorActionPreference = "Stop"

$UA_DIR = Join-Path (Join-Path (Join-Path $HOME ".maestro") "vendor") "ua"
$UA_REPO = "https://github.com/Lum1104/Understand-Anything.git"
$UA_PLUGIN_DIR = Join-Path $UA_DIR "understand-anything-plugin"
$CORE_DIST = Join-Path (Join-Path (Join-Path $UA_PLUGIN_DIR "packages") "core") "dist"
$UA_COMMIT = "26edf61856fa476e466bda1814819a266a293c47"

if ((Test-Path $CORE_DIST) -and -not $Force) {
    Write-Host "UA vendor already installed at $UA_DIR"
    Write-Host "Run with -Force to reinstall"
    exit 0
}

# --- Step 1: Clone ---
Write-Host "==> Cloning Understand-Anything repository..."

if (-not (Test-Path $UA_DIR)) {
    New-Item -ItemType Directory -Path $UA_DIR -Force | Out-Null
}

if (Test-Path (Join-Path $UA_DIR ".git")) {
    Write-Host "    Updating existing clone..."
    Push-Location $UA_DIR
    try {
        $ErrorActionPreference = "Continue"
        git pull --ff-only 2>$null
        $ErrorActionPreference = "Stop"
        if ($LASTEXITCODE -ne 0) {
            Write-Host "    Warning: git pull failed, continuing with existing clone"
        }
    } finally {
        $ErrorActionPreference = "Stop"
        Pop-Location
    }
} else {
    try {
        git clone $UA_REPO $UA_DIR
        if ($LASTEXITCODE -ne 0) {
            throw "git clone exited with code $LASTEXITCODE"
        }
    } catch {
        Write-Host ""
        Write-Host "ERROR: Failed to clone repository." -ForegroundColor Red
        Write-Host "  URL: $UA_REPO" -ForegroundColor Red
        Write-Host ""
        Write-Host "Possible causes:" -ForegroundColor Yellow
        Write-Host "  - No internet connection"
        Write-Host "  - GitHub is unreachable (try a mirror or VPN)"
        Write-Host "  - git is not installed or not in PATH"
        Write-Host ""
        exit 1
    }
}

# --- Step 2: Checkout pinned version ---
$checkoutRef = if ($Tag) { $Tag } else { $UA_COMMIT }
Write-Host "==> Checking out version $checkoutRef..."
Push-Location $UA_DIR
try {
    $ErrorActionPreference = "Continue"
    git checkout $checkoutRef 2>$null
    $ErrorActionPreference = "Stop"
    if ($LASTEXITCODE -ne 0) {
        Write-Host "    Warning: checkout of $checkoutRef failed, using current HEAD"
    }
} finally {
    $ErrorActionPreference = "Stop"
    Pop-Location
}

# --- Step 3: Install dependencies ---
Write-Host "==> Installing dependencies..."
Push-Location $UA_PLUGIN_DIR
try {
    # Auto-approve tree-sitter native builds before install
    pnpm config set onlyBuiltDependencies "esbuild,tree-sitter-c,tree-sitter-c-sharp,tree-sitter-cpp,tree-sitter-go,tree-sitter-java,tree-sitter-javascript,tree-sitter-php,tree-sitter-python,tree-sitter-ruby,tree-sitter-rust,tree-sitter-typescript" --location project 2>&1 | Out-Null

    # Try frozen lockfile first, fall back to regular install
    $frozenResult = pnpm install --frozen-lockfile 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "    Frozen lockfile install failed, trying regular install..."
        pnpm install
        if ($LASTEXITCODE -ne 0) {
            Write-Host "ERROR: pnpm install failed." -ForegroundColor Red
            exit 1
        }
    }
} finally {
    Pop-Location
}

# --- Step 4: Build core ---
Write-Host "==> Building @understand-anything/core..."
Push-Location $UA_PLUGIN_DIR
try {
    pnpm --filter @understand-anything/core build
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: Core build failed." -ForegroundColor Red
        exit 1
    }
} finally {
    Pop-Location
}

# --- Done ---
Write-Host ""
Write-Host "==> Done. UA vendor installed successfully at $UA_DIR"
exit 0
