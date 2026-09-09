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
      // HarmonyOS limits the number of agent reminders. Retain the nearest 32;
      // opening/syncing the app replenishes the queue as reminders expire.
      await reminderAgentManager.cancelAllReminders();
      if (reminders.length && !notificationManager.isNotificationEnabledSync()) throw new Error('Notifications disabled');
      const seen: Set<string> = new Set<string>();
      for (const item of reminders.slice(0, 32)) {
        if (generation !== this.generation) return;
        if (seen.has(item.key)) continue;
        seen.add(item.key);
        const date: Date = new Date(item.at);
        const request: reminderAgentManager.ReminderRequestCalendar = {
          reminderType: reminderAgentManager.ReminderType.REMINDER_TYPE_CALENDAR,
          dateTime: { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate(), hour: date.getHours(), minute: date.getMinutes(), second: date.getSeconds() },
          title: item.title.slice(0, 120), content: item.body.slice(0, 500),
          ringDuration: 0, snoozeTimes: 0,
          wantAgent: { pkgName: 'cn.jishi.todo', abilityName: 'EntryAbility' },
          slotType: notificationManager.SlotType.CONTENT_INFORMATION
        };
        await reminderAgentManager.publishReminder(request);
      }
      this.lastPayload = payload;
    }).catch(() => { this.lastPayload = ''; onFailure(); });
  }
}
