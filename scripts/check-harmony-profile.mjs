import {readFile} from 'node:fs/promises';
import {X509Certificate} from 'node:crypto';
import {resolve} from 'node:path';
import {parseArgs} from 'node:util';
import {hasAgentReminderGrant} from './harmony-profile-policy.mjs';

// Print only release identity/permissions; never dump the signed profile or key.
const {values,positionals}=parseArgs({options:{profile:{type:'string'},certificate:{type:'string'}},allowPositionals:true});
const directory=resolve(positionals[0] || '.local/signing/harmony');
let certificate=new X509Certificate(await readFile(resolve(values.certificate || resolve(directory,'jishi-harmony-release.cer'))));
const bytes=await readFile(resolve(values.profile || resolve(directory,'jishi-harmony-release.p7b')));
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
if(profile.type!=='release')throw new Error('A release package requires a release profile');
const leaf=identity['distribution-certificate'] || identity['development-certificate'];
if(leaf) certificate=new X509Certificate(leaf);
if(certificate.ca)throw new Error('Release profile must identify a leaf signing certificate');
const now=Date.now();
if(now<Date.parse(certificate.validFrom)||now>=Date.parse(certificate.validTo))throw new Error('Release signing certificate is not currently valid');
const agentReminderGranted=hasAgentReminderGrant(profile);
console.log(JSON.stringify({bundleName:identity['bundle-name'],type:profile.type,certificateExpires:certificate.validTo,agentReminderGranted},null,2));
if(!agentReminderGranted)process.exitCode=2;
