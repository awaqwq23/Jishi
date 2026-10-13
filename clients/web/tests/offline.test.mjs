import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { OfflineClient } from '../app/offline.mjs';

function fixture() {
  const records = new Map(); let active = '', connected = false, loseResponse = false;
  const data = { user: { id: 'cloud-user', email: 'offline@example.test', name: '离线测试', settings: {} }, todos: [], categories: [], reminderPresets: [], schedules: [], scheduleRecords: [], diaryEntries: [], points: {} };
  const transport = async (path, init = {}) => {
    if (!connected) throw new TypeError('network unavailable');
    if (path.startsWith('/api/auth/')) return { ok: true };
    if (path === '/api/bootstrap') return structuredClone(data);
    const body = JSON.parse(init.body || '{}');
    if (path === '/api/todos') {
      const id = init.headers['X-Jishi-Create-Id'];
      if (!data.todos.some(x => x.id === id)) data.todos.push({ ...body, id, updatedAt: new Date().toISOString() });
      if (loseResponse) { loseResponse = false; throw new TypeError('response lost after commit'); }
      return { todo: data.todos.find(x => x.id === id) };
    }
    if (path.startsWith('/api/todos/')) { Object.assign(data.todos.find(x => x.id === path.split('/').at(-1)), body); return {}; }
    return {};
  };
  const storage = { async get(key) { return structuredClone(records.get(key)); }, async put(key, value) { records.set(key, structuredClone(value)); } };
  const newClient = (Client = OfflineClient) => new Client({ storage, transport, active: () => active, setActive: value => { active = value; } });
  return { newClient, records, data, online: () => { connected = true; }, offline: () => { connected = false; }, lose: () => { loseResponse = true; } };
}

test('offline registration, password verification and pending edits survive a new instance', async () => {
  const f = fixture(), client = f.newClient();
  await client.authenticate('register', { email: 'offline@example.test', password: 'test-secret-123', name: '本机账号' });
  await client.sync();
  await client.request('/api/todos', { method: 'POST', body: JSON.stringify({ title: '断网时保存' }) });
  await client.sync();
  assert.equal(client.status().pending, 1);
  assert.ok(!JSON.stringify(f.records.get('offline@example.test')).includes('test-secret-123'));
  const restarted = f.newClient();
  const cached = await restarted.open(); await restarted.sync();
  assert.equal(cached.todos[0].title, '断网时保存');
  await assert.rejects(restarted.authenticate('login', { email: 'offline@example.test', password: 'incorrect-123' }), /本机账号或密码/);
  f.online(); await restarted.sync();
  assert.equal(restarted.status().pending, 0);
  assert.equal(f.data.todos.length, 1);
  assert.equal(f.data.todos[0].title, '断网时保存');
});

test('older WebViews without structuredClone or randomUUID can persist and synchronize offline data', async () => {
  const module = { exports: {} };
  const source = await readFile(new URL('../app/offline.mjs', import.meta.url), 'utf8');
  vm.runInNewContext(source.replace(/^export /gm, '') + '\nmodule.exports = { OfflineClient };', {
    module, URL, Uint8Array, TextEncoder, TextDecoder,
    crypto: { subtle: crypto.subtle, getRandomValues: crypto.getRandomValues.bind(crypto) },
  });
  const f = fixture(), client = f.newClient(module.exports.OfflineClient);
  await client.authenticate('register', { email: 'offline@example.test', password: 'test-secret-123' }); await client.sync();
  const { todo } = await client.request('/api/todos', { method: 'POST', body: JSON.stringify({ title: 'Legacy offline record' }) }); await client.sync();
  assert.match(todo.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  f.online(); await client.sync();
  assert.equal(client.status().pending, 0); assert.equal(f.data.todos[0].title, 'Legacy offline record');
});

test('lost response after a committed creation retries without duplication', async () => {
  const f = fixture(), client = f.newClient();
  await client.authenticate('register', { email: 'offline@example.test', password: 'test-secret-123' }); await client.sync();
  await client.request('/api/todos', { method: 'POST', body: JSON.stringify({ title: '只创建一次' }) }); await client.sync();
  f.online(); f.lose(); await client.sync();
  assert.equal(f.data.todos.length, 1); assert.equal(client.status().pending, 1);
  await f.newClient().open();
  await client.sync();
  assert.equal(f.data.todos.length, 1); assert.equal(client.status().pending, 0);
});

test('concurrent cloud changes retain the local edit and stop uploads', async () => {
  const f = fixture(), client = f.newClient();
  await client.authenticate('register', { email: 'offline@example.test', password: 'test-secret-123' }); await client.sync();
  await client.request('/api/todos', { method: 'POST', body: JSON.stringify({ title: '原来标题' }) }); await client.sync();
  f.online(); await client.sync();
  f.offline();
  await client.request(`/api/todos/${f.data.todos[0].id}`, { method: 'PATCH', body: JSON.stringify({ title: '本机标题' }) });
  await client.sync(); f.data.todos[0].title = '另一台设备标题'; f.online(); await client.sync();
  assert.equal(f.data.todos[0].title, '另一台设备标题');
  assert.equal(client.account.data.todos[0].title, '本机标题');
  assert.equal(client.status().pending, 1); assert.match(client.status().issue, /本地修改已保留/);
});

test('logging out never opens another account cache or discards its pending edits', async () => {
  const f = fixture(), client = f.newClient();
  await client.authenticate('register', { email: 'offline@example.test', password: 'test-secret-123' }); await client.sync();
  await client.request('/api/todos', { method: 'POST', body: JSON.stringify({ title: '第一个账号私有内容' }) }); await client.sync();
  await client.request('/api/auth/logout', { method: 'POST' });
  await assert.rejects(f.newClient().open());
  await client.authenticate('register', { email: 'second@example.test', password: 'second-secret-123' }); await client.sync();
  assert.equal(client.account.data.todos.length, 0);
  assert.equal(f.records.get('offline@example.test').queue.length, 1);
});
