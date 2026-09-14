[CmdletBinding(SupportsShouldProcess)]
param([ValidateRange(1024,65535)][int]$Port = 8000)
$ErrorActionPreference = 'Stop'
$khamlinkPython = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '.venv/Scripts/python.exe'))
$khamlinkArguments = '-m\s+khamlink\.cli\s+serve\s+--port\s+' + $Port + '\s*$'

# Match this workspace's interpreter AND exact local serve command. Never kill
# arbitrary Python processes or terminate whichever application happens to own a port.
$khamlinkServers = @(Get-CimInstance Win32_Process -Filter "Name = 'python.exe'" | Where-Object {
    $_.ExecutablePath -eq $khamlinkPython -and $_.CommandLine -match $khamlinkArguments
})
if ($khamlinkServers.Count -eq 0) {
    Write-Host "No background KhamLink server from this workspace was found on port $Port."
    return
}
foreach ($khamlinkServer in $khamlinkServers) {
    if ($PSCmdlet.ShouldProcess("KhamLink process $($khamlinkServer.ProcessId) on port $Port", 'Stop local server')) {
        $khamlinkCurrent = Get-CimInstance Win32_Process -Filter "ProcessId = $($khamlinkServer.ProcessId)"
        if (-not $khamlinkCurrent -or $khamlinkCurrent.CreationDate -ne $khamlinkServer.CreationDate -or $khamlinkCurrent.ExecutablePath -ne $khamlinkPython -or $khamlinkCurrent.CommandLine -notmatch $khamlinkArguments) {
            throw 'The process identity changed. No stop action was taken.'
        }
        # The virtualenv launcher has a Python child; stop only this verified tree.
        & taskkill.exe /PID $khamlinkCurrent.ProcessId /T /F
        if ($LASTEXITCODE -ne 0) { throw 'The local server could not be stopped. No files were deleted.' }
        Write-Host 'KhamLink stopped. Your corpus, index and feedback are retained.'
    }
}
