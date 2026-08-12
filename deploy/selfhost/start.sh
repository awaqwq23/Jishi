#!/bin/sh
set -eu
npx wrangler d1 migrations apply DB --local --persist-to /data --config wrangler.selfhost.jsonc
exec npx wrangler dev --local --ip 0.0.0.0 --port 3000 --persist-to /data --config wrangler.selfhost.jsonc
