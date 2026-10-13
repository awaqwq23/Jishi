import { ApiError, clientTimestamp, readJson } from './security';
import { beijingDate } from './points';

type Row = Record<string, unknown>;
export const guestSchema = [`CREATE TABLE IF NOT EXISTS guest_migrations (user_id TEXT PRIMARY KEY, migration_id TEXT NOT NULL UNIQUE, snapshot_hash TEXT NOT NULL, created_at TEXT NOT NULL)`];
const identifier = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function object(value: unknown): Row { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError(400, '游客备份格式无效'); return value as Row; }
function list(value: unknown): Row[] { if (!Array.isArray(value) || value.length > 5000) throw new ApiError(400, '游客记录格式无效或过多，本机备份仍保留'); return value.map(object); }
function text(value: unknown, max: number, required = false) { const result = String(value ?? ''); if (result.length > max || (required && !result.trim())) throw new ApiError(400, '游客记录内容无效'); return result; }
function id(value: unknown) { const result = String(value); if (!identifier.test(result)) throw new ApiError(400, '游客记录标识无效'); return result; }
function date(value: unknown) { const result = String(value), parsed=new Date(result+'T12:00:00Z'); if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0,10) !== result) throw new ApiError(400,'游客记录日期无效'); return result; }
function deadline(value:unknown){if(typeof value!=='string'||!value.includes('T')||!Number.isFinite(Date.parse(value)))throw new ApiError(400,'游客截止时间无效');return new Date(value).toISOString();}
function integer(value: unknown, signed = false) { if (!Number.isSafeInteger(value) || Number(value) > 100000 || Number(value) < (signed ? -100000 : 0)) throw new ApiError(400,'游客积分无效'); return Number(value); }

// One atomic D1 batch: a failed record leaves neither a migration marker nor a
// partially copied account. The nonce also makes a lost response safe to retry.
export async function importGuest(request: Request, db: D1Database, userId: string) {
  const body = await readJson(request, 8 * 1024 * 1024), migrationId = id(body.migrationId), data = object(body.snapshot);
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(data)))), n => n.toString(16).padStart(2,'0')).join('');
  const previous = await db.prepare('SELECT migration_id,snapshot_hash FROM guest_migrations WHERE user_id=?').bind(userId).first<Row>();
  if (previous) {
    if (previous.migration_id !== migrationId || previous.snapshot_hash !== hash) throw new ApiError(409,'此账号已接收过其他游客记录，本机备份仍保留');
    return { imported: true, repeated: true };
  }
  const now = new Date().toISOString(), today = beijingDate();
  const categories = list(data.categories), presets = list(data.reminderPresets), todos = list(data.todos), schedules = list(data.schedules), records = list(data.scheduleRecords), diaries = list(data.diaryEntries);
  const points = object(data.points), products = list(points.products), ledger = list(points.ledger), profile = object(data.user);
  const groups: [string, Row[]][] = [['categories',categories],['reminder_presets',presets],['todos',todos],['schedule_items',schedules],['schedule_records',records],['diary_entries',diaries],['shop_products',products]];
  for (const [table, rows] of groups) {
    const seen = new Set<string>();
    for (const row of rows) { const key = id(row.id); if (seen.has(key)) throw new ApiError(400,'游客记录标识重复'); seen.add(key); }
    // All dynamic table names come from the fixed groups above.
    for (let start=0;start<rows.length;start+=80) {
      const keys = rows.slice(start,start+80).map(row=>row.id);
      const other = await db.prepare(`SELECT id FROM ${table} WHERE id IN (${keys.map(()=>'?').join(',')}) AND user_id!=? LIMIT 1`).bind(...keys,userId).first();
      if (other) throw new ApiError(409,'游客标识已被使用，本机记录仍保留');
    }
  }
  const statements: D1PreparedStatement[] = [];
  // The empty-account guard is inside the atomic batch, rather than only an
  // earlier read; another page cannot add cloud data between those two steps.
  statements.push(db.prepare(`INSERT OR IGNORE INTO guest_migrations (user_id,migration_id,snapshot_hash,created_at) SELECT ?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM todos WHERE user_id=?) AND NOT EXISTS (SELECT 1 FROM schedule_items WHERE user_id=?) AND NOT EXISTS (SELECT 1 FROM diary_entries WHERE user_id=?) AND NOT EXISTS (SELECT 1 FROM point_rules WHERE user_id=?) AND NOT EXISTS (SELECT 1 FROM point_ledger WHERE user_id=?) AND NOT EXISTS (SELECT 1 FROM shop_products WHERE user_id=?) AND NOT EXISTS (SELECT 1 FROM categories WHERE user_id=? AND NOT ((name='默认' AND color='#9e8d74' AND is_default=1) OR (name='学习' AND color='#78928a' AND is_default=0) OR (name='娱乐' AND color='#8d82a6' AND is_default=0) OR (name='杂项' AND color='#b98572' AND is_default=0))) AND NOT EXISTS (SELECT 1 FROM reminder_presets WHERE user_id=? AND NOT ((name='默认' AND offsets_json='[720,360,180,10]' AND is_default=1) OR (name='仅 10 分钟前' AND offsets_json='[10]' AND is_default=0) OR (name='大事件' AND offsets_json='[10080,4320,1440]' AND is_default=0))) AND EXISTS (SELECT 1 FROM users WHERE id=? AND avatar_url IS NULL AND settings_json='{}')`).bind(userId,migrationId,hash,now,...Array(9).fill(userId)));
  const gate = 'EXISTS (SELECT 1 FROM guest_migrations WHERE user_id=? AND migration_id=? AND snapshot_hash=?)';
  const insert = (table:string, columns:string, values:unknown[]) => statements.push(db.prepare(`INSERT INTO ${table} (${columns}) SELECT ${values.map(()=>'?').join(',')} WHERE ${gate}`).bind(...values,userId,migrationId,hash));
  const categoryIds = new Set(categories.map(row=>row.id)), presetIds = new Set(presets.map(row=>row.id)), scheduleIds = new Set(schedules.map(row=>row.id));
  if (categories.length) statements.push(db.prepare(`DELETE FROM categories WHERE user_id=? AND ${gate}`).bind(userId,userId,migrationId,hash));
  if (presets.length) statements.push(db.prepare(`DELETE FROM reminder_presets WHERE user_id=? AND ${gate}`).bind(userId,userId,migrationId,hash));
  categories.forEach((row,index)=>insert('categories','id,user_id,name,color,is_default,created_at',[id(row.id),userId,text(row.name,12,true),/^#[a-f0-9]{6}$/i.test(String(row.color)) ? row.color : '#9e8d74',index===0?1:0,now]));
  presets.forEach((row,index)=>{
    if (!Array.isArray(row.offsets) || !row.offsets.length || row.offsets.length>8 || row.offsets.some(value=>!Number.isSafeInteger(value)||value<=0||value>525600)) throw new ApiError(400,'游客提醒组无效');
    insert('reminder_presets','id,user_id,name,offsets_json,is_default,created_at',[id(row.id),userId,text(row.name,20,true),JSON.stringify(row.offsets),index===0?1:0,now]);
  });
  for (const row of todos) {
    if (!['active','completed','deleted'].includes(String(row.status)) || !['low','normal','important','urgent'].includes(String(row.priority))) throw new ApiError(400,'游客待办状态无效');
    if ((row.categoryId && !categoryIds.has(row.categoryId)) || (row.reminderPresetId && !presetIds.has(row.reminderPresetId))) throw new ApiError(400,'游客待办关联无效');
    const offsets=Array.isArray(row.reminderOffsets)?row.reminderOffsets:[];
    if(offsets.length>8 || offsets.some(value=>!Number.isSafeInteger(value)||value<=0||value>525600))throw new ApiError(400,'游客提醒时间无效');
    insert('todos','id,user_id,title,content,deadline,reminder_preset_id,reminder_offsets_json,category_id,priority,notes,status,created_at,completed_at,deleted_at,updated_at',[id(row.id),userId,text(row.title,60,true),text(row.content,10000),row.deadline?deadline(row.deadline):null,row.reminderPresetId||null,JSON.stringify(offsets),row.categoryId||null,row.priority,text(row.notes,10000),row.status,clientTimestamp(row.createdAt),row.completedAt?clientTimestamp(row.completedAt):null,row.status==='deleted'?now:null,clientTimestamp(row.updatedAt)]);
  }
  for (const row of schedules) {
    if(!['routine','habit'].includes(String(row.kind))||!['once','daily','weekly','custom','holidays'].includes(String(row.recurrence))||!['active','deleted'].includes(String(row.status)))throw new ApiError(400,'游客计划状态无效');
    const weekdays=Array.isArray(row.weekdays)?row.weekdays:[];if(weekdays.some(value=>!Number.isInteger(value)||value<0||value>6))throw new ApiError(400,'游客计划星期无效');
    if(row.timeOfDay&&!/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(String(row.timeOfDay)))throw new ApiError(400,'游客计划时间无效');
    insert('schedule_items','id,user_id,title,kind,notes,recurrence,start_date,time_of_day,weekdays_json,status,created_at,updated_at,deleted_at',[id(row.id),userId,text(row.title,80,true),row.kind,text(row.notes,10000),row.recurrence,date(row.startDate),row.timeOfDay||null,JSON.stringify(weekdays),row.status,clientTimestamp(row.createdAt),clientTimestamp(row.updatedAt),row.status==='deleted'?now:null]);
  }
  const occurrenceKeys=new Set<string>();
  for(const row of records){const day=date(row.occurrenceDate),key=String(row.itemId)+':'+day;if(!scheduleIds.has(row.itemId)||occurrenceKeys.has(key))throw new ApiError(400,'游客完成记录关联无效');occurrenceKeys.add(key);insert('schedule_records','id,user_id,item_id,occurrence_date,completed_at',[id(row.id),userId,row.itemId,day,clientTimestamp(row.completedAt)]);}
  const diaryDates=new Set<string>();
  for(const row of diaries){const day=date(row.entryDate);if(diaryDates.has(day))throw new ApiError(400,'游客日记日期重复');diaryDates.add(day);insert('diary_entries','id,user_id,entry_date,content,created_at,updated_at',[id(row.id),userId,day,text(row.content,200000),clientTimestamp(row.createdAt),clientTimestamp(row.updatedAt)]);}
  for(const row of products){const cost=integer(row.cost);if(!cost)throw new ApiError(400,'商品积分必须大于0');insert('shop_products','id,user_id,name,cost,created_at',[id(row.id),userId,text(row.name,80,true),cost,now]);}
  if(points.enabled){const rules=object(points.rules);insert('point_rules','user_id,signin_reward,signin_penalty,task_reward,task_penalty,habit_reward,habit_penalty,started_at,settled_date',[userId,...['signinReward','signinPenalty','taskReward','taskPenalty','habitReward','habitPenalty'].map(key=>integer(rules[key])),clientTimestamp(points.startedAt),today]);}
  const eventKeys=new Set<string>();
  for(const row of ledger){const key=text(row.eventKey||row.id,200,true);if(eventKeys.has(key))throw new ApiError(400,'游客积分记录重复');eventKeys.add(key);insert('point_ledger','id,user_id,event_key,amount,units,label,created_at',[crypto.randomUUID(),userId,key,integer(row.amount,true),integer(row.units??row.amount,true),text(row.label,300),clientTimestamp(row.createdAt)]);if(key.startsWith('signin:'))insert('daily_checkins','user_id,checkin_date,created_at',[userId,date(key.slice(7)),clientTimestamp(row.createdAt)]);}
  const avatar=profile.avatarUrl ? text(profile.avatarUrl,3*1024*1024) : null;
  if(avatar&&!/^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+=*$/.test(avatar))throw new ApiError(400,'游客头像格式无效');
  const settings=object(profile.settings||{});if(JSON.stringify(settings).length>10000)throw new ApiError(400,'游客设置过大');
  statements.push(db.prepare(`UPDATE users SET settings_json=?,avatar_url=COALESCE(?,avatar_url),updated_at=? WHERE id=? AND ${gate}`).bind(JSON.stringify(settings),avatar,now,userId,userId,migrationId,hash));
  try { await db.batch(statements); }
  catch (error) {
    // A concurrent identical retry may have committed before this batch began.
    const receipt = await db.prepare('SELECT migration_id,snapshot_hash FROM guest_migrations WHERE user_id=?').bind(userId).first<Row>();
    if (receipt?.migration_id === migrationId && receipt.snapshot_hash === hash) return { imported: true, repeated: true };
    throw error;
  }
  const imported=await db.prepare('SELECT migration_id,snapshot_hash FROM guest_migrations WHERE user_id=?').bind(userId).first<Row>();
  if(!imported||imported.migration_id!==migrationId||imported.snapshot_hash!==hash)throw new ApiError(409,'云端账号已有内容，游客记录保留在本机');
  return { imported:true, repeated:false };
}
