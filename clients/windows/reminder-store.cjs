const fs = require('node:fs');
const path = require('node:path');

function createReminderStore({ file, notify, clock = Date.now }) {
  let reminders = [];
  let delivering = false;
  const save = () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(reminders), { mode: 0o600 });
    fs.renameSync(`${file}.tmp`, file);
  };
  const sync = (payload) => {
    const parsed = JSON.parse(payload);
    if (!Array.isArray(parsed) || parsed.length > 300) throw new Error('Invalid reminder queue');
    const now = clock(), seen = new Set();
    const due = parsed.length ? reminders.filter(item => item.at <= now && now - item.at <= 86400000) : [];
    reminders = [...due, ...parsed.filter(item => item && typeof item.key === 'string' && item.key.length <= 200 && typeof item.title === 'string' && typeof item.body === 'string' && Number.isFinite(item.at) && item.at > now && item.at <= now + 366 * 86400000)].filter(item => !seen.has(item.key) && seen.add(item.key)).map(item => ({key:item.key,at:item.at,title:item.title.slice(0,120),body:item.body.slice(0,500)}));
    save();
  };
  const restore = () => {
    try { const data = JSON.parse(fs.readFileSync(file, 'utf8')); if (Array.isArray(data)) reminders = data.filter(item => item && typeof item.key === 'string' && typeof item.title === 'string' && typeof item.body === 'string' && Number.isFinite(item.at)).slice(0,300); }
    catch { reminders = []; }
  };
  const tick = async () => {
    if (delivering) return;
    const now = clock();
    const due = reminders.filter(item => item.at <= now);
    if (!due.length) return;
    delivering = true;
    try {
      for (const item of due) {
        if (now - item.at <= 86400000) {
          const accepted = await notify(item);
          if (accepted === false) throw new Error('Reminder delivery failed');
        }
        reminders = reminders.filter(current => current.key !== item.key);
        save(); // Keep failed reminders until the system or desktop fallback accepts them.
      }
    } finally { delivering = false; }
  };
  return { sync, restore, tick };
}
module.exports = { createReminderStore };
