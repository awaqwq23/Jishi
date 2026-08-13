#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 3 ]]; then
  echo "Usage: sudo install-release.sh <latest.json> <windows.exe> <android.apk>" >&2
  exit 2
fi

manifest_source="$1"
windows_source="$2"
android_source="$3"
target="/var/www/jishi-downloads"

for source in "$manifest_source" "$windows_source" "$android_source"; do
  test -f "$source"
  test ! -L "$source"
done

mapfile -t release_names < <(node - "$manifest_source" "$windows_source" "$android_source" <<'NODE'
const { createHash } = require("node:crypto");
const { readFileSync } = require("node:fs");
const { basename } = require("node:path");
const [manifestPath, windowsPath, androidPath] = process.argv.slice(2);
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
if (manifest.schemaVersion !== 1 || !manifest.clients?.windows || !manifest.clients?.android) throw new Error("Invalid update manifest");
for (const [platform, filePath] of [["windows", windowsPath], ["android", androidPath]]) {
  const release = manifest.clients[platform];
  const expectedName = basename(new URL(release.downloadUrl).pathname);
  const actualName = basename(filePath);
  if (expectedName !== actualName || !/^Jishi-(Windows-Setup|Android)-[0-9]+(?:\.[0-9]+){2}\.(exe|apk)$/.test(actualName)) throw new Error(`${platform} filename mismatch`);
  const digest = createHash("sha256").update(readFileSync(filePath)).digest("hex").toUpperCase();
  if (digest !== String(release.sha256).toUpperCase()) throw new Error(`${platform} SHA-256 mismatch`);
  console.log(actualName);
}
NODE
)

[[ ${#release_names[@]} -eq 2 ]]
install -d -o awaqwq233 -g awaqwq233 -m 0755 "$target"
install -o awaqwq233 -g awaqwq233 -m 0644 "$windows_source" "$target/${release_names[0]}"
install -o awaqwq233 -g awaqwq233 -m 0644 "$android_source" "$target/${release_names[1]}"
install -o awaqwq233 -g awaqwq233 -m 0644 "$manifest_source" "$target/.latest.json.new"
mv -f "$target/.latest.json.new" "$target/latest.json"
echo "Published ${release_names[0]} and ${release_names[1]}"
