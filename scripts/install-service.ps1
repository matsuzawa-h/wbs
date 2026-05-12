<#
.SYNOPSIS
    Register WBS Web as a Windows service using NSSM.

.DESCRIPTION
    Run this once after a fresh deploy. For subsequent code updates, use restart-service.ps1.
    Requires an elevated (admin) PowerShell prompt and nssm.exe.

.PARAMETER ServiceName
    Service name registered in Windows. Defaults to "WbsWeb".

.PARAMETER NssmPath
    Path to nssm.exe. Defaults to C:\Tools\nssm.exe.

.PARAMETER AppDir
    Deployed app directory (must contain dist\main.js). Defaults to C:\Apps\WbsWeb.

.PARAMETER DataDir
    Data directory containing wbs.db and logs\. Defaults to C:\AppsData\WbsWeb.

.PARAMETER NodeExe
    Path to node.exe. Defaults to "C:\Program Files\nodejs\node.exe".

.PARAMETER Port
    Listening port. Defaults to 5000.
#>

[CmdletBinding()]
param(
    [string]$ServiceName = 'WbsWeb',
    [string]$NssmPath = 'C:\Tools\nssm.exe',
    [string]$AppDir = 'C:\Apps\WbsWeb',
    [string]$DataDir = 'C:\AppsData\WbsWeb',
    [string]$NodeExe = 'C:\Program Files\nodejs\node.exe',
    [int]$Port = 5000
)

$ErrorActionPreference = 'Stop'

$current = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($current)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'This script must run from an elevated (administrator) PowerShell.'
}

if (-not (Test-Path $NssmPath)) { throw "nssm.exe not found at $NssmPath" }
if (-not (Test-Path $NodeExe)) { throw "node.exe not found at $NodeExe" }

$entry = Join-Path $AppDir 'dist\main.js'
if (-not (Test-Path $entry)) { throw "App entry not found at $entry. Did you run deploy.ps1?" }

$logsDir = Join-Path $DataDir 'logs'
if (-not (Test-Path $logsDir)) { New-Item -ItemType Directory -Force $logsDir | Out-Null }

Write-Host "Installing service '$ServiceName' via NSSM..."
& $NssmPath install $ServiceName $NodeExe $entry
& $NssmPath set $ServiceName AppDirectory $AppDir
& $NssmPath set $ServiceName AppEnvironmentExtra "PORT=$Port" "NODE_ENV=production" "DB_PATH=$DataDir\wbs.db"
& $NssmPath set $ServiceName AppStdout (Join-Path $logsDir 'stdout.log')
& $NssmPath set $ServiceName AppStderr (Join-Path $logsDir 'stderr.log')
& $NssmPath set $ServiceName Start SERVICE_AUTO_START
& $NssmPath set $ServiceName AppRotateFiles 1
& $NssmPath set $ServiceName AppRotateOnline 1
& $NssmPath set $ServiceName AppRotateBytes 10485760

Write-Host "Starting service..."
& $NssmPath start $ServiceName

Write-Host "Done. Service '$ServiceName' should be running on http://localhost:$Port"
Write-Host "Health check: curl http://localhost:$Port/api/health"
