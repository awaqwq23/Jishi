export const GUEST = '@jishi-guest-device';
const dayKey = (now = Date.now()) => new Date(now + 8 * 3600000).toISOString().slice(0,10);
export function guestDefaults(data, uuid) {
  data.user.guest = true;
  data.categories = [['默认','#9e8d74'],['学习','#78928a'],['娱乐','#8d82a6'],['杂项','#b98572']].map(([name,color],index)=>({id:uuid(),name,color,isDefault:index===0?1:0}));
  data.reminderPresets = [['默认',[720,360,180,10]],['仅 10 分钟前',[10]],['大事件',[10080,4320,1440]]].map(([name,offsets],index)=>({id:uuid(),name,offsets,isDefault:index===0?1:0}));
  data.points.guest = true;
  return data;
}
function occurs(item,date){
  if(date<item.startDate||date<dayKey(Date.parse(item.createdAt)))return false;
  if(item.recurrence==='once')return date===item.startDate;
  if(item.recurrence==='daily')return true;
  const weekday=new Date(`${date}T12:00:00+08:00`).getUTCDay();
  return item.recurrence==='holidays' ? weekday===0||weekday===6 : item.weekdays.includes(weekday);
}
export function settleGuestPoints(data, now = Date.now()) {
  const points=data.points,today=dayKey(now);points.guest=true;points.provisional=false;points.today=today;
  if(!points.enabled)return;
  points.startedAt ||= new Date(now).toISOString();points.settledDate ||= dayKey(Date.parse(points.startedAt));
  const entry=(key,amount,label)=>{
    let row=points.ledger.find(item=>(item.eventKey||item.id)===key);
    if(!row){row={id:key,eventKey:key,amount,units:amount,label,createdAt:new Date(now).toISOString()};points.ledger.unshift(row);}
    row.eventKey ||= key;row.units ??= row.amount;return row;
  };
  const checks=new Set(points.ledger.filter(row=>(row.eventKey||row.id).startsWith('signin:')).map(row=>(row.eventKey||row.id).slice(7)));
  points.checkedIn=checks.has(today);
  for(const item of data.todos){
    const key=`task:${item.id}`,miss=`miss:${key}`;
    if(item.completedAt&&item.completedAt>=points.startedAt)entry(key,points.rules.taskReward,`完成任务：${item.title}`);
    const reward=points.ledger.find(row=>(row.eventKey||row.id)===key);if(reward)reward.amount=item.completedAt?reward.units:0;
    if(item.status==='active'&&item.deadline&&Date.parse(item.deadline)>=Date.parse(points.startedAt)&&Date.parse(item.deadline)<now)entry(miss,-points.rules.taskPenalty,`任务逾期：${item.title}`);
    const penalty=points.ledger.find(row=>(row.eventKey||row.id)===miss);if(penalty){if(item.completedAt)penalty.amount=0;else if(item.status==='active'&&item.deadline&&Date.parse(item.deadline)<now)penalty.amount=penalty.units;}
  }
  for(const item of data.schedules.filter(item=>item.status==='active')){
    const records=data.scheduleRecords.filter(row=>row.itemId===item.id);
    for(const record of records.filter(row=>row.completedAt>=points.startedAt&&row.occurrenceDate<=today&&occurs(item,row.occurrenceDate))){
      const key=`schedule:${item.id}:${record.occurrenceDate}`;entry(key,item.kind==='habit'?points.rules.habitReward:points.rules.taskReward,`完成${item.kind==='habit'?'习惯':'定期任务'}：${item.title}（${record.occurrenceDate}）`).amount=points.ledger.find(row=>(row.eventKey||row.id)===key).units;
    }
    for(const row of points.ledger){
      const key=row.eventKey||row.id;
      if(key.startsWith(`schedule:${item.id}:`))row.amount=records.some(record=>key===`schedule:${item.id}:${record.occurrenceDate}`)?(row.units??row.amount):0;
      if(key.startsWith(`miss:schedule:${item.id}:`))row.amount=records.some(record=>key===`miss:schedule:${item.id}:${record.occurrenceDate}`)?0:(row.units??row.amount);
    }
  }
  let day=points.settledDate,count=0;
  while(day<today&&count++<3660){
    if(!checks.has(day))entry(`miss:signin:${day}`,-points.rules.signinPenalty,`未签到：${day}`);
    for(const item of data.schedules.filter(item=>item.status==='active'&&occurs(item,day)))if(!data.scheduleRecords.some(row=>row.itemId===item.id&&row.occurrenceDate===day))entry(`miss:schedule:${item.id}:${day}`,-(item.kind==='habit'?points.rules.habitPenalty:points.rules.taskPenalty),`未完成${item.kind==='habit'?'习惯':'定期任务'}：${item.title}（${day}）`);
    day=new Date(Date.parse(day+'T00:00:00Z')+86400000).toISOString().slice(0,10);
  }
  points.settledDate=day;
  for(const row of points.ledger){row.units??=row.amount;row.eventKey||=row.id;if(row.eventKey.startsWith('miss:signin:')&&checks.has(row.eventKey.slice(12)))row.amount=0;row.label=row.label.replace('（待同步）','');}
  points.balance=points.ledger.reduce((sum,row)=>sum+row.amount,0);
}
export function redeemGuest(data,body){
  settleGuestPoints(data);
  if(typeof body.requestId!=='string'||!/^[a-zA-Z0-9-]{16,80}$/.test(body.requestId))throw Object.assign(new Error('兑换标识无效'),{status:400});
  const key=`redeem:${body.requestId}`;if(data.points.ledger.some(row=>row.eventKey===key))return;
  const product=data.points.products.find(item=>item.id===body.productId);
  if(!product)throw Object.assign(new Error('商品不存在'),{status:404});
  if(data.points.balance<product.cost)throw Object.assign(new Error('积分不足'),{status:409});
  data.points.ledger.unshift({id:key,eventKey:key,amount:-product.cost,units:-product.cost,label:`兑换：${product.name}`,createdAt:new Date().toISOString()});settleGuestPoints(data);
}
export function guestExport(data,section){
  if(section==='config')return {name:data.user.name,settings:data.user.settings,categories:data.categories,reminderPresets:data.reminderPresets};
  if(section==='todos')return {items:data.todos};
  if(section==='schedules')return {items:data.schedules,records:data.scheduleRecords};
  if(section==='diary')return {entries:data.diaryEntries};
  throw new Error('不支持此导出分区');
}
