param(
  [Parameter(Mandatory = $true)][string]$StageDirectory,
  [Parameter(Mandatory = $true)][string]$PreviousVersion,
  [Parameter(Mandatory = $true)][string]$NewVersion,
  [Parameter(Mandatory = $true)][string]$BatchName
)
$ErrorActionPreference = 'Stop'
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\')
function Assert-WorkspacePath([string]$Path) {
  $full = [IO.Path]::GetFullPath($Path)
  if (-not $full.StartsWith("$workspace\", [StringComparison]::OrdinalIgnoreCase)) { throw "Outside workspace: $full" }
  $cursor = $full
  while ($cursor.Length -ge $workspace.Length) {
    if (Test-Path -LiteralPath $cursor) {
      if ((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Reparse point: $cursor" }
    }
    if ($cursor -eq $workspace) { break }
    $cursor = Split-Path -Parent $cursor
  }
  return $full
}
function Inventory([string]$Path) {
  $item=Get-Item -LiteralPath $Path -Force
  if (-not $item.PSIsContainer) { return @{ Count=1; Bytes=[long]$item.Length } }
  $items=@(Get-ChildItem -LiteralPath $Path -Recurse -Force)
  if (@($items | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }).Count) { throw "Nested reparse point: $Path" }
  if (@($items | Where-Object { $_.Name -match '\.(sqlite|db|pdf)$' }).Count) { throw "Unexpected data in program output: $Path" }
  $files=@($items | Where-Object { -not $_.PSIsContainer })
  return @{ Count=$files.Count; Bytes=[long](($files | Measure-Object Length -Sum).Sum) }
}
$release=Assert-WorkspacePath (Join-Path $workspace 'release')
$stage=Assert-WorkspacePath (Join-Path $workspace $StageDirectory)
$batch=Assert-WorkspacePath (Join-Path $workspace "delete\$BatchName")
$oldDirectory=Assert-WorkspacePath (Join-Path $batch "旧正式版-$PreviousVersion")
if (Test-Path -LiteralPath $batch) { throw "Batch already exists: $batch" }
$oldNames=@('win-unpacked', "PhD-Research-Workbench-$PreviousVersion-Setup.exe")
$newNames=@('win-unpacked', "PhD-Research-Workbench-$NewVersion-Setup.exe")
$plan=@()
for($i=0; $i -lt $oldNames.Count; $i++) {
  $source=Assert-WorkspacePath (Join-Path $release $oldNames[$i])
  $target=Assert-WorkspacePath (Join-Path $oldDirectory $oldNames[$i])
  if (-not (Test-Path -LiteralPath $source)) { throw "Missing source: $source" }
  $plan+=@{Source=$source;Target=$target;Inventory=(Inventory $source);Reason='旧版程序产物'}
}
$newPlan=@()
foreach($name in $newNames) {
  $source=Assert-WorkspacePath (Join-Path $stage $name)
  $target=Assert-WorkspacePath (Join-Path $release $name)
  if (-not (Test-Path -LiteralPath $source)) { throw "Missing staged output: $source" }
  if ((Test-Path -LiteralPath $target) -and ($target -notin $plan.Source)) { throw "Target already exists: $target" }
  $newPlan+=@{Source=$source;Target=$target;Inventory=(Inventory $source)}
}
$running=@(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith((Join-Path $release 'win-unpacked'),[StringComparison]::OrdinalIgnoreCase) })
if($running.Count) { throw 'Close the formal program before promotion.' }
New-Item -ItemType Directory -Path $oldDirectory -Force | Out-Null
$time=Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz'
$manifest=@('# 待删除清单','','移动时间：'+$time,'','| 原路径 | 现路径 | 文件数 | 总字节数 | 归类理由 |','|---|---|---:|---:|---|')
foreach($entry in $plan) {
  Move-Item -LiteralPath $entry.Source -Destination $entry.Target
  if(Test-Path -LiteralPath $entry.Source) { throw 'Source remains after move.' }
  $actual=Inventory $entry.Target
  if($actual.Count -ne $entry.Inventory.Count -or $actual.Bytes -ne $entry.Inventory.Bytes) { throw 'Moved inventory differs.' }
  $manifest+="| $($entry.Source) | $($entry.Target) | $($actual.Count) | $($actual.Bytes) | $($entry.Reason) |"
}
[IO.File]::WriteAllLines((Join-Path $batch '待删除清单.md'),$manifest,[Text.UTF8Encoding]::new($false))
foreach($entry in $newPlan) {
  Move-Item -LiteralPath $entry.Source -Destination $entry.Target
  if(Test-Path -LiteralPath $entry.Source) { throw 'Staged source remains after move.' }
  $actual=Inventory $entry.Target
  if($actual.Count -ne $entry.Inventory.Count -or $actual.Bytes -ne $entry.Inventory.Bytes) { throw 'Promoted inventory differs.' }
}
Write-Output "PROMOTED $NewVersion"
Write-Output "OLD_ARTIFACTS $oldDirectory"