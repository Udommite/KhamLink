param(
    [Parameter(Mandatory = $true)]
    [string[]]$Ids,
    [string]$SrsPath,
    [switch]$IncludeStates
)

$ErrorActionPreference = 'Stop'

if (-not $SrsPath) {
    $skillRoot = Split-Path -Parent $PSScriptRoot
    $skillsRoot = Split-Path -Parent $skillRoot
    $agentsRoot = Split-Path -Parent $skillsRoot
    $workspaceRoot = Split-Path -Parent $agentsRoot
    $SrsPath = Join-Path $workspaceRoot 'khamlink_srs.md'
}

if (-not (Test-Path -LiteralPath $SrsPath -PathType Leaf)) {
    throw "SRS not found: $SrsPath"
}

$text = [System.IO.File]::ReadAllText($SrsPath, [System.Text.Encoding]::UTF8)
$requested = @(
    $Ids |
        ForEach-Object { $_ -split ',' } |
        ForEach-Object { $_.Trim().ToUpperInvariant() } |
        Where-Object { $_ } |
        Select-Object -Unique
)

foreach ($id in $requested) {
    if ($id -notmatch '^REQ-\d{3}$') {
        throw "Invalid requirement ID '$id'. Expected REQ-###."
    }
}

$controlIds = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)

foreach ($id in $requested) {
    $number = $id.Substring(4)
    $escaped = [regex]::Escape($id)
    $detailPattern = "(?ms)^<a id=`"req-$number`"></a>\r?\n### ${escaped}:.*?(?=^<a id=`"req-\d{3}`"></a>|^## \d+\.|\z)"
    $detail = [regex]::Match($text, $detailPattern)
    if (-not $detail.Success) {
        throw "Detailed requirement not found: $id"
    }

    "===== $id ====="

    $indexLine = [regex]::Match($text, "(?m)^\| .*${escaped}.*\| MOD-.*$")
    if ($indexLine.Success) {
        "INDEX"
        $indexLine.Value
    }

    "DETAIL"
    $detail.Value.Trim()

    $validationId = 'VAL-' + $number
    $validationLine = [regex]::Match($text, "(?m)^\| <a id=`"val-$number`"></a>``$validationId``.*$")
    if ($validationLine.Success) {
        "ACCEPTANCE"
        $validationLine.Value
    }

    [regex]::Matches($detail.Value, '\b(?:ARCH|DOM|DEC|Q)-\d{3}\b') | ForEach-Object {
        [void]$controlIds.Add($_.Value.ToUpperInvariant())
    }

    ""
}

if ($controlIds.Count -gt 0) {
    "===== REFERENCED CONTROLS ====="
    foreach ($controlId in @($controlIds) | Sort-Object) {
        $number = $controlId.Substring($controlId.Length - 3)
        $line = if ($controlId.StartsWith('Q-')) {
            [regex]::Match($text, "(?m)^\| <a id=`"q-$number`"></a>``$([regex]::Escape($controlId))``.*$")
        } else {
            [regex]::Match($text, "(?m)^\| ``$([regex]::Escape($controlId))``.*$")
        }
        if ($line.Success) { $line.Value }
    }
}

if ($IncludeStates) {
    $states = [regex]::Match($text, '(?ms)^## 7\. State and Lifecycle Requirements.*?(?=^## 8\.)')
    if ($states.Success) {
        ""
        "===== STATE AND LIFECYCLE REQUIREMENTS ====="
        $states.Value.Trim()
    }
}
