#!/usr/bin/env bash
set -euo pipefail

web_root="${JISHI_WEB_ROOT:-/opt/jishi/clients/web}"
manifest_path="${JISHI_UPDATE_MANIFEST:-/var/www/jishi-downloads/latest.json}"

test -d "$web_root/app"
test -f "$manifest_path"
test ! -L "$manifest_path"

node - "$web_root" "$manifest_path" <<'NODE'
const { createHash } = require("node:crypto");
const { readdirSync, readFileSync, renameSync, statSync, writeFileSync } = require("node:fs");
const { extname, join, relative } = require("node:path");

const [webRoot, manifestPath] = process.argv.slice(2);
const hash = createHash("sha256");
const files = [];
const textExtensions = new Set([".css", ".js", ".json", ".svg", ".ts", ".tsx", ".webmanifest"]);

function stableWebBytes(path, bytes) {
  return textExtensions.has(extname(path).toLowerCase())
    ? Buffer.from(bytes.toString("utf8").replace(/\r\n/g, "\n"), "utf8")
    : bytes;
}

function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) walk(fullPath);
    else if (entry.isFile() && relative(webRoot, fullPath).replaceAll("\\", "/") !== "public/updates/latest.json") files.push(fullPath);
  }
}

walk(join(webRoot, "app"));
walk(join(webRoot, "public"));
for (const name of ["package.json", "package-lock.json", "vite.config.ts", "next.config.ts"]) {
  const fullPath = join(webRoot, name);
  if (statSync(fullPath).isFile()) files.push(fullPath);
}
files.sort();
for (const file of files) {
  hash.update(relative(webRoot, file).replaceAll("\\", "/"));
  hash.update("\0");
  const bytes = readFileSync(file);
  hash.update(stableWebBytes(file, bytes));
  hash.update("\0");
}

const webBuild = hash.digest("hex");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
if (manifest.webBuild === webBuild) process.exit(0);
manifest.webBuild = webBuild;
manifest.releaseId = `web-${webBuild.slice(0, 16)}`;
manifest.publishedAt = new Date().toISOString();
const temporary = `${manifestPath}.tmp`;
writeFileSync(temporary, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 });
renameSync(temporary, manifestPath);
NODE
