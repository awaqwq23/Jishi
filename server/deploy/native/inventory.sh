#!/usr/bin/env bash
set -euo pipefail
systemctl is-active jishi-api jishi-web nginx
df -h /opt /var/lib /var/backups
for root in /opt/jishi /opt/jishi-staging /var/www/jishi-downloads /var/backups/jishi /opt/jishi-backups; do
  if test -d "$root"; then
    test ! -L "$root"
    find "$root" -maxdepth 1 -printf '%y %s %p\n'
    du -sh "$root"
  fi
done
