#!/usr/bin/env bash
set -euo pipefail
# Called only after deployment and real-account/device verification have passed.
[[ $# = 2 && "$1" = --verified ]]
keep="$2"
[[ "$keep" = /var/backups/jishi/previous-* ]]
test -d "$keep" && test ! -L "$keep"
test "$(realpath "$keep")" = "$keep"
(cd "$keep" && sha256sum -c SHA256SUMS)
test -f "$keep/verification-complete"
for unit in jishi-api jishi-web nginx; do systemctl is-active --quiet "$unit"; done
curl -fsS --max-time 15 https://awaqwq233.com/note/health >/dev/null
for parent in /var/backups/jishi /opt/jishi-backups; do
  test -d "$parent" && test ! -L "$parent"
  test "$(realpath "$parent")" = "$parent"
  while IFS= read -r -d '' candidate; do
    [[ "$candidate" = "$keep" ]] && continue
    test ! -L "$candidate"
    [[ "$(realpath "$candidate")" = "$parent/"* ]]
    [[ -z "$(find "$candidate" -type l -print -quit)" ]]
    printf 'delete=%s\n' "$candidate"
    rm -rf -- "$candidate"
  done < <(find "$parent" -mindepth 1 -maxdepth 1 -print0)
done
while IFS= read -r -d '' stage; do
  [[ "$stage" = /opt/jishi-stage-* ]]
  test -d "$stage" && test ! -L "$stage"
  test "$(realpath "$stage")" = "$stage"
  [[ -z "$(find "$stage" -type l -not -path '*/node_modules/*' -print -quit)" ]]
  printf 'delete=%s\n' "$stage"
  rm -rf -- "$stage"
done < <(find /opt -mindepth 1 -maxdepth 1 -type d -name 'jishi-stage-*' -print0)
python3 - <<'PY'
import json
from pathlib import Path
target=Path('/var/www/jishi-downloads');marker=target/'.retained-installers.json'
assert target.is_dir() and not target.is_symlink() and marker.is_file() and not marker.is_symlink()
keep=set(json.loads(marker.read_text()))
for source in target.iterdir():
    if source.suffix not in ('.exe','.apk') or source.name in keep: continue
    assert source.is_file() and not source.is_symlink() and source.parent.resolve()==target
    print('delete='+str(source));source.unlink()
marker.unlink()
PY
