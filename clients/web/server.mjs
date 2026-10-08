import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat, realpath } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Readable } from 'node:stream';

const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.woff2':'font/woff2'};
const hopHeaders = new Set(['host','connection','keep-alive','proxy-authenticate','proxy-authorization','te','trailer','transfer-encoding','upgrade']);
export function createWebServer({ directory = fileURLToPath(new URL('./dist/', import.meta.url)), upstream = process.env.API_UPSTREAM || 'http://127.0.0.1:8787' } = {}) {
  const root = resolve(directory);
  return http.createServer(async (request,response) => {
    const json = (status,error) => { if(!response.headersSent) { response.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}); response.end(JSON.stringify({error})); } else response.destroy(); };
    try {
      const url = new URL(request.url, 'http://localhost');
      if (url.pathname === '/note') { response.writeHead(308,{Location:`/note/${url.search}`}); response.end(); return; }
      const pathname = decodeURIComponent(url.pathname.replace(/^\/note(?=\/)/,''));
      if (pathname.startsWith('/api/')) {
        const headers = new Headers();
        for(const [name,value] of Object.entries(request.headers)) if(!hopHeaders.has(name)&&value!==undefined) headers.set(name, Array.isArray(value)?value.join(', '):value);
        const method=request.method||'GET';
        const result = await fetch(`${upstream.replace(/\/$/,'')}${pathname}${url.search}`,{method,headers,...(['GET','HEAD'].includes(method)?{}:{body:Readable.toWeb(request),duplex:'half'}),redirect:'manual',signal:AbortSignal.timeout(60000)});
        for(const [name,value] of result.headers) if(!hopHeaders.has(name)&&!['set-cookie','content-length','content-encoding'].includes(name)) response.setHeader(name,value);
        const cookies=result.headers.getSetCookie(); if(cookies.length) response.setHeader('Set-Cookie',cookies);
        response.statusCode=result.status;
        if(!result.body||method==='HEAD') response.end(); else Readable.fromWeb(result.body).on('error',()=>response.destroy()).pipe(response);
        return;
      }
      if(pathname==='/health') {response.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});response.end(JSON.stringify({status:'ok',service:'jishi-web'}));return;}
      if(!['GET','HEAD'].includes(request.method||'')) {json(405,'此操作不受支持');return;}
      const filename=pathname==='/'?'index.html':pathname.slice(1);
      const target=resolve(root,filename);
      if(target!==root&&!target.startsWith(root+sep)) {json(403,'路径不允许');return;}
      let absolute,info;
      try { absolute=await realpath(target); info=await stat(absolute); } catch {json(404,'文件不存在');return;}
      if(!absolute.startsWith(root+sep)||!info.isFile()) {json(403,'路径不允许');return;}
      response.writeHead(200,{'Content-Type':types[extname(absolute)]||'application/octet-stream','Content-Length':info.size,'Cache-Control':pathname.startsWith('/assets/')?'public, max-age=31536000, immutable':'no-cache','X-Content-Type-Options':'nosniff'});
      if(request.method==='HEAD') response.end(); else createReadStream(absolute).on('error',()=>response.destroy()).pipe(response);
    } catch(error) {json(error instanceof URIError?400:502,error instanceof URIError?'请求路径无效':'服务暂时不可用');}
  });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const argument = name => {const index=process.argv.indexOf(name);return index<0?undefined:process.argv[index+1];};
  const port=Number(argument('--port')||process.env.PORT||3000), host=argument('--hostname')||'127.0.0.1';
  createWebServer().listen(port,host,()=>console.log(`Jishi Web listening on ${host}:${port}`));
}
