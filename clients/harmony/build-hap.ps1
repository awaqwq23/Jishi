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
  throw 'hvigorw was not found. Install DevEco Studio or Command Line Tools and the HarmonyOS API 12 SDK first.'
}

$hvigor = $hvigorCandidates[0]
& $hvigor --mode project -p product=default -p buildMode=debug assembleHap
if ($LASTEXITCODE -ne 0) {
  throw "HarmonyOS build failed with exit code $LASTEXITCODE"
}

$hap = Get-ChildItem -LiteralPath (Join-Path $projectRoot 'entry\build') -Filter '*.hap' -File -Recurse |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1
if (-not $hap) {
  throw 'The build finished without producing a .hap file.'
}

Write-Host "HAP created: $($hap.FullName)"
