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
        NotificationScheduler.show(context, title == null ? "Jishi reminder" : title, body == null ? "A scheduled task is due" : body, key == null ? "jishi-reminder" : key);
    }
}
