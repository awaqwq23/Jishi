#!/usr/bin/env python3
"""Prepare an Origin-preserving API proxy without replacing Certbot configuration."""
import argparse
import hashlib
import json
import re
from pathlib import Path

TARGETS = ('jishi', 'jishi-subdomain')

def patch_config(text):
    count = 0
    def location(match):
        nonlocal count
        body = match[2]
        if not re.search(r'proxy_pass\s+http://127\.0\.0\.1:8787(?:/health)?;', body):
            return match[0]
        if 'proxy_set_header Host 127.0.0.1:8787;' in body:
            return match[0]
        if 'proxy_set_header Host $host;' not in body:
            raise ValueError('Unexpected API Host configuration; inspect before patching')
        body = body.replace('proxy_set_header Host $host;', 'proxy_set_header Host 127.0.0.1:8787;')
        if 'proxy_set_header X-Forwarded-Host ' not in body:
            body = body.replace('proxy_set_header Host 127.0.0.1:8787;', 'proxy_set_header Host 127.0.0.1:8787;\n        proxy_set_header X-Forwarded-Host $host;')
        count += 1
        return match[1] + body + match[3]
    result = re.sub(r'(location\s+[^{}]+\{)([^{}]*)(\})', location, text)
    if not re.search(r'proxy_set_header Host 127\.0\.0\.1:8787;', result):
        raise ValueError('No verified API locations found')
    return result, count

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('mode', choices=('prepare', 'apply', 'restore'))
    parser.add_argument('stage')
    parser.add_argument('--backup')
    args = parser.parse_args()
    stage = Path(args.stage)
    assert str(stage) == '/opt/jishi-staging' and not stage.is_symlink()
    candidates = stage / '.nginx-origin-candidates'
    if args.mode == 'prepare':
        candidates.mkdir(mode=0o700, exist_ok=True)
        assert not candidates.is_symlink()
        records = []
        for name in TARGETS:
            source = Path('/etc/nginx/sites-available') / name
            assert source.is_file() and not source.is_symlink()
            content, count = patch_config(source.read_text())
            candidate = candidates / name
            assert not candidate.is_symlink()
            candidate.write_text(content)
            candidate.chmod(0o600)
            records.append({'name':name,'before':digest(source),'after':digest(candidate),'changedLocations':count})
        (candidates / 'manifest.json').write_text(json.dumps(records, indent=2)+'\n')
        print(json.dumps(records))
        return
    records = json.loads((candidates / 'manifest.json').read_text())
    assert {row['name'] for row in records} == set(TARGETS)
    for row in records:
        target = Path('/etc/nginx/sites-available') / row['name']
        assert target.is_file() and not target.is_symlink()
        if args.mode == 'apply':
            source = candidates / row['name']
            assert not source.is_symlink() and digest(source) == row['after'] and digest(target) == row['before']
        else:
            backup = Path(args.backup)
            assert str(backup).startswith('/var/backups/jishi/previous-') and not backup.is_symlink()
            source = backup / 'restore/etc/nginx/sites-available' / row['name']
            assert source.is_file() and not source.is_symlink() and digest(source) == row['before']
        target.write_bytes(source.read_bytes())
        target.chmod(0o644)
    print('nginx_origin_config='+args.mode)

if __name__ == '__main__':
    main()
