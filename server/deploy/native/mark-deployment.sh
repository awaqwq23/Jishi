#!/usr/bin/env bash
set -euo pipefail
root="${JISHI_PROJECT_ROOT:-/opt/jishi}"
manifest="${JISHI_UPDATE_MANIFEST:-/var/www/jishi-downloads/latest.json}"
test -f "$manifest" && test ! -L "$manifest"
node --input-type=module - "$root" "$manifest" <<'NODE'
import { pathToFileURL } from 'node:url';
import { readFile,writeFile,rename,chmod } from 'node:fs/promises';
const [root,path]=process.argv.slice(2);
const {webBuildHash}=await import(pathToFileURL(root+'/scripts/release-layout.mjs'));
const expected=await webBuildHash(root+'/clients/web');
const manifest=JSON.parse(await readFile(path,'utf8'));
if(manifest.webBuild!==expected) throw new Error('Deployed Web hash differs from approved release manifest');
NODE
