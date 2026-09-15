const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { createServer } = require("node:http");
const { mkdtemp, readFile, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { once } = require("node:events");
const { createUpdateDownloader, segmentBounds } = require("./update-downloader.cjs");

test("splits a file into eight contiguous byte ranges", () => {
  assert.deepEqual(Array.from({ length: 8 }, (_, index) => segmentBounds(10, index)), [
    { start: 0, end: 0 }, { start: 1, end: 1 }, { start: 2, end: 2 }, { start: 3, end: 4 },
    { start: 5, end: 5 }, { start: 6, end: 6 }, { start: 7, end: 7 }, { start: 8, end: 9 },
  ]);
});

test("downloads eight ranges, reports progress, and verifies the completed file", async () => {
  const bytes = Buffer.alloc(257 * 1024 + 13);
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = index % 251;
  const sha256 = createHash("sha256").update(bytes).digest("hex").toUpperCase();
  const ranges = [];
  const server = createServer((request, response) => {
    const match = /^bytes=(\d+)-(\d+)$/.exec(request.headers.range || "");
    if (!match) { response.writeHead(416); response.end(); return; }
    const start = Number(match[1]); const end = Number(match[2]);
    ranges.push([start, end]);
    response.writeHead(206, { "Content-Range": `bytes ${start}-${end}/${bytes.length}`, "Content-Length": end - start + 1, ETag: '"fixture"' });
    response.end(bytes.subarray(start, end + 1));
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const root = await mkdtemp(join(tmpdir(), "jishi-update-test-"));
  const states = [];
  try {
    const port = server.address().port;
    const downloader = createUpdateDownloader({ fetchImpl: fetch, stateDir: join(root, "state"), downloadsDir: join(root, "downloads"), onState: (state) => states.push(state) });
    await assert.rejects(
      downloader.start({ url: `http://127.0.0.1:${port}/Jishi-Windows-Setup-0.4.6.exe`, filename: "Jishi-Windows-Setup-0.4.6.exe", size: bytes.length, sha256 }),
      /下载地址无效/,
    );

    const secureFetchForTest = (url, init) => fetch(url.replace("https:", "http:"), init);
    const secureDownloader = createUpdateDownloader({ fetchImpl: secureFetchForTest, stateDir: join(root, "state2"), downloadsDir: join(root, "downloads2"), onState: (state) => states.push(state) });
    const completed = await secureDownloader.start({ url: `https://127.0.0.1:${port}/Jishi-Windows-Setup-0.4.6.exe`, filename: "Jishi-Windows-Setup-0.4.6.exe", size: bytes.length, sha256 });
    assert.equal(completed.status, "completed");
    assert.deepEqual(await readFile(completed.savePath), bytes);
    assert.equal(ranges.length, 8);
    assert.ok(states.some((state) => state.status === "downloading"));
    assert.ok(states.some((state) => state.status === "verifying"));
  } finally {
    server.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("keeps partial segments and resumes them with new Range offsets", async () => {
  const bytes = Buffer.alloc(512 * 1024, 0x5a);
  const sha256 = createHash("sha256").update(bytes).digest("hex").toUpperCase();
  const requestedStarts = [];
  let slow = true;
  const server = createServer((request, response) => {
    const match = /^bytes=(\d+)-(\d+)$/.exec(request.headers.range || "");
    const start = Number(match?.[1]); const end = Number(match?.[2]);
    requestedStarts.push(start);
    response.writeHead(206, { "Content-Range": `bytes ${start}-${end}/${bytes.length}`, "Content-Length": end - start + 1 });
    const firstEnd = Math.min(end + 1, start + 4096);
    response.write(bytes.subarray(start, firstEnd));
    if (!slow) { response.end(bytes.subarray(firstEnd, end + 1)); return; }
    let cursor = firstEnd;
    const timer = setInterval(() => {
      if (response.destroyed) { clearInterval(timer); return; }
      const next = Math.min(end + 1, cursor + 4096);
      response.write(bytes.subarray(cursor, next)); cursor = next;
      if (cursor >= end + 1) { clearInterval(timer); response.end(); }
    }, 100);
    response.on("close", () => clearInterval(timer));
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const root = await mkdtemp(join(tmpdir(), "jishi-resume-test-"));
  try {
    const url = `https://127.0.0.1:${server.address().port}/Jishi-Windows-Setup-0.4.6.exe`;
    const request = { url, filename: "Jishi-Windows-Setup-0.4.6.exe", size: bytes.length, sha256 };
    const fetchForTest = (target, init) => fetch(target.replace("https:", "http:"), init);
    let paused = false;
    const first = createUpdateDownloader({
      fetchImpl: fetchForTest, stateDir: join(root, "state"), downloadsDir: join(root, "downloads"),
      onState: (state) => { if (!paused && state.receivedBytes >= 8 * 4096) { paused = true; first.pause(); } },
    });
    const interrupted = await first.start(request);
    assert.equal(interrupted.status, "paused");
    slow = false;
    const resumed = createUpdateDownloader({ fetchImpl: fetchForTest, stateDir: join(root, "state"), downloadsDir: join(root, "downloads") });
    const completed = await resumed.resumePending();
    assert.equal(completed.status, "completed");
    assert.deepEqual(await readFile(completed.savePath), bytes);
    const originalStarts = new Set(Array.from({ length: 8 }, (_, index) => segmentBounds(bytes.length, index).start));
    assert.equal(requestedStarts.slice(8).length, 8);
    assert.ok(requestedStarts.slice(8).every((start) => !originalStarts.has(start)), JSON.stringify(requestedStarts));
  } finally {
    server.close();
    await rm(root, { recursive: true, force: true });
  }
});
