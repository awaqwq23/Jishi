param(
  [string]$HvigorPath = $env:JISHI_HVIGOR_PATH,
  [string]$SdkHome = $env:DEVECO_SDK_HOME,
  [string]$SigningProfilePath,
  [ValidateSet('debug', 'release')][string]$BuildMode = 'debug',
  [ValidateSet('hap', 'app')][string]$Artifact = 'hap'
)
$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent (Split-Path -Parent $projectRoot)
$localSigningProfile = Join-Path $projectRoot 'signing.local.json5'
if (!$SigningProfilePath -and (Test-Path -LiteralPath $localSigningProfile -PathType Leaf)) {
  $SigningProfilePath = $localSigningProfile
}
if ($BuildMode -eq 'release' -and !$SigningProfilePath) {
  throw 'Release builds require an external signing profile. Configure release signing in DevEco Studio, then save the generated build-profile.json5 as clients/harmony/signing.local.json5 (Git ignored).'
}
if ($SigningProfilePath) {
  if (!(Test-Path -LiteralPath $SigningProfilePath -PathType Leaf)) { throw 'Signing profile file was not found.' }
  $SigningProfilePath = (Resolve-Path -LiteralPath $SigningProfilePath).Path
  $repoAbsolute = (Resolve-Path -LiteralPath $repoRoot).Path.TrimEnd('\')
  if ($SigningProfilePath.StartsWith($repoAbsolute + '\', [StringComparison]::OrdinalIgnoreCase) -and
      ![string]::Equals($SigningProfilePath, $localSigningProfile, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'A signing profile inside the repository must be clients/harmony/signing.local.json5 (Git ignored).'
  }
}

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
$tempAbsolute = (Resolve-Path -LiteralPath $env:TEMP).Path.TrimEnd('\')
if (!$stage.StartsWith($tempAbsolute + '\', [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Build stage must stay inside the resolved TEMP directory.'
}
New-Item -ItemType Directory -Path $stage | Out-Null
try {
  foreach ($name in @('AppScope','hvigor','build-profile.json5','oh-package.json5','hvigorfile.ts')) {
    Copy-Item -LiteralPath (Join-Path $projectRoot $name) -Destination $stage -Recurse
  }
  if ($SigningProfilePath) {
    Copy-Item -LiteralPath $SigningProfilePath -Destination (Join-Path $stage 'build-profile.json5') -Force
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
  if (!$outputs.Count) { throw "No .$Artifact artifact was generated. Stage: $stage" }

  if ($BuildMode -eq 'release') {
    $signTool = Join-Path $env:DEVECO_SDK_HOME 'default/openharmony/toolchains/lib/hap-sign-tool.jar'
    if (!(Test-Path -LiteralPath $signTool -PathType Leaf)) { throw 'HarmonyOS SDK HAP signature verifier was not found.' }
    foreach ($output in $outputs) {
      if ($output.Name -match 'unsigned') { throw 'Release artifact is unsigned; no package was delivered.' }
      $hapToVerify = $output.FullName
      if ($Artifact -eq 'app') {
        $archive = [System.IO.Compression.ZipFile]::OpenRead($output.FullName)
        try {
          $hapEntries = @($archive.Entries | Where-Object { $_.FullName -match '\.hap$' })
          if (!$hapEntries.Count) { throw 'Release APP contains no HAP to verify.' }
          foreach ($hapEntry in $hapEntries) {
            $hapToVerify = Join-Path $stage ('verify-' + [guid]::NewGuid().ToString('N') + '.hap')
            [System.IO.Compression.ZipFileExtensions]::ExtractToFile($hapEntry, $hapToVerify)
            $verified = & (Join-Path $env:JAVA_HOME 'bin/java.exe') -jar $signTool verify-app -inFile $hapToVerify -outCertChain (Join-Path $stage 'verified-cert.cer') -outProfile (Join-Path $stage 'verified-profile.p7b') 2>&1
            if ($LASTEXITCODE -ne 0) { throw 'Release APP contains an HAP without a valid signature; no package was delivered.' }
          }
        } finally { $archive.Dispose() }
      } else {
        $verified = & (Join-Path $env:JAVA_HOME 'bin/java.exe') -jar $signTool verify-app -inFile $hapToVerify -outCertChain (Join-Path $stage 'verified-cert.cer') -outProfile (Join-Path $stage 'verified-profile.p7b') 2>&1
        if ($LASTEXITCODE -ne 0) { throw 'Release HAP signature verification failed; no package was delivered.' }
      }
    }
  }

  $destination = Join-Path $repoRoot ('outputs/harmony/' + (Split-Path -Leaf $stage))
  New-Item -ItemType Directory -Path $destination -Force | Out-Null
  foreach ($output in $outputs) {
    $target = Join-Path $destination $output.Name
    Copy-Item -LiteralPath $output.FullName -Destination $target
    Get-FileHash -LiteralPath $target -Algorithm SHA256 | Select-Object Path,Hash
  }
  if ($BuildMode -eq 'release') { Write-Host 'Release package HAP signature verified. AppGallery review and real-device checks are still required.' }
  else { Write-Host "Build stage: $stage"; Write-Host 'Debug artifacts may be unsigned. They cannot be submitted to AppGallery.' }
} finally {
  # A staged release profile can contain encrypted signing credentials. Never retain it in TEMP.
  if ($SigningProfilePath -and (Test-Path -LiteralPath $stage -PathType Container)) {
    $resolvedStage = (Resolve-Path -LiteralPath $stage).Path
    if ($resolvedStage.StartsWith($tempAbsolute + '\', [StringComparison]::OrdinalIgnoreCase) -and
        (((Get-Item -LiteralPath $resolvedStage).Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0)) {
      Remove-Item -LiteralPath $resolvedStage -Recurse -Force
    }
  }
}
