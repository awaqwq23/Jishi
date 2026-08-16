import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const templateRoot = new URL("../", import.meta.url);

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the 记时 application shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>记时 · 待办<\/title>/i);
  assert.match(html, /正在整理你的今天/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/);
});

test("includes product metadata and installable shell", async () => {
  const [css, page, layout, packageJson, manifest] = await Promise.all([
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../public/manifest.webmanifest", import.meta.url), "utf8"),
  ]);
    assert.match(page, /export const metadata:\s*Metadata/);
  assert.match(page, /<TodoApp/);
  assert.match(layout, /title:\s*"记时/);
  assert.match(manifest, /"display": "standalone"/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  await access(new URL("public/sw.js", templateRoot));
});

test("keeps the reported interaction regressions covered", async () => {
  const [app, css, server, androidConfig, offlinePage] = await Promise.all([
    readFile(new URL("../app/TodoApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../../../server/src/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../../android/capacitor.config.ts", import.meta.url), "utf8"),
    readFile(new URL("../../android/www/offline.html", import.meta.url), "utf8"),
  ]);
  assert.match(app, /notificationsSupported\(\)/);
  assert.match(app, /detail-layer/);
  assert.match(app, /function ImageCropper/);
  assert.match(app, /onPointerUp=.*commitOpacity/);
  assert.match(app, /jishi-device-login-v1/);
  assert.match(app, /PATCH.*api\/categories/s);
  assert.match(app, /PATCH.*api\/presets/s);
  assert.match(css, /task-card::before[^}]*width:\s*7px/s);
  assert.match(server, /request\.method === "PATCH"/);
  assert.match(androidConfig, /errorPath:\s*"offline\.html"/);
  assert.match(offlinePage, /重新连接主服务器/);
});
