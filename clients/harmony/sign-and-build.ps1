param(
  [string]$SdkHome = 'C:\Users\Administrator\AppData\Local\Jishi\toolchains\deveco26\command-line-tools\sdk',
  [string]$JavaHome = 'C:\Program Files\Java\jdk-21.0.11',
  [string]$SigningRoot,
  [string]$ProtectedPasswordFile
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent (Split-Path -Parent $projectRoot)
if (!$SigningRoot) { $SigningRoot = Join-Path $repoRoot '.local/signing/harmony' }
$signingRoot = (Resolve-Path -LiteralPath $SigningRoot).Path
$env:JAVA_HOME = $JavaHome
$bundledNode = Join-Path (Split-Path -Parent $SdkHome) 'tool/node'
if (Test-Path -LiteralPath (Join-Path $bundledNode 'node.exe')) { $env:PATH = $bundledNode + ';' + $env:PATH }
& node (Join-Path $repoRoot 'scripts/check-harmony-profile.mjs') $signingRoot --profile (Join-Path $signingRoot 'jishi-harmony-reminder-candidate.p7b')
if ($LASTEXITCODE -ne 0) { throw 'The approved release Profile is required.' }
$dialog = $null
if (!$ProtectedPasswordFile) {
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object Windows.Forms.Form
$dialog.Text = '记时鸿蒙发布签名'
$dialog.Width = 510; $dialog.Height = 220; $dialog.StartPosition = 'CenterScreen'
$label = New-Object Windows.Forms.Label
$label.Text = '请输入既有鸿蒙发布 P12 的密码。仅用于本次本机签名，不发送到聊天。'
$label.SetBounds(20,20,460,45)
$inputBox = New-Object Windows.Forms.TextBox
$inputBox.UseSystemPasswordChar = $true; $inputBox.SetBounds(20,75,460,25)
$confirm = New-Object Windows.Forms.Button
$confirm.Text = '签名并构建'; $confirm.SetBounds(340,120,140,30)
$confirm.DialogResult = [Windows.Forms.DialogResult]::OK
$dialog.Controls.AddRange(@($label,$inputBox,$confirm)); $dialog.AcceptButton = $confirm
}
$tempRoot = (Resolve-Path -LiteralPath $env:TEMP).Path.TrimEnd('\')
$stage = Join-Path $tempRoot ('jishi-signing-' + [guid]::NewGuid().ToString('N'))
if ($stage -match '[^\x00-\x7F]') { throw 'An ASCII TEMP directory is required.' }
try {
  if ($ProtectedPasswordFile) {
    Add-Type -AssemblyName System.Security
    $passwordPath = (Resolve-Path -LiteralPath $ProtectedPasswordFile).Path
    if (!$passwordPath.StartsWith($signingRoot + '\', [StringComparison]::OrdinalIgnoreCase) -or
        (Get-Item -LiteralPath $passwordPath).Attributes -band [IO.FileAttributes]::ReparsePoint) {
      throw 'The protected password must belong to the selected signing directory.'
    }
    $plainBytes = [Security.Cryptography.ProtectedData]::Unprotect(
      [IO.File]::ReadAllBytes($passwordPath), $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
    try { $env:JISHI_LOCAL_SIGNING_PASSWORD = [Text.Encoding]::UTF8.GetString($plainBytes) }
    finally { [Array]::Clear($plainBytes, 0, $plainBytes.Length) }
  } else {
    if ($dialog.ShowDialog() -ne [Windows.Forms.DialogResult]::OK) { throw 'Signing cancelled.' }
    if (!$inputBox.Text) { throw 'No password entered.' }
    $env:JISHI_LOCAL_SIGNING_PASSWORD = $inputBox.Text
    $inputBox.Text = ''; $dialog.Dispose()
  }
  New-Item -ItemType Directory -Path $stage | Out-Null
  try {
    & node (Join-Path $repoRoot 'scripts/prepare-harmony-signing.mjs') $stage $signingRoot (Join-Path $projectRoot 'build-profile.json5') $JavaHome
    if ($LASTEXITCODE -ne 0) { throw 'Unable to prepare signing configuration. Check the local password.' }
  } finally { Remove-Item Env:JISHI_LOCAL_SIGNING_PASSWORD -ErrorAction SilentlyContinue }
  & (Join-Path $projectRoot 'build-hap.ps1') -BuildMode release -Artifact app -SdkHome $SdkHome -SigningProfilePath (Join-Path $stage 'signing.json5')
} finally {
  if ($dialog) { $dialog.Dispose() }
  Remove-Item Env:JISHI_LOCAL_SIGNING_PASSWORD -ErrorAction SilentlyContinue
  if (Test-Path -LiteralPath $stage -PathType Container) {
    $actual = (Resolve-Path -LiteralPath $stage).Path
    if (!$actual.StartsWith($tempRoot + '\', [StringComparison]::OrdinalIgnoreCase) -or
        (Get-Item -LiteralPath $actual).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Unsafe signing cleanup target' }
    Remove-Item -LiteralPath $actual -Recurse -Force
  }
}
