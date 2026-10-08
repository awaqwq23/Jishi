"use client";

import { useRef, useState } from 'react';

type Rules = { signinReward:number; signinPenalty:number; taskReward:number; taskPenalty:number; habitReward:number; habitPenalty:number };
export type PointsData = { enabled:boolean; rules:Rules; balance:number; checkedIn:boolean; today:string; products:{id:string;name:string;cost:number}[]; ledger:{id:string;amount:number;label:string;createdAt:string}[] };
type Props = { userId:string; value:PointsData; request:(path:string,method:string,body?:unknown)=>Promise<PointsData>; onChange:(value:PointsData)=>void };
type Redemption = {productId:string; requestId:string};
function pendingRedemption(key:string):Redemption|null {
  try { const value=JSON.parse(localStorage.getItem(key)||'null'); return value && typeof value.productId==='string' && /^[a-zA-Z0-9-]{16,80}$/.test(value.requestId) ? value : null; } catch { return null; }
}

export default function PointsBoard({ userId, value, request, onChange }: Props) {
  const [tab,setTab] = useState('checkin');
  const [rules,setRules] = useState(value.rules);
  const [name,setName] = useState(''); const [cost,setCost] = useState(50); const [editing,setEditing] = useState('');
  const [busy,setBusy] = useState(false); const [message,setMessage] = useState(''); const [error,setError] = useState('');
  const retryKey = `jishi-pending-redemption:${userId}`;
  const [pending,setPending] = useState<Redemption|null>(()=>pendingRedemption(retryKey));
  const retry = useRef<Redemption|null>(pending);
  const act = async (path:string,method:string,body?:unknown,success='已保存') => {
    if (busy) return;
    setBusy(true); setError(''); setMessage('');
    try { const result = await request(path,method,body); onChange(result); setMessage(success); return true; }
    catch (reason) {
      const status = (reason as {status?:number})?.status;
      if (path==='/api/shop/redeem' && status && [400,404,409].includes(status)) { retry.current=null; setPending(null); localStorage.removeItem(retryKey); }
      setError(reason instanceof Error ? reason.message : '操作失败，请稍后重试'); return false;
    }
    finally { setBusy(false); }
  };
  const redeem = async (product:PointsData['products'][number]) => {
    if (!window.confirm(`使用 ${product.cost} 积分兑换“${product.name}”？奖励需要你自行兑现。`)) return;
    if (retry.current && retry.current.productId !== product.id) { setError('请先重试上一笔兑换，确认结果后再兑换其他商品'); return; }
    const payload = retry.current || {productId:product.id,requestId:crypto.randomUUID()}; retry.current = payload;
    setPending(payload);
    try { localStorage.setItem(retryKey, JSON.stringify(payload)); }
    catch { setError('无法保存兑换请求，请允许本设备存储后重试'); return; }
    if (await act('/api/shop/redeem','POST',payload,`兑换成功：${product.name}，请自行兑现奖励`)) { retry.current = null; setPending(null); localStorage.removeItem(retryKey); }
  };
  return <div className="points-board">
    <header className="topbar"><div><span className="eyebrow">每天积累一点进步</span><h1>打卡与积分商店</h1></div><strong className="points-balance">{value.balance} 积分</strong></header>
    <div className="status-tabs"><button className={tab==='checkin'?'active':''} onClick={()=>setTab('checkin')}>每日打卡</button><button className={tab==='shop'?'active':''} onClick={()=>setTab('shop')}>积分商店</button><button className={tab==='history'?'active':''} onClick={()=>setTab('history')}>积分记录</button></div>
    {error && <p role="alert" className="points-error">{error}</p>}{message && <p role="status">{message}</p>}
    {tab==='checkin' && <>
      <section className="settings-card"><h2>每日签到</h2><p>{value.today} · 按北京时间结算</p><button className="button primary" disabled={busy||!value.enabled||value.checkedIn} onClick={()=>void act('/api/points/checkin','POST',{},'签到成功，积分已到账')}>{value.checkedIn?'今天已签到':`签到领取 ${value.rules.signinReward} 积分`}</button><p>{value.enabled?'完成待办、定期任务和习惯后自动计分。':'先保存下方规则，开启打卡和自动计分。'}</p></section>
      <section className="settings-card"><h2>自定义积分规则</h2><p>奖励与扣分均填写正整数或 0；填写 0 表示不奖不扣。</p><div className="points-rules"><span>项目</span><span>完成奖励</span><span>未完成扣分</span>{([['每日签到','signinReward','signinPenalty'],['待办 / 定期任务','taskReward','taskPenalty'],['习惯','habitReward','habitPenalty']] as const).map(([label,reward,penalty])=><div className="points-rule-row" key={label}><strong>{label}</strong><input aria-label={`${label}奖励积分`} type="number" min="0" max="100000" step="1" value={rules[reward]} onChange={event=>setRules({...rules,[reward]:Number(event.target.value)})}/><input aria-label={`${label}未完成扣分`} type="number" min="0" max="100000" step="1" value={rules[penalty]} onChange={event=>setRules({...rules,[penalty]:Number(event.target.value)})}/></div>)}</div><button className="button secondary" disabled={busy} onClick={()=>void act('/api/points/rules','PUT',rules,'积分规则已保存')}>保存积分规则</button><p className="points-help">开启前的记录不计分。待办到截止时间后扣分（无截止时间不扣）；签到、定期任务与习惯在次日结算，离线期间下次同步补算。补完成会退回该次未完成扣分；取消完成会撤回奖励。重复完成不重复加分，余额可为负数。修改规则仅影响之后尚未记账的事件。</p></section>
    </>}
    {tab==='shop' && <>
      {pending && <section className="settings-card"><p>上一笔兑换结果尚未确认。重新确认不会重复扣分。</p><button className="button secondary" disabled={busy} onClick={()=>void act('/api/shop/redeem','POST',pending,'兑换已确认，请自行兑现奖励').then(ok=>{if(ok){retry.current=null;setPending(null);localStorage.removeItem(retryKey);}})}>确认上一笔兑换</button></section>}
      <section className="settings-card"><h2>给努力一点奖励</h2><p>这里记录积分兑换，具体奖励由你自己实现，例如 50 积分换一顿 KFC。</p><div className="points-products">{value.products.map(product=><article className="points-product" key={product.id}><div><h3>{product.name}</h3><p>{product.cost} 积分</p></div><div className="notification-actions"><button className="button primary" disabled={busy||(value.balance<product.cost&&pending?.productId!==product.id)} onClick={()=>void redeem(product)}>{pending?.productId===product.id?'确认兑换结果':value.balance<product.cost?'积分不足':'兑换'}</button><button className="button secondary" disabled={busy} onClick={()=>{setEditing(product.id);setName(product.name);setCost(product.cost);}}>编辑</button><button className="text-button" disabled={busy} onClick={()=>{if(window.confirm(`删除商品“${product.name}”？已有兑换记录会保留。`)) void act(`/api/shop/products?id=${encodeURIComponent(product.id)}`,'DELETE');}}>删除</button></div></article>)}{!value.products.length&&<p>还没有商品，添加一个想要的奖励吧。</p>}</div></section>
      <form className="settings-card" onSubmit={event=>{event.preventDefault();void act('/api/shop/products',editing?'PATCH':'POST',{id:editing,name,cost}).then(ok=>{if(ok){setName('');setCost(50);setEditing('');}});}}><h2>{editing?'编辑商品':'添加商品'}</h2><label className="field"><span>奖励名称</span><input required maxLength={80} value={name} placeholder="如：一顿 KFC" onChange={event=>setName(event.target.value)}/></label><label className="field"><span>所需积分</span><input required type="number" min="1" max="100000" step="1" value={cost} onChange={event=>setCost(Number(event.target.value))}/></label><button className="button secondary" disabled={busy||!name.trim()} type="submit">保存商品</button>{editing&&<button className="text-button" type="button" onClick={()=>{setEditing('');setName('');setCost(50);}}>取消编辑</button>}</form>
    </>}
    {tab==='history'&&<section className="settings-card"><h2>最近 100 条积分记录</h2>{value.ledger.map(entry=><div className="setting-line" key={entry.id}><div><strong>{entry.label}</strong><small>{new Date(entry.createdAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})}{entry.amount===0?' · 不计分 / 已撤回':''}</small></div><b>{entry.amount>0?'+':''}{entry.amount}</b></div>)}{!value.ledger.length&&<p>还没有积分记录。</p>}</section>}
  </div>;
}
