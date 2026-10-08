const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawn} = require('node:child_process');

async function main() {
  if(process.platform!=='win32') throw new Error('Windows smoke test requires Windows');
  const executable=path.resolve(process.argv[2]);if(!fs.existsSync(executable)) throw new Error('Installed executable missing');
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'jishi-smoke-'));
  const server=http.createServer((_request,response)=>{response.writeHead(200,{'Content-Type':'application/json'});response.end(JSON.stringify({status:'ok',service:'jishi-api'}));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url=`http://127.0.0.1:${server.address().port}/note/`;
  try {
    let stdout='';
    const child=spawn(executable,['--jishi-smoke-test'],{windowsHide:true,env:{...process.env,JISHI_WEB_URL:url,APPDATA:folder},stdio:['ignore','pipe','pipe']});
    child.stdout.on('data',chunk=>{stdout+=chunk.toString();});
    child.stderr.on('data',()=>{});
    const timeout=setTimeout(()=>child.kill(),45000);
    const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});clearTimeout(timeout);
    if(code!==0||!stdout.includes(`JISHI_RESOLVED_URL=${url}`)) throw new Error('Installed Windows startup/host smoke failed');
    console.log('installed_windows_smoke=pass');
  } finally {
    await new Promise(resolve=>server.close(resolve));
    if(!fs.realpathSync(folder).startsWith(fs.realpathSync(os.tmpdir())+path.sep)||fs.lstatSync(folder).isSymbolicLink()) throw new Error('Unsafe smoke cleanup');
    fs.rmSync(folder,{recursive:true,force:true});
  }
}
main().catch(()=>{console.error('installed_windows_smoke=failed');process.exitCode=1;});
