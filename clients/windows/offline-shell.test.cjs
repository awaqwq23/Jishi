const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

test('native offline shell keeps trusted HTTPS requests and never substitutes an API response', async () => {
  const exported = { exports: {} }, paths = [];
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'offline-shell.cjs'), 'utf8'), {
    require(name) { if (name === 'node:fs/promises') return { async readFile(file) { paths.push(file); return Buffer.from('<html>拾光记事本机入口</html>'); } }; return require(name); },
    module: exported, __dirname: 'C:/test-app', Response, AbortSignal, URL,
  });
  let handler;
  const session = { protocol: { handle(scheme, callback) { assert.equal(scheme, 'https'); handler = callback; } }, async fetch(request, options) { assert.equal(options.bypassCustomProtocolHandlers, true); if (request.url.includes('/api/')) return new Response('{"error":"offline"}', { status: 503 }); throw new TypeError('network unavailable'); } };
  const origins = ['https://awaqwq233.com'];
  exported.exports.installOfflineShell(session, origins);
  const html = await handler(new Request('https://awaqwq233.com/note/'));
  assert.equal(html.status, 200); assert.match(await html.text(), /本机入口/);
  const api = await handler(new Request('https://awaqwq233.com/note/api/bootstrap'));
  assert.equal(api.status, 503); assert.match(await api.text(), /offline/);
  assert.equal(paths.length, 1);
  assert.equal(exported.exports.localPath('https://evil.example/note/', origins), null);
  assert.equal(exported.exports.localPath('https://awaqwq233.com/note/../secret.key', origins), null);
  assert.equal(exported.exports.localPath('https://awaqwq233.com/note/assets/app.js', origins), 'assets/app.js');
});

test('offline startup reopens the last trusted site and rejects a forged saved URL', async () => {
  for (const saved of ['https://fallback.example/note/', 'https://attacker.example/']) {
    const loaded = [], checked = [];
    let ready;
    class Window {
      constructor() { this.webContents = { getUserAgent: () => 'test', setUserAgent() {}, session: { on() {} }, setWindowOpenHandler() {} }; }
      loadURL(url) { loaded.push(url); return Promise.resolve(); }
      on() {}
    }
    class Tray { setToolTip() {} on() {} setContextMenu() {} }
    const electron = { app: { getPath: () => '/device-test', getVersion: () => '0.4.9', setAppUserModelId() {}, requestSingleInstanceLock: () => true, on() {}, async getFileIcon() { return {}; }, whenReady() { return { then(callback) { ready = callback(); } }; } }, BrowserWindow: Window, Tray, Menu: { buildFromTemplate: value => value }, net: {}, session: { defaultSession: {} }, ipcMain: { on() {}, handle() {} }, Notification: { isSupported: () => false }, shell: {} };
    const modules = {
      electron,
      'node:fs': { readFileSync() { return JSON.stringify({ url: saved }); }, mkdirSync() {}, writeFileSync() {} },
      'app-config.json': { webUrl: 'https://primary.example/', fallbackUrls: ['https://fallback.example/note/'] },
      'host-resolver.cjs': { uniqueUrls: values => [...new Set(values.filter(Boolean))], async resolveAppUrl(values) { checked.push(...values); throw new Error('all hosts unavailable'); } },
      'offline-shell.cjs': { installOfflineShell() {} },
      'update-downloader.cjs': { createUpdateDownloader: () => ({ async resumePending() {} }), safeRequest: value => value },
      'reminder-store.cjs': { createReminderStore: () => ({ restore() {}, async tick() {} }) },
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'main.cjs'), 'utf8'), {
      require(name) { return modules[name] || modules[path.basename(name)] || require(name); }, __dirname: '/test-app', process: { argv: [], env: {}, platform: 'win32' }, URL, console, setInterval() {},
    });
    await ready;
    const expected = saved.includes('attacker') ? 'https://primary.example/' : saved;
    assert.equal(checked[0], expected); assert.deepEqual(loaded, [expected]);
  }
});
