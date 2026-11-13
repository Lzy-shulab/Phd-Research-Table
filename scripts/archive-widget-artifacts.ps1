param([Parameter(Mandatory = $true)][string]$BatchName)
$ErrorActionPreference = 'Stop'
$widgetWorkspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\')
$widgetVersion = (Get-Content -LiteralPath (Join-Path $widgetWorkspace 'package.json') -Raw | ConvertFrom-Json).version
function CheckedWidgetPath([string]$relative) {
  $absolute = [IO.Path]::GetFullPath((Join-Path $widgetWorkspace $relative))
  if (-not $absolute.StartsWith("$widgetWorkspace\", [StringComparison]::OrdinalIgnoreCase)) { throw "Outside project: $absolute" }
  $cursor = $absolute
  while ($cursor.Length -ge $widgetWorkspace.Length) {
    if ((Test-Path -LiteralPath $cursor) -and (((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)) { throw "Reparse point: $cursor" }
    if ($cursor -eq $widgetWorkspace) { break }
    $cursor = Split-Path -Parent $cursor
  }
  return $absolute
}
function WidgetInventory([string]$path) {
  $item = Get-Item -LiteralPath $path -Force
  $items = if ($item.PSIsContainer) { @(Get-ChildItem -LiteralPath $path -Force -Recurse) } else { @($item) }
  if (@($items | Where-Object { ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 }).Count) { throw "Nested reparse point: $path" }
  $files = @($items | Where-Object { -not $_.PSIsContainer })
  return @{ Count = $files.Count; Bytes = [long]($files | Measure-Object Length -Sum).Sum }
}
$batch = CheckedWidgetPath "delete\$BatchName"
$manifest = Join-Path $batch '待删除清单.md'
if (-not (Test-Path -LiteralPath $manifest)) { throw 'Release promotion manifest is missing.' }
$entries = @(
  @{ Path = 'out'; Reason = '本轮可重新生成的构建输出，正式版已写入 release' },
  @{ Path = 'test-results'; Reason = '本轮隔离测试资料、截图、源码修改前副本和只读比对结果' },
  @{ Path = "release-stage-$widgetVersion"; Reason = '本轮候选程序和安装包，可重新生成' },
  @{ Path = "release-stage-$widgetVersion-final"; Reason = '本轮候选程序、安装包及打包临时文件，正式版已写入 release' },
  @{ Path = "release-stage-$widgetVersion-ready"; Reason = '本轮候选程序、安装包及打包临时文件，正式版已写入 release' },
  @{ Path = 'node_modules\.vite\vitest'; Reason = '本轮可重新生成的单元测试缓存' }
)
$plan = @()
foreach ($entry in $entries) {
  $source = CheckedWidgetPath $entry.Path
  $target = CheckedWidgetPath "delete\$BatchName\$($entry.Path)"
  if (-not (Test-Path -LiteralPath $source)) { continue }
  if (Test-Path -LiteralPath $target) { throw "Destination exists: $target" }
  $plan += @{ Source = $source; Target = $target; Reason = $entry.Reason; Inventory = (WidgetInventory $source) }
}
foreach ($entry in $plan) {
  New-Item -ItemType Directory -Path (Split-Path -Parent $entry.Target) -Force | Out-Null
  Move-Item -LiteralPath $entry.Source -Destination $entry.Target
  if (Test-Path -LiteralPath $entry.Source) { throw "Source remains: $($entry.Source)" }
  $after = WidgetInventory $entry.Target
  if ($after.Count -ne $entry.Inventory.Count -or $after.Bytes -ne $entry.Inventory.Bytes) { throw "Inventory changed: $($entry.Target)" }
  $line = "| $($entry.Source) | $($entry.Target) | $($after.Count) | $($after.Bytes) | $($entry.Reason)；$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz') |`n"
  [IO.File]::AppendAllText($manifest, $line, [Text.UTF8Encoding]::new($false))
  Write-Output "ARCHIVED $($entry.Source) FILES=$($after.Count) BYTES=$($after.Bytes)"
}
