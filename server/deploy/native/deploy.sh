#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
[[ $# = 3 && ( "$1" = --preflight || "$1" = --apply ) ]]
mode="$1"; stage="$2"; backup="$3"
[[ "$stage" = /opt/jishi-staging && "$backup" = /var/backups/jishi/previous-* ]]
[[ "$(id -u)" = 0 ]]
for path in "$stage" /opt/jishi /var/lib/jishi /var/www/jishi-downloads /var/backups/jishi; do
  test -d "$path" && test ! -L "$path" && test "$(realpath "$path")" = "$path"
done
test ! -e "$backup" && test ! -L "$backup"
key=/etc/jishi/backup-20260909.key
test -f "$key" && test ! -L "$key" && test "$(stat -c %a "$key")" = 600
test "$(stat -c %s "$key")" = 32
secret_gate() {
  python3 - <<'PY'
import pwd,stat
from pathlib import Path
p=Path('/opt/jishi/server/.dev.vars');s=p.lstat()
assert stat.S_ISREG(s.st_mode) and not p.is_symlink() and stat.S_IMODE(s.st_mode)==0o600
assert pwd.getpwuid(s.st_uid).pw_name=='awaqwq233'
values={}
for line in p.read_text().splitlines():
    if '=' in line and not line.lstrip().startswith('#'):
        name,value=line.split('=',1);values[name.strip()]=value.strip().strip(chr(34)+chr(39))
assert len(values.get('AUTH_SECRET',''))>=32
print('secret_gate=pass (values hidden)')
PY
}
secret_gate
test -x "$stage/node_modules/.bin/wrangler"
test -x /usr/local/bin/node && test -f "$stage/clients/web/server.mjs"
test -f "$stage/.stage-verified"
test -f "$stage/.release-commit"
(cd "$stage" && npm run check:updates && npm audit --audit-level=high && node scripts/publish-github-release.mjs --verify)
for unit in jishi-api jishi-web nginx; do systemctl is-active --quiet "$unit"; done
nginx -t
if [[ "$mode" = --preflight ]]; then
  echo "preflight=pass stage=$stage backup=$backup"
  exit 0
fi
# --apply may only be called after the exact command and this backup/rollback
# scope have been shown to and explicitly confirmed by the user.
ready=0; mutated=0
crypto="$stage/scripts/backup-crypto.mjs"
rollback() {
  trap - ERR
  set +e
  if [[ "$ready" = 1 && "$mutated" = 1 ]]; then
    systemctl stop jishi-web jishi-api
    install -d -m 0700 "$backup/restore"
    node "$crypto" decrypt "$backup/production.tar.aesgcm" "$backup/restore.tar" "$key" || exit 90
    tar -xf "$backup/restore.tar" -C "$backup/restore" || exit 91
    rsync -a --delete --exclude='.dev.vars' --exclude='.dev.vars.*' --exclude='.env' --exclude='.env.*' "$backup/restore/opt/jishi/" /opt/jishi/ || exit 92
    rsync -a --delete "$backup/restore/var/lib/jishi/" /var/lib/jishi/ || exit 93
    rsync -a --delete "$backup/restore/var/www/jishi-downloads/" /var/www/jishi-downloads/ || exit 94
    install -o awaqwq233 -g awaqwq233 -m 0600 "$backup/restore/opt/jishi/server/.dev.vars" /opt/jishi/server/.dev.vars
    install -m 0644 "$backup/restore/etc/systemd/system/jishi-api.service" /etc/systemd/system/jishi-api.service
    install -m 0644 "$backup/restore/etc/systemd/system/jishi-web.service" /etc/systemd/system/jishi-web.service
    secret_gate || exit 95
    systemctl daemon-reload
  fi
  systemctl start jishi-api
  curl -fsS --retry 15 --retry-delay 2 --retry-connrefused http://127.0.0.1:8787/health >/dev/null || exit 96
  systemctl start jishi-web
  curl -fsS --retry 15 --retry-delay 2 --retry-connrefused http://127.0.0.1:3000/ >/dev/null || exit 97
  echo "rollback=restored backup=$backup" >&2
  exit 1
}
trap rollback ERR
install -d -m 0700 "$backup"
systemctl stop jishi-web jishi-api
tar -cpf "$backup/production.tar" -C / opt/jishi var/lib/jishi var/www/jishi-downloads etc/systemd/system/jishi-api.service etc/systemd/system/jishi-web.service etc/nginx
node "$crypto" encrypt "$backup/production.tar" "$backup/production.tar.aesgcm" "$key"
node "$crypto" decrypt "$backup/production.tar.aesgcm" "$backup/verified.tar" "$key"
cmp "$backup/production.tar" "$backup/verified.tar"
(cd "$backup" && sha256sum production.tar.aesgcm > SHA256SUMS)
ready=1
rm -- "$backup/production.tar" "$backup/verified.tar"
mutated=1
rsync -a --delete --chown=awaqwq233:awaqwq233 \
  --include='.env.example' --include='.env.selfhost.example' \
  --exclude='.dev.vars' --exclude='.dev.vars.*' --exclude='.env' --exclude='.env.*' \
  --exclude='.git' --exclude='.wrangler' --exclude='.stage-*' --exclude='.local' \
  --exclude='work' --exclude='outputs' "$stage/" /opt/jishi/
install -m 0644 "$stage/server/deploy/native/jishi-api.service" /etc/systemd/system/jishi-api.service
install -m 0644 "$stage/server/deploy/native/jishi-web.service" /etc/systemd/system/jishi-web.service
chmod 0755 /opt/jishi/server/deploy/native/mark-deployment.sh
# Preserve public installer URLs while retaining only current + previous assets.
python3 - "$stage" <<'PY'
import json,shutil,sys
from pathlib import Path
stage=Path(sys.argv[1]);target=Path('/var/www/jishi-downloads');keep=set()
for slot in ('current','previous'):
    for source in (stage/'releases'/slot).iterdir():
        assert source.is_file() and not source.is_symlink()
        if source.suffix in ('.exe','.apk'):
            shutil.copyfile(source,target/source.name);(target/source.name).chmod(0o644);keep.add(source.name)
temporary=target/'.latest.json.new';shutil.copyfile(stage/'releases/current/latest.json',temporary);temporary.chmod(0o644);temporary.replace(target/'latest.json')
# Obsolete download deletion is deferred until all production checks pass.
(target/'.retained-installers.json').write_text(json.dumps(sorted(keep)))
PY
secret_gate
systemctl daemon-reload
systemctl start jishi-api
curl -fsS --retry 15 --retry-delay 2 --retry-connrefused http://127.0.0.1:8787/health >/dev/null
systemctl start jishi-web
curl -fsS --retry 15 --retry-delay 2 --retry-connrefused http://127.0.0.1:3000/health >/dev/null
nginx -t
systemctl reload nginx
for unit in jishi-api jishi-web nginx; do systemctl is-active --quiet "$unit"; done
curl -fsS https://awaqwq233.com/note/ >/dev/null
curl -fsS https://awaqwq233.com/note/health >/dev/null
echo "deployment=started backup=$backup; complete contracts, account/device and legacy-log verification before cleanup"
