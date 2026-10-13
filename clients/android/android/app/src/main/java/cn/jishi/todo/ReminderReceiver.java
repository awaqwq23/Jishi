package cn.jishi.todo;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class ReminderReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String title = intent.getStringExtra("title");
        String body = intent.getStringExtra("body");
        String key = intent.getStringExtra("key");
        try { NotificationScheduler.show(context, title == null ? "拾光记事提醒" : title, body == null ? "计划时间已到" : body, key == null ? "jishi-reminder" : key); }
        catch (RuntimeException error) { android.util.Log.w("JishiReminder", "System notification unavailable; check notification permissions"); }
    }
}
