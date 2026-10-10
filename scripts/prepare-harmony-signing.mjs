import {randomBytes,createCipheriv,pbkdf2Sync} from 'node:crypto';
import {mkdir,readFile,writeFile,copyFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

// Called only by the local password dialog. Never print passwords or material.
const [stage,signingRoot,projectProfile,javaHome]=process.argv.slice(2).map(value=>resolve(value));
const password=process.env.JISHI_LOCAL_SIGNING_PASSWORD;
delete process.env.JISHI_LOCAL_SIGNING_PASSWORD;
if(!password) throw new Error('No signing password was entered');
const sourceStore=join(signingRoot,'jishi-harmony-release.p12');
const keyAlias='jishi-harmony-release';
const result=spawnSync(join(javaHome,'bin/keytool.exe'),['-list','-keystore',sourceStore,
  '-storetype','PKCS12','-alias',keyAlias,'-storepass:env','JISHI_KEY_CHECK_PASSWORD'],
  {env:{...process.env,JISHI_KEY_CHECK_PASSWORD:password},encoding:'utf8',windowsHide:true});
if(result.status!==0) throw new Error('The existing keystore password or alias was not accepted');

// DevEco/Hvigor AES-GCM material format. Private identity is retained unchanged.
function encrypt(key,plain) {
  const iv=randomBytes(12),cipher=createCipheriv('aes-128-gcm',key,iv);
  const ciphertext=Buffer.concat([cipher.update(plain),cipher.final()]);
  const length=Buffer.alloc(4);length.writeUInt32BE(ciphertext.length+16);
  return Buffer.concat([length,iv,ciphertext,cipher.getAuthTag()]);
}
const components=[randomBytes(16),randomBytes(16),randomBytes(16)];
const fixed=Buffer.from([49,243,9,115,214,175,91,184,211,190,177,88,101,131,192,119]);
const combined=Buffer.alloc(16);
for(let i=0;i<16;i++)combined[i]=components[0][i]^components[1][i]^components[2][i]^fixed[i];
const salt=randomBytes(16),workKey=randomBytes(16);
const rootKey=pbkdf2Sync(combined.toString(),salt,10000,16,'sha256');
for(let i=0;i<3;i++) {
  const directory=join(stage,'material','fd',String(i));
  await mkdir(directory,{recursive:true});await writeFile(join(directory,'value'),components[i]);
}
for(const [name,bytes] of [['ac',salt],['ce',encrypt(rootKey,workKey)]]) {
  const directory=join(stage,'material',name);await mkdir(directory,{recursive:true});
  await writeFile(join(directory,'value'),bytes);
}
for(const [source,target] of [['jishi-harmony-release.p12','release.p12'],
  ['jishi-harmony-release.cer','release.cer'],['jishi-harmony-reminder-candidate.p7b','release.p7b']]) {
  await copyFile(join(signingRoot,source),join(stage,target));
}
const config=JSON.parse(await readFile(projectProfile,'utf8'));
const encrypted=encrypt(workKey,Buffer.from(password,'utf8')).toString('hex');
const {DecipherUtil}=createRequire(import.meta.url)(fileURLToPath(new URL(
  '../.local/toolchains/harmony/node_modules/@ohos/hvigor-ohos-plugin/src/utils/decipher-util.js',import.meta.url)));
if(DecipherUtil.decryptPwd(stage,encrypted,'temporary signing configuration')!==password) {
  throw new Error('Temporary signing encryption failed validation');
}
config.app.signingConfigs=[{name:'release',type:'HarmonyOS',material:{
  certpath:join(stage,'release.cer'),storeFile:join(stage,'release.p12'),
  profile:join(stage,'release.p7b'),keyAlias,signAlg:'SHA256withECDSA',
  storePassword:encrypted,keyPassword:encrypted}}];
config.app.products[0].signingConfig='release';
await writeFile(join(stage,'signing.json5'),JSON.stringify(config,null,2));
console.log('Existing release identity validated; temporary encrypted signing configuration prepared.');
