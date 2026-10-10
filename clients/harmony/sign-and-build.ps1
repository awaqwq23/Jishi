param(
  [string]$SdkHome = 'C:\Users\Administrator\AppData\Local\Jishi\toolchains\deveco26\command-line-tools\sdk',
  [string]$JavaHome = 'C:\Program Files\Java\jdk-21.0.11'
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent (Split-Path -Parent $projectRoot)
$signingRoot = Join-Path $repoRoot '.local/signing/harmony'
$env:JAVA_HOME = $JavaHome
$bundledNode = Join-Path (Split-Path -Parent $SdkHome) 'tool/node'
if (Test-Path -LiteralPath (Join-Path $bundledNode 'node.exe')) { $env:PATH = $bundledNode + ';' + $env:PATH }
& node (Join-Path $repoRoot 'scripts/check-harmony-profile.mjs') --profile (Join-Path $signingRoot 'jishi-harmony-reminder-candidate.p7b')
if ($LASTEXITCODE -ne 0) { throw 'The approved release Profile is required.' }
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
$tempRoot = (Resolve-Path -LiteralPath $env:TEMP).Path.TrimEnd('\')
$stage = Join-Path $tempRoot ('jishi-signing-' + [guid]::NewGuid().ToString('N'))
if ($stage -match '[^\x00-\x7F]') { throw 'An ASCII TEMP directory is required.' }
try {
  if ($dialog.ShowDialog() -ne [Windows.Forms.DialogResult]::OK) { throw 'Signing cancelled.' }
  if (!$inputBox.Text) { throw 'No password entered.' }
  New-Item -ItemType Directory -Path $stage | Out-Null
  $env:JISHI_LOCAL_SIGNING_PASSWORD = $inputBox.Text
  $inputBox.Text = ''; $dialog.Dispose()
  try {
    & node (Join-Path $repoRoot 'scripts/prepare-harmony-signing.mjs') $stage $signingRoot (Join-Path $projectRoot 'build-profile.json5') $JavaHome
    if ($LASTEXITCODE -ne 0) { throw 'Unable to prepare signing configuration. Check the local password.' }
  } finally { Remove-Item Env:JISHI_LOCAL_SIGNING_PASSWORD -ErrorAction SilentlyContinue }
  & (Join-Path $projectRoot 'build-hap.ps1') -BuildMode release -Artifact app -SdkHome $SdkHome -SigningProfilePath (Join-Path $stage 'signing.json5')
} finally {
  $dialog.Dispose()
  Remove-Item Env:JISHI_LOCAL_SIGNING_PASSWORD -ErrorAction SilentlyContinue
  if (Test-Path -LiteralPath $stage -PathType Container) {
    $actual = (Resolve-Path -LiteralPath $stage).Path
    if (!$actual.StartsWith($tempRoot + '\', [StringComparison]::OrdinalIgnoreCase) -or
        (Get-Item -LiteralPath $actual).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Unsafe signing cleanup target' }
    Remove-Item -LiteralPath $actual -Recurse -Force
  }
}
