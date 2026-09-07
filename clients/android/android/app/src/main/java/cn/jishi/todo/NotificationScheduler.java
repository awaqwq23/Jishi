package cn.jishi.todo;

import android.Manifest;
import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import android.content.pm.PackageManager;

import org.json.JSONArray;
import org.json.JSONObject;

final class NotificationScheduler {
    static final String CHANNEL = "jishi-reminders-v2";
    private static final String PREFS = "jishi-native-reminders";
    private static final String PAYLOAD = "payload";

    private NotificationScheduler() {}

    static void ensureChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel channel = new NotificationChannel(CHANNEL, "记时任务提醒", NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription("在到点时显示待办和定期任务提醒");
        channel.enableVibration(true);
        context.getSystemService(NotificationManager.class).createNotificationChannel(channel);
    }

    static void show(Context context, String title, String body, String key) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return;
        ensureChannel(context);
        Intent launchIntent = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        if (launchIntent == null) launchIntent = new Intent(context, MainActivity.class);
        launchIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent contentIntent = PendingIntent.getActivity(context, key.hashCode(), launchIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        NotificationCompat.Builder notification = new NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setContentIntent(contentIntent)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setDefaults(NotificationCompat.DEFAULT_ALL);
        NotificationManagerCompat.from(context).notify(key.hashCode(), notification.build());
    }

    static void sync(Context context, String payload, boolean persist) {
        ensureChannel(context);
        SharedPreferences preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        cancelPayload(context, preferences.getString(PAYLOAD, "[]"));
        JSONArray reminders;
        try { reminders = new JSONArray(payload); } catch (Exception error) { reminders = new JSONArray(); }
        if (persist) preferences.edit().putString(PAYLOAD, reminders.toString()).apply();
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        long now = System.currentTimeMillis();
        for (int index = 0; index < Math.min(reminders.length(), 300); index++) {
            JSONObject reminder = reminders.optJSONObject(index);
            if (reminder == null) continue;
            String key = reminder.optString("key", ""); long at = reminder.optLong("at", 0);
            if (key.isEmpty() || at <= now || at - now > 21L * 86400000L) continue;
            PendingIntent intent = pendingIntent(context, reminder, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !alarms.canScheduleExactAlarms()) alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, intent);
            else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, intent);
            else alarms.setExact(AlarmManager.RTC_WAKEUP, at, intent);
        }
    }

    static void restore(Context context) {
        SharedPreferences preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        sync(context, preferences.getString(PAYLOAD, "[]"), false);
    }

    private static void cancelPayload(Context context, String payload) {
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        try {
            JSONArray reminders = new JSONArray(payload);
            for (int index = 0; index < reminders.length(); index++) {
                JSONObject reminder = reminders.optJSONObject(index);
                if (reminder != null && !reminder.optString("key", "").isEmpty()) {
                    PendingIntent intent = pendingIntent(context, reminder, PendingIntent.FLAG_NO_CREATE | PendingIntent.FLAG_IMMUTABLE);
                    if (intent != null) alarms.cancel(intent);
                }
            }
        } catch (Exception ignored) {}
    }

    private static PendingIntent pendingIntent(Context context, JSONObject reminder, int flags) {
        String key = reminder.optString("key", "");
        Intent intent = new Intent(context, ReminderReceiver.class)
            .putExtra("title", reminder.optString("title", "记时提醒"))
            .putExtra("body", reminder.optString("body", "计划时间已到"))
            .putExtra("key", key);
        return PendingIntent.getBroadcast(context, key.hashCode(), intent, flags);
    }
}
