import test from 'node:test';
import assert from 'node:assert/strict';
import { sendNativeNotification } from '../app/system-notifications.mjs';

test('queued mobile notification requires a matching OS receipt', async () => {
  const target = new EventTarget();
  const native = { notify() {
    queueMicrotask(() => target.dispatchEvent(new CustomEvent('jishi-native-notification-result', { detail: { key: 'test', state: 'sent' } })));
    return 'queued';
  } };
  assert.equal(await sendNativeNotification(native, 'test', 'test', 'test', target), true);
  native.notify = () => {
    queueMicrotask(() => target.dispatchEvent(new CustomEvent('jishi-native-notification-result', { detail: { key: 'test', state: 'failed' } })));
    return 'queued';
  };
  await assert.rejects(sendNativeNotification(native, 'test', 'test', 'test', target), /发送失败/);
});
test('unconfirmed queue and rejected bridge do not report success; older clients remain compatible', async () => {
  const target = new EventTarget();
  await assert.rejects(sendNativeNotification({ notify: () => 'queued' }, '', '', 'test', target, 5), /未收到/);
  await assert.rejects(sendNativeNotification({ notify: () => 'rejected' }, '', '', 'test', target), /被拒绝/);
  assert.equal(await sendNativeNotification({ notify: () => undefined }, '', '', 'old', target), false);
  assert.equal(await sendNativeNotification({ notify: async () => true }, '', '', 'windows', target), true);
});
