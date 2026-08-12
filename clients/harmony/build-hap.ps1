$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $projectRoot

$hvigorCandidates = @(
  (Join-Path $projectRoot 'hvigorw.bat'),
  (Join-Path $projectRoot 'hvigorw'),
  (Get-Command hvigorw.bat -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -ErrorAction SilentlyContinue),
  (Get-Command hvigorw -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -ErrorAction SilentlyContinue)
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }

if ($hvigorCandidates.Count -eq 0) {
  throw '未找到 hvigorw。请先从华为开发者联盟安装最新版 DevEco Studio/Command Line Tools，并在 DevEco Studio 中首次打开本目录以下载 HarmonyOS API 12 SDK。'
}

$hvigor = $hvigorCandidates[0]
& $hvigor --mode project -p product=default -p buildMode=debug assembleHap
if ($LASTEXITCODE -ne 0) {
  throw "HarmonyOS 构建失败，退出码：$LASTEXITCODE"
}

$hap = Get-ChildItem -LiteralPath (Join-Path $projectRoot 'entry\build') -Filter '*.hap' -File -Recurse |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1
if (-not $hap) {
  throw '构建命令已结束，但没有找到 .hap 文件。'
}

Write-Host "HAP 已生成：$($hap.FullName)"
