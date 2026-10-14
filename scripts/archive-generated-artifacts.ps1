param(
  [Parameter(Mandatory = $true)][ValidatePattern('^\d+\.\d+\.\d+$')][string]$Version,
  [Parameter(Mandatory = $true)][string]$BatchName
)
$ErrorActionPreference = 'Stop'
$archiveWorkspace = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\')
$archivePrefix = "$archiveWorkspace\"
function Assert-ArchivePath([string]$Path) {
  $full = [System.IO.Path]::GetFullPath($Path)
  if (-not $full.StartsWith($archivePrefix, [System.StringComparison]::OrdinalIgnoreCase)) { throw "Path outside workspace: $full" }
  $cursor = $full
  while ($cursor.Length -ge $archiveWorkspace.Length) {
    if (Test-Path -LiteralPath $cursor) {
      $item = Get-Item -LiteralPath $cursor -Force
      if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Reparse point: $cursor" }
    }
    if ($cursor -eq $archiveWorkspace) { break }
    $cursor = Split-Path -Parent $cursor
  }
  return $full
}
function Archive-Inventory([string]$Path) {
  $item = Get-Item -LiteralPath $Path -Force
  if (-not $item.PSIsContainer) { return @{ Count = 1; Bytes = [long]$item.Length } }
  $items = @(Get-ChildItem -LiteralPath $Path -Recurse -Force -ErrorAction Stop)
  if (@($items | Where-Object { ($_.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0 }).Count) { throw "Nested reparse point: $Path" }
  $files = @($items | Where-Object { -not $_.PSIsContainer })
  return @{ Count = $files.Count; Bytes = [long](($files | Measure-Object -Property Length -Sum).Sum) }
}
$archiveBatch = Assert-ArchivePath (Join-Path $archiveWorkspace "delete\$BatchName")
if (-not $archiveBatch.StartsWith("$archiveWorkspace\delete\", [System.StringComparison]::OrdinalIgnoreCase)) { throw 'Batch must stay inside delete.' }
if (-not (Test-Path -LiteralPath $archiveBatch)) { throw 'Promote the release and create its manifest before archiving generated outputs.' }
$archiveEntries = @(
  @{ Relative = 'out'; Reason = '本轮可重新构建的程序输出，正式程序已写入 release' },
  @{ Relative = 'test-results'; Reason = '隔离测试数据、截图与只读验收记录；不含正式工作台数据' },
  @{ Relative = 'node_modules\.vite\vitest'; Reason = '本轮单元测试结果缓存，可重新生成' },
  @{ Relative = "release-stage-$Version"; Reason = '正式产物移入 release 后剩余的临时打包文件' }
  @{ Relative = "release-stage-$Version-final"; Reason = '正式产物移入 release 后剩余的最终打包文件' }
  @{ Relative = "release-stage-$Version-updater-fixed"; Reason = '正式产物移入 release 后剩余的更新流程打包文件' }
  @{ Relative = "release-stage-$Version-ready"; Reason = '正式产物移入 release 后剩余的最终更新流程打包文件' }
  @{ Relative = "release-stage-$Version-before-scroll-fix"; Reason = '拖选自动滚动修正前的临时程序和安装包，正式版已替换' }
  @{ Relative = '验收记录'; Reason = '本轮可重新生成的验收材料' }
  @{ Relative = 'src\renderer\styles\sky.css'; Reason = '用户要求移除的晴空主题样式，已从构建中移除' }
  @{ Relative = 'src\renderer\assets\sky'; Reason = '已移除主题的程序插画资源，不含用户上传背景' }
  @{ Relative = 'src\renderer\styles\wilds.css'; Reason = '用户要求移除的旷野遗迹主题样式，已从构建中移除' }
  @{ Relative = 'src\renderer\styles\visual-styles.css'; Reason = '工作台风格选择卡片与多主题预览样式，已从构建中移除' }
  @{ Relative = 'src\renderer\assets\wilds'; Reason = '已移除旷野遗迹主题的程序字体与插画资源，不含用户数据' }
  @{ Relative = 'src\renderer\components\layout\WildsOrnaments.tsx'; Reason = '已移除旷野遗迹主题的装饰组件' }
  @{ Relative = 'src\shared\visual-styles.ts'; Reason = '已移除多主题调色板与主题选项定义' }
  @{ Relative = 'scripts\wilds-theme-smoke.mjs'; Reason = '只适用于已移除旷野遗迹主题的旧回归脚本' }
)
$archivePlan = @()
foreach ($entry in $archiveEntries) {
  $source = Assert-ArchivePath (Join-Path $archiveWorkspace $entry.Relative)
  $target = Assert-ArchivePath (Join-Path $archiveBatch $entry.Relative)
  if (-not (Test-Path -LiteralPath $source)) { continue }
  if (Test-Path -LiteralPath $target) { throw "Archive target exists: $target" }
  $inventory = Archive-Inventory $source
  $archivePlan += @{ Source = $source; Target = $target; Count = $inventory.Count; Bytes = $inventory.Bytes; Reason = $entry.Reason }
}
$archiveTime = Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz'
$archiveRows = @('', "## 本轮生成文件（$archiveTime）", '', '| 原路径 | 现路径 | 文件数 | 总字节数 | 归类理由 |', '|---|---|---:|---:|---|')
foreach ($entry in $archivePlan) {
  New-Item -ItemType Directory -Path (Split-Path -Parent $entry.Target) -Force | Out-Null
  Move-Item -LiteralPath $entry.Source -Destination $entry.Target
  if (Test-Path -LiteralPath $entry.Source) { throw "Source still exists: $($entry.Source)" }
  $actual = Archive-Inventory $entry.Target
  if ($actual.Count -ne $entry.Count -or $actual.Bytes -ne $entry.Bytes) { throw "Inventory changed: $($entry.Target)" }
  $archiveRows += "| $($entry.Source) | $($entry.Target) | $($entry.Count) | $($entry.Bytes) | $($entry.Reason) |"
  [System.IO.File]::AppendAllText((Join-Path $archiveBatch '待删除清单.md'), ($archiveRows -join "`n") + "`n", [System.Text.UTF8Encoding]::new($false))
  $archiveRows = @()
  Write-Output "ARCHIVED $($entry.Source) -> $($entry.Target) FILES=$($entry.Count) BYTES=$($entry.Bytes)"
}
