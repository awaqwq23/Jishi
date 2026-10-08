import { createHash } from 'node:crypto';
import { readFile, readdir, lstat } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const currentDirectory = join(root, 'releases/current');
export const previousDirectory = join(root, 'releases/previous');
export const artifactName = (platform, version) => platform === 'windows' ? `Jishi-Windows-Setup-${version}.exe` : `Jishi-Android-${version}.apk`;
export async function webBuildHash(webRoot = join(root, 'clients/web')) {
  const files = [], textExtensions = new Set(['.css','.js','.mjs','.json','.svg','.ts','.tsx','.webmanifest','.html']);
  async function walk(directory) {
    for(const entry of await readdir(directory,{withFileTypes:true})) {
      if(entry.isSymbolicLink()) throw new Error('Web inputs may not be symlinks');
      const file=join(directory,entry.name);
      if(entry.isDirectory()) await walk(file);
      else if(entry.isFile()&&relative(webRoot,file).replaceAll('\\','/')!=='public/updates/latest.json') files.push(file);
    }
  }
  await walk(join(webRoot,'app')); await walk(join(webRoot,'public'));
  for(const name of ['package.json','vite.config.ts','index.html','server.mjs','tsconfig.json']) files.push(join(webRoot,name));
  files.push(join(webRoot,'../../package-lock.json'));
  const hash=createHash('sha256');
  const key = file => relative(webRoot,file).replaceAll('\\','/');
  for(const file of files.sort((a,b)=>key(a)<key(b)?-1:key(a)>key(b)?1:0)) {
    if((await lstat(file)).isSymbolicLink()) throw new Error('Web inputs may not be symlinks');
    const bytes=await readFile(file); hash.update(relative(webRoot,file).replaceAll('\\','/'));hash.update('\0');
    hash.update(textExtensions.has(extname(file).toLowerCase())?Buffer.from(bytes.toString('utf8').replace(/\r\n/g,'\n')):bytes);hash.update('\0');
  }
  return hash.digest('hex');
}
