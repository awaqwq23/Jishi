import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../../harmony/entry/src/main/ets/pages/ReminderScheduler.ets', import.meta.url), 'utf8');
function fixture() {
  let now = Date.now(), enabled = true, next = 1;
  const reminders = new Map(), published = [], cancelled = [], slots = [];
  const agent = {
    ReminderType: { REMINDER_TYPE_CALENDAR: 1 },
    async getAllValidReminders() { return [...reminders.values()]; },
    async cancelAllReminders() { reminders.clear(); cancelled.push('all'); },
    async cancelReminder(id) { reminders.delete(id); cancelled.push(id); },
    async publishReminder(request) { const id = next++; published.push(request); reminders.set(id, { reminderId: id, reminderReq: request }); return id; },
  };
  const notification = { SlotType: { SERVICE_INFORMATION: 2, CONTENT_INFORMATION: 3 }, isNotificationEnabledSync: () => enabled, async addSlot(slot) { slots.push(slot); } };
  const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
  class Clock extends Date { static now() { return now; } }
  const context = { exports: {}, Date: Clock, require: name => name === '@kit.BackgroundTasksKit' ? { reminderAgentManager: agent } : { notificationManager: notification } };
  vm.runInNewContext(output, context);
  const scheduler = new context.exports.ReminderScheduler();
  let failures = 0;
  return { scheduler, published, cancelled, slots, setEnabled: value => { enabled = value; }, setNow: value => { now = value; }, get now() { return now; }, get failures() { return failures; }, async sync(items) { scheduler.sync(JSON.stringify(items), () => failures++); await scheduler.queue; } };
}
test('Harmony uses service notifications and updates queues without cancelling a due reminder', async () => {
  const f = fixture();
  const one = { key: 'one', title: '任务一', body: '到时', at: f.now + 60000 };
  const two = { key: 'two', title: '任务二', body: '到时', at: f.now + 120000 };
  await f.sync([one]); await f.sync([one, two]);
  assert.equal(f.published.length, 2);
  assert.ok(f.published.every(request => request.slotType === 2 && request.notificationId > 0));
  assert.equal(f.cancelled.length, 0);
  f.setNow(one.at + 1000);
  await f.sync([two]);
  assert.equal(f.cancelled.length, 0);
  assert.equal(f.scheduler.hasScheduled('one'), true);
  await f.sync([]);
  assert.deepEqual(f.cancelled, ['all']);
  assert.equal(f.scheduler.hasScheduled('one'), false);
});
test('denied permission does not erase existing reminders; same payload can retry after grant', async () => {
  const f = fixture();
  const item = { key: 'task', title: '任务', body: '到时', at: f.now + 60000 };
  f.setEnabled(false); await f.sync([item]);
  assert.equal(f.failures, 1); assert.equal(f.cancelled.length, 0);
  f.setEnabled(true); await f.sync([item]);
  assert.equal(f.published.length, 1); assert.equal(f.failures, 1);
});
