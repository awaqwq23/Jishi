#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

commit=682c7cd40dd2d5e41331c406246982fe5d95a3b8
mode="${1:-}"
[[ -z "$mode" || "$mode" = --preflight ]]
stage=/opt/jishi-stage-682c7cd
stage_db=/var/lib/jishi-stage-682c7cd
nginx_stage="$stage/deploy-nginx"
backup=/var/backups/jishi/pre-682c7cd-20260914-updates
key=/etc/jishi/backup-20260909.key
crypto="$stage/scripts/backup-crypto.mjs"
deploy_started="$(date -u '+%Y-%m-%d %H:%M:%S UTC')"
nginx_log_lines="$(wc -l < /var/log/nginx/access.log)"

test "$(id -u)" = 0
for path in /opt/jishi /var/lib/jishi /var/www/jishi-downloads "$stage" "$stage_db" "$nginx_stage"; do
  test -d "$path" && test ! -L "$path"
done
test "$(realpath /var/backups/jishi)" = /var/backups/jishi
test ! -e "$backup" && test ! -L "$backup"
test -f "$key" && test ! -L "$key" && test "$(stat -c %a "$key")" = 600 && test "$(stat -c %s "$key")" = 32
test -f /home/awaqwq233/.jishi-backup-20260909.key
test ! -L /home/awaqwq233/.jishi-backup-20260909.key
test "$(stat -c %a /home/awaqwq233/.jishi-backup-20260909.key)" = 600
cmp "$key" /home/awaqwq233/.jishi-backup-20260909.key
test "$(git -C "$stage" rev-parse HEAD)" = "$commit"
git -C "$stage" diff --quiet "$commit" -- . ':(exclude)clients/web/.wrangler/deploy/config.json'
while IFS= read -r path; do
  [[ "$path" = deploy-nginx/* || "$path" = deploy-update-downloads-682c7cd.sh ]]
done < <(git -C "$stage" ls-files --others --exclude-standard)
test -x "$stage/node_modules/.bin/wrangler"
test -x "$stage/node_modules/.bin/vinext"
available_kb="$(df --output=avail -k /var/backups/jishi | tail -n 1 | tr -d ' ')"
test "$available_kb" -ge 5242880

sha256sum -c <<'HASHES'
025a15e316d81a59464cfcd1263166272998300908f854bd1e1459510d9e7d43  /opt/jishi-stage-682c7cd/clients/web/public/updates/latest.json
ad05ed72741d4e1d771da6bfaf8c5ffdcf8d79a804db8bf3511c30d99f826ee7  /opt/jishi-stage-682c7cd/Jishi-Windows-Setup-0.4.5.exe
7fdcb9acfbc4dd22e62969a332a57987da69f4464b7259c22e656e1eb7a9c945  /opt/jishi-stage-682c7cd/Jishi-Android-0.4.6.apk
ad05ed72741d4e1d771da6bfaf8c5ffdcf8d79a804db8bf3511c30d99f826ee7  /var/www/jishi-downloads/Jishi-Windows-Setup-0.4.5.exe
7fdcb9acfbc4dd22e62969a332a57987da69f4464b7259c22e656e1eb7a9c945  /var/www/jishi-downloads/Jishi-Android-0.4.6.apk
d40c018a2302cd48d8330adcb01b41370a77c8977364f05568c7060a0e296743  /etc/nginx/sites-available/jishi
c0f7de0f493df615429aac12fee8c064c9b81144be76601786e9331b74f5c9de  /etc/nginx/sites-available/jishi-subdomain
181fe0da294722d025e583a0fc20d068330e744b03e1e1ebdd66e305798bb6c6  /etc/nginx/sites-available/awaqwq233-heartbeat
6b78ae9f26c6adb819ff0be45c5a72ee300002baec866baabf59ae8d7e591781  /opt/jishi-stage-682c7cd/deploy-nginx/jishi
d7bdfa5178d55fb6d9b2ec8c96b3cc82b28e4b1ccdd77009e2651048ce005325  /opt/jishi-stage-682c7cd/deploy-nginx/jishi-subdomain
fca5e7fbf26ebe231850df1a9acdee2c784708e8482453ba2a096eac9421e485  /opt/jishi-stage-682c7cd/deploy-nginx/awaqwq233-heartbeat
HASHES

secret_gate() {
  python3 - <<'PY'
import os, pwd, stat
from pathlib import Path
p = Path('/opt/jishi/server/.dev.vars')
s = p.lstat()
assert stat.S_ISREG(s.st_mode) and not p.is_symlink()
assert stat.S_IMODE(s.st_mode) == 0o600
assert pwd.getpwuid(s.st_uid).pw_name == 'awaqwq233'
values = {}
for line in p.read_text().splitlines():
    if '=' in line and not line.lstrip().startswith('#'):
        key, value = line.split('=', 1)
        values[key.strip()] = value.strip().strip('"\x27')
assert len(values.get('AUTH_SECRET', '')) >= 32
print('Production secret file gate passed (values hidden).')
PY
}

secret_gate
systemctl is-active --quiet jishi-api
systemctl is-active --quiet jishi-web
systemctl is-active --quiet nginx
nginx -t -c "$nginx_stage/nginx-test.conf"
(cd "$stage" && npm run check:updates)
if [[ "$mode" = --preflight ]]; then
  echo 'deployment_preflight=pass'
  exit 0
fi

ready=0
mutated=0
rollback() {
  trap - ERR
  set +e
  if [[ "$mutated" = 1 && "$ready" = 1 ]]; then
    systemctl stop jishi-web jishi-api
    install -d -m 0700 "$backup/restore"
    node "$crypto" decrypt "$backup/production.tar.aesgcm" "$backup/restore.tar" "$key" || exit 90
    tar -xf "$backup/restore.tar" -C "$backup/restore" || exit 91
    rsync -a --delete --exclude='.dev.vars' --exclude='.dev.vars.*' --exclude='.env' --exclude='.env.*' "$backup/restore/opt/jishi/" /opt/jishi/ || exit 92
    rsync -a --delete "$backup/restore/var/lib/jishi/" /var/lib/jishi/ || exit 93
    rsync -a --delete "$backup/restore/var/www/jishi-downloads/" /var/www/jishi-downloads/ || exit 94
    install -o awaqwq233 -g awaqwq233 -m 0600 "$backup/restore/opt/jishi/server/.dev.vars" /opt/jishi/server/.dev.vars
    for name in jishi jishi-subdomain awaqwq233-heartbeat; do
      install -m 0644 "$backup/restore/etc/nginx/sites-available/$name" "/etc/nginx/sites-available/$name"
    done
    for name in jishi-api jishi-web; do
      install -m 0644 "$backup/restore/etc/systemd/system/$name.service" "/etc/systemd/system/$name.service"
    done
    systemctl daemon-reload
    secret_gate || exit 95
    nginx -t || exit 96
    systemctl start jishi-api && systemctl start jishi-web && systemctl reload nginx
    echo 'Deployment failed; the pre-deployment version was restored. Backup and staging were retained.' >&2
  else
    systemctl start jishi-api
    systemctl start jishi-web
    echo 'Deployment stopped before replacement; original services were restarted.' >&2
  fi
  exit 1
}
trap rollback ERR

install -d -m 0700 "$backup"
cat > "$backup/RESTORE.txt" <<'EOF'
This directory contains the encrypted production state from immediately before deployment 682c7cd.
Keep /etc/jishi/backup-20260909.key separately with mode 600.
The deployment script contains the tested automatic restore sequence. Do not expose the key or .dev.vars contents.
EOF

systemctl stop jishi-web jishi-api
tar -cpf "$backup/production.tar" -C / \
  opt/jishi var/lib/jishi var/www/jishi-downloads \
  etc/nginx/sites-available/jishi \
  etc/nginx/sites-available/jishi-subdomain \
  etc/nginx/sites-available/awaqwq233-heartbeat \
  etc/systemd/system/jishi-api.service \
  etc/systemd/system/jishi-web.service
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
  --exclude='.git' --exclude='.wrangler' --exclude='deploy-nginx/' \
  --exclude='/deploy-update-downloads-682c7cd.sh' \
  --exclude='work/' --exclude='outputs/' \
  --exclude='/Jishi-*.exe' --exclude='/Jishi-*.apk' \
  "$stage/" /opt/jishi/
chmod 0755 /opt/jishi/server/deploy/native/mark-deployment.sh
install -m 0644 "$nginx_stage/jishi" /etc/nginx/sites-available/jishi
install -m 0644 "$nginx_stage/jishi-subdomain" /etc/nginx/sites-available/jishi-subdomain
install -m 0644 "$nginx_stage/awaqwq233-heartbeat" /etc/nginx/sites-available/awaqwq233-heartbeat
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
import base64
import hashlib
import hmac
import json
import sqlite3
import time
import urllib.error
import urllib.request
from pathlib import Path

def open_json(request):
    with urllib.request.urlopen(request, timeout=30) as response:
        assert response.status == 200
        assert 'application/json' in response.headers.get('Content-Type', '')
        return json.load(response)

for url in (
    'https://awaqwq233.com/note/',
    'https://awaqwq233.com/note/health',
    'https://jishi.awaqwq233.com/',
    'https://jishi.awaqwq233.com/health',
):
    with urllib.request.urlopen(url, timeout=30) as response:
        assert response.status == 200

invalid = urllib.request.Request(
    'https://awaqwq233.com/note/api/auth/login',
    data=json.dumps({'email': 'deployment-invalid@example.invalid', 'password': 'invalid-password'}).encode(),
    headers={'Content-Type': 'application/json', 'Origin': 'https://awaqwq233.com'},
)
try:
    urllib.request.urlopen(invalid, timeout=30)
    raise AssertionError('Invalid login unexpectedly succeeded')
except urllib.error.HTTPError as error:
    assert error.code == 401
    assert 'application/json' in error.headers.get('Content-Type', '')
    assert 'error' in json.load(error)

expected = json.loads(Path('/var/www/jishi-downloads/latest.json').read_text())
for url in ('https://awaqwq233.com/note/updates/latest.json', 'https://jishi.awaqwq233.com/updates/latest.json'):
    actual = open_json(urllib.request.Request(url, headers={'User-Agent': 'JishiWindows/0.4.4'}))
    assert actual['releaseId'] == expected['releaseId'] == 'web-4ac12598051f51c5'
    assert actual['webBuild'] == expected['webBuild'] == '4ac12598051f51c583c07212a3cf37328e214eba34a1e0c4cfe67585246f7594'

downloads = (
    ('https://awaqwq233.com/note/downloads/Jishi-Windows-Setup-0.4.5.exe', 99627529, 'JishiWindows/0.4.4'),
    ('https://jishi.awaqwq233.com/downloads/Jishi-Windows-Setup-0.4.5.exe', 99627529, 'JishiWindows/0.4.3'),
    ('https://awaqwq233.com/note/downloads/Jishi-Android-0.4.6.apk', 4155446, 'JishiAndroid/0.4.4'),
    ('https://jishi.awaqwq233.com/downloads/Jishi-Android-0.4.6.apk', 4155446, 'JishiAndroid/0.4.4'),
)
for url, size, agent in downloads:
    request = urllib.request.Request(url, method='HEAD', headers={'User-Agent': agent})
    with urllib.request.urlopen(request, timeout=30) as response:
        assert response.status == 200
        assert int(response.headers['Content-Length']) == size
        assert response.headers.get('Content-Disposition', '').lower().startswith('attachment')

for url, _, agent in (downloads[0], downloads[2]):
    request = urllib.request.Request(url, headers={'Range': 'bytes=0-0', 'User-Agent': agent})
    with urllib.request.urlopen(request, timeout=30) as response:
        assert response.status == 206
        assert len(response.read()) == 1

db = None
user = None
for path in Path('/var/lib/jishi/v3/d1').rglob('*.sqlite'):
    connection = sqlite3.connect(path.as_uri() + '?mode=ro', uri=True)
    if connection.execute("SELECT name FROM sqlite_master WHERE name='users'").fetchone():
        db = connection
        user = connection.execute('SELECT id,email,name FROM users ORDER BY created_at LIMIT 1').fetchone()
        break
    connection.close()
assert db is not None and user is not None
required_tables = {'users', 'todos', 'schedule_items', 'schedule_records', 'diary_entries', 'auth_rate_limits'}
tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
assert required_tables <= tables
db.close()

values = {}
for line in Path('/opt/jishi/server/.dev.vars').read_text().splitlines():
    if '=' in line and not line.lstrip().startswith('#'):
        key, value = line.split('=', 1)
        values[key.strip()] = value.strip().strip('"\x27')
secret = values['AUTH_SECRET'].encode()
payload = json.dumps({'id': user[0], 'email': user[1], 'name': user[2] or user[1].split('@')[0], 'exp': int(time.time()) + 300}, separators=(',', ':')).encode()
encoded = base64.urlsafe_b64encode(payload).rstrip(b'=')
signature = base64.urlsafe_b64encode(hmac.new(secret, encoded, hashlib.sha256).digest()).rstrip(b'=')
cookie = b'jishi_session=' + encoded + b'.' + signature
bootstrap = open_json(urllib.request.Request('https://awaqwq233.com/note/api/bootstrap', headers={'Cookie': cookie.decode(), 'User-Agent': 'JishiWindows/0.4.4'}))
assert bootstrap.get('user', {}).get('id') == user[0]
print('Public health, JSON 401, existing-account bootstrap, update manifest, attachment headers, byte ranges, and tables passed.')
PY

(cd /opt/jishi && npm run check:updates)
systemctl is-active --quiet jishi-api
systemctl is-active --quiet jishi-web
systemctl is-active --quiet nginx
test -z "$(journalctl -q -u jishi-api -u jishi-web --since "$deploy_started" -p err --no-pager)"
tail -n "+$((nginx_log_lines + 1))" /var/log/nginx/access.log | python3 -c 'import re,sys
bad=[]
for line in sys.stdin:
    match=re.search(r"\"(?:GET|HEAD) ([^ ]+) [^\"]+\" (\d{3}).*\"([^\"]*)\"$", line.rstrip())
    if not match: continue
    path,status,agent=match.groups()
    if any(marker in agent for marker in ("JishiWindows/0.4.3","JishiWindows/0.4.4","JishiAndroid/0.4.4")) and (path.startswith("/note/") or path.startswith("/updates/") or path.startswith("/downloads/")) and int(status)>=400:
        bad.append((path,status))
assert not bad, bad'

trap - ERR
for old in \
  /var/backups/jishi/pre-7ac3043-20260909-security \
  /var/backups/jishi/pre-df68e52-20260908T021500Z \
  /var/backups/jishi/pre-f02effc-20260909-security; do
  if [[ -e "$old" || -L "$old" ]]; then
    test -d "$old" && test ! -L "$old"
    test "$(dirname "$(realpath "$old")")" = /var/backups/jishi
    rm -rf --one-file-system -- "$old"
    echo "removed_old_backup=$old"
  fi
done

test "$(realpath "$stage_db")" = "$stage_db" && test ! -L "$stage_db"
test "$(realpath "$stage")" = "$stage" && test ! -L "$stage"
rm -rf --one-file-system -- "$stage_db"
rm -rf --one-file-system -- "$stage"

echo "deployment=pass commit=$commit release=web-4ac12598051f51c5 backup=$backup"
