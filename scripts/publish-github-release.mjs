import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repo = "awaqwq23/Jishi";
const manifest = JSON.parse(await readFile(join(root, "clients/web/public/updates/latest.json"), "utf8"));
const tag = `clients-v${manifest.clients.windows.version}-a${manifest.clients.android.version}`;
const verifyOnly = process.argv.includes("--verify");

function githubToken() {
  if (process.env.GH_TOKEN || process.env.GITHUB_TOKEN) return process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  const filled = execFileSync("git", ["credential", "fill"], {
    input: "protocol=https\nhost=github.com\n\n", encoding: "utf8", stdio: ["pipe", "pipe", "ignore"],
  });
  const password = filled.split(/\r?\n/).find((line) => line.startsWith("password="))?.slice(9);
  if (!password) throw new Error("GitHub credential is unavailable");
  return password;
}

const token = githubToken();
const headers = {
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "Jishi-client-release",
};

async function request(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { ...headers, ...options.headers } });
  if (response.status === 404 && options.allow404) return null;
  if (!response.ok) throw new Error(`GitHub API ${response.status} for ${new URL(url).pathname}`);
  return response.json();
}

const artifacts = [];
for (const platform of ["windows", "android"]) {
  const release = manifest.clients[platform];
  const name = platform === "windows" ? `Jishi-Windows-Setup-${release.version}.exe` : `Jishi-Android-${release.version}.apk`;
  const bytes = await readFile(join(root, name));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (bytes.length !== release.size || sha256.toUpperCase() !== release.sha256.toUpperCase()) {
    throw new Error(`${name} differs from update manifest`);
  }
  const expectedUrl = `https://github.com/${repo}/releases/download/${tag}/${name}`;
  if (release.githubUrl !== expectedUrl) throw new Error(`${name} GitHub URL differs from update manifest`);
  artifacts.push({ name, bytes, sha256, url: expectedUrl });
}

const releaseUrl = `https://api.github.com/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`;
let githubRelease = await request(releaseUrl, { allow404: true });
if (!githubRelease && verifyOnly) throw new Error(`GitHub Release ${tag} does not exist`);
if (!githubRelease) {
  const target = process.env.GITHUB_SHA || execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  githubRelease = await request(`https://api.github.com/repos/${repo}/releases`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tag_name: tag,
      target_commitish: target,
      name: `记时 Windows ${manifest.clients.windows.version} / Android ${manifest.clients.android.version}`,
      body: `与正式站点更新清单一致的安装包。\n\nWindows SHA-256: ${artifacts[0].sha256.toUpperCase()}\nAndroid SHA-256: ${artifacts[1].sha256.toUpperCase()}\n\n下载对应平台的安装包后按系统提示覆盖安装。`,
      draft: false,
      prerelease: false,
    }),
  });
}

if (githubRelease.draft || githubRelease.prerelease) throw new Error("GitHub Release is not a public stable release");
for (const artifact of artifacts) {
  let asset = githubRelease.assets.find((item) => item.name === artifact.name);
  if (!asset && !verifyOnly) {
    asset = await request(`https://uploads.github.com/repos/${repo}/releases/${githubRelease.id}/assets?name=${encodeURIComponent(artifact.name)}`, {
      method: "POST",
      headers: { "Content-Type": artifact.name.endsWith(".apk") ? "application/vnd.android.package-archive" : "application/octet-stream" },
      body: artifact.bytes,
    });
  }
  if (!asset) throw new Error(`${artifact.name} is missing from GitHub Release`);
  if (asset.state !== "uploaded" || asset.size !== artifact.bytes.length || asset.browser_download_url !== artifact.url) {
    throw new Error(`${artifact.name} GitHub asset metadata mismatch`);
  }
  if (asset.digest !== `sha256:${artifact.sha256}`) {
    throw new Error(`${artifact.name} GitHub asset SHA-256 mismatch or unavailable`);
  }
  console.log(`${artifact.name}: uploaded, ${asset.size} bytes, SHA-256 verified`);
}
console.log(`GitHub Release verified: https://github.com/${repo}/releases/tag/${tag}`);
