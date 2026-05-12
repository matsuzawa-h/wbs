<#
.SYNOPSIS
    Build and stage WBS Web for Windows service deployment.

.DESCRIPTION
    Steps:
      1. pnpm --filter @wbs/web build       # Vue dist/
      2. Mirror Vue dist into packages/api/public/
      3. pnpm --filter @wbs/api build        # NestJS dist/
      4. pnpm --filter @wbs/api --prod deploy <AppDir>
      5. Mirror packages/api/public into <AppDir>/public/
      6. Ensure <DataDir> exists (DB lives here, isolated from <AppDir>)
      7. Run drizzle migrations against the production DB
      8. Reminder: run install-service.ps1 if first time

.PARAMETER AppDir
    Destination directory for the application bundle. Defaults to C:\Apps\WbsWeb.

.PARAMETER DataDir
    Directory where wbs.db lives (must be outside AppDir). Defaults to C:\AppsData\WbsWeb.

.PARAMETER SkipMigrate
    Skip the migration step (for code-only redeploys when schema is unchanged).
#>

[CmdletBinding()]
param(
    [string]$AppDir = 'C:\Apps\WbsWeb',
    [string]$DataDir = 'C:\AppsData\WbsWeb',
    [switch]$SkipMigrate
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
Write-Host "Repo root: $repoRoot"
Write-Host "AppDir:    $AppDir"
Write-Host "DataDir:   $DataDir"

Push-Location $repoRoot
try {
    Write-Host "`n[1/7] Building Vue frontend..."
    pnpm --filter '@wbs/web' build

    Write-Host "`n[2/7] Mirroring Vue dist -> packages/api/public/..."
    $srcDist = Join-Path $repoRoot 'packages\web\dist'
    $apiPublic = Join-Path $repoRoot 'packages\api\public'
    if (-not (Test-Path $apiPublic)) { New-Item -ItemType Directory -Force $apiPublic | Out-Null }
    robocopy $srcDist $apiPublic /MIR | Out-Null

    Write-Host "`n[3/7] Building NestJS API..."
    pnpm --filter '@wbs/api' build

    Write-Host "`n[4/7] pnpm deploy -> $AppDir (production deps only)..."
    if (Test-Path $AppDir) {
        # Keep public/ if it was previously copied; pnpm deploy refreshes the rest.
        Write-Host "  AppDir already exists; pnpm deploy will refresh deps and dist"
    }
    pnpm --filter '@wbs/api' --prod deploy $AppDir

    Write-Host "`n[5/7] Mirroring built public -> $AppDir\public ..."
    $appPublic = Join-Path $AppDir 'public'
    if (-not (Test-Path $appPublic)) { New-Item -ItemType Directory -Force $appPublic | Out-Null }
    robocopy $apiPublic $appPublic /MIR | Out-Null

    Write-Host "`n[6/7] Ensuring data directory exists at $DataDir ..."
    if (-not (Test-Path $DataDir)) { New-Item -ItemType Directory -Force $DataDir | Out-Null }
    $logsDir = Join-Path $DataDir 'logs'
    if (-not (Test-Path $logsDir)) { New-Item -ItemType Directory -Force $logsDir | Out-Null }

    if (-not $SkipMigrate) {
        Write-Host "`n[7/7] Running production Drizzle migrations against $DataDir\wbs.db ..."
        $env:DB_PATH = Join-Path $DataDir 'wbs.db'
        try {
            Push-Location $AppDir
            try {
                $drizzleKit = Join-Path $AppDir 'node_modules\drizzle-kit\bin.cjs'
                if (-not (Test-Path $drizzleKit)) {
                    throw "drizzle-kit not found at $drizzleKit. Make sure pnpm deploy installed devDeps too, or run migrations from the repo against the prod DB_PATH."
                }
                & node $drizzleKit migrate
            } finally {
                Pop-Location
            }
        } finally {
            Remove-Item Env:DB_PATH -ErrorAction SilentlyContinue
        }
    } else {
        Write-Host "`n[7/7] SkipMigrate set - skipping production migration."
    }

    Write-Host "`nDeploy staging complete."
    Write-Host "Next: if first install, run scripts\install-service.ps1"
    Write-Host "      otherwise:  C:\Tools\nssm.exe restart WbsWeb"
} finally {
    Pop-Location
}
