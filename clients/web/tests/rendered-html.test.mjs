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
  const [app, css, server, migration, androidConfig, offlinePage, androidActivity, androidManifest] = await Promise.all([
    readFile(new URL("../app/TodoApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../../../server/src/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../../../server/drizzle/0001_modules_and_portability.sql", import.meta.url), "utf8"),
    readFile(new URL("../../android/capacitor.config.ts", import.meta.url), "utf8"),
    readFile(new URL("../../android/www/offline.html", import.meta.url), "utf8"),
    readFile(new URL("../../android/android/app/src/main/java/cn/jishi/todo/MainActivity.java", import.meta.url), "utf8"),
    readFile(new URL("../../android/android/app/src/main/AndroidManifest.xml", import.meta.url), "utf8"),
  ]);
  assert.match(app, /notificationsSupported\(\)/);
  assert.match(app, /detail-layer/);
  assert.match(app, /function ImageCropper/);
  assert.match(app, /onPointerUp=.*commitAppearance\("cardOpacity"/);
  assert.match(app, /jishi-device-login-v1/);
  assert.match(app, /PATCH.*api\/categories/s);
  assert.match(app, /PATCH.*api\/presets/s);
  assert.match(css, /task-card::before[^}]*width:\s*7px/s);
  assert.match(css, /background-color:\s*rgb\(var\(--card\)\s*\/\s*var\(--card-opacity\)\)/);
  assert.match(css, /app-shell\.has-custom-background/);
  assert.match(server, /request\.method === "PATCH"/);
  assert.match(app, /function ReminderOffsetsEditor/);
  assert.match(app, /function nextReminderOffset/);
  assert.match(app, /nextReminderOffset\(value\)/);
  assert.match(app, /option value="days">天/);
  assert.match(app, /option value="hours">小时/);
  assert.match(app, /option value="minutes">分钟/);
  assert.doesNotMatch(app, /option value="seconds">秒/);
  assert.match(app, /backgroundOpacity/);
  assert.match(app, /backgroundAcrylic/);
  assert.match(app, /onChange=.*previewAppearance\(\{ cardOpacity/s);
  assert.match(app, /style=\{\{ width: Math\.max\(0, -?drag\) \}\}/);
  assert.match(app, /const dragValue = useRef\(0\)/);
  assert.match(app, /const distance = dragValue\.current/);
  assert.doesNotMatch(css, /swipe-shell\.completing|swipe-shell\.deleting/);
  assert.match(css, /\.swipe-action\s*\{[^}]*padding:\s*0;/s);
  assert.match(css, /\.delete-action > svg[^}]*margin-left:\s*22px/s);
  assert.match(css, /background-acrylic::after/);
  assert.match(css, /\.app-shell\s*\{[^}]*isolation:\s*isolate/s);
  assert.match(css, /background-acrylic::after\s*\{[^}]*z-index:\s*-1/s);
  assert.match(css, /\.main-surface\s*\{[^}]*z-index:\s*auto/s);
  assert.match(css, /\.main-surface\s*\{[^}]*padding:\s*28px 18px calc\(112px \+ env\(safe-area-inset-bottom\)\)/s);
  assert.match(app, /function ScheduleBoard/);
  assert.match(app, /function ScheduleDetailPanel/);
  assert.match(app, /task-action-menu/);
  assert.match(app, /onEdit=\{\(\) => setEditor\(todo\)\}/);
  assert.match(app, /mobile-quick-menu/);
  assert.match(app, /showDeviceNotification/);
  assert.match(app, /registration\.showNotification/);
  assert.match(app, /JishiNative/);
  assert.match(app, /jishi-notification-history-v1/);
  assert.match(app, /document\.addEventListener\("visibilitychange"/);
  assert.match(app, /jishi-native-notification-permission/);
  assert.match(app, /if \(deadline <= now\)/);
  assert.match(app, /function DiaryBoard/);
  assert.match(app, /\/api\/data\/export/);
  assert.doesNotMatch(app, /response\.blob\(\).*createObjectURL/s);
  assert.match(app, /anchor\.download = `jishi-\$\{target\}\.\$\{format\}`/);
  assert.match(app, /jishi-local-appearance-v1/);
  assert.match(app, /indexedDB\.open\(LOCAL_MEDIA_DB/);
  assert.match(app, /writeLocalBackground\(data\.user\.id, file\)/);
  assert.doesNotMatch(app, /api\/media\?kind=background/);
  assert.doesNotMatch(app, /onSaveProfile\(\{ settings:/);
  assert.match(css, /\.editor-scroll\s*\{[^}]*flex:\s*1;[^}]*min-height:\s*0/s);
  assert.match(css, /\.crop-panel\s*\{[^}]*display:\s*flex;[^}]*overflow:\s*hidden/s);
  assert.match(app, /const previewGeometry = useMemo/);
  assert.match(app, /Math\.min\(outputWidth \/ image\.naturalWidth, outputHeight \/ image\.naturalHeight\)/);
  assert.match(app, /activePointers/);
  assert.match(app, /onWheel=/);
  assert.match(app, />完整显示</);
  assert.match(app, />填满裁剪框</);
  assert.doesNotMatch(app, />水平位置</);
  assert.doesNotMatch(app, />垂直位置</);
  assert.match(css, /\.crop-viewport img\s*\{[^}]*position:\s*absolute/s);
  assert.match(server, /CREATE TABLE IF NOT EXISTS schedule_items/);
  assert.match(server, /CREATE TABLE IF NOT EXISTS diary_entries/);
  assert.match(server, /\/api\/data\/import/);
  assert.match(migration, /CREATE TABLE `schedule_records`/);
  assert.match(androidConfig, /errorPath:\s*"offline\.html"/);
  assert.match(offlinePage, /重新连接主服务器/);
  assert.match(androidActivity, /addJavascriptInterface\(new JishiNativeBridge\(\), "JishiNative"\)/);
  assert.match(androidActivity, /NotificationManagerCompat/);
  assert.match(androidActivity, /pendingNotifications/);
  assert.match(androidActivity, /evaluateJavascript/);
  assert.match(androidActivity, /DownloadManager\.Request/);
  assert.match(androidActivity, /CookieManager\.getInstance\(\)\.getCookie\(url\)/);
  assert.match(androidManifest, /android\.permission\.POST_NOTIFICATIONS/);
});
