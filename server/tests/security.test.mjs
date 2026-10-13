import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import {mkdtemp,realpath,rm,lstat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,sep} from 'node:path';
import {settleGuestPoints} from '../../clients/web/app/guest.mjs';
import {OfflineClient} from '../../clients/web/app/offline.mjs';
import { Miniflare, Log, LogLevel, convertV4MiniflareOptions } from "miniflare";

let runtime, db, alice, bob;
const secret = randomUUID() + randomUUID();
const origin = "https://jishi.example.test";
async function call(path, { cookie, method = "GET", body, headers = {} } = {}) {
  return runtime.dispatchFetch(`${origin}${path}`, { method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...headers }, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
}
async function json(response, status) {
  assert.equal(response.status, status);
  assert.match(response.headers.get("content-type") || "", /application\/json/);
  return response.json();
}
async function account(name) {
  const email = `${name}-${randomUUID()}@example.test`, password = randomUUID();
  const response = await call("/api/auth/register", { method: "POST", body: { email, password, name } });
  const cookie = response.headers.get("set-cookie").split(";")[0];
  const { user } = await json(response, 201);
  const bootstrap = await json(await call("/api/bootstrap", { cookie }), 200);
  return { email, password, cookie, user, bootstrap };
}
before(async () => {
  runtime = new Miniflare(convertV4MiniflareOptions({ modules: true, scriptPath: fileURLToPath(new URL("../.wrangler/dry-run/index.js", import.meta.url)), compatibilityDate: "2026-05-22", d1Databases: ["DB"], r2Buckets: ["MEDIA"], bindings: { AUTH_SECRET: secret, ALLOWED_ORIGINS: origin }, log: new Log(LogLevel.NONE) }));
  db = await runtime.getD1Database("DB");
  alice = await account("Alice"); bob = await account("Bob");
});

test('username registration requires matching passwords, retries safely and keeps legacy login', async () => {
  const username='拾光_'+randomUUID().slice(0,8),password='Guest-password-123',registrationId=randomUUID();
  await json(await call('/api/auth/register',{method:'POST',body:{username,password,confirmPassword:'wrong'}}),400);
  assert.equal(await db.prepare('SELECT id FROM users WHERE username=?').bind(username).first(),null);
  const credentials={username,password,confirmPassword:password,registrationId};
  const first=await json(await call('/api/auth/register',{method:'POST',body:credentials}),201);
  const retry=await json(await call('/api/auth/register',{method:'POST',body:credentials}),201);
  assert.equal(first.user.id,retry.user.id);assert.equal(first.user.username,username);
  await json(await call('/api/auth/register',{method:'POST',body:{...credentials,registrationId:randomUUID()}}),409);
  const logged=await call('/api/auth/login',{method:'POST',body:{username,password}});await json(logged,200);
  const data=await json(await call('/api/bootstrap',{cookie:logged.headers.get('set-cookie').split(';')[0]}),200);assert.equal(data.user.username,username);
  await json(await call('/api/auth/login',{method:'POST',body:{username,password:'wrong'}}),401);
  await json(await call('/api/auth/login',{method:'POST',body:{username:alice.email,password:alice.password}}),200);
  const concurrent={username:'parallel_'+randomUUID().slice(0,8),password,confirmPassword:password,registrationId:randomUUID()};
  const simultaneous=await Promise.all([call('/api/auth/register',{method:'POST',body:concurrent}),call('/api/auth/register',{method:'POST',body:concurrent})]);
  const values=await Promise.all(simultaneous.map(response=>json(response,201)));assert.equal(values[0].user.id,values[1].user.id);
});

function guestSnapshot(owner) {
  const data=structuredClone(owner.bootstrap),now=new Date().toISOString(),today=new Date(Date.now()+8*3600000).toISOString().slice(0,10);
  data.user.guest=true;
  data.todos=[{id:randomUUID(),title:'游客已完成任务',content:'本机内容',notes:'备注',priority:'normal',status:'completed',createdAt:now,updatedAt:now,completedAt:now,deletedAt:null,deadline:new Date(Date.now()+3600000).toISOString(),categoryId:data.categories[0].id,reminderPresetId:data.reminderPresets[0].id,reminderOffsets:[10]}];
  data.schedules=[{id:randomUUID(),title:'游客习惯',kind:'habit',notes:'',recurrence:'daily',startDate:today,timeOfDay:'23:00',weekdays:[],status:'active',createdAt:now,updatedAt:now,deletedAt:null}];
  data.scheduleRecords=[{id:randomUUID(),itemId:data.schedules[0].id,occurrenceDate:today,completedAt:now}];
  data.diaryEntries=[{id:randomUUID(),entryDate:today,content:'游客日记',createdAt:now,updatedAt:now}];
  data.points.enabled=true;data.points.startedAt=now;data.points.settledDate=today;
  data.points.products=[{id:randomUUID(),name:'游客商品',cost:5}];
  data.points.ledger=[{id:'signin:'+today,eventKey:'signin:'+today,amount:5,units:5,label:'签到',createdAt:now},{id:'redeem:guest-retry-0001',eventKey:'redeem:guest-retry-0001',amount:-5,units:-5,label:'兑换：游客商品',createdAt:now}];
  settleGuestPoints(data);return data;
}

test('guest snapshot migrates every module and points once without accepting cross-user references', async () => {
  const owner=await account('GuestImport'),snapshot=guestSnapshot(owner),migrationId=randomUUID();
  const body={migrationId,snapshot};
  await json(await call('/api/guest/import',{cookie:owner.cookie,method:'POST',headers:{'X-Jishi-Account-Email':bob.email},body}),409);
  const rejected=structuredClone(body);rejected.snapshot.todos[0].categoryId=bob.bootstrap.categories[0].id;
  await json(await call('/api/guest/import',{cookie:owner.cookie,method:'POST',body:rejected}),400);
  const concurrent = await Promise.all([call('/api/guest/import',{cookie:owner.cookie,method:'POST',body}),call('/api/guest/import',{cookie:owner.cookie,method:'POST',body})]);
  for (const response of concurrent) await json(response,200);
  const repeated=await json(await call('/api/guest/import',{cookie:owner.cookie,method:'POST',body}),200);assert.equal(repeated.repeated,true);
  const value=await json(await call('/api/bootstrap',{cookie:owner.cookie}),200);
  assert.equal(value.todos.length,1);assert.equal(value.todos[0].deadline,snapshot.todos[0].deadline);
  assert.equal(value.schedules.length,1);assert.equal(value.scheduleRecords.length,1);assert.equal(value.diaryEntries[0].content,'游客日记');
  assert.equal(value.points.balance,snapshot.points.balance);assert.equal(value.points.products.length,1);assert.equal(value.points.checkedIn,true);
  await json(await call('/api/guest/import',{cookie:owner.cookie,method:'POST',body:{...body,migrationId:randomUUID()}}),409);
  const busy=await account('GuestOccupied');await json(await call('/api/todos',{cookie:busy.cookie,method:'POST',body:{title:'保留云端内容'}}),201);
  await json(await call('/api/guest/import',{cookie:busy.cookie,method:'POST',body:{migrationId:randomUUID(),snapshot:guestSnapshot(busy)}}),409);
  assert.equal((await json(await call('/api/bootstrap',{cookie:busy.cookie}),200)).todos[0].title,'保留云端内容');
});

test('failed atomic guest migration preserves local retry identity and empty cloud account',async()=>{
  const owner=await account('GuestRollback'),snapshot=guestSnapshot(owner),body={migrationId:randomUUID(),snapshot};
  await db.exec(`CREATE TRIGGER guest_insert_failure BEFORE INSERT ON diary_entries WHEN NEW.user_id='${owner.user.id}' BEGIN SELECT RAISE(ABORT, 'simulated migration failure'); END;`);
  try{
    await json(await call('/api/guest/import',{cookie:owner.cookie,method:'POST',body}),500);
    assert.equal(await db.prepare('SELECT migration_id FROM guest_migrations WHERE user_id=?').bind(owner.user.id).first(),null);
    assert.equal((await json(await call('/api/bootstrap',{cookie:owner.cookie}),200)).todos.length,0);
  }finally{await db.exec('DROP TRIGGER guest_insert_failure;');}
  await json(await call('/api/guest/import',{cookie:owner.cookie,method:'POST',body}),200);
});

test('real worker accepts guest-client registration and complete migration without guest network requests',async()=>{
  const storage=new Map();let active='',cookie='',requests=0;
  const client=new OfflineClient({storage:{async get(key){return structuredClone(storage.get(key));},async put(key,value){storage.set(key,structuredClone(value));}},active:()=>active,setActive:value=>{active=value;},transport:async(path,init={})=>{
    requests++;const response=await call(path,{cookie,method:init.method||'GET',body:init.body,headers:init.headers||{}});
    if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];
    const body=await response.json();if(!response.ok)throw Object.assign(new Error(body.error),{status:response.status});return body;
  }});
  await client.startGuest();
  await client.request('/api/points/rules',{method:'PUT',body:JSON.stringify({signinReward:5,signinPenalty:0,taskReward:10,taskPenalty:0,habitReward:7,habitPenalty:0})});
  const result=await client.request('/api/todos',{method:'POST',body:JSON.stringify({title:'整条链路的游客记录'})});
  await client.request('/api/todos/'+result.todo.id,{method:'PATCH',body:JSON.stringify({status:'completed'})});
  await client.request('/api/points/checkin',{method:'POST',body:'{}'});
  await client.request('/api/profile',{method:'PATCH',body:JSON.stringify({avatarUrl:'data:image/png;base64,iVBORw0KGgo='})});
  const before=client.account.data.points.balance;assert.equal(requests,0);
  const username='full_guest_'+randomUUID().slice(0,8),password='Guest-password-123';
  await client.authenticate('register',{username,password,confirmPassword:password});await client.sync();
  assert.equal(client.account.migration,null);assert.equal(client.status().pending,0);
  assert.equal(client.account.data.user.username,username);assert.equal(client.account.data.todos[0].title,'整条链路的游客记录');
  assert.equal(client.account.data.points.balance,before);assert.ok(client.account.data.user.avatarUrl.startsWith('data:image/png'));
});
after(async () => { await runtime?.dispose(); });

test('offline creation retries keep stable IDs, ownership and conditional edits', async () => {
  const id = randomUUID();
  await json(await call('/api/todos', { cookie: alice.cookie, method: 'POST', headers: { 'X-Jishi-Account-Email': bob.email }, body: { title: 'Must not enter another account' } }), 409);
  const created = await json(await call('/api/todos', { cookie: alice.cookie, method: 'POST', headers: { 'X-Jishi-Create-Id': id }, body: { title: 'Offline creation' } }), 201);
  assert.equal(created.todo.id, id);
  const retried = await json(await call('/api/todos', { cookie: alice.cookie, method: 'POST', headers: { 'X-Jishi-Create-Id': id }, body: { title: 'Offline creation' } }), 200);
  assert.equal(retried.todo.id, id);
  await json(await call('/api/todos', { cookie: bob.cookie, method: 'POST', headers: { 'X-Jishi-Create-Id': id }, body: { title: 'Wrong owner' } }), 409);
  await json(await call(`/api/todos/${id}`, { cookie: alice.cookie, method: 'PATCH', headers: { 'If-Match': 'outdated' }, body: { title: 'Must not overwrite' } }), 409);
  const changed = await json(await call(`/api/todos/${id}`, { cookie: alice.cookie, method: 'PATCH', headers: { 'If-Match': retried.todo.updatedAt }, body: { title: 'Synchronized' } }), 200);
  assert.equal(changed.todo.title, 'Synchronized');
  const data = await json(await call('/api/bootstrap', { cookie: alice.cookie }), 200);
  assert.equal(data.todos.filter(x => x.id === id).length, 1);
});

test('offline habit dates and points survive delayed upload without losing past completions', async () => {
  const owner = await account('OfflineDates'), cookie = owner.cookie;
  const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
  const date = new Date(Date.now() - 86400000 + 8 * 3600000).toISOString().slice(0, 10);
  const enabled = new Date(`${date}T00:00:00+08:00`).toISOString();
  const completed = new Date(`${date}T12:00:00+08:00`).toISOString();
  await json(await call('/api/points/rules', { cookie, method: 'PUT', body: { signinReward: 5, signinPenalty: 0, taskReward: 10, taskPenalty: 0, habitReward: 7, habitPenalty: 3, clientEnabledAt: enabled } }), 200);
  const { item } = await json(await call('/api/schedules', { cookie, method: 'POST', body: { title: 'Yesterday offline habit', kind: 'habit', recurrence: 'daily', startDate: date, clientCreatedAt: enabled } }), 201);
  assert.equal(item.createdAt, enabled);
  let value = await json(await call(`/api/schedules/${item.id}/completion`, { cookie, method: 'PUT', body: { occurrenceDate: date, completed: true, clientCompletedAt: completed } }), 200);
  assert.equal(value.record.completedAt, completed); assert.equal(value.points.balance, 7);
  value = await json(await call(`/api/schedules/${item.id}/completion`, { cookie, method: 'PUT', body: { occurrenceDate: date, completed: true, clientCompletedAt: completed } }), 200);
  assert.equal(value.points.balance, 7);
  assert.equal(value.points.today, today);
});

test('check-in, custom rules, shop and redeemed balance survive a server restart', async () => {
  const folder=await mkdtemp(join(tmpdir(),'jishi-persistence-'));
  const options=convertV4MiniflareOptions({modules:true,scriptPath:fileURLToPath(new URL('../.wrangler/dry-run/index.js',import.meta.url)),compatibilityDate:'2026-05-22',d1Databases:['DB'],resourcePersistencePath:folder,r2Buckets:['MEDIA'],bindings:{AUTH_SECRET:secret,ALLOWED_ORIGINS:origin},log:new Log(LogLevel.NONE)});
  let instance=new Miniflare(options);
  let cookie;
  const request=async(path,method='GET',body)=>json(await instance.dispatchFetch(origin+path,{method,headers:{...(cookie?{Cookie:cookie}:{}),'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)}),200);
  try {
    const response=await instance.dispatchFetch(origin+'/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:`persist-${randomUUID()}@example.test`,password:randomUUID(),name:'Persistence'})});
    await json(response,201);cookie=response.headers.get('set-cookie').split(';')[0];
    const rules={signinReward:9,signinPenalty:2,taskReward:10,taskPenalty:3,habitReward:7,habitPenalty:4};
    await request('/api/points/rules','PUT',rules);
    await request('/api/points/checkin','POST',{});
    const shop=await request('/api/shop/products','POST',{name:'Saved reward',cost:4});
    const productId=shop.products[0].id,requestId=randomUUID();
    const before=await request('/api/shop/redeem','POST',{productId,requestId});assert.equal(before.balance,5);
    await instance.dispose();instance=new Miniflare(options);
    const restored=await request('/api/points');
    assert.deepEqual(restored,before);
    assert.equal((await request('/api/shop/redeem','POST',{productId,requestId})).balance,5);
    assert.equal((await request('/api/points/checkin','POST',{})).balance,5);
    await request('/api/bootstrap');
  } finally {
    await instance.dispose();
    assert.ok((await realpath(folder)).startsWith((await realpath(tmpdir()))+sep));assert.ok(!(await lstat(folder)).isSymbolicLink());
    await rm(folder,{recursive:true,force:true});
  }
});

test('points check-in, completion reversal and atomic redemption contracts', async () => {
  const owner=await account('Points'); const cookie=owner.cookie;
  const rules={signinReward:5,signinPenalty:2,taskReward:10,taskPenalty:3,habitReward:7,habitPenalty:4};
  await json(await call('/api/points/rules',{cookie,method:'PUT',body:rules}),200);
  const checkins=await Promise.all([call('/api/points/checkin',{cookie,method:'POST',body:{}}),call('/api/points/checkin',{cookie,method:'POST',body:{}})]);
  for(const response of checkins) await json(response,200);
  assert.equal((await json(await call('/api/points',{cookie}),200)).balance,5);
  const {todo}=await json(await call('/api/todos',{cookie,method:'POST',body:{title:'points task'}}),201);
  let result=await json(await call(`/api/todos/${todo.id}`,{cookie,method:'PATCH',body:{status:'completed'}}),200);
  assert.equal(result.points.balance,15);
  result=await json(await call(`/api/todos/${todo.id}`,{cookie,method:'PATCH',body:{status:'completed'}}),200); assert.equal(result.points.balance,15);
  result=await json(await call(`/api/todos/${todo.id}`,{cookie,method:'PATCH',body:{status:'active'}}),200); assert.equal(result.points.balance,5);
  result=await json(await call(`/api/todos/${todo.id}`,{cookie,method:'PATCH',body:{status:'completed'}}),200); assert.equal(result.points.balance,15);
  const shop=await json(await call('/api/shop/products',{cookie,method:'POST',body:{name:'KFC',cost:10}}),200); const productId=shop.products[0].id;
  await json(await call('/api/shop/redeem',{cookie:bob.cookie,method:'POST',body:{productId,requestId:randomUUID()}}),404);
  const requestId=randomUUID(); const redeemed=await json(await call('/api/shop/redeem',{cookie,method:'POST',body:{productId,requestId}}),200); assert.equal(redeemed.balance,5);
  const retried=await json(await call('/api/shop/redeem',{cookie,method:'POST',body:{productId,requestId}}),200); assert.equal(retried.balance,5);
  await json(await call('/api/shop/redeem',{cookie,method:'POST',body:{productId,requestId:randomUUID()}}),409);
  const small=await json(await call('/api/shop/products',{cookie,method:'POST',body:{name:'small reward',cost:5}}),200); const smallId=small.products.find(p=>p.name==='small reward').id;
  const concurrent=await Promise.all([call('/api/shop/redeem',{cookie,method:'POST',body:{productId:smallId,requestId:randomUUID()}}),call('/api/shop/redeem',{cookie,method:'POST',body:{productId:smallId,requestId:randomUUID()}})]);
  assert.deepEqual(concurrent.map(response=>response.status).sort(),[200,409]);
  assert.equal((await json(await call('/api/points',{cookie}),200)).balance,0);
  for(const cost of [-1,0,1.5,'10']) await json(await call('/api/shop/products',{cookie,method:'POST',body:{name:'invalid',cost}}),400);
  const invalid=await call('/api/points',{cookie:'invalid'}); await json(invalid,401);
});

test('missed days settle once; habits refund penalties on late completion and restore on undo', async()=>{
  const owner=await account('Settlement'), cookie=owner.cookie;
  const today=new Date(Date.now()+8*3600000).toISOString().slice(0,10);
  const yesterday=new Date(new Date(today+'T00:00:00Z').getTime()-86400000).toISOString().slice(0,10);
  const rules={signinReward:5,signinPenalty:2,taskReward:10,taskPenalty:3,habitReward:7,habitPenalty:4};
  await json(await call('/api/points/rules',{cookie,method:'PUT',body:rules}),200);
  const {item}=await json(await call('/api/schedules',{cookie,method:'POST',body:{title:'daily habit',kind:'habit',startDate:yesterday}}),201);
  await db.prepare('UPDATE schedule_items SET created_at=? WHERE id=?').bind(yesterday+'T00:00:00.000Z',item.id).run();
  await db.prepare('UPDATE point_rules SET started_at=?,settled_date=? WHERE user_id=?').bind(yesterday+'T00:00:00.000Z',yesterday,owner.user.id).run();
  let state=await json(await call('/api/points',{cookie}),200); assert.equal(state.balance,-6);
  state=await json(await call('/api/points',{cookie}),200); assert.equal(state.balance,-6);
  let result=await json(await call(`/api/schedules/${item.id}/completion`,{cookie,method:'PUT',body:{occurrenceDate:yesterday}}),200); assert.equal(result.points.balance,5);
  result=await json(await call(`/api/schedules/${item.id}/completion`,{cookie,method:'PUT',body:{occurrenceDate:yesterday,completed:false}}),200); assert.equal(result.points.balance,-6);
  result=await json(await call(`/api/schedules/${item.id}/completion`,{cookie,method:'PUT',body:{occurrenceDate:yesterday}}),200); assert.equal(result.points.balance,5);
});

test("forged gateway headers and tampered/expired legacy cookies cannot authenticate", async () => {
  await json(await call("/api/bootstrap", { headers: { "x-auth-request-email": alice.email, "oai-authenticated-user-id": alice.user.id, "oai-authenticated-user-email": alice.email } }), 401);
  await json(await call("/api/bootstrap", { cookie: `${alice.cookie}tampered` }), 401);
  // Legacy signed cookies remain valid, but a missing expiration must not bypass expiry.
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  for (const exp of [undefined, 1, Math.floor(Date.now()/1000)+600]) {
    const payload = Buffer.from(JSON.stringify({ ...alice.user, exp })).toString("base64url");
    const signature = Buffer.from(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload))).toString("base64url");
    await json(await call("/api/bootstrap", { cookie: `jishi_session=${payload}.${signature}` }), exp > 1 ? 200 : 401);
  }
});

test("cross-user references and edits are denied, including legacy export joins", async () => {
  const categoryId = alice.bootstrap.categories[0].id;
  const reminderPresetId = alice.bootstrap.reminderPresets[0].id;
  for (const references of [{categoryId}, {reminderPresetId}]) await json(await call("/api/todos", {cookie:bob.cookie,method:"POST",body:{title:"foreign",...references}}),400);
  const {todo} = await json(await call("/api/todos",{cookie:alice.cookie,method:"POST",body:{title:"Alice private",categoryId,reminderPresetId}}),201);
  await json(await call(`/api/todos/${todo.id}`,{cookie:bob.cookie,method:"PATCH",body:{title:"intrusion"}}),404);
  await json(await call(`/api/categories?id=${categoryId}`,{cookie:bob.cookie,method:"PATCH",body:{name:"intrusion"}}),404);
  await json(await call(`/api/presets?id=${reminderPresetId}`,{cookie:bob.cookie,method:"DELETE"}),404);
  await db.prepare("INSERT INTO todos (id,user_id,title,category_id,reminder_preset_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?)").bind(randomUUID(),bob.user.id,"legacy reference",categoryId,reminderPresetId,new Date().toISOString(),new Date().toISOString()).run();
  const exported = await json(await call("/api/data/export?section=todos&format=json",{cookie:bob.cookie}),200);
  assert.ok(!JSON.stringify(exported).includes("Alice private"));
  for (const item of exported.data.items) { assert.equal(item.categoryName,null); assert.equal(item.presetName,null); }
});

test("diary, schedules, imports, exports and media remain scoped to their owner", async () => {
  const {item}=await json(await call("/api/schedules",{cookie:alice.cookie,method:"POST",body:{title:"Alice schedule",kind:"habit",startDate:"2026-09-09"}}),201);
  await json(await call(`/api/schedules/${item.id}/completion`,{cookie:bob.cookie,method:"PUT",body:{occurrenceDate:"2026-09-09"}}),404);
  await json(await call("/api/diary/2026-09-09",{cookie:alice.cookie,method:"PUT",body:{content:"Alice diary"}}),200);
  await json(await call("/api/data/import?section=diary",{cookie:bob.cookie,method:"POST",body:{schemaVersion:1,section:"diary",data:{entries:[]}}}),200);
  const aliceData=await json(await call("/api/bootstrap",{cookie:alice.cookie}),200);
  const bobData=await json(await call("/api/bootstrap",{cookie:bob.cookie}),200);
  assert.equal(aliceData.diaryEntries[0].content,"Alice diary"); assert.equal(bobData.diaryEntries.length,0); assert.equal(bobData.schedules.length,0);
  await json(await call("/api/media?kind=avatar",{cookie:alice.cookie,method:"PUT",headers:{"Content-Type":"image/png"},body:"test-image"}),200);
  const image=await call("/api/media?kind=avatar",{cookie:alice.cookie});
  assert.equal(image.status,200); assert.match(image.headers.get("cache-control"),/no-store/); assert.match(image.headers.get("vary"),/Cookie/);
  await json(await call("/api/media?kind=avatar",{cookie:bob.cookie}),404);
});

test("malformed, oversized and cross-origin writes get controlled JSON errors", async () => {
  for (const body of ["{", "null", "[]"]) await json(await call("/api/auth/login",{method:"POST",body}),400);
  await json(await call("/api/auth/login",{method:"POST",body:"x".repeat(4097)}),413);
  await json(await call("/api/auth/login",{method:"POST",body:{email:alice.email,password:alice.password},headers:{Origin:"https://attacker.example"}}),403);
  await json(await call("/api/auth/login",{method:"POST",body:{email:alice.email,password:alice.password},headers:{Origin:origin,"Content-Type":"application/json"}}),200);
  await json(await call("/api/auth/login",{method:"POST",body:{email:alice.email,password:"wrong"}}),401);
  const response=await call("/api/bootstrap",{cookie:alice.cookie,headers:{Origin:"https://attacker.example"}});
  assert.equal(response.headers.get("access-control-allow-origin"),null);
});

test("persistent auth limits cannot be bypassed by spoofing IP headers", async () => {
  const email = `limit-${randomUUID()}@example.test`;
  for (let index=0;index<20;index++) await json(await call("/api/auth/login",{method:"POST",body:{email,password:"incorrect"},headers:{"X-Real-IP":`192.0.2.${index}`}}),401);
  const response=await call("/api/auth/login",{method:"POST",body:{email,password:"incorrect"},headers:{"X-Real-IP":"198.51.100.1"}});
  await json(response,429); assert.ok(response.headers.get("retry-after"));
  const rows=await db.prepare("SELECT key FROM auth_rate_limits").all();
  assert.ok(rows.results.every(row=>!row.key.includes(email)));
});

test("a failed multi-batch-size import preserves the original partition", async () => {
  const entries = Array.from({length: 80}, (_, index) => ({entryDate: index < 79 ? new Date(Date.UTC(2025,0,index+1)).toISOString().slice(0,10) : "2025-01-01", content:"replacement"}));
  const response = await call("/api/data/import?section=diary",{cookie:alice.cookie,method:"POST",body:{schemaVersion:1,section:"diary",data:{entries}}});
  const failure = await json(response,500);
  assert.ok(failure.requestId); assert.ok(!failure.error.includes("UNIQUE"));
  const data = await json(await call("/api/bootstrap",{cookie:alice.cookie}),200);
  assert.equal(data.diaryEntries.length,1); assert.equal(data.diaryEntries[0].content,"Alice diary");
});

test('equivalent HTTPS origins work and URL-shaped origin attacks remain rejected', async () => {
  const headers={Origin:`${origin}:443`,'Content-Type':'application/json'};
  const response=await call('/api/auth/login',{method:'POST',body:{email:alice.email,password:alice.password},headers});
  await json(response,200);
  assert.equal(response.headers.get('access-control-allow-origin'),headers.Origin);
  for(const bad of [`${origin}/path`,`${origin}?query=1`,'https://jishi.example.test.attacker.test','https://attacker.test','https://user:password@jishi.example.test']) {
    await json(await call('/api/auth/login',{method:'POST',body:{},headers:{Origin:bad,Referer:origin+'/','X-Jishi-Client':'web'}}),403);
  }
});

test('proxy transport origins and opaque origins never bypass the browser origin guard', async () => {
  for(const invalid of ['http://127.0.0.1:8787','http://localhost:8787','null']) {
    const headers={Origin:invalid,Referer:origin+'/','X-Jishi-Client':'web','User-Agent':'JishiHarmony/0.3.4'};
    const response=await call('/api/auth/login',{method:'POST',body:{},headers});
    await json(response,403);
    assert.equal(response.headers.get('access-control-allow-origin'),null);
  }
  await json(await call('/api/auth/login',{method:'POST',body:{},headers:{'Sec-Fetch-Site':'cross-site',Referer:origin+'/','X-Jishi-Client':'web'}}),403);
});
