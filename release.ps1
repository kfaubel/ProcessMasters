param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('major', 'minor', 'patch')]
    [string]$Bump
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoPath = Join-Path $repoRoot 'repository.json'
$updatesPath = Join-Path $repoRoot 'updates.xri'
$scriptsDir = Join-Path $repoRoot 'src\scripts'

if (-not (Test-Path -LiteralPath $repoPath)) {
    throw "repository.json not found: $repoPath"
}

if (-not (Test-Path -LiteralPath $updatesPath)) {
    throw "updates.xri not found: $updatesPath"
}

if (-not (Test-Path -LiteralPath $scriptsDir)) {
    throw "scripts directory not found: $scriptsDir"
}

$repo = Get-Content -Raw -LiteralPath $repoPath | ConvertFrom-Json
$versionParts = $repo.version.Split('.')

if ($versionParts.Count -ne 3) {
    throw "repository.json version must be in major.minor.patch format: $($repo.version)"
}

$major = [int]$versionParts[0]
$minor = [int]$versionParts[1]
$patch = [int]$versionParts[2]

switch ($Bump) {
    'major' {
        $major += 1
        $minor = 0
        $patch = 0
    }
    'minor' {
        $minor += 1
        $patch = 0
    }
    'patch' {
        $patch += 1
    }
}

$newVersion = '{0}.{1}.{2}' -f $major, $minor, $patch
$repo.version = $newVersion

foreach ($scriptEntry in $repo.scripts) {
    if ($scriptEntry.id -eq 'ProcessMasters') {
        $scriptEntry.version = $newVersion
    }
}

$repo | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $repoPath -Encoding UTF8

$zipName = 'ProcessMasters-v{0}.zip' -f $newVersion
$zipPath = Join-Path $repoRoot $zipName

if (Test-Path -LiteralPath $zipPath) {
    Remove-Item -LiteralPath $zipPath -Force
}

Compress-Archive -Path (Join-Path $scriptsDir '*') -DestinationPath $zipPath -Force

$sha1 = (Get-FileHash -Algorithm SHA1 -LiteralPath $zipPath).Hash.ToLowerInvariant()
$releaseDate = Get-Date -Format yyyyMMdd

$updates = Get-Content -Raw -LiteralPath $updatesPath
$updates = [regex]::Replace($updates, 'fileName="[^"]+"', 'fileName="' + $zipName + '"', 1)
$updates = [regex]::Replace($updates, 'sha1="[A-Fa-f0-9]+"', 'sha1="' + $sha1 + '"', 1)
$updates = [regex]::Replace($updates, 'releaseDate="\d{8}"', 'releaseDate="' + $releaseDate + '"', 1)
Set-Content -LiteralPath $updatesPath -Value $updates -Encoding UTF8

Write-Host "Updated repository version: $newVersion"
Write-Host "Created archive: $zipName"
Write-Host "SHA1: $sha1"