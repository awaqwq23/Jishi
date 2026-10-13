import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

test('activation completes before a controlled page finishes reloading',async()=>{
  const handlers=new Map(),navigations=[],deleted=[];
  const client={url:'https://jishi.test/note/',navigate(url){navigations.push(url);return new Promise(()=>{});}};
  vm.runInNewContext(await readFile(new URL('../public/sw.js',import.meta.url),'utf8'),{
    URL,self:{registration:{scope:'https://jishi.test/note/'},addEventListener(type,handler){handlers.set(type,handler);},clients:{async claim(){},async matchAll(){return [client];}}},
    caches:{async keys(){return ['jishi-shell-v2:/note','unrelated-cache'];},async delete(key){deleted.push(key);}},
  });
  let activation;handlers.get('activate')({waitUntil(promise){activation=promise;}});
  let timer;
  try {await Promise.race([activation,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Activation is blocked by its own controlled navigation')),100);})]);}
  finally {clearTimeout(timer);}
  assert.deepEqual(navigations,[client.url]);assert.deepEqual(deleted,['jishi-shell-v2:/note']);
});

test('installation caches the built JS/CSS and offline assets never receive HTML', async () => {
  const handlers = new Map(), added = [];
  const shell = new Response('<script src="./assets/app.js"></script><link href="./assets/app.css" rel="stylesheet">');
  vm.runInNewContext(await readFile(new URL('../public/sw.js', import.meta.url), 'utf8'), {
    URL, Response, fetch: async () => { throw new TypeError('offline'); },
    self: { registration: { scope: 'https://jishi.test/note/' }, addEventListener(type, handler) { handlers.set(type, handler); }, async skipWaiting() {} },
    caches: { async open() { return { async addAll(items) { added.push(...items); }, async match() { return shell.clone(); } }; }, async match(request) { return request === '/note/' ? shell.clone() : undefined; } },
  });
  let installing; handlers.get('install')({ waitUntil(promise) { installing = promise; } }); await installing;
  assert.ok(added.includes('https://jishi.test/note/assets/app.js'));
  assert.ok(added.includes('https://jishi.test/note/assets/app.css'));
  let reply; handlers.get('fetch')({ request: { url: 'https://jishi.test/note/assets/missing.js', method: 'GET', mode: 'cors' }, respondWith(promise) { reply = promise; } });
  assert.equal((await reply).type, 'error');
  handlers.get('fetch')({ request: { url: 'https://jishi.test/note/', method: 'GET', mode: 'navigate' }, respondWith(promise) { reply = promise; } });
  assert.match(await (await reply).text(), /assets\/app.js/);
});
