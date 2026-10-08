import assert from 'node:assert/strict';
import { before,after,test } from 'node:test';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createWebServer } from '../server.mjs';
let web,api,base;
before(async()=>{
  api=http.createServer((request,response)=>{response.writeHead(request.url.startsWith('/api/auth/login')?401:200,{'Content-Type':'application/json','Set-Cookie':'jishi_session=test; Path=/; HttpOnly'}); response.end(JSON.stringify({error:'unauthorized',cookie:request.headers.cookie||null}));});
  await new Promise(resolve=>api.listen(0,'127.0.0.1',resolve));
  web=createWebServer({upstream:`http://127.0.0.1:${api.address().port}`});await new Promise(resolve=>web.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${web.address().port}`;
});
after(async()=>{await Promise.all([new Promise(resolve=>web.close(resolve)),new Promise(resolve=>api.close(resolve))]);});
test('serves the same application at root and /note with relative assets and PWA metadata',async()=>{
  for(const prefix of ['','/note']) {
    const response=await fetch(base+prefix+'/'); assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/text\/html/);
    const html=await response.text();assert.match(html,/<title>记时 · 待办<\/title>/);assert.match(html,/正在整理你的今天/);assert.match(html,/manifest.webmanifest/);
    const script=html.match(/src="([^"]+\.js)"/)[1];const asset=await fetch(new URL(script,base+prefix+'/'));assert.equal(asset.status,200);assert.match(asset.headers.get('content-type'),/javascript/);assert.match(asset.headers.get('cache-control'),/immutable/);
    const head=await fetch(base+prefix+'/favicon.svg',{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');
  }
  const redirect=await fetch(base+'/note',{redirect:'manual'});assert.equal(redirect.status,308);assert.equal(redirect.headers.get('location'),'/note/');
});
test('API proxy preserves status, JSON errors, cookies and /note contracts',async()=>{
  const response=await fetch(base+'/note/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json',Cookie:'jishi_session=existing'},body:JSON.stringify({password:'invalid'})});
  assert.equal(response.status,401);assert.match(response.headers.get('content-type'),/application\/json/);assert.match(response.headers.get('set-cookie'),/HttpOnly/);assert.equal((await response.json()).cookie,'jishi_session=existing');
});
test('rejects traversal and missing static resources without leaking server files',async()=>{
  for(const [path,status] of [['/..%2f..%2fAGENTS.md',403],['/missing-file.js',404],['/%zz',400]]) {const response=await fetch(base+path);assert.equal(response.status,status);assert.match(response.headers.get('content-type'),/application\/json/);}
  assert.equal((await fetch(base+'/health')).status,200);
});
test('includes accessible metadata, installable shell and reduced motion styles',async()=>{
  const [html,css]=await Promise.all([readFile(new URL('../index.html',import.meta.url),'utf8'),readFile(new URL('../app/globals.css',import.meta.url),'utf8')]);
  assert.match(html,/lang="zh-CN"/);assert.match(html,/viewport-fit=cover/);assert.match(html,/apple-mobile-web-app-capable/);assert.match(css,/prefers-reduced-motion:\s*reduce/);
});
