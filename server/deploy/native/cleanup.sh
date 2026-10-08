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
declare -a obsolete=()
for parent in /var/backups/jishi /opt/jishi-backups; do
  test -d "$parent" && test ! -L "$parent"
  test "$(realpath "$parent")" = "$parent"
  while IFS= read -r -d '' candidate; do
    [[ "$candidate" = "$keep" ]] && continue
    test ! -L "$candidate"
    [[ "$(realpath "$candidate")" = "$parent/"* ]]
    [[ -z "$(find "$candidate" -type l -print -quit)" ]]
    obsolete+=("$candidate")
  done < <(find "$parent" -mindepth 1 -maxdepth 1 -print0)
done
while IFS= read -r -d '' stage; do
  [[ "$stage" = /opt/jishi-stage-* ]]
  test -d "$stage" && test ! -L "$stage"
  test "$(realpath "$stage")" = "$stage"
  [[ -z "$(find "$stage" -type l -not -path '*/node_modules/*' -print -quit)" ]]
  obsolete+=("$stage")
done < <(find /opt -mindepth 1 -maxdepth 1 -type d -name 'jishi-stage-*' -print0)
python3 - <<'PY'
import hashlib,json,re
from pathlib import Path
target=Path('/var/www/jishi-downloads');marker=target/'.retained-installers.json'
assert target.is_dir() and not target.is_symlink() and marker.is_file() and not marker.is_symlink()
keep=set(json.loads(marker.read_text()))
assert 3<=len(keep)<=4
pattern=re.compile(r'(?:Jishi-Windows-Setup-\d+\.\d+\.\d+\.exe|Jishi-Android-\d+\.\d+\.\d+\.apk)')
assert all(isinstance(name,str) and pattern.fullmatch(name) for name in keep)
assert len([name for name in keep if name.endswith('.exe')])==2
assert 1<=len([name for name in keep if name.endswith('.apk')])<=2
for slot in ('current','previous'):
    directory=Path('/opt/jishi/releases')/slot
    sums=directory/'SHA256SUMS'
    assert sums.is_file() and not sums.is_symlink()
    names=set()
    for line in sums.read_text().splitlines():
        digest,name=line.split(maxsplit=1);name=name.lstrip('*')
        assert re.fullmatch(r'[a-fA-F0-9]{64}',digest) and pattern.fullmatch(name) and name in keep
        source=target/name
        assert source.is_file() and not source.is_symlink()
        assert hashlib.file_digest(source.open('rb'),'sha256').hexdigest()==digest.lower()
        names.add(name)
    assert len(names)==2
for source in target.iterdir():
    if source.suffix not in ('.exe','.apk') or source.name in keep: continue
    assert source.is_file() and not source.is_symlink() and source.parent.resolve()==target
    assert pattern.fullmatch(source.name)
print('retained_installers=verified')
PY
# All candidates and the retained release have passed checks before deletion.
printf 'delete=%s\n' "${obsolete[@]}"
for candidate in "${obsolete[@]}"; do rm -rf -- "$candidate"; done
python3 - <<'PY'
import json,re
from pathlib import Path
target=Path('/var/www/jishi-downloads');marker=target/'.retained-installers.json'
keep=set(json.loads(marker.read_text()))
pattern=re.compile(r'(?:Jishi-Windows-Setup-\d+\.\d+\.\d+\.exe|Jishi-Android-\d+\.\d+\.\d+\.apk)')
for source in target.iterdir():
    if source.name in keep or not pattern.fullmatch(source.name): continue
    assert source.is_file() and not source.is_symlink() and source.parent.resolve()==target
    print('delete='+str(source));source.unlink()
marker.unlink()
PY
