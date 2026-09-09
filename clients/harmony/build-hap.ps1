param(
  [string]$HvigorPath = $env:JISHI_HVIGOR_PATH,
  [string]$SdkHome = $env:DEVECO_SDK_HOME,
  [ValidateSet('debug', 'release')][string]$BuildMode = 'debug',
  [ValidateSet('hap', 'app')][string]$Artifact = 'hap'
)
$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent (Split-Path -Parent $projectRoot)

$hvigorCandidates = @(
  $HvigorPath,
  (Join-Path $projectRoot 'hvigorw.bat'),
  (Join-Path $repoRoot 'work/harmony-tools/node_modules/@ohos/hvigor/bin/hvigor.js'),
  (Get-Command hvigorw.bat -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -ErrorAction SilentlyContinue),
  (Get-Command hvigorw -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -ErrorAction SilentlyContinue)
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }

if ($hvigorCandidates.Count -eq 0) {
  throw 'hvigorw was not found. Install DevEco Studio or Command Line Tools and the HarmonyOS API 12 SDK first.'
}

$hvigor = (Resolve-Path -LiteralPath @($hvigorCandidates)[0]).Path
if (!$SdkHome -or !(Test-Path -LiteralPath (Join-Path $SdkHome 'default/sdk-pkg.json'))) {
  throw 'Set DEVECO_SDK_HOME or -SdkHome to a complete HarmonyOS SDK directory.'
}
$env:DEVECO_SDK_HOME = (Resolve-Path -LiteralPath $SdkHome).Path
if (!$env:JAVA_HOME -or !(Test-Path -LiteralPath (Join-Path $env:JAVA_HOME 'bin/java.exe'))) {
  throw 'Set JAVA_HOME to the JDK supplied by DevEco Studio.'
}
# Hvigor rejects non-ASCII project paths. Copy only HarmonyOS project inputs.
$stage = Join-Path $env:TEMP ('jishi-harmony-' + [guid]::NewGuid().ToString('N'))
if ($stage -match '[^\x00-\x7F]') { throw 'TEMP must point to an ASCII-only directory.' }
New-Item -ItemType Directory -Path $stage | Out-Null
foreach ($name in @('AppScope','hvigor','build-profile.json5','oh-package.json5','hvigorfile.ts')) {
  Copy-Item -LiteralPath (Join-Path $projectRoot $name) -Destination $stage -Recurse
}
New-Item -ItemType Directory -Path (Join-Path $stage 'entry') | Out-Null
foreach ($name in @('src','build-profile.json5','oh-package.json5','hvigorfile.ts')) {
  Copy-Item -LiteralPath (Join-Path $projectRoot "entry/$name") -Destination (Join-Path $stage 'entry') -Recurse
}
if ($hvigor.EndsWith('.js')) {
  $env:NODE_PATH = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $hvigor)))
}
$arguments = if ($Artifact -eq 'hap') {
  @('--mode','module','-p','product=default','-p','module=entry@default','-p',"buildMode=$BuildMode",'assembleHap','--no-daemon')
} else {
  @('--mode','project','-p','product=default','-p',"buildMode=$BuildMode",'assembleApp','--no-daemon')
}
Push-Location -LiteralPath $stage
try {
  # Windows PowerShell treats native stderr warnings as errors when redirected.
  # Hvigor's exit code is the authoritative build result.
  $ErrorActionPreference = 'Continue'
  if ($hvigor.EndsWith('.js')) { & node $hvigor @arguments }
  else { & $hvigor @arguments }
  $ErrorActionPreference = 'Stop'
  if ($LASTEXITCODE -ne 0) { throw "HarmonyOS build failed. Stage: $stage" }
} finally { $ErrorActionPreference = 'Stop'; Pop-Location }

$outputs = @(Get-ChildItem -LiteralPath $stage -Filter "*.$Artifact" -File -Recurse |
  Where-Object { $_.FullName -match '[\\/]outputs[\\/]' })
if (!$outputs.Count) {
  throw "No .$Artifact artifact was generated. Stage: $stage"
}
$destination = Join-Path $repoRoot ('outputs/harmony/' + (Split-Path -Leaf $stage))
New-Item -ItemType Directory -Path $destination -Force | Out-Null
foreach ($output in $outputs) {
  $target = Join-Path $destination $output.Name
  Copy-Item -LiteralPath $output.FullName -Destination $target
  Get-FileHash -LiteralPath $target -Algorithm SHA256 | Select-Object Path,Hash
}
Write-Host "Build stage: $stage"
Write-Host 'Unsigned artifacts cannot be installed or submitted to AppGallery. Verify signing before release.'
