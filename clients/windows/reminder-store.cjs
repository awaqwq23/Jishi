const fs = require('node:fs');
const path = require('node:path');

function createReminderStore({ file, notify, clock = Date.now }) {
  let reminders = [];
  const save = () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(reminders), { mode: 0o600 });
    fs.renameSync(`${file}.tmp`, file);
  };
  const sync = (payload) => {
    const parsed = JSON.parse(payload);
    if (!Array.isArray(parsed) || parsed.length > 300) throw new Error('Invalid reminder queue');
    tick();
    const now = clock(), seen = new Set();
    reminders = parsed.filter(item => item && typeof item.key === 'string' && item.key.length <= 200 && typeof item.title === 'string' && typeof item.body === 'string' && Number.isFinite(item.at) && item.at > now && item.at <= now + 366 * 86400000 && !seen.has(item.key) && seen.add(item.key)).map(item => ({key:item.key,at:item.at,title:item.title.slice(0,120),body:item.body.slice(0,500)}));
    save();
  };
  const restore = () => {
    try { const data = JSON.parse(fs.readFileSync(file, 'utf8')); if (Array.isArray(data)) reminders = data.filter(item => item && typeof item.key === 'string' && typeof item.title === 'string' && typeof item.body === 'string' && Number.isFinite(item.at)).slice(0,300); }
    catch { reminders = []; }
  };
  const tick = () => {
    const now = clock();
    const due = reminders.filter(item => item.at <= now);
    if (!due.length) return;
    reminders = reminders.filter(item => item.at > now);
    save(); // Persist delivery before notifying, including across restart or resume.
    for (const item of due) if (now - item.at <= 86400000) notify(item);
  };
  return { sync, restore, tick };
}
module.exports = { createReminderStore };
