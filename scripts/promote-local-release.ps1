param(
  [Parameter(Mandatory = $true)][string]$StageDirectory,
  [Parameter(Mandatory = $true)][string]$BatchName
)
$ErrorActionPreference = 'Stop'
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\')
function CheckedPath([string]$value) {
  $full = [IO.Path]::GetFullPath((Join-Path $workspace $value))
  if (-not $full.StartsWith("$workspace\", [StringComparison]::OrdinalIgnoreCase)) { throw "Outside project: $full" }
  $cursor = $full
  while ($cursor.Length -ge $workspace.Length) {
    if ((Test-Path -LiteralPath $cursor) -and (((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)) { throw "Reparse point: $cursor" }
    if ($cursor -eq $workspace) { break }
    $cursor = Split-Path -Parent $cursor
  }
  return $full
}
function Inventory([string]$path) {
  $item = Get-Item -LiteralPath $path -Force
  $items = if ($item.PSIsContainer) { @(Get-ChildItem -LiteralPath $path -Force -Recurse) } else { @($item) }
  if (@($items | Where-Object { ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 }).Count) { throw "Nested reparse point: $path" }
  $files = @($items | Where-Object { -not $_.PSIsContainer })
  return @{ Count = $files.Count; Bytes = [long]($files | Measure-Object Length -Sum).Sum }
}
$version = (Get-Content (Join-Path $workspace 'package.json') -Raw | ConvertFrom-Json).version
$installer = "PhD-Research-Workbench-$version-Setup.exe"
$release = CheckedPath 'release'
$stage = CheckedPath $StageDirectory
$batch = CheckedPath "delete\$BatchName"
if (Test-Path -LiteralPath $batch) { throw 'Cleanup batch already exists' }
$entries = @(
  @{ Source = $release; Target = (CheckedPath "delete\$BatchName\旧正式版"); Reason = '旧版可重新生成的程序目录和安装产物' },
  @{ Source = (CheckedPath "$StageDirectory\win-unpacked"); Target = (CheckedPath 'release\win-unpacked'); Reason = '最新版可运行程序' },
  @{ Source = (CheckedPath "$StageDirectory\$installer"); Target = (CheckedPath "release\$installer"); Reason = '最新版安装包' }
)
if (@(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith("$release\", [StringComparison]::OrdinalIgnoreCase) }).Count) { throw 'Close the running release before promotion' }
if (@(Get-ChildItem -LiteralPath $release -Recurse -Force -File | Where-Object { $_.Name -match '\.sqlite($|-)|workspace-location\.json$|\.pdf$' }).Count) { throw 'User-owned files found in release; keep it in place' }
foreach ($entry in $entries) { $entry.Inventory = Inventory $entry.Source }
New-Item -ItemType Directory -Path $batch | Out-Null
$manifest = @('# 待删除清单', '', '| 原路径 | 现路径 | 文件数 | 总字节数 | 归类理由与移动时间 |', '|---|---|---:|---:|---|')
foreach ($entry in $entries) {
  $parent = Split-Path -Parent $entry.Target
  if (-not (Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Path $parent | Out-Null }
  Move-Item -LiteralPath $entry.Source -Destination $entry.Target
  if (Test-Path -LiteralPath $entry.Source) { throw "Source remains: $($entry.Source)" }
  $actual = Inventory $entry.Target
  if ($actual.Count -ne $entry.Inventory.Count -or $actual.Bytes -ne $entry.Inventory.Bytes) { throw 'File inventory changed during move' }
  if ($entry.Reason -like '旧版*') { $manifest += "| $($entry.Source) | $($entry.Target) | $($actual.Count) | $($actual.Bytes) | $($entry.Reason)；$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz') |" }
}
[IO.File]::WriteAllLines((Join-Path $batch '待删除清单.md'), $manifest, [Text.UTF8Encoding]::new($false))
Write-Output "PROMOTED $version"
