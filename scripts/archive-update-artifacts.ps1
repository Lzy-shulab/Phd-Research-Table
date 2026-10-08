param(
  [Parameter(Mandatory = $true)][string]$BatchName,
  [Parameter(Mandatory = $true)][string[]]$Paths
)

$ErrorActionPreference = 'Stop'
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\')
function Assert-WorkspacePath([string]$Path) {
  $full = [IO.Path]::GetFullPath($Path)
  if (-not $full.StartsWith("$workspace\", [StringComparison]::OrdinalIgnoreCase)) { throw "Outside workspace: $full" }
  $cursor = $full
  while ($cursor.Length -ge $workspace.Length) {
    if (Test-Path -LiteralPath $cursor) {
      if (((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Reparse point: $cursor" }
    }
    if ($cursor -eq $workspace) { break }
    $cursor = Split-Path -Parent $cursor
  }
  return $full
}
function Inventory([string]$Path) {
  $items = @(Get-ChildItem -LiteralPath $Path -Force -Recurse)
  if (@($items | Where-Object { ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 }).Count) { throw "Nested reparse point: $Path" }
  $files = @($items | Where-Object { -not $_.PSIsContainer })
  return @{ Count = $files.Count; Bytes = [long]($files | Measure-Object Length -Sum).Sum }
}
$batch = Assert-WorkspacePath (Join-Path $workspace "delete\$BatchName")
$manifest = Assert-WorkspacePath (Join-Path $batch '待删除清单.md')
if (-not (Test-Path -LiteralPath $manifest)) { throw 'Promote the release and create its manifest first.' }
$entries = @()
foreach ($relative in $Paths) {
  $reason = switch -Regex ($relative) {
    '^out$' { '可重新生成的编译输出'; break }
    '^test-results$' { '隔离测试样例、缓存与截图'; break }
    '^验收记录$' { '验收截图、只读数据摘要与检查记录'; break }
    '^(release|build)-stage-v?[0-9.]+$' { '已完成正式版写入后的打包暂存残留'; break }
    default { throw "Not an approved generated artifact directory: $relative" }
  }
  $source = Assert-WorkspacePath (Join-Path $workspace $relative)
  $target = Assert-WorkspacePath (Join-Path $batch $relative)
  if (-not (Test-Path -LiteralPath $source -PathType Container)) { throw "Missing source directory: $source" }
  if (Test-Path -LiteralPath $target) { throw "Archive target already exists: $target" }
  $entries += @{ Source = $source; Target = $target; Reason = $reason; Inventory = (Inventory $source) }
}
foreach ($entry in $entries) {
  $movedAt = Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz'
  Move-Item -LiteralPath $entry.Source -Destination $entry.Target
  if (Test-Path -LiteralPath $entry.Source) { throw "Source remains after move: $($entry.Source)" }
  $actual = Inventory $entry.Target
  if ($actual.Count -ne $entry.Inventory.Count -or $actual.Bytes -ne $entry.Inventory.Bytes) { throw "Inventory changed: $($entry.Target)" }
  $line = "| $($entry.Source) | $($entry.Target) | $($actual.Count) | $($actual.Bytes) | $($entry.Reason)；移动时间 $movedAt |"
  [IO.File]::AppendAllText($manifest, "$line`n", [Text.UTF8Encoding]::new($false))
  Write-Output "ARCHIVED $($entry.Source) -> $($entry.Target): $($actual.Count) files, $($actual.Bytes) bytes"
}
