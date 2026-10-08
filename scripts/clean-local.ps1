param([switch]$Apply)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path.TrimEnd('\')
if (((Get-Item -LiteralPath $root -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Workspace root may not be a reparse point' }
function Assert-SafeTree([string]$Path) {
  $full = [IO.Path]::GetFullPath($Path)
  if (!$full.StartsWith($root + '\', [StringComparison]::OrdinalIgnoreCase)) { throw "Outside workspace: $full" }
  $parts = $full.Substring($root.Length + 1).Split('\')
  $cursor = $root
  foreach ($part in $parts) {
    $cursor = Join-Path $cursor $part
    if ((Test-Path -LiteralPath $cursor) -and (((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)) { throw "Reparse point: $cursor" }
  }
  if ((Test-Path -LiteralPath $full -PathType Container) -and @(Get-ChildItem -LiteralPath $full -Recurse -Force | Where-Object { ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 }).Count) { throw "Nested reparse point: $full" }
  return $full
}
foreach ($slot in @('current','previous')) {
  $directory = Assert-SafeTree (Join-Path $root "releases/$slot")
  if (!(Test-Path -LiteralPath (Join-Path $directory 'SHA256SUMS'))) { throw "Missing verified release slot: $slot" }
  $sums = Get-Content -LiteralPath (Join-Path $directory 'SHA256SUMS')
  if (@($sums).Count -lt 2) { throw 'Each release slot requires verified Windows and Android artifacts' }
  foreach ($line in $sums) {
    if ($line -notmatch '^([A-Fa-f0-9]{64}) [*]?([A-Za-z0-9._-]+)$') { throw 'Invalid checksum entry' }
    $expected = $Matches[1]; $file = Assert-SafeTree (Join-Path $directory $Matches[2])
    if ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ne $expected) { throw "Release checksum mismatch: $file" }
  }
}
if (Test-Path -LiteralPath (Join-Path $root 'work/harmony-signing')) { throw 'Relocate signing identity before cleaning work' }
if (Test-Path -LiteralPath (Join-Path $root 'work/harmony-tools')) { throw 'Relocate reusable Harmony toolchain before cleaning work' }
if (!(Test-Path -LiteralPath (Join-Path $root 'docs/OPERATIONS.md')) -or !(Test-Path -LiteralPath (Join-Path $root 'docs/RELEASES.md'))) { throw 'Consolidated documentation required' }
$candidates = @('word','outputs','.tmp','clients/windows/dist','clients/web/.wrangler','clients/web/.next','clients/web/.vinext','clients/web/build','clients/web/examples','clients/web/worker','clients/web/.openai','server/migrations/meta','server/deploy/native/releases','clients/android/android/.gradle','clients/android/android/build','clients/android/android/app/build','clients/harmony/.hvigor','clients/harmony/build','clients/harmony/entry/build')
foreach ($relative in $candidates) {
  $target = Assert-SafeTree (Join-Path $root $relative)
  if (!(Test-Path -LiteralPath $target)) { continue }
  Write-Output "$($(if ($Apply) {'delete'} else {'candidate'}))=$target"
  if ($Apply) { Remove-Item -LiteralPath $target -Recurse -Force }
}
