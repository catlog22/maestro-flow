param(
    [Parameter(Mandatory = $true)]
    [string]$InputPath,

    [Parameter(Mandatory = $true)]
    [string]$OutputPath,

    [ValidateSet("svg", "png", "pdf")]
    [string]$Format = "svg",

    [ValidateSet("default", "neutral", "forest", "dark", "base")]
    [string]$Theme = "base",

    [int]$Width = 1600,

    [int]$Height = 1200,

    [double]$Scale = 2.0,

    [string]$BackgroundColor = "white",

    [string]$ConfigPath,

    [switch]$Quiet
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function New-DefaultConfigFile {
    param([string]$Path)

    $config = @'
{
  "theme": "base",
  "themeVariables": {
    "fontFamily": "Times New Roman",
    "fontSize": "18px",
    "primaryColor": "#ffffff",
    "primaryTextColor": "#111827",
    "primaryBorderColor": "#111827",
    "lineColor": "#374151",
    "secondaryColor": "#f8fafc",
    "tertiaryColor": "#ffffff"
  },
  "flowchart": {
    "htmlLabels": false,
    "curve": "linear"
  },
  "sequence": {
    "useMaxWidth": false
  },
  "er": {
    "layoutDirection": "TB"
  }
}
'@
    $encoding = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $config, $encoding)
}

function Resolve-MermaidRunner {
    $mmdc = Get-Command mmdc -ErrorAction SilentlyContinue
    if ($mmdc) {
        return @{
            Command = $mmdc.Source
            PrefixArgs = @()
        }
    }

    $npx = Get-Command npx.cmd -ErrorAction SilentlyContinue
    if (-not $npx) {
        $npx = Get-Command npx -ErrorAction SilentlyContinue
    }

    if ($npx) {
        return @{
            Command = $npx.Source
            PrefixArgs = @("-y", "@mermaid-js/mermaid-cli")
        }
    }

    throw "Neither mmdc nor npx was found. Install Node.js and mermaid-cli."
}

$resolvedInput = (Resolve-Path -LiteralPath $InputPath).Path
$resolvedOutput = [System.IO.Path]::GetFullPath($OutputPath)
$outputDir = Split-Path -Parent $resolvedOutput

if (-not (Test-Path -LiteralPath $outputDir)) {
    New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
}

$effectiveConfigPath = $ConfigPath
$temporaryConfig = $null

if (-not $effectiveConfigPath) {
    $temporaryConfig = Join-Path ([System.IO.Path]::GetTempPath()) ("mermaid-config-" + [guid]::NewGuid().ToString("N") + ".json")
    New-DefaultConfigFile -Path $temporaryConfig
    $effectiveConfigPath = $temporaryConfig
}
else {
    $effectiveConfigPath = (Resolve-Path -LiteralPath $effectiveConfigPath).Path
}

$runner = Resolve-MermaidRunner
$arguments = @()
$arguments += $runner.PrefixArgs
$arguments += @(
    "-i", $resolvedInput,
    "-o", $resolvedOutput,
    "-c", $effectiveConfigPath,
    "-b", $BackgroundColor,
    "-w", "$Width",
    "-H", "$Height",
    "-s", "$Scale"
)

if ($Theme -ne "base") {
    $arguments += @("-t", $Theme)
}

if ($Quiet) {
    $arguments += "-q"
}

try {
    & $runner.Command @arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Mermaid rendering failed with exit code $LASTEXITCODE."
    }

    [pscustomobject]@{
        input = $resolvedInput
        output = $resolvedOutput
        format = $Format
        theme = $Theme
        width = $Width
        height = $Height
        scale = $Scale
        command = $runner.Command
    } | ConvertTo-Json -Depth 4
}
finally {
    if ($temporaryConfig -and (Test-Path -LiteralPath $temporaryConfig)) {
        Remove-Item -LiteralPath $temporaryConfig -Force
    }
}
