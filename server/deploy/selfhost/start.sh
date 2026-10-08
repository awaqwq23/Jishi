#!/bin/sh
set -eu
umask 077
printf 'AUTH_SECRET=%s\nALLOWED_ORIGINS=%s\n' "$AUTH_SECRET" "$ALLOWED_ORIGINS" > /app/server/.dev.vars
/app/node_modules/.bin/wrangler d1 migrations apply DB --local --persist-to /data
exec /app/node_modules/.bin/wrangler dev --local --ip 0.0.0.0 --port 8787 --persist-to /data
