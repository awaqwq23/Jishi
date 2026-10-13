const fs = require('node:fs');
const path = require('node:path');

function createSystemNotifier({ Notification, fallback, file, timeout = 5000, clock = Date.now }) {
  const retained = new Set(), pending = new Map();
  let delivered = {};
  try { delivered = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* First launch. */ }
  const remember = key => {
    delivered = { ...delivered, [key]: clock() };
    delivered = Object.fromEntries(Object.entries(delivered).filter(([, at]) => Number.isFinite(at) && clock() - at < 90 * 86400000).slice(-5000));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(delivered), { mode: 0o600 });
    fs.renameSync(`${file}.tmp`, file);
  };
  const notify = (item, onClick = () => {}) => {
    if (Object.hasOwn(delivered, item.key)) return Promise.resolve(true);
    if (pending.has(item.key)) return pending.get(item.key);
    const operation = (async () => {
      if (!Notification.isSupported()) {
        await fallback(item, onClick);
      } else {
        await new Promise((resolve, reject) => {
          const notification = new Notification({ title: item.title.slice(0, 120), body: item.body.slice(0, 500), silent: false, timeoutType: 'never' });
          retained.add(notification);
          let settled = false;
          const timer = setTimeout(() => finish(new Error('System notification did not confirm delivery')), timeout);
          const finish = error => {
            if (settled) return;
            settled = true; clearTimeout(timer);
            if (error) { retained.delete(notification); notification.close(); reject(error); }
            else resolve();
          };
          notification.once('show', () => finish());
          notification.once('failed', () => finish(new Error('System notification failed')));
          notification.once('close', () => retained.delete(notification));
          notification.once('click', () => { retained.delete(notification); onClick(); });
          try { notification.show(); } catch (error) { finish(error); }
        }).catch(() => fallback(item, onClick));
      }
      remember(item.key);
      return true;
    })().finally(() => pending.delete(item.key));
    pending.set(item.key, operation);
    return operation;
  };
  return { notify };
}
module.exports = { createSystemNotifier };
