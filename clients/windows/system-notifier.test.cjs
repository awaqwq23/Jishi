const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createSystemNotifier } = require('./system-notifier.cjs');
test('native toast is retained, accepted once and deduplicated across restart', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jishi-toast-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const shown = [];
  class Notification extends EventEmitter {
    static isSupported() { return true; }
    show() { shown.push(this); queueMicrotask(() => this.emit('show')); }
    close() { this.emit('close'); }
  }
  const options = { desktopPopup: false, Notification, file: path.join(dir, 'receipt.json'), fallback: () => { throw new Error('Unexpected fallback'); } };
  const service = createSystemNotifier(options), item = { key: 'task:one', title: '任务', body: '到时' };
  assert.deepEqual(await Promise.all([service.notify(item), service.notify(item)]), [true, true]);
  assert.equal(shown.length, 1);
  await createSystemNotifier(options).notify(item);
  assert.equal(shown.length, 1);
});
test('OS toast failure uses desktop popup, total failure remains retryable', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jishi-toast-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  class Notification extends EventEmitter {
    static isSupported() { return true; }
    show() { queueMicrotask(() => this.emit('failed')); }
    close() {}
  }
  let allowed = false, calls = 0;
  const service = createSystemNotifier({ Notification, file: path.join(dir, 'receipt.json'), fallback: async () => { calls++; if (!allowed) throw new Error('Display unavailable'); } });
  const item = { key: 'retry', title: '任务', body: '到时' };
  await assert.rejects(service.notify(item), /Display unavailable/);
  allowed = true;
  assert.equal(await service.notify(item), true);
  assert.equal(calls, 2);
});


test('Windows shows a desktop popup even after toast acceptance and retries failed popup', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jishi-toast-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  class Notification extends EventEmitter {
    static isSupported() { return true; }
    show() { queueMicrotask(() => this.emit('show')); }
    close() {}
  }
  let calls = 0, allowed = false;
  const options = { Notification, desktopPopup: true, file: path.join(dir, 'receipt.json'), fallback: async () => { calls++; if (!allowed) throw new Error('Popup failed'); } };
  const service = createSystemNotifier(options), item = { key: 'visible', title: 'task', body: 'due' };
  await assert.rejects(service.notify(item), /Popup failed/);
  allowed = true;
  await Promise.all([service.notify(item), service.notify(item)]);
  await createSystemNotifier(options).notify(item);
  assert.equal(calls, 2);
});
