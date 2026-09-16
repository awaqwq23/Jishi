#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

# The --preflight mode is read-only. The default mode requires final user
# confirmation after its exact command and rollback scope have been shown.
feature_commit=02a1aea9071cea4628dcdd1dbd577be089084a46
stage=/opt/jishi-stage-02a1aea
backup=/var/backups/jishi/pre-02a1aea-20260916-progress-notifications
old_backups=(
  /var/backups/jishi/pre-682c7cd-20260914-updates
  /var/backups/jishi/pre-02a1aea-20260915-progress-notifications
)
downloads=/var/www/jishi-downloads
key=/etc/jishi/backup-20260909.key
crypto="$stage/scripts/backup-crypto.mjs"
mode="${1:-}"
[[ -z "$mode" || "$mode" = --preflight ]]
test "$(id -u)" = 0

secret_gate() {
  python3 - <<'PY'
import pwd, stat
from pathlib import Path
p = Path('/opt/jishi/server/.dev.vars')
s = p.lstat()
assert stat.S_ISREG(s.st_mode) and not p.is_symlink()
assert stat.S_IMODE(s.st_mode) == 0o600
assert pwd.getpwuid(s.st_uid).pw_name == 'awaqwq233'
values = {}
for line in p.read_text().splitlines():
    if '=' in line and not line.lstrip().startswith('#'):
        name, value = line.split('=', 1)
        values[name.strip()] = value.strip().strip(chr(34) + chr(39))
assert len(values.get('AUTH_SECRET', '')) >= 32
print('secret_gate=pass (values hidden)')
PY
}

for path in "$stage" /opt/jishi /var/lib/jishi "$downloads" /var/backups/jishi; do
  test -d "$path" && test ! -L "$path"
  test "$(realpath "$path")" = "$path"
done
test ! -e "$backup" && test ! -L "$backup"
for old_backup in "${old_backups[@]}"; do
  test -d "$old_backup" && test ! -L "$old_backup"
  test "$(realpath "$old_backup")" = "$old_backup"
done
test -f "$key" && test ! -L "$key"
test "$(stat -c %a "$key")" = 600 && test "$(stat -c %s "$key")" = 32
test -f "$stage/server/deploy/native/releases/deploy-02a1aea-20260915.sh"
test "$(realpath "$stage/server/deploy/native/releases/deploy-02a1aea-20260915.sh")" = "$stage/server/deploy/native/releases/deploy-02a1aea-20260915.sh"
git -C "$stage" merge-base --is-ancestor "$feature_commit" HEAD
git -C "$stage" diff --quiet HEAD -- . ':(exclude)clients/web/.wrangler/deploy/config.json'
test -x "$stage/node_modules/.bin/wrangler"
test -x "$stage/node_modules/.bin/vinext"
test "$(df --output=avail -k /var/backups/jishi | tail -1 | tr -d ' ')" -ge 5242880
test ! -e "$downloads/Jishi-Windows-Setup-0.4.6.exe"
test ! -e "$downloads/Jishi-Android-0.4.7.apk"
sha256sum -c <<'HASHES'
4079bca14b51a731d7bbc230dfeaaaaa6ffc7ed184403f10880167a8a5c92244  /opt/jishi-stage-02a1aea/Jishi-Windows-Setup-0.4.6.exe
2c238d4f4d346f613d77e008a626ef46a98f5f70fec6f3e84f089fff2c0fa8e2  /opt/jishi-stage-02a1aea/Jishi-Android-0.4.7.apk
b93752517e10a05c1708128b6c482aae7deb40a738b8bdf021106b21922ec433  /opt/jishi-stage-02a1aea/clients/web/public/updates/latest.json
6b78ae9f26c6adb819ff0be45c5a72ee300002baec866baabf59ae8d7e591781  /etc/nginx/sites-available/jishi
HASHES
secret_gate
systemctl is-active --quiet jishi-api
systemctl is-active --quiet jishi-web
systemctl is-active --quiet nginx
(cd "$stage" && npm run check:updates)
if [[ "$mode" = --preflight ]]; then
  echo "preflight=pass stage=$stage backup=$backup"
  exit 0
fi

started="$(date -u '+%Y-%m-%d %H:%M:%S UTC')"
nginx_lines="$(wc -l < /var/log/nginx/access.log)"
ready=0
mutated=0
rolling_back=0
rollback() {
  if [[ "$rolling_back" = 1 ]]; then
    trap - ERR
    set +e
    echo 'rollback_already_attempted=1; leaving services as found for manual inspection' >&2
    exit 1
  fi
  rolling_back=1
  trap - ERR
  set +e
  if [[ "$ready" = 1 && "$mutated" = 1 ]]; then
    systemctl stop jishi-web jishi-api
    install -d -m 0700 "$backup/restore"
    node "$crypto" decrypt "$backup/production.tar.aesgcm" "$backup/restore.tar" "$key" || exit 90
    tar -xf "$backup/restore.tar" -C "$backup/restore" || exit 91
    rsync -a --delete --exclude='.dev.vars' --exclude='.dev.vars.*' --exclude='.env' --exclude='.env.*' "$backup/restore/opt/jishi/" /opt/jishi/ || exit 92
    rsync -a --delete "$backup/restore/var/lib/jishi/" /var/lib/jishi/ || exit 93
    rsync -a --delete "$backup/restore/var/www/jishi-downloads/" "$downloads/" || exit 94
    install -o awaqwq233 -g awaqwq233 -m 0600 "$backup/restore/opt/jishi/server/.dev.vars" /opt/jishi/server/.dev.vars
    install -m 0644 "$backup/restore/etc/systemd/system/jishi-api.service" /etc/systemd/system/jishi-api.service
    install -m 0644 "$backup/restore/etc/systemd/system/jishi-web.service" /etc/systemd/system/jishi-web.service
    secret_gate || exit 95
    systemctl daemon-reload
    systemctl start jishi-api || exit 96
    curl -fsS --retry 20 --retry-delay 2 --retry-connrefused http://127.0.0.1:8787/health >/dev/null || exit 97
    systemctl start jishi-web || exit 98
    curl -fsS --retry 20 --retry-delay 2 --retry-connrefused http://127.0.0.1:3000/ >/dev/null || exit 99
    echo "rollback=restored backup=$backup" >&2
  else
    systemctl start jishi-api || exit 96
    curl -fsS --retry 20 --retry-delay 2 --retry-connrefused http://127.0.0.1:8787/health >/dev/null || exit 97
    systemctl start jishi-web || exit 98
    curl -fsS --retry 20 --retry-delay 2 --retry-connrefused http://127.0.0.1:3000/ >/dev/null || exit 99
    echo "rollback=original-services-restarted" >&2
  fi
  exit 1
}
trap rollback ERR

install -d -m 0700 "$backup"
systemctl stop jishi-web jishi-api
tar -cpf "$backup/production.tar" -C / \
  opt/jishi var/lib/jishi var/www/jishi-downloads \
  etc/systemd/system/jishi-api.service etc/systemd/system/jishi-web.service \
  etc/nginx/sites-available/jishi
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
  --exclude='.git' --exclude='.wrangler' --exclude='.stage-d1/' \
  --exclude='work/' --exclude='outputs/' \
  --exclude='/Jishi-*.exe' --exclude='/Jishi-*.apk' \
  "$stage/" /opt/jishi/
chmod 0755 /opt/jishi/server/deploy/native/mark-deployment.sh
install -o awaqwq233 -g awaqwq233 -m 0644 "$stage/Jishi-Windows-Setup-0.4.6.exe" "$downloads/Jishi-Windows-Setup-0.4.6.exe"
install -o awaqwq233 -g awaqwq233 -m 0644 "$stage/Jishi-Android-0.4.7.apk" "$downloads/Jishi-Android-0.4.7.apk"
install -o awaqwq233 -g awaqwq233 -m 0644 "$stage/clients/web/public/updates/latest.json" "$downloads/latest.json"
# The update-contract checker reads installers from the repository root. Keep
# verified local copies there as well as the Nginx download directory.
install -o awaqwq233 -g awaqwq233 -m 0644 "$stage/Jishi-Windows-Setup-0.4.6.exe" /opt/jishi/Jishi-Windows-Setup-0.4.6.exe
install -o awaqwq233 -g awaqwq233 -m 0644 "$stage/Jishi-Android-0.4.7.apk" /opt/jishi/Jishi-Android-0.4.7.apk
secret_gate
systemctl daemon-reload
systemctl start jishi-api
curl -fsS --retry 20 --retry-delay 2 --retry-connrefused http://127.0.0.1:8787/health >/dev/null
systemctl start jishi-web
curl -fsS --retry 20 --retry-delay 2 --retry-connrefused http://127.0.0.1:3000/ >/dev/null
nginx -t
systemctl reload nginx

python3 - <<'PY'
import base64, hashlib, hmac, json, sqlite3, time, urllib.error, urllib.request
from pathlib import Path
def open_json(request):
    with urllib.request.urlopen(request, timeout=30) as response:
        assert response.status == 200
        assert 'application/json' in response.headers.get('Content-Type', '')
        return json.load(response)
for url in ('https://awaqwq233.com/note/', 'https://awaqwq233.com/note/health',
            'https://jishi.awaqwq233.com/', 'https://jishi.awaqwq233.com/health'):
    with urllib.request.urlopen(url, timeout=30) as response:
        assert response.status == 200
invalid = urllib.request.Request('https://awaqwq233.com/note/api/auth/login',
    data=json.dumps({'email':'invalid@example.invalid','password':'invalid'}).encode(),
    headers={'Content-Type':'application/json','Origin':'https://awaqwq233.com'})
try:
    urllib.request.urlopen(invalid, timeout=30)
    raise AssertionError('Invalid login unexpectedly succeeded')
except urllib.error.HTTPError as error:
    assert error.code == 401 and 'application/json' in error.headers.get('Content-Type','')
    assert 'error' in json.load(error)
expected = json.loads(Path('/var/www/jishi-downloads/latest.json').read_text())
assert expected['releaseId'] == 'web-3e3b2175ceeeafbf'
assert expected['webBuild'] == '3e3b2175ceeeafbf4bc89f4990a1d1420c50e957bf0fb8a58f8f2b93bd024813'
for url in ('https://awaqwq233.com/note/updates/latest.json',
            'https://jishi.awaqwq233.com/updates/latest.json'):
    actual = open_json(urllib.request.Request(url, headers={'User-Agent':'JishiWindows/0.4.4'}))
    assert actual['releaseId'] == expected['releaseId']
for name, size in (('Jishi-Windows-Setup-0.4.6.exe',99630936),
                   ('Jishi-Android-0.4.7.apk',4069317)):
    url = 'https://awaqwq233.com/note/downloads/' + name
    with urllib.request.urlopen(urllib.request.Request(url, method='HEAD'), timeout=30) as response:
        assert response.status == 200 and int(response.headers['Content-Length']) == size
        assert response.headers.get('Content-Disposition','').lower().startswith('attachment')
    with urllib.request.urlopen(urllib.request.Request(url, headers={'Range':'bytes=0-0'}), timeout=30) as response:
        assert response.status == 206 and len(response.read()) == 1
db = None
for path in Path('/var/lib/jishi/v3/d1').rglob('*.sqlite'):
    connection = sqlite3.connect(path.as_uri() + '?mode=ro', uri=True)
    if connection.execute("SELECT name FROM sqlite_master WHERE name='users'").fetchone():
        db = connection
        user = db.execute('SELECT id,email,name FROM users ORDER BY created_at LIMIT 1').fetchone()
        break
    connection.close()
assert db is not None and user is not None
tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
assert {'users','todos','schedule_items','schedule_records','auth_rate_limits'} <= tables
db.close()
values = {}
for line in Path('/opt/jishi/server/.dev.vars').read_text().splitlines():
    if '=' in line and not line.lstrip().startswith('#'):
        name, value = line.split('=',1)
        values[name.strip()] = value.strip().strip(chr(34) + chr(39))
payload = json.dumps({'id':user[0], 'email':user[1], 'name':user[2] or user[1].split('@')[0],
                      'exp':int(time.time())+300},separators=(',',':')).encode()
encoded = base64.urlsafe_b64encode(payload).rstrip(b'=')
signature = base64.urlsafe_b64encode(hmac.new(values['AUTH_SECRET'].encode(),encoded,hashlib.sha256).digest()).rstrip(b'=')
cookie = b'jishi_session=' + encoded + b'.' + signature
bootstrap = open_json(urllib.request.Request('https://awaqwq233.com/note/api/bootstrap',
    headers={'Cookie':cookie.decode(), 'User-Agent':'JishiWindows/0.4.4'}))
assert bootstrap.get('user',{}).get('id') == user[0]
print('public_health_json_401_existing_account_bootstrap_downloads_tables=pass')
PY

(cd /opt/jishi && npm run check:updates)
sha256sum -c <<'LIVE_HASHES'
4079bca14b51a731d7bbc230dfeaaaaa6ffc7ed184403f10880167a8a5c92244  /var/www/jishi-downloads/Jishi-Windows-Setup-0.4.6.exe
2c238d4f4d346f613d77e008a626ef46a98f5f70fec6f3e84f089fff2c0fa8e2  /var/www/jishi-downloads/Jishi-Android-0.4.7.apk
b93752517e10a05c1708128b6c482aae7deb40a738b8bdf021106b21922ec433  /var/www/jishi-downloads/latest.json
6b78ae9f26c6adb819ff0be45c5a72ee300002baec866baabf59ae8d7e591781  /etc/nginx/sites-available/jishi
LIVE_HASHES
systemctl is-active --quiet jishi-api
systemctl is-active --quiet jishi-web
systemctl is-active --quiet nginx
test -z "$(journalctl -q -u jishi-api -u jishi-web --since "$started" -p err --no-pager)"
tail -n "+$((nginx_lines + 1))" /var/log/nginx/access.log | python3 -c 'import re,sys
bad=[]
for line in sys.stdin:
    match=re.search(r"\"(?:GET|HEAD) ([^ ]+) [^\"]+\" (\d{3}).*\"([^\"]*)\"$",line.rstrip())
    if not match: continue
    path,status,agent=match.groups()
    if any(marker in agent for marker in ("JishiWindows/0.4.3","JishiWindows/0.4.4","JishiAndroid/0.4.4")) and int(status)>=400:
        bad.append((path,status))
assert not bad,bad'

trap - ERR
# Only after every verification: retain the single freshly created previous-
# version backup. These exact old targets were inventoried before deployment.
test -d "$backup" && test ! -L "$backup"
test "$(realpath "$backup")" = "$backup"
test -f "$backup/production.tar.aesgcm" && test ! -L "$backup/production.tar.aesgcm"
sha256sum -c "$backup/SHA256SUMS"
for candidate in "${old_backups[@]}"; do
  test -d "$candidate" && test ! -L "$candidate"
  test "$(realpath "$candidate")" = "$candidate"
  test "$(dirname "$candidate")" = /var/backups/jishi
  rm -rf --one-file-system -- "$candidate"
  echo "removed_old_backup=$candidate"
done
test -d "$stage" && test ! -L "$stage"
test "$(realpath "$stage")" = /opt/jishi-stage-02a1aea
rm -rf --one-file-system -- "$stage"
echo "deployment=pass feature_commit=$feature_commit backup=$backup"
