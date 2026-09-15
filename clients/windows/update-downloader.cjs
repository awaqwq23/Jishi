const { createHash } = require("node:crypto");
const { createReadStream, createWriteStream } = require("node:fs");
const { access, mkdir, open, readFile, rename, rm, stat, writeFile } = require("node:fs/promises");
const { basename, extname, join } = require("node:path");
const { once } = require("node:events");

const PART_COUNT = 8;
const UPDATE_FILE = /^Jishi-Windows-Setup-[0-9]+(?:\.[0-9]+){2}\.exe$/;

function safeRequest(input) {
  if (!input || typeof input !== "object") throw new Error("更新信息无效");
  const url = new URL(String(input.url));
  const filename = basename(String(input.filename || url.pathname.split("/").at(-1) || ""));
  const size = Number(input.size);
  const sha256 = String(input.sha256 || "").toUpperCase();
  if (url.protocol !== "https:" || !UPDATE_FILE.test(filename)) throw new Error("更新下载地址无效");
  if (!Number.isSafeInteger(size) || size <= 0 || size > 1024 * 1024 * 1024) throw new Error("更新文件大小无效");
  if (!/^[A-F0-9]{64}$/.test(sha256)) throw new Error("更新校验值无效");
  return { url: url.toString(), filename, size, sha256 };
}

async function exists(path) {
  try { await access(path); return true; } catch { return false; }
}

async function sha256File(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex").toUpperCase();
}

function segmentBounds(size, index) {
  const start = Math.floor(size * index / PART_COUNT);
  return { start, end: Math.floor(size * (index + 1) / PART_COUNT) - 1 };
}

function createUpdateDownloader({ fetchImpl, stateDir, downloadsDir, onState = () => {}, onCompleted = () => {} }) {
  const metadataPath = join(stateDir, "pending-update.json");
  let state = { status: "idle", receivedBytes: 0, totalBytes: 0, bytesPerSecond: 0, percent: 0, etaSeconds: null, filename: "" };
  let active = false;
  let generation = 0;
  let lastSampleAt = 0;
  let lastSampleBytes = 0;
  let smoothedSpeed = 0;

  const emit = (patch = {}) => {
    state = { ...state, ...patch };
    onState({ ...state });
    return { ...state };
  };

  const partPath = (request, index) => join(stateDir, `${request.sha256.slice(0, 20)}.${index}.part`);
  const combinedPath = (request) => join(stateDir, `${request.sha256.slice(0, 20)}.complete`);

  async function partSizes(request) {
    const sizes = [];
    for (let index = 0; index < PART_COUNT; index += 1) {
      const bounds = segmentBounds(request.size, index);
      const expected = Math.max(0, bounds.end - bounds.start + 1);
      let size = 0;
      try { size = Math.min((await stat(partPath(request, index))).size, expected); } catch { /* Missing parts start at zero. */ }
      sizes.push(size);
    }
    return sizes;
  }

  async function publishProgress(request, force = false) {
    const receivedBytes = (await partSizes(request)).reduce((sum, size) => sum + size, 0);
    const now = Date.now();
    if (lastSampleAt && now > lastSampleAt && receivedBytes >= lastSampleBytes) {
      const current = (receivedBytes - lastSampleBytes) * 1000 / (now - lastSampleAt);
      if (current > 0) smoothedSpeed = smoothedSpeed ? smoothedSpeed * 0.7 + current * 0.3 : current;
    }
    if (force || now - lastSampleAt >= 500) {
      lastSampleAt = now;
      lastSampleBytes = receivedBytes;
      emit({
        status: "downloading",
        receivedBytes,
        totalBytes: request.size,
        bytesPerSecond: Math.round(smoothedSpeed),
        percent: Math.min(100, receivedBytes / request.size * 100),
        etaSeconds: smoothedSpeed > 0 ? Math.ceil((request.size - receivedBytes) / smoothedSpeed) : null,
        filename: request.filename,
        message: "八路加速下载中；关闭窗口后仍会在后台继续",
      });
    }
  }

  async function cleanRequestFiles(request) {
    for (let index = 0; index < PART_COUNT; index += 1) await rm(partPath(request, index), { force: true });
    await rm(combinedPath(request), { force: true });
  }

  async function loadMetadata() {
    try { return safeRequest(JSON.parse(await readFile(metadataPath, "utf8"))); }
    catch { return null; }
  }

  async function saveMetadata(request) {
    await mkdir(stateDir, { recursive: true });
    await writeFile(metadataPath, `${JSON.stringify(request)}\n`, "utf8");
  }

  async function downloadPart(request, index, token) {
    const bounds = segmentBounds(request.size, index);
    const path = partPath(request, index);
    await mkdir(stateDir, { recursive: true });
    let received = 0;
    try { received = Math.min((await stat(path)).size, bounds.end - bounds.start + 1); } catch { /* Start a new segment. */ }
    if (received >= bounds.end - bounds.start + 1) return;
    const file = await open(path, received ? "a" : "w");
    try {
      for (let attempt = 0; attempt < 4; attempt += 1) {
        if (token !== generation) throw new Error("下载已暂停");
        try {
          const start = bounds.start + received;
          const response = await fetchImpl(request.url, {
            headers: { Range: `bytes=${start}-${bounds.end}`, "Cache-Control": "no-cache" },
          });
          if (response.status !== 206 || !response.body) throw new Error(`服务器未返回可续传分段（HTTP ${response.status}）`);
          const contentRange = response.headers.get("content-range") || "";
          if (!contentRange.startsWith(`bytes ${start}-${bounds.end}/`)) throw new Error("服务器返回的下载分段不一致");
          const reader = response.body.getReader();
          while (true) {
            if (token !== generation) { await reader.cancel(); throw new Error("下载已暂停"); }
            const { done, value } = await reader.read();
            if (token !== generation) { await reader.cancel(); throw new Error("下载已暂停"); }
            if (done) break;
            if (!value?.byteLength) continue;
            await file.write(value);
            received += value.byteLength;
            await publishProgress(request);
          }
          if (received === bounds.end - bounds.start + 1) return;
          throw new Error("下载分段提前结束");
        } catch (error) {
          if (token !== generation || attempt === 3) throw error;
          await new Promise((resolve) => setTimeout(resolve, (attempt + 1) * 750));
          received = Math.min((await stat(path)).size, bounds.end - bounds.start + 1);
        }
      }
    } finally {
      await file.close();
    }
  }

  async function availableDestination(request) {
    const direct = join(downloadsDir, request.filename);
    if (!(await exists(direct))) return direct;
    try {
      if ((await stat(direct)).size === request.size && await sha256File(direct) === request.sha256) return direct;
    } catch { /* Pick a non-conflicting path below. */ }
    const extension = extname(request.filename);
    const stem = request.filename.slice(0, -extension.length);
    for (let index = 1; index < 1000; index += 1) {
      const candidate = join(downloadsDir, `${stem} (${index})${extension}`);
      if (!(await exists(candidate))) return candidate;
    }
    throw new Error("下载目录中同名文件过多，请先整理后重试");
  }

  async function combineAndVerify(request, token) {
    emit({ status: "verifying", receivedBytes: request.size, totalBytes: request.size, percent: 100, etaSeconds: 0, message: "下载完成，正在校验安装包" });
    const target = combinedPath(request);
    const output = createWriteStream(target, { flags: "w" });
    const hash = createHash("sha256");
    try {
      for (let index = 0; index < PART_COUNT; index += 1) {
        for await (const chunk of createReadStream(partPath(request, index))) {
          if (token !== generation) throw new Error("下载已暂停");
          hash.update(chunk);
          if (!output.write(chunk)) await once(output, "drain");
        }
      }
      output.end();
      await once(output, "close");
    } catch (error) {
      output.destroy();
      throw error;
    }
    const actual = hash.digest("hex").toUpperCase();
    if ((await stat(target)).size !== request.size || actual !== request.sha256) {
      await cleanRequestFiles(request);
      throw new Error("安装包校验失败，已清除损坏的临时分段");
    }
    await mkdir(downloadsDir, { recursive: true });
    const destination = await availableDestination(request);
    if (await exists(destination)) await rm(target, { force: true });
    else await rename(target, destination);
    for (let index = 0; index < PART_COUNT; index += 1) await rm(partPath(request, index), { force: true });
    await rm(metadataPath, { force: true });
    const completed = emit({ status: "completed", savePath: destination, bytesPerSecond: Math.round(smoothedSpeed), message: "安装包已校验并保存到下载目录" });
    await onCompleted(destination, completed);
    return completed;
  }

  async function start(input) {
    const request = safeRequest(input);
    if (active) return { ...state };
    active = true;
    const token = ++generation;
    lastSampleAt = 0; lastSampleBytes = 0; smoothedSpeed = 0;
    try {
      const old = await loadMetadata();
      if (old && (old.url !== request.url || old.size !== request.size || old.sha256 !== request.sha256)) await cleanRequestFiles(old);
      await saveMetadata(request);
      emit({ status: "downloading", receivedBytes: (await partSizes(request)).reduce((sum, size) => sum + size, 0), totalBytes: request.size, bytesPerSecond: 0, percent: 0, etaSeconds: null, filename: request.filename, message: "正在连接更新服务器" });
      await publishProgress(request, true);
      await Promise.all(Array.from({ length: PART_COUNT }, (_, index) => downloadPart(request, index, token)));
      await publishProgress(request, true);
      return await combineAndVerify(request, token);
    } catch (error) {
      const message = error instanceof Error ? error.message : "下载暂时中断";
      return emit({ status: "paused", message: `${message}；再次点击可从已有进度继续`, bytesPerSecond: 0, etaSeconds: null });
    } finally {
      active = false;
    }
  }

  async function resumePending() {
    const request = await loadMetadata();
    return request ? start(request) : { ...state };
  }

  function pause() {
    if (!active) return;
    generation += 1;
    emit({ status: "paused", bytesPerSecond: 0, etaSeconds: null, message: "下载已暂停，下次启动会自动续传" });
  }

  return { start, resumePending, pause, getState: () => ({ ...state }), isActive: () => active, safeRequest };
}

module.exports = { PART_COUNT, createUpdateDownloader, safeRequest, segmentBounds };
