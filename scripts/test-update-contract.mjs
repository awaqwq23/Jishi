import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFile(join(root, path), "utf8");
const [manifestText, windowsPackageText, androidPackageText, windowsMain, androidConfig, nginx, apiService, webService] = await Promise.all([
  read("clients/web/public/updates/latest.json"),
  read("clients/windows/package.json"),
  read("clients/android/package.json"),
  read("clients/windows/main.cjs"),
  read("clients/android/capacitor.config.ts"),
  read("server/deploy/native/nginx-jishi.conf"),
  read("server/deploy/native/jishi-api.service"),
  read("server/deploy/native/jishi-web.service"),
]);
const manifest = JSON.parse(manifestText);
const versions = {
  windows: JSON.parse(windowsPackageText).version,
  android: JSON.parse(androidPackageText).version,
};

assert.equal(manifest.schemaVersion, 1);
assert.match(manifest.releaseId, /^web-[a-f0-9]{16}$/);
assert.match(manifest.webBuild, /^[A-Fa-f0-9]{64}$/);
assert.ok(Array.isArray(manifest.notes) && manifest.notes.length > 0);

const textExtensions = new Set([".css", ".js", ".json", ".svg", ".ts", ".tsx", ".webmanifest"]);
const webRoot = join(root, "clients/web");
const webFiles = [];
async function walkWeb(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) await walkWeb(fullPath);
    else if (entry.isFile() && relative(webRoot, fullPath).replaceAll("\\", "/") !== "public/updates/latest.json") webFiles.push(fullPath);
  }
}
await walkWeb(join(webRoot, "app"));
await walkWeb(join(webRoot, "public"));
for (const name of ["package.json", "package-lock.json", "vite.config.ts", "next.config.ts"]) webFiles.push(join(webRoot, name));
const webHash = createHash("sha256");
for (const file of webFiles.sort()) {
  webHash.update(relative(webRoot, file).replaceAll("\\", "/"));
  webHash.update("\0");
  const bytes = await readFile(file);
  webHash.update(textExtensions.has(extname(file).toLowerCase()) ? Buffer.from(bytes.toString("utf8").replace(/\r\n/g, "\n"), "utf8") : bytes);
  webHash.update("\0");
}
assert.equal(manifest.webBuild, webHash.digest("hex"));
assert.equal(manifest.releaseId, `web-${manifest.webBuild.slice(0, 16)}`);

for (const platform of ["windows", "android"]) {
  const release = manifest.clients[platform];
  assert.equal(release.version, versions[platform]);
  const expectedName = platform === "windows" ? `Jishi-Windows-Setup-${release.version}.exe` : `Jishi-Android-${release.version}.apk`;
  assert.equal(new URL(release.downloadUrl).pathname.split("/").at(-1), expectedName);
  const artifact = await readFile(join(root, expectedName));
  assert.equal(release.size, (await stat(join(root, expectedName))).size);
  assert.equal(release.sha256, createHash("sha256").update(artifact).digest("hex").toUpperCase());
}

assert.match(windowsMain, /JishiWindows\/\$\{app\.getVersion\(\)\}/);
assert.match(androidConfig, /JishiAndroid\/\$\{appVersion\}/);
assert.match(nginx, /location = \/updates\/latest\.json/);
assert.match(nginx, /location \/downloads\//);
assert.match(apiService, /ExecStartPre=\/opt\/jishi\/node_modules\/\.bin\/wrangler /);
assert.match(apiService, /ExecStart=\/opt\/jishi\/node_modules\/\.bin\/wrangler /);
assert.doesNotMatch(apiService, /\/server\/node_modules\/\.bin\/wrangler/);
assert.match(webService, /ExecStart=\/opt\/jishi\/node_modules\/\.bin\/vinext /);
assert.doesNotMatch(webService, /\/clients\/web\/node_modules\/\.bin\/vinext/);
assert.match(webService, /ExecStartPost=.*mark-deployment\.sh/);
console.log("Update manifest, artifacts, client markers, and host configuration are consistent.");
