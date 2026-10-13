// All records and pending writes are scoped to the signed-in email. Credentials
// are encrypted with a non-exportable device key, never placed in localStorage.
const DB = 'jishi-offline-v1';
const ACTIVE = 'jishi-offline-active-v1';
const clone = value => typeof structuredClone === 'function' ? structuredClone(value) : value === undefined ? undefined : JSON.parse(JSON.stringify(value));
function uuid() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16)); bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
const fail = (message, status) => Object.assign(new Error(message), { status });
export const unavailable = error => !error?.status || error.status >= 500;

export async function deviceStore() {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('accounts');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const run = (mode, action) => new Promise((resolve, reject) => {
    const transaction = db.transaction('accounts', mode);
    const request = action(transaction.objectStore('accounts'));
    transaction.oncomplete = () => resolve(request.result);
    transaction.onabort = transaction.onerror = () => reject(transaction.error);
  });
  const writes = new Map();
  const put = (key, value) => {
    const preceding = writes.get(key) || Promise.resolve();
    const writing = preceding.catch(() => {}).then(() => new Promise((resolve, reject) => {
      const transaction = db.transaction('accounts', 'readwrite'), store = transaction.objectStore('accounts');
      const revision = value.revision || 0;
      let reason;
      const current = store.get(key);
      current.onsuccess = () => {
        if ((current.result?.revision || 0) !== revision) {
          reason = fail('另一个页面已更新本机内容。待同步记录仍保留，请重新打开此页面后重试', 409);
          transaction.abort(); return;
        }
        store.put({ ...value, revision: revision + 1 }, key);
      };
      transaction.oncomplete = () => { value.revision = revision + 1; resolve(); };
      transaction.onabort = transaction.onerror = () => reject(reason || transaction.error);
    }));
    writes.set(key, writing); return writing;
  };
  return { get: key => run('readonly', s => s.get(key)), put };
}

async function seal(password) {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  return { key, iv, bytes: await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(password)) };
}
async function unseal(value) {
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: value.iv }, value.key, value.bytes));
}

function emptyAccount(email, name) {
  return { user: { id: `local-${uuid()}`, email, name: name || email.split('@')[0], settings: {} }, todos: [], categories: [], reminderPresets: [], schedules: [], scheduleRecords: [], diaryEntries: [], points: { enabled: false, balance: 0, checkedIn: false, today: new Date().toISOString().slice(0, 10), rules: { signinReward: 5, signinPenalty: 0, taskReward: 10, taskPenalty: 0, habitReward: 5, habitPenalty: 0 }, products: [], ledger: [] } };
}

function entity(data, path, body = {}) {
  const url = new URL(path, 'https://local.invalid');
  const parts = url.pathname.split('/');
  if (parts[2] === 'profile') return data.user;
  if (url.pathname === '/api/points/rules') return data.points.rules;
  if (url.pathname === '/api/shop/products') return data.points.products.find(x => x.id === (body.id || url.searchParams.get('id'))) || null;
  if (parts[2] === 'diary') return data.diaryEntries.find(x => x.entryDate === parts[3]) || null;
  if (parts[2] === 'todos') return data.todos.find(x => x.id === parts[3]) || null;
  if (parts[2] === 'schedules') return parts[4] === 'completion' ? null : data.schedules.find(x => x.id === parts[3]) || null;
  const list = parts[2] === 'categories' ? data.categories : parts[2] === 'presets' ? data.reminderPresets : [];
  return list.find(x => x.id === url.searchParams.get('id')) || null;
}

export function applyLocal(data, operation) {
  const { path, method, body = {}, id } = operation;
  const now = new Date().toISOString();
  const url = new URL(path, 'https://local.invalid'), parts = url.pathname.split('/');
  const section = parts[2];
  if (path === '/api/points/rules') {
    if (Object.values(body).some(x => !Number.isSafeInteger(x) || x < 0 || x > 100000)) throw fail('积分规则无效', 400);
    data.points.rules = { ...data.points.rules, ...body }; data.points.enabled = true; return clone(data.points);
  }
  if (path === '/api/points/checkin') {
    if (!data.points.enabled) throw fail('请先保存积分规则', 400);
    const date = body.date, key = `signin:${date}`;
    if (!data.points.ledger.some(x => x.id === key)) {
      data.points.ledger.unshift({ id: key, amount: data.points.rules.signinReward, label: `每日签到：${date}（待同步）`, createdAt: now }); data.points.balance += data.points.rules.signinReward;
    }
    data.points.today = date; data.points.checkedIn = true; return clone(data.points);
  }
  if (url.pathname === '/api/shop/products') {
    const targetId = body.id || url.searchParams.get('id');
    if (method === 'DELETE') data.points.products = data.points.products.filter(x => x.id !== targetId);
    else {
      if (!String(body.name || '').trim() || body.name.length > 80 || !Number.isSafeInteger(body.cost) || body.cost < 1 || body.cost > 100000) throw fail('商品名称或积分无效', 400);
      const product = { id: method === 'POST' ? id : targetId, name: body.name.trim(), cost: body.cost };
      data.points.products = [...data.points.products.filter(x => x.id !== product.id), product];
    }
    return clone(data.points);
  }
  if (section === 'profile' && method === 'PATCH') { data.user = { ...data.user, ...body }; return { user: data.user }; }
  if (section === 'diary' && method === 'PUT') {
    const old = entity(data, path);
    const entry = { id: old?.id || id, entryDate: parts[3], createdAt: old?.createdAt || now, updatedAt: now, content: String(body.content || '') };
    data.diaryEntries = [...data.diaryEntries.filter(x => x.entryDate !== entry.entryDate), entry].sort((a, b) => b.entryDate.localeCompare(a.entryDate)); return { entry };
  }
  if (section === 'schedules' && parts[4] === 'completion' && method === 'PUT') {
    data.scheduleRecords = data.scheduleRecords.filter(x => !(x.itemId === parts[3] && x.occurrenceDate === body.occurrenceDate));
    const record = body.completed ? { id, itemId: parts[3], occurrenceDate: body.occurrenceDate, completedAt: now } : null;
    if (record) data.scheduleRecords.push(record); return { record };
  }
  const specs = { todos: ['todos', 'todo', 60], schedules: ['schedules', 'item', 80], categories: ['categories', 'category', 12], presets: ['reminderPresets', 'preset', 20] };
  const spec = specs[section];
  if (!spec) throw fail('此操作需要联网后完成，本地内容仍已保存', 503);
  const [key, resultKey, limit] = spec;
  const targetId = parts[3] || url.searchParams.get('id');
  const current = data[key].find(x => x.id === targetId);
  if (method === 'DELETE') {
    if (['todos', 'schedules'].includes(section) && current?.status !== 'deleted') throw fail('请先移入回收站', 400);
    if (['categories', 'presets'].includes(section) && data[key].length <= 1) throw fail('至少保留一项', 400);
    data[key] = data[key].filter(x => x.id !== targetId);
    if (section === 'schedules') data.scheduleRecords = data.scheduleRecords.filter(x => x.itemId !== targetId);
    if (section === 'categories') data.todos = data.todos.map(x => x.categoryId === targetId ? { ...x, categoryId: data.categories[0]?.id || null } : x);
    if (section === 'presets') data.todos = data.todos.map(x => x.reminderPresetId === targetId ? { ...x, reminderPresetId: null } : x);
    return { ok: true };
  }
  if (method !== 'POST' && !current) throw fail('本地记录不存在', 404);
  const item = { ...(section === 'todos' ? { content: '', notes: '', priority: 'normal', deadline: null, reminderPresetId: null, reminderOffsets: [], categoryId: null, status: 'active', completedAt: null, deletedAt: null } : section === 'schedules' ? { kind: 'routine', notes: '', recurrence: 'daily', startDate: now.slice(0, 10), timeOfDay: null, weekdays: [], status: 'active', deletedAt: null } : { isDefault: 0, color: '#8d82a6', offsets: [10] }), createdAt: now, ...current, ...body, id: current?.id || id, updatedAt: now };
  const title = String(item.title ?? item.name ?? '').trim();
  if (!title || title.length > limit) throw fail(`名称应为 1 至 ${limit} 个字`, 400);
  if (section === 'todos') {
    item.title = title;
    if (body.status === 'completed') item.completedAt = current?.completedAt || now;
    if (body.status === 'active') { item.completedAt = null; item.deletedAt = null; }
    if (body.status === 'deleted') item.deletedAt = now;
    item.reminderOffsets = data.reminderPresets.find(x => x.id === item.reminderPresetId)?.offsets || item.reminderOffsets;
  }
  if (section === 'schedules') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(item.startDate) || !['once', 'daily', 'weekly', 'custom', 'holidays'].includes(item.recurrence)) throw fail('日期或重复规则无效', 400);
    if (['weekly', 'custom'].includes(item.recurrence) && !item.weekdays.length) throw fail('请至少选择一个星期', 400);
    item.deletedAt = item.status === 'deleted' ? now : null;
  }
  if (section === 'presets' && (!Array.isArray(item.offsets) || !item.offsets.length || item.offsets.some(x => !Number.isFinite(x) || x <= 0))) throw fail('提醒时间无效', 400);
  data[key] = current ? data[key].map(x => x.id === current.id ? item : x) : [...data[key], item];
  return { [resultKey]: clone(item) };
}

export class OfflineClient {
  constructor({ storage, transport, active, setActive, emit = () => {}, legacyLogin = null, onLegacyImported = () => {} }) {
    Object.assign(this, { storage, transport, active, setActive, emit, legacyLogin, onLegacyImported });
    this.account = null; this.busy = null; this.offline = false; this.issue = '';
    this.legacyAutoEmail = ''; this.migration = null; this.requiresLogin = false;
  }
  async migrateLegacy() {
    if (this.migration) return this.migration;
    this.migration = (async () => {
      const saved = this.legacyLogin;
      if (!saved?.password || !saved.rememberPassword) return;
      const email = String(saved.email || '').trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || typeof saved.password !== 'string' || saved.password.length < 8) return;
      const account = await this.storage.get(email) || { email, data: emptyAccount(email), queue: [], local: false };
      account.credentials = await seal(saved.password);
      await this.storage.put(email, account);
      if (saved.autoLogin) this.legacyAutoEmail = email;
      this.legacyLogin = null; this.onLegacyImported();
    })();
    return this.migration;
  }
  status() { return { offline: this.offline, pending: this.account?.queue.length || 0, issue: this.issue }; }
  notify() { this.emit(this.account ? clone(this.account.data) : null, this.status()); }
  async save() { await this.storage.put(this.account.email, this.account); this.notify(); }
  async open() {
    await this.migrateLegacy();
    const email = this.active();
    if (email) this.account = await this.storage.get(email) || null;
    if (this.account) { this.notify(); void this.sync(); return clone(this.account.data); }
    let data;
    try { data = await this.transport('/api/bootstrap'); }
    catch (error) {
      if (!this.legacyAutoEmail || !(unavailable(error) || error.status === 401)) throw error;
      this.account = await this.storage.get(this.legacyAutoEmail);
      this.setActive(this.account.email); this.notify(); void this.sync(); return clone(this.account.data);
    }
    const emailKey = data.user.email.toLowerCase();
    this.account = await this.storage.get(emailKey) || { email: emailKey, data, queue: [], credentials: null, local: false };
    if (!this.account.queue.length) this.account.data = data;
    this.account.local = false;
    await this.save(); this.setActive(this.account.email); void this.sync(); return clone(this.account.data);
  }
  async authenticate(mode, { email, password, name }) {
    await this.migrateLegacy();
    email = String(email).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 8 || password.length > 128) throw fail('请填写有效邮箱和至少 8 位密码', 400);
    const saved = await this.storage.get(email);
    try {
      await this.transport(`/api/auth/${mode}`, { method: 'POST', body: JSON.stringify({ email, password, name }) });
      const cloud = await this.transport('/api/bootstrap');
      this.account = saved || { email, data: cloud, queue: [], local: false };
      if (!this.account.queue.length) this.account.data = cloud;
      this.account.local = false; this.offline = false;
    } catch (error) {
      if (!unavailable(error)) throw error;
      if (saved) {
        if (!saved.credentials || await unseal(saved.credentials) !== password) throw fail('本机账号或密码不正确', 401);
        this.account = saved;
      } else {
        if (mode !== 'register') throw fail('本机尚未保存此账号。可先离线创建账号，联网后同步', 401);
        this.account = { email, data: emptyAccount(email, name), queue: [], local: true };
      }
      this.offline = true;
    }
    this.account.credentials = await seal(password);
    this.requiresLogin = false; this.issue = '';
    await this.save(); this.setActive(email); void this.sync();
  }
  async request(path, init = {}) {
    if (path === '/api/bootstrap') return this.open();
    if (path === '/api/auth/logout') { this.setActive(''); this.account = null; try { await this.transport(path, init); } catch { /* Local sign-out is authoritative on this device. */ } return { ok: true }; }
    if (path.startsWith('/api/auth/')) return this.authenticate(path.endsWith('register') ? 'register' : 'login', JSON.parse(init.body));
    if (!this.account) return this.transport(path, init);
    if (this.active() !== this.account.email) throw fail('另一个页面已切换账号，请重新打开此页面；原账号的待同步内容仍保留', 409);
    const scopedInit = { ...init, headers: { ...(init.headers || {}), 'X-Jishi-Account-Email': this.account.email } };
    const method = init.method || 'GET';
    if (method === 'GET') {
      if (path === '/api/points') {
        if (this.offline || this.account.queue.length) {
          const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
          if (this.account.data.points.today !== today) { this.account.data.points.today = today; this.account.data.points.checkedIn = false; }
          return { ...clone(this.account.data.points), provisional: true };
        }
        const points = await this.transport(path, scopedInit); this.account.data.points = points; await this.save(); return points;
      }
      return this.transport(path, scopedInit);
    }
    if (!/^\/api\/(todos|schedules|categories|presets|diary|profile)(\/|\?|$)/.test(path) && !['/api/points/rules', '/api/points/checkin', '/api/shop/products'].includes(path.split('?')[0])) {
      if (this.offline || this.account.queue.length) throw fail('请联网并完成同步后再操作积分、兑换或导入', 409);
      return this.transport(path, scopedInit);
    }
    const body = init.body ? JSON.parse(init.body) : {};
    const operation = { id: uuid(), path, method, body, base: clone(entity(this.account.data, path, body)) };
    if (path === '/api/points/checkin') operation.body.date = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
    const draft = clone(this.account.data), result = applyLocal(draft, operation);
    if (method === 'POST' && ['/api/todos', '/api/schedules'].includes(path)) operation.body.clientCreatedAt = (result.todo || result.item).createdAt;
    if (path.startsWith('/api/todos/') && body.status === 'completed') operation.body.clientCompletedAt = result.todo.completedAt;
    if (path.startsWith('/api/schedules/') && path.endsWith('/completion') && result.record) operation.body.clientCompletedAt = result.record.completedAt;
    if (path.startsWith('/api/diary/') && !operation.base) operation.body.clientCreatedAt = result.entry.createdAt;
    if (path === '/api/points/rules' && !this.account.data.points.enabled) operation.body.clientEnabledAt = new Date().toISOString();
    if (path.startsWith('/api/points/') || path.startsWith('/api/shop/')) { result.provisional = true; draft.points.provisional = true; }
    // Persist the mutation and its retry identity together before reporting success.
    const oldData = this.account.data;
    this.account.data = draft; this.account.queue.push(operation);
    try { await this.save(); } catch (error) { this.account.data = oldData; this.account.queue = this.account.queue.filter(item => item.id !== operation.id); throw error; }
    void this.sync(); return result;
  }
  async sync() {
    if (this.requiresLogin) return;
    if (!this.account || this.busy) return this.busy;
    const account = this.account;
    this.busy = this.flush(account).finally(() => { this.busy = null; });
    return this.busy;
  }
  async flush(account) {
    try {
      if (this.active() !== account.email) return;
      let cloud;
      try { if (!account.local) cloud = await this.transport('/api/bootstrap'); }
      catch (error) { if (error.status !== 401) throw error; }
      if (cloud?.user.email.toLowerCase() !== account.email) cloud = null;
      if (!cloud && account.credentials) {
        const password = await unseal(account.credentials);
        if (account.local) {
          try { await this.transport('/api/auth/register', { method: 'POST', body: JSON.stringify({ email: account.email, password, name: account.data.user.name }) }); }
          catch (error) { if (error.status !== 409) throw error; }
        }
        await this.transport('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: account.email, password }) });
      }
      cloud ||= await this.transport('/api/bootstrap');
      if (cloud.user.email.toLowerCase() !== account.email) throw fail('云端账号与本机账号不同，已暂停同步', 409);
      if (this.account !== account || this.active() !== account.email) return;
      this.offline = false; this.issue = ''; account.local = false;
      while (account.queue.length) {
        const operation = account.queue[0], current = entity(cloud, operation.path, operation.body);
        if (operation.path.startsWith('/api/diary/') && !operation.base && current && current.content !== operation.body.content) throw fail('云端已有这一天的日记，本地日记已保留，请先备份后处理冲突', 409);
        if (operation.method === 'DELETE' && !current) { account.queue.shift(); await this.storage.put(account.email, account); continue; }
        if (operation.method !== 'POST' && operation.base) {
          const fields = operation.method === 'DELETE' ? Object.keys(operation.base).filter(x => x !== 'updatedAt') : Object.keys(operation.body);
          if (!current || fields.some(key => JSON.stringify(current[key]) !== JSON.stringify(operation.base[key]) && JSON.stringify(current[key]) !== JSON.stringify(operation.body[key]))) throw fail('同一条内容在云端也有修改，本地修改已保留，请导出备份后处理冲突', 409);
        }
        if (this.active() !== account.email) return;
        await this.transport(operation.path, { method: operation.method, headers: { 'X-Jishi-Account-Email': account.email, 'X-Jishi-Create-Id': operation.id, ...(current?.updatedAt ? { 'If-Match': current.updatedAt } : {}) }, body: operation.method === 'DELETE' ? undefined : JSON.stringify(operation.body) });
        account.queue.shift();
        await this.storage.put(account.email, account);
        cloud = await this.transport('/api/bootstrap');
        if (this.account !== account) return;
      }
      account.data = cloud; await this.save();
    } catch (error) {
      if (this.account !== account) return;
      this.offline = unavailable(error); this.issue = this.offline ? '' : error.message;
      if (error.status === 401 || error.status === 429) { this.requiresLogin = true; this.issue = '云端登录未通过。请在“我的”退出并重新登录以更新本机密码；本机记录及待同步内容仍保留'; }
      this.notify();
    }
  }
}

let client, initializing;
export async function offlineRequest(path, init, transport, legacyLogin, onLegacyImported) {
  if (!client) {
    initializing ||= (async () => new OfflineClient({ storage: await deviceStore(), transport, legacyLogin, onLegacyImported, active: () => localStorage.getItem(ACTIVE), setActive: email => {
    if (email) { localStorage.setItem(ACTIVE, email); localStorage.removeItem(`${ACTIVE}:signed-out`); }
    else { localStorage.removeItem(ACTIVE); localStorage.setItem(`${ACTIVE}:signed-out`, 'true'); }
    }, emit: (data, status) => window.dispatchEvent(new CustomEvent('jishi-local-data', { detail: { data, status } })) }))();
    client = await initializing;
  }
  await client.migrateLegacy();
  if (path === '/api/bootstrap' && localStorage.getItem(`${ACTIVE}:signed-out`) === 'true') throw fail('请先登录后再继续', 401);
  if (!client.storageListenerInstalled) {
    client.storageListenerInstalled = true;
    window.addEventListener('storage', event => { if (event.key === ACTIVE && client.account && event.newValue !== client.account.email) { client.account = null; window.location.reload(); } });
  }
  return client.request(path, init);
}
export async function reconnect() { await client?.sync(); }
export async function forgetLocalCredentials() {
  if (client?.account) { client.account.credentials = null; await client.save(); }
}
export function exportLocalBackup() {
  if (!client?.account) return;
  const blob = new Blob([JSON.stringify({ schemaVersion: 1, exportedAt: new Date().toISOString(), data: client.account.data, pending: client.account.queue }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob), anchor = document.createElement('a');
  anchor.href = url; anchor.download = `拾光记事-本机备份-${new Date().toISOString().slice(0, 10)}.json`; anchor.click(); URL.revokeObjectURL(url);
}
