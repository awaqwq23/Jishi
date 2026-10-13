import test from 'node:test';
import assert from 'node:assert/strict';
import { OfflineClient } from '../app/offline.mjs';
import { GUEST } from '../app/guest.mjs';
function fixture(){
  const saved=new Map(),requests=[];let active='',online=true,cloud,loseImport=false,imports=0,failGuestStamp=false,failTarget=false;
  const storage={async get(key){return structuredClone(saved.get(key));},async put(key,value){if(key===GUEST&&value.migratedTo&&failGuestStamp){failGuestStamp=false;throw new Error('device storage interrupted');}if(key!==GUEST&&value.migration&&failTarget){failTarget=false;throw new Error('target storage interrupted');}const old=saved.get(key);if((old?.revision||0)!==(value.revision||0))throw Object.assign(new Error('stale local write'),{status:409});value.revision=(value.revision||0)+1;saved.set(key,structuredClone(value));}};
  const transport=async(path,init={})=>{
    requests.push(path);if(!online)throw new TypeError('offline');
    const body=JSON.parse(init.body||'{}');
    if(path==='/api/auth/register'){
      if(cloud&&(cloud.user.email!==body.email||cloud.registrationId!==body.registrationId))throw Object.assign(new Error('username exists'),{status:409});
      cloud||={registrationId:body.registrationId,user:{id:'cloud-'+body.email,email:body.email,username:body.username,name:body.name,settings:{}},todos:[],categories:[],reminderPresets:[],schedules:[],scheduleRecords:[],diaryEntries:[],points:{}};
      return {user:cloud.user};
    }
    if(path==='/api/auth/login')return {};
    if(path==='/api/bootstrap'){if(!cloud)throw Object.assign(new Error('sign in'),{status:401});return structuredClone(cloud);}
    if(path==='/api/guest/import'){
      if(!cloud.migrationId){const user=cloud.user,registrationId=cloud.registrationId;cloud={...structuredClone(body.snapshot),registrationId,user:{...user,guest:false},migrationId:body.migrationId};cloud.points.guest=false;imports++;}
      if(loseImport){loseImport=false;throw new TypeError('response lost');}return {imported:true};
    }
    throw new Error('unexpected transport '+path);
  };
  return {saved,requests,get imports(){return imports;},get cloud(){return cloud;},setOnline(value){online=value;},lose(){loseImport=true;},failGuestReceipt(){failGuestStamp=true;},failRegistrationStorage(){failTarget=true;},client(){return new OfflineClient({storage,transport,active:()=>active,setActive:value=>{active=value;}});}};
}
const write=(client,path,body,method='POST')=>client.request(path,{method,body:JSON.stringify(body)});
test('guest editing, local points and redemption, restart and reconnect never call the server',async()=>{
  const f=fixture(),client=f.client();await client.startGuest();
  const todo=await write(client,'/api/todos',{title:'游客私密记录'});
  await write(client,'/api/points/rules',{signinReward:5,signinPenalty:0,taskReward:10,taskPenalty:0,habitReward:7,habitPenalty:0},'PUT');
  await write(client,'/api/todos/'+todo.todo.id,{status:'completed'},'PATCH');
  await write(client,'/api/points/checkin',{});
  const products=await write(client,'/api/shop/products',{name:'奖励',cost:5});
  await write(client,'/api/shop/redeem',{productId:products.products[0].id,requestId:'guest-redemption-0001'});
  await write(client,'/api/shop/redeem',{productId:products.products[0].id,requestId:'guest-redemption-0001'});
  await client.sync();const restarted=f.client();await restarted.open();await restarted.sync();
  assert.equal(restarted.account.data.todos[0].title,'游客私密记录');assert.equal(restarted.account.data.points.balance,10);
  assert.equal(restarted.status().guest,true);assert.equal(restarted.status().pending,0);assert.deepEqual(f.requests,[]);
  await restarted.request('/api/auth/logout',{method:'POST'});assert.deepEqual(f.requests,[]);
});
test('a taken username leaves guest records local; logging into that existing account does not merge them',async()=>{
  const f=fixture(),client=f.client();
  await client.authenticate('register',{username:'taken_name',password:'password-123',confirmPassword:'password-123'});await client.sync();f.saved.delete('taken_name');
  await client.startGuest();await write(client,'/api/todos',{title:'不能上传到已存在账号'});
  await assert.rejects(client.authenticate('register',{username:'taken_name',password:'password-123',confirmPassword:'password-123'}),/exists/);
  assert.equal(client.status().guest,true);assert.equal(f.saved.get(GUEST).claimedBy,null);
  await client.authenticate('login',{username:'taken_name',password:'password-123'});await client.sync();
  assert.equal(f.imports,0);assert.equal(f.cloud.todos.length,0);assert.equal(f.saved.get(GUEST).data.todos.length,1);
});
test('an offline username collision restores guest mode without uploading to the existing account',async()=>{
  const f=fixture(),client=f.client();
  await client.authenticate('register',{username:'taken_offline',password:'password-123',confirmPassword:'password-123'});await client.sync();f.saved.delete('taken_offline');
  await client.startGuest();await write(client,'/api/todos',{title:'离线注册冲突时仍私密'});f.setOnline(false);
  await client.authenticate('register',{username:'taken_offline',password:'password-123',confirmPassword:'password-123'});await client.sync();
  f.setOnline(true);await client.sync();
  assert.equal(client.status().guest,true);assert.equal(f.imports,0);assert.equal(f.cloud.todos.length,0);assert.equal(f.saved.get(GUEST).claimedBy,null);
});
test('registration migrates a snapshot once after a lost reply and keeps original guest backup',async()=>{
  const f=fixture(),client=f.client();await client.startGuest();
  await write(client,'/api/todos',{title:'要迁移的游客记录'});
  await write(client,'/api/diary/2026-10-13',{content:'游客日记'},'PUT');
  f.lose();await client.authenticate('register',{username:'拾光测试',password:'password-123',confirmPassword:'password-123'});await client.sync();
  assert.ok(f.saved.get(GUEST).data.todos.length);await client.sync();
  assert.equal(f.imports,1);assert.equal(f.cloud.todos.length,1);assert.equal(f.cloud.diaryEntries[0].content,'游客日记');
  assert.equal(f.saved.get(GUEST).migratedTo,'拾光测试');assert.equal(client.account.migration,null);
});
test('offline guest registration resumes on reconnect; mismatched passwords leave guest private',async()=>{
  const f=fixture(),client=f.client();await client.startGuest();await write(client,'/api/todos',{title:'断网游客记录'});
  await assert.rejects(client.authenticate('register',{username:'guest_new',password:'password-123',confirmPassword:'different'}),/两次/);assert.deepEqual(f.requests,[]);
  f.setOnline(false);await client.authenticate('register',{username:'guest_new',password:'password-123',confirmPassword:'password-123'});await client.sync();
  assert.equal(f.imports,0);assert.ok(client.account.migration);assert.ok(!JSON.stringify(f.saved.get('guest_new')).includes('password-123'));
  f.setOnline(true);await client.sync();assert.equal(f.imports,1);assert.equal(f.cloud.todos[0].title,'断网游客记录');
});
test('two pages cannot both claim one guest snapshot for different accounts',async()=>{
  const f=fixture(),first=f.client();await first.startGuest();const second=f.client();await second.open();
  await first.authenticate('register',{username:'first_guest',password:'password-123',confirmPassword:'password-123'});await first.sync();
  await assert.rejects(second.authenticate('register',{username:'second_guest',password:'password-123',confirmPassword:'password-123'}),/stale/);
  assert.equal(f.imports,1);assert.ok(!f.saved.has('second_guest'));
});
test('a device write failure after server import cannot cause guest records to migrate twice',async()=>{
  const f=fixture(),client=f.client();await client.startGuest();await write(client,'/api/todos',{title:'导入后仍有可靠回执'});f.failGuestReceipt();
  await client.authenticate('register',{username:'guest_receipt',password:'password-123',confirmPassword:'password-123'});await client.sync();
  const restarted=f.client();await restarted.open();await restarted.sync();
  assert.equal(f.imports,1);assert.equal(restarted.account.data.todos[0].title,'导入后仍有可靠回执');
  const newSpace=await restarted.startGuest();assert.equal(newSpace.todos.length,0);assert.equal(f.imports,1);
});
test('a failed local registration write releases the guest snapshot without contacting the server',async()=>{
  const f=fixture(),client=f.client();await client.startGuest();await write(client,'/api/todos',{title:'本机故障也保留'});f.failRegistrationStorage();
  const body={username:'guest_storage',password:'password-123',confirmPassword:'password-123'};
  await assert.rejects(client.authenticate('register',body),/storage/);
  assert.equal(f.saved.get(GUEST).claimedBy,null);assert.equal(client.status().guest,true);assert.deepEqual(f.requests,[]);
  await client.authenticate('register',body);await client.sync();assert.equal(f.imports,1);
});
