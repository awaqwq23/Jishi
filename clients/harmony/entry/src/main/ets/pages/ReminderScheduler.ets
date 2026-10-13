import { reminderAgentManager } from '@kit.BackgroundTasksKit';
import { notificationManager } from '@kit.NotificationKit';

interface NativeReminder {
  key: string;
  title: string;
  body: string;
  at: number;
}

export class ReminderScheduler {
  private queue: Promise<void> = Promise.resolve();
  private generation: number = 0;
  private lastPayload: string = '';
  private scheduled: Map<string, number> = new Map<string, number>();

  sync(payload: string, onFailure: () => void): void {
    if (typeof payload !== 'string' || payload.length > 300000 || payload === this.lastPayload) return;
    const generation = ++this.generation;
    this.queue = this.queue.then(async () => {
      if (generation !== this.generation) return;
      let reminders: NativeReminder[] = JSON.parse(payload) as NativeReminder[];
      if (!Array.isArray(reminders)) return;
      const now: number = Date.now();
      reminders = reminders.filter((item: NativeReminder) => item && typeof item.key === 'string' &&
        typeof item.title === 'string' && typeof item.body === 'string' && Number.isFinite(item.at) &&
        item.at > now && item.at <= now + 21 * 86400000).sort((a: NativeReminder, b: NativeReminder) => a.at - b.at);
      // Retain the nearest 30 for compatibility with older supported devices;
      // opening/syncing the app replenishes the queue as reminders expire.
      if (reminders.length && !notificationManager.isNotificationEnabledSync()) throw new Error('Notifications disabled');
      await notificationManager.addSlot(notificationManager.SlotType.SERVICE_INFORMATION);
      if (!reminders.length && payload === '[]') {
        await reminderAgentManager.cancelAllReminders();
        this.scheduled.clear();
        this.lastPayload = payload;
        return;
      }
      // Updating a task must not cancel a reminder that is just being displayed.
      const existing: reminderAgentManager.ReminderInfo[] = await reminderAgentManager.getAllValidReminders();
      const desired: Set<number> = new Set<number>();
      for (const item of reminders.slice(0, 30)) desired.add(this.notificationId(item.key));
      for (const info of existing) {
        const id: number = info.reminderReq.notificationId || 0;
        let at: number = 0;
        this.scheduled.forEach((time: number, key: string) => { if (this.notificationId(key) === id) at = time; });
        if (!desired.has(id) && !(at > 0 && now >= at && now - at < 90000)) await reminderAgentManager.cancelReminder(info.reminderId);
      }
      const seen: Set<string> = new Set<string>();
      for (const item of reminders.slice(0, 30)) {
        if (generation !== this.generation) return;
        if (seen.has(item.key)) continue;
        seen.add(item.key);
        const previous: reminderAgentManager.ReminderInfo | undefined = existing.find((info: reminderAgentManager.ReminderInfo) => info.reminderReq.notificationId === this.notificationId(item.key));
        if (previous && previous.reminderReq.title === item.title.slice(0, 120) && previous.reminderReq.content === item.body.slice(0, 500)) {
          this.scheduled.set(item.key, item.at);
          continue;
        }
        if (previous) await reminderAgentManager.cancelReminder(previous.reminderId);
        const date: Date = new Date(item.at);
        const request: reminderAgentManager.ReminderRequestCalendar = {
          reminderType: reminderAgentManager.ReminderType.REMINDER_TYPE_CALENDAR,
          dateTime: { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate(), hour: date.getHours(), minute: date.getMinutes(), second: date.getSeconds() },
          title: item.title.slice(0, 120), content: item.body.slice(0, 500),
          notificationId: this.notificationId(item.key),
          ringDuration: 0, snoozeTimes: 0,
          wantAgent: { pkgName: 'cn.jishi.todo', abilityName: 'EntryAbility' },
          slotType: notificationManager.SlotType.SERVICE_INFORMATION
        };
        await reminderAgentManager.publishReminder(request);
        this.scheduled.set(item.key, item.at);
      }
      this.scheduled.forEach((at: number, key: string) => { if (now - at >= 90000 || (at > now && !seen.has(key))) this.scheduled.delete(key); });
      this.lastPayload = payload;
    }).catch(() => { this.lastPayload = ''; onFailure(); });
  }

  hasScheduled(key: string): boolean {
    const at: number | undefined = this.scheduled.get(key);
    return at !== undefined && Date.now() >= at && Date.now() - at < 90000;
  }

  notificationId(key: string): number {
    let value: number = 0;
    for (let index: number = 0; index < key.length; index++) value = (value * 31 + key.charCodeAt(index)) & 0x7fffffff;
    return value === 0 ? 1 : value;
  }
}
