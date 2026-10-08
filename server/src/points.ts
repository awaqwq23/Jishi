import { ApiError, readJson } from './security';

type Row = Record<string, unknown>;
export const pointsSchema = [
  `CREATE TABLE IF NOT EXISTS point_rules (user_id TEXT PRIMARY KEY, signin_reward INTEGER NOT NULL DEFAULT 5, signin_penalty INTEGER NOT NULL DEFAULT 0, task_reward INTEGER NOT NULL DEFAULT 10, task_penalty INTEGER NOT NULL DEFAULT 0, habit_reward INTEGER NOT NULL DEFAULT 5, habit_penalty INTEGER NOT NULL DEFAULT 0, started_at TEXT NOT NULL, settled_date TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS point_ledger (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, event_key TEXT NOT NULL, amount INTEGER NOT NULL, units INTEGER NOT NULL, label TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(user_id,event_key))`,
  `CREATE INDEX IF NOT EXISTS idx_point_ledger_user ON point_ledger(user_id,created_at)`,
  `CREATE TABLE IF NOT EXISTS daily_checkins (user_id TEXT NOT NULL, checkin_date TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(user_id,checkin_date))`,
  `CREATE TABLE IF NOT EXISTS shop_products (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, cost INTEGER NOT NULL CHECK(cost>0), created_at TEXT NOT NULL)`,
];

export function beijingDate(now = new Date()) { return new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10); }
function occurs(item: Row, date: string) {
  if (date < String(item.start_date) || date < beijingDate(new Date(String(item.created_at)))) return false;
  if (item.recurrence === 'once') return date === item.start_date;
  if (item.recurrence === 'daily') return true;
  const day = new Date(`${date}T12:00:00+08:00`).getUTCDay();
  if (item.recurrence === 'holidays') return day === 0 || day === 6;
  return (JSON.parse(String(item.weekdays_json)) as number[]).includes(day);
}
function integer(value: unknown, positive = false) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < (positive ? 1 : 0) || value > 100000) throw new ApiError(400, '积分应为有效整数，范围为 0 至 100000（商品至少 1 积分）');
  return value;
}
export async function settlePoints(db: D1Database, userId: string) {
  const now = new Date().toISOString(), today = beijingDate();
  // No retroactive deductions or rewards before the user first enables this module.
  const rules = await db.prepare('SELECT * FROM point_rules WHERE user_id=?').bind(userId).first<Row>();
  if (!rules) return;
  const entry = (key: string, amount: number, label: string) => db.prepare('INSERT OR IGNORE INTO point_ledger (id,user_id,event_key,amount,units,label,created_at) VALUES (?,?,?,?,?,?,?)').bind(crypto.randomUUID(), userId, key, amount, amount, label, now);
  const statements: D1PreparedStatement[] = [];
  const todos = await db.prepare('SELECT * FROM todos WHERE user_id=?').bind(userId).all<Row>();
  for (const item of todos.results) {
    const key = `task:${item.id}`;
    if (item.completed_at && String(item.completed_at) >= String(rules.started_at)) statements.push(entry(key, Number(rules.task_reward), `完成任务：${item.title}`));
    statements.push(db.prepare('UPDATE point_ledger SET amount=CASE WHEN ? IS NULL THEN 0 ELSE units END WHERE user_id=? AND event_key=?').bind(item.completed_at, userId, key));
    if (item.deadline && item.status === 'active' && new Date(String(item.deadline)).getTime() >= new Date(String(rules.started_at)).getTime() && new Date(String(item.deadline)).getTime() < Date.now()) statements.push(entry(`miss:${key}`, -Number(rules.task_penalty), `任务逾期：${item.title}`));
    if (item.deadline && item.status === 'active' && new Date(String(item.deadline)).getTime() < Date.now()) statements.push(db.prepare('UPDATE point_ledger SET amount=units WHERE user_id=? AND event_key=?').bind(userId, `miss:${key}`));
    if (item.completed_at) statements.push(db.prepare('UPDATE point_ledger SET amount=0 WHERE user_id=? AND event_key=?').bind(userId, `miss:${key}`));
  }
  const schedules = await db.prepare("SELECT * FROM schedule_items WHERE user_id=? AND status='active'").bind(userId).all<Row>();
  const records = await db.prepare('SELECT * FROM schedule_records WHERE user_id=?').bind(userId).all<Row>();
  for (const item of schedules.results) {
    const missedPrefix = `miss:schedule:${item.id}:`, rewardPrefix = `schedule:${item.id}:`;
    statements.push(db.prepare("UPDATE point_ledger SET amount=units WHERE user_id=? AND substr(event_key,1,?)=? AND NOT EXISTS (SELECT 1 FROM schedule_records r WHERE r.user_id=? AND r.item_id=? AND point_ledger.event_key='miss:schedule:'||r.item_id||':'||r.occurrence_date)").bind(userId, missedPrefix.length, missedPrefix, userId, item.id));
    for (const record of records.results.filter(record => record.item_id === item.id && String(record.completed_at) >= String(rules.started_at) && String(record.occurrence_date) <= today && occurs(item, String(record.occurrence_date)))) {
      const key = `schedule:${item.id}:${record.occurrence_date}`;
      statements.push(entry(key, Number(item.kind === 'habit' ? rules.habit_reward : rules.task_reward), `完成${item.kind === 'habit' ? '习惯' : '定期任务'}：${item.title}（${record.occurrence_date}）`));
      statements.push(db.prepare('UPDATE point_ledger SET amount=units WHERE user_id=? AND event_key=?').bind(userId, key));
      statements.push(db.prepare('UPDATE point_ledger SET amount=0 WHERE user_id=? AND event_key=?').bind(userId, `miss:${key}`));
    }
    statements.push(db.prepare("UPDATE point_ledger SET amount=0 WHERE user_id=? AND substr(event_key,1,?)=? AND NOT EXISTS (SELECT 1 FROM schedule_records r WHERE r.user_id=? AND r.item_id=? AND point_ledger.event_key='schedule:'||r.item_id||':'||r.occurrence_date)").bind(userId, rewardPrefix.length, rewardPrefix, userId, item.id));
  }
  const checked = await db.prepare('SELECT checkin_date FROM daily_checkins WHERE user_id=?').bind(userId).all<{checkin_date: string}>();
  const dates = new Set(checked.results.map(item => item.checkin_date));
  let date = String(rules.settled_date);
  while (date < today) {
    if (!dates.has(date)) statements.push(entry(`miss:signin:${date}`, -Number(rules.signin_penalty), `未签到：${date}`));
    for (const item of schedules.results) {
      if (!occurs(item, date) || records.results.some(record => record.item_id === item.id && record.occurrence_date === date)) continue;
      statements.push(entry(`miss:schedule:${item.id}:${date}`, -Number(item.kind === 'habit' ? rules.habit_penalty : rules.task_penalty), `未完成${item.kind === 'habit' ? '习惯' : '定期任务'}：${item.title}（${date}）`));
    }
    date = new Date(new Date(`${date}T00:00:00Z`).getTime() + 86400000).toISOString().slice(0, 10);
  }
  for (let index = 0; index < statements.length; index += 80) await db.batch(statements.slice(index, index + 80));
  await db.prepare('UPDATE point_rules SET settled_date=? WHERE user_id=? AND settled_date<?').bind(today, userId, today).run();
}
export async function pointsState(db: D1Database, userId: string) {
  await settlePoints(db, userId);
  const [rules, balance, checked, products, ledger] = await Promise.all([
    db.prepare('SELECT signin_reward signinReward,signin_penalty signinPenalty,task_reward taskReward,task_penalty taskPenalty,habit_reward habitReward,habit_penalty habitPenalty FROM point_rules WHERE user_id=?').bind(userId).first(),
    db.prepare('SELECT COALESCE(SUM(amount),0) balance FROM point_ledger WHERE user_id=?').bind(userId).first<{balance:number}>(),
    db.prepare('SELECT checkin_date date FROM daily_checkins WHERE user_id=? AND checkin_date=?').bind(userId, beijingDate()).first(),
    db.prepare('SELECT id,name,cost FROM shop_products WHERE user_id=? ORDER BY created_at DESC').bind(userId).all(),
    db.prepare('SELECT id,amount,label,created_at createdAt FROM point_ledger WHERE user_id=? ORDER BY created_at DESC,rowid DESC LIMIT 100').bind(userId).all(),
  ]);
  return { enabled: !!rules, rules: rules || {signinReward:5,signinPenalty:0,taskReward:10,taskPenalty:0,habitReward:5,habitPenalty:0}, balance: balance?.balance || 0, checkedIn: !!checked, today: beijingDate(), products: products.results, ledger: ledger.results };
}
export async function pointsAction(request: Request, db: D1Database, userId: string) {
  const url = new URL(request.url), path = url.pathname;
  await settlePoints(db, userId);
  if (path === '/api/points' && request.method === 'GET') return pointsState(db, userId);
  const body = request.method === 'DELETE' ? {} : await readJson(request, 8192);
  const now = new Date().toISOString();
  if (path === '/api/points/rules' && request.method === 'PUT') {
    const values = ['signinReward','signinPenalty','taskReward','taskPenalty','habitReward','habitPenalty'].map(key => integer(body[key]));
    await db.prepare('INSERT INTO point_rules (user_id,signin_reward,signin_penalty,task_reward,task_penalty,habit_reward,habit_penalty,started_at,settled_date) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET signin_reward=excluded.signin_reward,signin_penalty=excluded.signin_penalty,task_reward=excluded.task_reward,task_penalty=excluded.task_penalty,habit_reward=excluded.habit_reward,habit_penalty=excluded.habit_penalty').bind(userId, ...values, now, beijingDate()).run();
  } else if (path === '/api/points/checkin' && request.method === 'POST') {
    const rules = await db.prepare('SELECT signin_reward FROM point_rules WHERE user_id=?').bind(userId).first<{signin_reward:number}>();
    if (!rules) throw new ApiError(400, '请先保存积分规则以开启打卡');
    const date = beijingDate();
    await db.batch([
      db.prepare('INSERT OR IGNORE INTO daily_checkins VALUES (?,?,?)').bind(userId, date, now),
      db.prepare('INSERT OR IGNORE INTO point_ledger VALUES (?,?,?,?,?,?,?)').bind(crypto.randomUUID(), userId, `signin:${date}`, rules.signin_reward, rules.signin_reward, `每日签到：${date}`, now),
    ]);
  } else if (path === '/api/shop/products' && (request.method === 'POST' || request.method === 'PATCH')) {
    const name = String(body.name || '').trim(), cost = integer(body.cost, true);
    if (!name || name.length > 80) throw new ApiError(400, '商品名称应为 1 至 80 个字');
    if (request.method === 'POST') await db.prepare('INSERT INTO shop_products VALUES (?,?,?,?,?)').bind(crypto.randomUUID(), userId, name, cost, now).run();
    else {
      const result = await db.prepare('UPDATE shop_products SET name=?,cost=? WHERE id=? AND user_id=?').bind(name, cost, String(body.id || ''), userId).run();
      if (!result.meta.changes) throw new ApiError(404, '商品不存在');
    }
  } else if (path === '/api/shop/products' && request.method === 'DELETE') {
    await db.prepare('DELETE FROM shop_products WHERE id=? AND user_id=?').bind(url.searchParams.get('id') || '', userId).run();
  } else if (path === '/api/shop/redeem' && request.method === 'POST') {
    const token = String(body.requestId || ''), productId = String(body.productId || '');
    if (!/^[a-zA-Z0-9-]{16,80}$/.test(token)) throw new ApiError(400, '兑换请求标识无效');
    const key = `redeem:${token}`;
    const previous = await db.prepare('SELECT id FROM point_ledger WHERE user_id=? AND event_key=?').bind(userId, key).first();
    if (!previous) {
      const product = await db.prepare('SELECT id FROM shop_products WHERE id=? AND user_id=?').bind(productId, userId).first();
      if (!product) throw new ApiError(404, '商品不存在');
      // A single SQL statement checks the current balance and spends it atomically.
      const result = await db.prepare("INSERT OR IGNORE INTO point_ledger (id,user_id,event_key,amount,units,label,created_at) SELECT ?,?,?, -cost,-cost,'兑换成功：'||name,? FROM shop_products WHERE id=? AND user_id=? AND cost<=(SELECT COALESCE(SUM(amount),0) FROM point_ledger WHERE user_id=?)").bind(crypto.randomUUID(), userId, key, now, productId, userId, userId).run();
      if (!result.meta.changes && !await db.prepare('SELECT id FROM point_ledger WHERE user_id=? AND event_key=?').bind(userId,key).first()) throw new ApiError(409, '积分不足，无法兑换');
    }
  } else throw new ApiError(405, '此操作不受支持');
  return pointsState(db, userId);
}
