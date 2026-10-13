const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createReminderStore } = require('./reminder-store.cjs');
function cleanup(folder) {
  assert.ok(fs.realpathSync(folder).startsWith(fs.realpathSync(os.tmpdir()) + path.sep));
  assert.equal(fs.lstatSync(folder).isSymbolicLink(), false);
  fs.rmSync(folder, { recursive:true, force:true });
}

test('reminders survive restart, long delays, clock jumps and deliver once', async t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'jishi-reminder-test-'));
  t.after(() => cleanup(folder));
  const file = path.join(folder,'reminders.json'); let now = 1000000; const seen = [];
  const options = {file, clock:()=>now, notify:item=>seen.push(item.key)};
  const first = createReminderStore(options);
  const at = now + 90 * 86400000;
  first.sync(JSON.stringify([{key:'long',title:'test',body:'test',at},{key:'long',title:'test',body:'test',at}]));
  const second = createReminderStore(options); second.restore(); now=at+1000; await second.tick(); await second.tick();
  assert.deepEqual(seen,['long']);
  const third=createReminderStore(options); third.restore(); await third.tick(); assert.equal(seen.length,1);
});
test('failed notification remains persisted and is retried after restart', async t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'jishi-reminder-test-'));
  t.after(() => cleanup(folder));
  const file = path.join(folder, 'queue.json'); let now = 0;
  const first = createReminderStore({ file, clock: () => now, notify: async () => { throw new Error('blocked'); } });
  first.sync(JSON.stringify([{ key: 'retry', title: 'test', body: 'test', at: 500 }]));
  now = 1000;
  await assert.rejects(first.tick(), /blocked/);
  assert.equal(JSON.parse(fs.readFileSync(file))[0].key, 'retry');
  const delivered = [];
  const restarted = createReminderStore({ file, clock: () => now, notify: async item => { delivered.push(item.key); return true; } });
  restarted.restore(); await restarted.tick(); await restarted.tick();
  assert.deepEqual(delivered, ['retry']);
  assert.deepEqual(JSON.parse(fs.readFileSync(file)), []);
});
test('disable cancels persisted reminders and malformed queues preserve valid data', async t => {
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'jishi-reminder-test-'));
  t.after(()=>cleanup(folder));
  let now=0; const seen=[];
  const store=createReminderStore({file:path.join(folder,'queue.json'),clock:()=>now,notify:item=>seen.push(item.key)});
  store.sync(JSON.stringify([{key:'soon',title:'test',body:'body',at:500}]));
  assert.throws(()=>store.sync('{}')); assert.throws(()=>store.sync('broken'));
  store.sync('[]'); now=1000; await store.tick(); assert.equal(seen.length,0);
});
