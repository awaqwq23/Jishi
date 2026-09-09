#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
stage=/opt/jishi-stage-7ac3043
backup=/var/backups/jishi/pre-7ac3043-20260909-security
key=/etc/jishi/backup-20260909.key
crypto="$stage/scripts/backup-crypto.mjs"
test "$(id -u)" = 0
for path in /opt/jishi /var/lib/jishi /var/www/jishi-downloads "$stage"; do
  test -d "$path" && test ! -L "$path"
done
test ! -e "$backup"
test -f "$key" && test ! -L "$key"
test "$(stat -c %a "$key")" = 600
cmp "$key" /home/awaqwq233/.jishi-backup-20260909.key
test ! -L /etc/jishi
test "$(realpath /var/backups/jishi)" = /var/backups/jishi
sha256sum -c <<'HASHES'
148baf3f999a98e48c2d4a9a80551f063eb3141b9becc0ae0509ef84e3be3393  /etc/nginx/sites-available/jishi
541c40fc48f4f6019f5fb77b0e543044b88cfb060755db2ffb530745711f0864  /etc/nginx/sites-available/jishi-subdomain
64b3f8522d3fd8018799ee9c35311e0baacac344b4600bd68184f0d2309f440a  /etc/nginx/sites-available/awaqwq233-heartbeat
HASHES
test -f /home/awaqwq233/.jishi-backup-20260909.key
test ! -L /home/awaqwq233/.jishi-backup-20260909.key
test "$(stat -c %s /home/awaqwq233/.jishi-backup-20260909.key)" = 32
test -x "$stage/node_modules/.bin/wrangler"
test -x "$stage/node_modules/.bin/vinext"
nginx -t -c "$stage/nginx-test.conf"
systemctl is-active --quiet jishi-api jishi-web nginx
secret_gate() {
  python3 - <<'PY'
import os,stat,pwd
from pathlib import Path
p=Path('/opt/jishi/server/.dev.vars'); s=p.lstat()
assert stat.S_ISREG(s.st_mode) and not p.is_symlink()
assert stat.S_IMODE(s.st_mode)==0o600 and pwd.getpwuid(s.st_uid).pw_name=='awaqwq233'
v={}
for line in p.read_text().splitlines():
 if '=' in line and not line.lstrip().startswith('#'):
  k,x=line.split('=',1); v[k.strip()]=x.strip().strip('"\x27')
assert len(v.get('AUTH_SECRET',''))>=32
print('Production secret file gate passed (values hidden).')
PY
}
secret_gate
install -d -m 0700 /etc/jishi "$backup"
install -m 0600 /home/awaqwq233/.jishi-backup-20260909.key "$key"
ready=0
mutated=0
rollback() {
  trap - ERR
  set +e
  if [[ "$mutated" = 1 && "$ready" = 1 ]]; then
    systemctl stop jishi-web jishi-api
    mkdir -m 0700 "$backup/restore"
    node "$crypto" decrypt "$backup/production.tar.aesgcm" "$backup/restore.tar" "$key" || exit 90
    tar -xf "$backup/restore.tar" -C "$backup/restore" || exit 91
    rsync -a --delete --exclude='.dev.vars' --exclude='.dev.vars.*' --exclude='.env' --exclude='.env.*' "$backup/restore/opt/jishi/" /opt/jishi/ || exit 92
    rsync -a --delete --exclude='.dev.vars' --exclude='.dev.vars.*' --exclude='.env' --exclude='.env.*' "$backup/restore/var/lib/jishi/" /var/lib/jishi/ || exit 93
    install -o awaqwq233 -g awaqwq233 -m 0600 "$backup/restore/opt/jishi/server/.dev.vars" /opt/jishi/server/.dev.vars
    for name in jishi jishi-subdomain awaqwq233-heartbeat; do install -m 0644 "$backup/restore/etc/nginx/sites-available/$name" "/etc/nginx/sites-available/$name"; done
    for name in jishi-api jishi-web; do install -m 0644 "$backup/restore/etc/systemd/system/$name.service" "/etc/systemd/system/$name.service"; done
    install -o awaqwq233 -g awaqwq233 -m 0644 "$backup/restore/var/www/jishi-downloads/latest.json" /var/www/jishi-downloads/latest.json
    systemctl daemon-reload
    secret_gate || exit 94
    systemctl start jishi-api && systemctl start jishi-web
    nginx -t && systemctl reload nginx
    echo 'Deployment failed; pre-deployment files restored. Encrypted backup and private recovery workspace retained.' >&2
  else
    systemctl start jishi-api
    systemctl start jishi-web
    echo 'Deployment stopped before replacement; original services restarted.' >&2
  fi
  exit 1
}
trap rollback ERR
systemctl stop jishi-web jishi-api
tar -cpf "$backup/production.tar" -C / opt/jishi var/lib/jishi var/www/jishi-downloads etc/nginx/sites-available/jishi etc/nginx/sites-available/jishi-subdomain etc/nginx/sites-available/awaqwq233-heartbeat etc/systemd/system/jishi-api.service etc/systemd/system/jishi-web.service
node "$crypto" encrypt "$backup/production.tar" "$backup/production.tar.aesgcm" "$key"
node "$crypto" decrypt "$backup/production.tar.aesgcm" "$backup/verified.tar" "$key"
cmp "$backup/production.tar" "$backup/verified.tar"
sha256sum "$backup/production.tar.aesgcm" > "$backup/SHA256SUMS"
ready=1
rm -- "$backup/production.tar" "$backup/verified.tar"
mutated=1
rsync -a --delete --chown=awaqwq233:awaqwq233 \
  --include='.env.example' --include='.env.selfhost.example' \
  --exclude='.dev.vars' --exclude='.dev.vars.*' --exclude='.env' --exclude='.env.*' \
  --exclude='.git' --exclude='.wrangler' --exclude='work/' --exclude='outputs/' \
  --exclude='/nginx-*.conf' --exclude='/Jishi-*.exe' --exclude='/Jishi-*.apk' \
  "$stage/" /opt/jishi/
python3 - <<'PY'
import os
from pathlib import Path
p=Path('/opt/jishi/server/.dev.vars')
lines=p.read_text().splitlines()
keys={'ALLOWED_ORIGINS':'https://awaqwq233.com,https://jishi.awaqwq233.com,https://jishi-104-214-169-232.nip.io','TRUST_PROXY_HEADERS':'true'}
lines=[line for line in lines if line.split('=',1)[0].strip() not in keys]
lines.extend(k+'='+v for k,v in keys.items())
temp=p.with_name('.dev.vars.security-new')
fd=os.open(temp,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
with os.fdopen(fd,'w') as f: f.write('\n'.join(lines)+'\n')
os.chown(temp,p.stat().st_uid,p.stat().st_gid)
os.replace(temp,p)
# Restrict stored database/media files without following symbolic links.
root=Path('/var/lib/jishi')
for parent,dirs,files in os.walk(root,followlinks=False):
 for name in dirs+files:
  child=Path(parent)/name
  if child.is_symlink(): raise RuntimeError('Unexpected symlink in persistent data')
  os.chmod(child,0o700 if child.is_dir() else 0o600)
os.chmod(root,0o700)
PY
install -m 0644 "$stage/nginx-jishi.conf" /etc/nginx/sites-available/jishi
install -m 0644 "$stage/nginx-jishi-subdomain.conf" /etc/nginx/sites-available/jishi-subdomain
install -m 0644 "$stage/nginx-heartbeat.conf" /etc/nginx/sites-available/awaqwq233-heartbeat
install -m 0644 "$stage/server/deploy/native/jishi-api.service" /etc/systemd/system/jishi-api.service
install -m 0644 "$stage/server/deploy/native/jishi-web.service" /etc/systemd/system/jishi-web.service
chmod 0755 /opt/jishi/server/deploy/native/mark-deployment.sh
install -o awaqwq233 -g awaqwq233 -m 0644 "$stage/clients/web/public/updates/latest.json" /var/www/jishi-downloads/latest.json
secret_gate
nginx -t
systemctl daemon-reload
systemctl start jishi-api
curl --fail --retry 20 --retry-delay 2 --retry-connrefused --silent http://127.0.0.1:8787/health >/dev/null
systemctl start jishi-web
curl --fail --retry 20 --retry-delay 2 --retry-connrefused --silent http://127.0.0.1:3000/ >/dev/null
systemctl reload nginx
python3 - <<'PY'
import json,urllib.request,urllib.error,sqlite3
from pathlib import Path
for url in ['https://awaqwq233.com/note/','https://awaqwq233.com/note/health','https://jishi.awaqwq233.com/health']:
 with urllib.request.urlopen(url,timeout=30) as r: assert r.status==200
req=urllib.request.Request('https://awaqwq233.com/note/api/auth/login',data=json.dumps({'email':'deployment-invalid@example.invalid','password':'invalid-password'}).encode(),headers={'Content-Type':'application/json','Origin':'https://awaqwq233.com'})
try: urllib.request.urlopen(req,timeout=30); raise AssertionError('Invalid login unexpectedly succeeded')
except urllib.error.HTTPError as e:
 assert e.code==401 and 'application/json' in e.headers.get('Content-Type',''); assert 'error' in json.load(e)
expected=json.loads(Path('/var/www/jishi-downloads/latest.json').read_text())
with urllib.request.urlopen('https://awaqwq233.com/note/updates/latest.json',timeout=30) as r:
 actual=json.load(r); assert actual['webBuild']==expected['webBuild'] and actual['releaseId']==expected['releaseId']
found=False
for p in Path('/var/lib/jishi/v3/d1').rglob('*.sqlite'):
 c=sqlite3.connect(p.as_uri()+'?mode=ro',uri=True)
 if c.execute("SELECT name FROM sqlite_master WHERE name='auth_rate_limits'").fetchone(): found=True
 c.close()
assert found
print('Public health, invalid-login JSON 401, update hash and migration checks passed.')
PY
systemctl is-active --quiet jishi-api jishi-web nginx
trap - ERR
echo "Deployment basic checks passed. Backup: $backup"
echo 'Keep older backups and staging until existing-account bootstrap and old-client log checks also pass.'
