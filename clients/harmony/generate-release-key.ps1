param(
  [string]$OutputDirectory,
  [string]$KeyAlias = 'jishi-harmony-release'
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent (Split-Path -Parent $projectRoot)
if (!$OutputDirectory) { $OutputDirectory = Join-Path $repoRoot 'work/harmony-signing' }
$OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)

$keytoolCandidates = @(
  $(if ($env:JAVA_HOME) { Join-Path $env:JAVA_HOME 'bin/keytool.exe' }),
  'C:\Program Files\Huawei\DevEco Studio\jbr\bin\keytool.exe',
  (Get-Command keytool.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -ErrorAction SilentlyContinue)
) | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) }
if (!$keytoolCandidates.Count) { throw 'keytool.exe was not found. Install DevEco Studio JBR or set JAVA_HOME.' }
$keytool = (Resolve-Path -LiteralPath @($keytoolCandidates)[0]).Path

New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$outputItem = Get-Item -LiteralPath $OutputDirectory
if (($outputItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
  throw 'Refusing to write signing keys through a reparse point.'
}
$keystore = Join-Path $OutputDirectory 'jishi-harmony-release.p12'
$csr = Join-Path $OutputDirectory 'jishi-harmony-release.csr'
if ((Test-Path -LiteralPath $keystore) -or (Test-Path -LiteralPath $csr)) {
  throw "Signing files already exist in $OutputDirectory. Move or back them up explicitly before creating a new release identity."
}

Write-Host 'This creates the HarmonyOS release private key locally.' -ForegroundColor Cyan
Write-Host 'Choose a strong password and keep it offline. Do not paste it into chat, Git, or AppGallery metadata.' -ForegroundColor Yellow
Write-Host 'When keytool asks for certificate identity fields, enter the developer account holder or organization details used for this release.'
Write-Host ''
& $keytool -genkeypair -alias $KeyAlias -keyalg EC -groupname secp256r1 -sigalg SHA256withECDSA `
  -validity 3650 -storetype PKCS12 -keystore $keystore
if ($LASTEXITCODE -ne 0) { throw 'Release key generation failed.' }

Write-Host ''
Write-Host 'Enter the same keystore password again to generate the CSR.' -ForegroundColor Cyan
& $keytool -certreq -alias $KeyAlias -sigalg SHA256withECDSA -storetype PKCS12 `
  -keystore $keystore -file $csr
if ($LASTEXITCODE -ne 0) { throw 'CSR generation failed.' }

Write-Host ''
Write-Host 'Release key and CSR created:' -ForegroundColor Green
Write-Host $keystore
Write-Host $csr
Write-Host 'Back up the P12 and password securely. Upload only the CSR when requesting the AppGallery release certificate.' -ForegroundColor Yellow
