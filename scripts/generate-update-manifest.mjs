import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { basename, join, relative } from "node:path";

import { root, currentDirectory, webBuildHash } from "./release-layout.mjs";
const publicUrl = (process.env.JISHI_PUBLIC_URL || "https://awaqwq233.com/note").replace(/\/$/, "");
const githubRepo = "awaqwq23/Jishi";
const required = process.env.JISHI_UPDATE_REQUIRED !== "false";
const notesArgument = process.argv.find((argument) => argument.startsWith("--notes="))?.slice(8);
const notes = (notesArgument || process.env.JISHI_RELEASE_NOTES || "修复问题并改进使用体验。")
  .split("|").map((note) => note.trim()).filter(Boolean);

async function json(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function fileRelease(platform, version, path, githubTag) {
  const bytes = await readFile(path);
  return {
    version,
    downloadUrl: `${publicUrl}/downloads/${basename(path)}`,
    githubUrl: `https://github.com/${githubRepo}/releases/download/${githubTag}/${basename(path)}`,
    sha256: createHash("sha256").update(bytes).digest("hex").toUpperCase(),
    size: bytes.length,
    required,
  };
}

const windowsPackage = await json(join(root, "clients/windows/package.json"));
const androidPackage = await json(join(root, "clients/android/package.json"));
const windowsPath = join(currentDirectory, `Jishi-Windows-Setup-${windowsPackage.version}.exe`);
const androidPath = join(currentDirectory, `Jishi-Android-${androidPackage.version}.apk`);
const githubTag = `clients-v${windowsPackage.version}-a${androidPackage.version}`;
const webRoot = join(root, "clients/web");
const webBuild = await webBuildHash(webRoot);
const manifest = {
  schemaVersion: 1,
  required,
  releaseId: `web-${webBuild.slice(0, 16)}`,
  webBuild,
  publishedAt: new Date().toISOString(),
  notes,
  clients: {
    windows: await fileRelease("windows", windowsPackage.version, windowsPath, githubTag),
    android: await fileRelease("android", androidPackage.version, androidPath, githubTag),
  },
};
const output = join(webRoot, "public/updates/latest.json");
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`);
await writeFile(join(currentDirectory, "latest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
await writeFile(join(currentDirectory, "SHA256SUMS"), Object.values(manifest.clients).map(release => `${release.sha256} *${basename(new URL(release.downloadUrl).pathname)}`).join("\n")+"\n");
console.log(`Generated ${relative(root, output)} for ${windowsPackage.version} / ${androidPackage.version}`);
