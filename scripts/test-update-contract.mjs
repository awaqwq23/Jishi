import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";

import { root, currentDirectory, previousDirectory, webBuildHash } from "./release-layout.mjs";
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
const githubTag = `clients-v${manifest.clients.windows.version}-a${manifest.clients.android.version}`;

assert.equal(manifest.schemaVersion, 1);
assert.match(manifest.releaseId, /^web-[a-f0-9]{16}$/);
assert.match(manifest.webBuild, /^[A-Fa-f0-9]{64}$/);
assert.ok(Array.isArray(manifest.notes) && manifest.notes.length > 0);

assert.equal(manifest.webBuild, await webBuildHash());
assert.equal(manifest.releaseId, `web-${manifest.webBuild.slice(0, 16)}`);

for (const platform of ["windows", "android"]) {
  const release = manifest.clients[platform];
  if (platform === 'android' && release.retained === true) {
    assert.equal(release.sourceVersion, versions.android);
    const priorManifest = JSON.parse(await readFile(join(previousDirectory, 'latest.json'), 'utf8'));
    assert.equal(release.version, priorManifest.clients.android.version);
    assert.equal(release.sha256, priorManifest.clients.android.sha256);
    assert.equal(release.size, priorManifest.clients.android.size);
  } else assert.equal(release.version, versions[platform]);
  const expectedName = platform === "windows" ? `Jishi-Windows-Setup-${release.version}.exe` : `Jishi-Android-${release.version}.apk`;
  assert.equal(new URL(release.downloadUrl).pathname.split("/").at(-1), expectedName);
  assert.equal(release.githubUrl, `https://github.com/awaqwq23/Jishi/releases/download/${githubTag}/${expectedName}`);
  const artifact = await readFile(join(currentDirectory, expectedName));
  assert.equal(release.size, (await stat(join(currentDirectory, expectedName))).size);
  assert.equal(release.sha256, createHash("sha256").update(artifact).digest("hex").toUpperCase());
}

assert.match(windowsMain, /JishiWindows\/\$\{app\.getVersion\(\)\}/);
assert.match(androidConfig, /JishiAndroid\/\$\{appVersion\}/);
assert.match(nginx, /location = \/updates\/latest\.json/);
assert.match(nginx, /location \/downloads\//);
assert.match(apiService, /ExecStartPre=\/opt\/jishi\/node_modules\/\.bin\/wrangler /);
assert.match(apiService, /ExecStart=\/opt\/jishi\/node_modules\/\.bin\/wrangler /);
assert.doesNotMatch(apiService, /\/server\/node_modules\/\.bin\/wrangler/);
assert.match(webService, /ExecStart=\/usr\/local\/bin\/node \/opt\/jishi\/clients\/web\/server\.mjs /);
assert.doesNotMatch(webService, /\/clients\/web\/node_modules\/\.bin\/vinext/);
assert.match(webService, /ExecStartPost=.*mark-deployment\.sh/);
console.log("Update manifest, artifacts, client markers, and host configuration are consistent.");

assert.deepEqual(JSON.parse(await readFile(join(currentDirectory,"latest.json"),"utf8")),manifest);
for(const directory of [currentDirectory,previousDirectory]) { for(const entry of await readdir(directory,{withFileTypes:true})) { assert.ok(!entry.isSymbolicLink(),"Release symlinks forbidden"); assert.ok(!entry.isDirectory(),"Release slots contain files only"); } }
