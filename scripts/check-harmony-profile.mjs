import {readFile} from 'node:fs/promises';
import {X509Certificate} from 'node:crypto';
import {resolve} from 'node:path';

// Print only release identity/permissions; never dump the signed profile or key.
const directory=resolve(process.argv[2] || '.local/signing/harmony');
const certificate=new X509Certificate(await readFile(resolve(directory,'jishi-harmony-release.cer')));
const bytes=await readFile(resolve(directory,'jishi-harmony-release.p7b'));
const profiles=[];
function walk(start,end) {
  let offset=start;
  while(offset<end) {
    const tag=bytes[offset++];let length=bytes[offset++];
    if(length&128) {
      const count=length&127;if(!count||count>4) throw new Error('Unsupported profile encoding');
      length=0;for(let i=0;i<count;i++)length=length*256+bytes[offset++];
    }
    const stop=offset+length;if(stop>end)throw new Error('Invalid profile encoding');
    if(tag&32) walk(offset,stop);
    else if(tag===4) {
      const text=bytes.subarray(offset,stop).toString('utf8').trim();
      if(text.startsWith('{')) {try {profiles.push(JSON.parse(text));}catch {/* not JSON content */}}
    }
    offset=stop;
  }
}
walk(0,bytes.length);
const profile=profiles.find(value=>value['bundle-info']);if(!profile)throw new Error('Release profile metadata unavailable');
const identity=profile['bundle-info'];
if(identity['bundle-name']!=='cn.jishi.todo')throw new Error('Profile belongs to another application');
const permissions=profile.acls?.['allowed-acls'] || [];
console.log(JSON.stringify({bundleName:identity['bundle-name'],type:profile.type,certificateExpires:certificate.validTo,agentReminderGranted:permissions.includes('ohos.permission.PUBLISH_AGENT_REMINDER')},null,2));
if(!permissions.includes('ohos.permission.PUBLISH_AGENT_REMINDER'))process.exitCode=2;
