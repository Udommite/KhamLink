param([switch]$Setup, [int]$Port = 8000, [switch]$PrepareOnly)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$env:PYTHONIOENCODING = 'utf-8'
function Confirm-CommandSucceeded([string]$Step) {
    if ($LASTEXITCODE -ne 0) { throw "$Step failed with exit code $LASTEXITCODE" }
}
if (-not (Test-Path -LiteralPath '.venv/Scripts/python.exe')) {
    python -m venv .venv
    Confirm-CommandSucceeded 'Python environment creation'
    $Setup = $true
}
if ($Setup) {
    & .venv/Scripts/python.exe -m pip install -r requirements.lock
    Confirm-CommandSucceeded 'Backend dependencies'
    & .venv/Scripts/python.exe -m pip install --no-deps -e .
    Confirm-CommandSucceeded 'Backend installation'
}
if ($Setup -or -not (Test-Path -LiteralPath 'frontend/node_modules')) {
    npm.cmd --prefix frontend ci
    Confirm-CommandSucceeded 'Frontend dependencies'
}
npm.cmd --prefix frontend run build
Confirm-CommandSucceeded 'Frontend build'
& .venv/Scripts/python.exe -m khamlink.cli demo --no-serve
Confirm-CommandSucceeded 'Corpus acquisition, validation and index publication'
if (-not $PrepareOnly) {
    Write-Host "KhamLink is ready at http://127.0.0.1:$Port (Ctrl+C to stop)."
    & .venv/Scripts/python.exe -m khamlink.cli serve --port $Port
    Confirm-CommandSucceeded 'KhamLink server'
}
