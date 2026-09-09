import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
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
after(async () => { await runtime?.dispose(); });

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
