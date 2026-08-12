#!/bin/sh
set -eu
umask 077
printf 'AUTH_SECRET=%s\nALLOWED_ORIGINS=%s\n' "$AUTH_SECRET" "$ALLOWED_ORIGINS" > /app/.dev.vars
npx wrangler d1 migrations apply DB --local --persist-to /data
exec npx wrangler dev --local --ip 0.0.0.0 --port 8787 --persist-to /data
