import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir,mkdtemp,writeFile,readFile,realpath,rm } from 'node:fs/promises';
import { join,sep } from 'node:path';
import { root,webBuildHash } from './release-layout.mjs';

test('Web hashes agree across LF/CRLF, exclude the public manifest and include the workspace lock',async t=>{
  const tests=join(root,'.local/tests');await mkdir(tests,{recursive:true});
  const folder=await mkdtemp(join(tests,'web-hash-'));
  t.after(async()=>{assert.ok((await realpath(folder)).startsWith((await realpath(tests))+sep));await rm(folder,{recursive:true,force:true});});
  const web=join(folder,'clients/web'); await mkdir(join(web,'app'),{recursive:true});await mkdir(join(web,'public/updates'),{recursive:true});
  const textFiles=['app/main.tsx','public/sw.js','package.json','vite.config.ts','index.html','server.mjs','tsconfig.json','../../package-lock.json'];
  for(const file of textFiles)await writeFile(join(web,file),'first line\nsecond line\n');
  await writeFile(join(web,'public/updates/latest.json'),'old manifest');
  await writeFile(join(web,'public/logo.png'),Buffer.from([0,13,10,255]));
  const before=await webBuildHash(web);
  for(const file of textFiles)await writeFile(join(web,file),(await readFile(join(web,file),'utf8')).replaceAll('\n','\r\n'));
  assert.equal(await webBuildHash(web),before);
  await writeFile(join(web,'public/updates/latest.json'),'new manifest');assert.equal(await webBuildHash(web),before);
  await writeFile(join(folder,'package-lock.json'),'changed dependencies\n');assert.notEqual(await webBuildHash(web),before);
});
