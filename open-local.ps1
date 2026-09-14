param([ValidateRange(1024,65535)][int]$Port = 8000, [switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$env:PYTHONIOENCODING = 'utf-8'
$khamlinkUrl = "http://127.0.0.1:$Port"

function Test-KhamLinkReady {
    try {
        $khamlinkConfig = Invoke-RestMethod -Uri "$khamlinkUrl/api/config" -TimeoutSec 2
        $khamlinkReady = Invoke-RestMethod -Uri "$khamlinkUrl/ready" -TimeoutSec 2
        return ($khamlinkReady.data.status -eq 'ready')
    } catch { return $false }
}

if (-not (Test-KhamLinkReady)) {
    if (-not (Test-Path -LiteralPath '.venv/Scripts/python.exe') -or -not (Test-Path -LiteralPath 'frontend/dist/index.html')) {
        & powershell -NoProfile -ExecutionPolicy Bypass -File "$PSScriptRoot/start.ps1" -PrepareOnly
        if ($LASTEXITCODE -ne 0) { throw 'Setup failed. See the output above.' }
    } else {
        & .venv/Scripts/python.exe -m khamlink.cli demo --no-serve
        if ($LASTEXITCODE -ne 0) { throw 'Local data preparation failed.' }
    }
    $khamlinkLogs = Join-Path $PSScriptRoot 'artifacts/local-server'
    New-Item -ItemType Directory -Path $khamlinkLogs -Force | Out-Null
    $khamlinkRun = [Guid]::NewGuid().ToString('N')
    $khamlinkOutput = Join-Path $khamlinkLogs "$khamlinkRun.stdout.log"
    $khamlinkErrors = Join-Path $khamlinkLogs "$khamlinkRun.stderr.log"
    $khamlinkProcess = Start-Process -FilePath "$PSScriptRoot/.venv/Scripts/python.exe" -ArgumentList @('-m','khamlink.cli','serve','--port',"$Port") -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput $khamlinkOutput -RedirectStandardError $khamlinkErrors -PassThru
    $khamlinkDeadline = [DateTime]::UtcNow.AddSeconds(30)
    do {
        if (Test-KhamLinkReady) { break }
        if ($khamlinkProcess.HasExited) { throw "The server exited. Check $khamlinkErrors. Port $Port may already be in use." }
        Start-Sleep -Milliseconds 250
    } while ([DateTime]::UtcNow -lt $khamlinkDeadline)
    if (-not (Test-KhamLinkReady)) { throw "Server startup is not ready yet. Check $khamlinkErrors before trying again." }
    Write-Host "KhamLink server started (process $($khamlinkProcess.Id))."
}
Write-Host "Open $khamlinkUrl"
if (-not $NoBrowser) { Start-Process $khamlinkUrl }
