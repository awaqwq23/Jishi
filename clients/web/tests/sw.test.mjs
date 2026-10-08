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
