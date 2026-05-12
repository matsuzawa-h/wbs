<#
.SYNOPSIS
    Online-safe backup of WbsWeb SQLite database (service can stay running).

.DESCRIPTION
    Wraps packages/api/scripts/backup.js which uses VACUUM INTO.
    Default source: $DataDir\wbs.db. Default destination: $DataDir\backups\wbs_<timestamp>.db.

.PARAMETER DataDir
    Production data directory. Defaults to C:\AppsData\WbsWeb.

.PARAMETER AppDir
    App directory containing node_modules. Defaults to C:\Apps\WbsWeb.

.PARAMETER NodeExe
    Path to node.exe. Defaults to "C:\Program Files\nodejs\node.exe".
#>

[CmdletBinding()]
param(
    [string]$DataDir = 'C:\AppsData\WbsWeb',
    [string]$AppDir = 'C:\Apps\WbsWeb',
    [string]$NodeExe = 'C:\Program Files\nodejs\node.exe'
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $NodeExe)) { throw "node.exe not found at $NodeExe" }
$script = Join-Path $AppDir 'scripts\backup.js'
if (-not (Test-Path $script)) {
    # AppDir may not contain scripts/ - try the repo path instead
    $repoScript = Join-Path (Split-Path -Parent $PSScriptRoot) 'packages\api\scripts\backup.js'
    if (Test-Path $repoScript) { $script = $repoScript } else {
        throw "backup.js not found at $script or $repoScript"
    }
}

$backupsDir = Join-Path $DataDir 'backups'
if (-not (Test-Path $backupsDir)) { New-Item -ItemType Directory -Force $backupsDir | Out-Null }

$env:DB_PATH = Join-Path $DataDir 'wbs.db'
try {
    Push-Location $DataDir
    try {
        & $NodeExe $script
    } finally {
        Pop-Location
    }
} finally {
    Remove-Item Env:DB_PATH -ErrorAction SilentlyContinue
}

Write-Host "Backup finished. Files in: $backupsDir"
