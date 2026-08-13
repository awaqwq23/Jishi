import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile, mkdir } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const publicUrl = (process.env.JISHI_PUBLIC_URL || "https://jishi-104-214-169-232.nip.io").replace(/\/$/, "");
const required = process.env.JISHI_UPDATE_REQUIRED === "true";
const notesArgument = process.argv.find((argument) => argument.startsWith("--notes="))?.slice(8);
const notes = (notesArgument || process.env.JISHI_RELEASE_NOTES || "修复问题并改进使用体验。")
  .split("|").map((note) => note.trim()).filter(Boolean);

async function json(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function fileRelease(platform, version, path) {
  const bytes = await readFile(path);
  return {
    version,
    downloadUrl: `${publicUrl}/downloads/${basename(path)}`,
    sha256: createHash("sha256").update(bytes).digest("hex").toUpperCase(),
    size: bytes.length,
    required,
  };
}

async function webBuildHash(webRoot) {
  const files = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const fullPath = join(directory, entry.name);
      if (entry.isDirectory()) await walk(fullPath);
      else if (entry.isFile() && relative(webRoot, fullPath).replaceAll("\\", "/") !== "public/updates/latest.json") files.push(fullPath);
    }
  }
  await walk(join(webRoot, "app"));
  await walk(join(webRoot, "public"));
  for (const name of ["package.json", "package-lock.json", "vite.config.ts", "next.config.ts"]) {
    const fullPath = join(webRoot, name);
    if ((await stat(fullPath)).isFile()) files.push(fullPath);
  }
  const hash = createHash("sha256");
  for (const file of files.sort()) {
    hash.update(relative(webRoot, file).replaceAll("\\", "/"));
    hash.update("\0");
    hash.update(await readFile(file));
    hash.update("\0");
  }
  return hash.digest("hex");
}

const windowsPackage = await json(join(root, "clients/windows/package.json"));
const androidPackage = await json(join(root, "clients/android/package.json"));
const windowsPath = join(root, `Jishi-Windows-Setup-${windowsPackage.version}.exe`);
const androidPath = join(root, `Jishi-Android-${androidPackage.version}.apk`);
const webRoot = join(root, "clients/web");
const webBuild = await webBuildHash(webRoot);
const manifest = {
  schemaVersion: 1,
  releaseId: `web-${webBuild.slice(0, 16)}`,
  webBuild,
  publishedAt: new Date().toISOString(),
  notes,
  clients: {
    windows: await fileRelease("windows", windowsPackage.version, windowsPath),
    android: await fileRelease("android", androidPackage.version, androidPath),
  },
};
const output = join(webRoot, "public/updates/latest.json");
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Generated ${relative(root, output)} for ${windowsPackage.version} / ${androidPackage.version}`);
