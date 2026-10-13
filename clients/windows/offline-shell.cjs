const { readFile } = require('node:fs/promises');
const path = require('node:path');

function localPath(url, origins) {
  const parsed = new URL(url);
  if (!origins.includes(parsed.origin)) return null;
  const relative = parsed.pathname.replace(/^\/note\//, '/').replace(/^\//, '') || 'index.html';
  return /^(index\.html|app-icon\.png|favicon\.svg|manifest\.webmanifest|assets\/[a-zA-Z0-9_.-]+\.(js|css))$/.test(relative) ? relative : null;
}
function installOfflineShell(session, origins) {
  const offline = new Set();
  session.protocol.handle('https', async request => {
    const relative = request.method === 'GET' ? localPath(request.url, origins) : null;
    const origin = new URL(request.url).origin;
    const local = async () => {
      const bytes = await readFile(path.join(__dirname, 'offline-shell', relative));
      const type = relative.endsWith('.js') ? 'application/javascript' : relative.endsWith('.css') ? 'text/css' : relative.endsWith('.png') ? 'image/png' : relative.endsWith('.svg') ? 'image/svg+xml' : relative.endsWith('.webmanifest') ? 'application/manifest+json' : 'text/html';
      return new Response(bytes, { headers: { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store' } });
    };
    if (relative && offline.has(origin)) return local();
    try {
      const response = await session.fetch(request, { bypassCustomProtocolHandlers: true, ...(relative === 'index.html' ? { signal: AbortSignal.any([request.signal, AbortSignal.timeout(6000)]) } : {}) });
      if (relative === 'index.html' && response.status >= 500) { offline.add(origin); return local(); }
      return response;
    } catch (error) {
      if (relative === 'index.html') { offline.add(origin); return local(); }
      if (relative && offline.has(origin)) return local();
      throw error;
    }
  });
}
module.exports = { installOfflineShell, localPath };
