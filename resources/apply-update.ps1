param(
  [Parameter(Mandatory = $true)][int]$TargetPid,
  [Parameter(Mandatory = $true)][string]$ArchivePath,
  [Parameter(Mandatory = $true)][string]$InstallDirectory,
  [Parameter(Mandatory = $true)][string]$ExecutableName,
  [switch]$SkipRelaunch
)
$ErrorActionPreference = 'Stop'
$updateRoot = Split-Path -Parent ([IO.Path]::GetFullPath($ArchivePath))
$updateTarget = [IO.Path]::GetFullPath($InstallDirectory).TrimEnd('\')
$payload = Join-Path $updateRoot 'payload'
$previous = Join-Path $updateRoot 'previous'
$statusFile = Join-Path $updateRoot 'result.json'
$replaced = @()
$targetClosed = $false
try {
  Expand-Archive -LiteralPath $ArchivePath -DestinationPath $payload
  if (-not (Test-Path -LiteralPath (Join-Path $payload $ExecutableName)) -or
      -not (Test-Path -LiteralPath (Join-Path $payload 'resources\app.asar'))) { throw 'Incomplete application update package.' }
  $files = @(Get-ChildItem -LiteralPath $payload -Recurse -File)
  foreach ($file in $files) {
    if (($file.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Invalid program file.' }
    $relative = $file.FullName.Substring($payload.Length + 1)
    if ($relative -match '(?i)(^|\\)(\u5de5\u4f5c\u53f0\u6570\u636e|workspace-location\.json)(\\|$)|\.(sqlite|db)(-|$)') { throw 'Package contains non-program files.' }
    $destination = [IO.Path]::GetFullPath((Join-Path $updateTarget $relative))
    if (-not $destination.StartsWith("$updateTarget\", [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid destination.' }
    $cursor = $destination
    while ($cursor.Length -ge $updateTarget.Length) {
      if ((Test-Path -LiteralPath $cursor) -and ((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Invalid destination link.' }
      if ($cursor -eq $updateTarget) { break }; $cursor = Split-Path -Parent $cursor
    }
  }
  [IO.File]::WriteAllText((Join-Path $updateRoot 'prepared.json'), '{"state":"prepared"}')
  while (Get-Process -Id $TargetPid -ErrorAction SilentlyContinue) { Start-Sleep -Milliseconds 250 }
  $targetClosed = $true
  foreach ($file in $files) {
    $relative = $file.FullName.Substring($payload.Length + 1)
    $destination = Join-Path $updateTarget $relative
    $backup = Join-Path $previous $relative
    New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
    if (Test-Path -LiteralPath $destination) {
      New-Item -ItemType Directory -Path (Split-Path -Parent $backup) -Force | Out-Null
      Copy-Item -LiteralPath $destination -Destination $backup
    }
    $replaced += @{ Destination = $destination; Backup = $backup }
    for ($attempt = 0; ; $attempt++) {
      try { Copy-Item -LiteralPath $file.FullName -Destination $destination -Force; break }
      catch { if ($attempt -ge 4) { throw }; Start-Sleep -Seconds 1 }
    }
  }
  @{ state = 'updated'; files = $files.Count } | ConvertTo-Json | Set-Content -LiteralPath $statusFile -Encoding UTF8
} catch {
  foreach ($entry in $replaced) {
    if (Test-Path -LiteralPath $entry.Backup) { Copy-Item -LiteralPath $entry.Backup -Destination $entry.Destination -Force }
  }
  @{ state = 'failed'; message = $_.Exception.Message } | ConvertTo-Json | Set-Content -LiteralPath $statusFile -Encoding UTF8
} finally {
  if ($targetClosed -and -not $SkipRelaunch) { Start-Process -FilePath (Join-Path $updateTarget $ExecutableName) -WorkingDirectory $updateTarget -WindowStyle Hidden }
}
