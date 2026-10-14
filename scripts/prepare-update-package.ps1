param([string]$RuntimeDirectory = 'release/win-unpacked', [string]$OutputDirectory = 'test-results/update-assets')
$ErrorActionPreference = 'Stop'
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$runtime = [IO.Path]::GetFullPath((Join-Path $workspace $RuntimeDirectory))
$output = [IO.Path]::GetFullPath((Join-Path $workspace $OutputDirectory))
if (-not $runtime.StartsWith("$workspace\") -or -not $output.StartsWith("$workspace\")) { throw 'Paths must stay inside workspace.' }
$version = (Get-Content -LiteralPath (Join-Path $workspace 'package.json') -Raw | ConvertFrom-Json).version
$items = @(Get-ChildItem -LiteralPath $runtime -Recurse -Force)
if (@($items | Where-Object { ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $_.Name -match '\.(sqlite|db)(-|$)|^workspace-location\.json$' }).Count) { throw 'Runtime contains non-program files or links.' }
New-Item -ItemType Directory -Path $output -Force | Out-Null
$packageName = "PhD-Research-Workbench-$version-Update.zip"
$packagePath = Join-Path $output $packageName
if (-not (Test-Path -LiteralPath $packagePath)) { Compress-Archive -Path (Join-Path $runtime '*') -DestinationPath $packagePath -CompressionLevel Optimal }
$installerName = "PhD-Research-Workbench-$version-Setup.exe"
$installer = Join-Path (Split-Path -Parent $runtime) $installerName
$releaseRoot = "https://github.com/Lzy-shulab/Phd-Research-Table/releases"
$manifest = @{
  tag_name = "v$version"; name = "PhD Research Workbench $version"; html_url = "$releaseRoot/tag/v$version"
  published_at = [DateTime]::UtcNow.ToString('o'); draft = $false; prerelease = $false
  assets = @(
    @{ name = $installerName; size = (Get-Item -LiteralPath $installer).Length; browser_download_url = "$releaseRoot/download/v$version/$installerName" },
    @{ name = $packageName; size = (Get-Item -LiteralPath $packagePath).Length; browser_download_url = "$releaseRoot/download/v$version/$packageName" }
  )
}
[IO.File]::WriteAllText((Join-Path $output 'latest-update.json'), ($manifest | ConvertTo-Json -Depth 5), [Text.UTF8Encoding]::new($false))
Write-Output "UPDATE_PACKAGE_READY $packagePath"
