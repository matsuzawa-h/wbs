<#
.SYNOPSIS
    Stop, redeploy, optionally migrate, then restart WbsWeb service.

.PARAMETER ServiceName
    Service name. Defaults to "WbsWeb".

.PARAMETER NssmPath
    Path to nssm.exe. Defaults to C:\Tools\nssm.exe.

.PARAMETER SkipMigrate
    Pass through to deploy.ps1 to skip Drizzle migrations.
#>

[CmdletBinding()]
param(
    [string]$ServiceName = 'WbsWeb',
    [string]$NssmPath = 'C:\Tools\nssm.exe',
    [switch]$SkipMigrate
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $NssmPath)) { throw "nssm.exe not found at $NssmPath" }

Write-Host "Stopping $ServiceName..."
& $NssmPath stop $ServiceName

$deploy = Join-Path $PSScriptRoot 'deploy.ps1'
if ($SkipMigrate) {
    & $deploy -SkipMigrate
} else {
    & $deploy
}

Write-Host "Starting $ServiceName..."
& $NssmPath start $ServiceName
Write-Host "Done."
