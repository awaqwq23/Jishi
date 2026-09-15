package cn.jishi.todo;

import android.Manifest;
import android.app.AlarmManager;
import android.app.DownloadManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.Settings;
import android.webkit.CookieManager;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.URLUtil;
import android.widget.Toast;

import androidx.core.content.ContextCompat;

import com.getcapacitor.BridgeActivity;

import java.util.ArrayList;
import java.util.List;

public class MainActivity extends BridgeActivity {
    private static final int NOTIFICATION_PERMISSION_REQUEST = 2045;
    private final List<PendingNotification> pendingNotifications = new ArrayList<>();
    private boolean notificationPermissionPending;
    private boolean exactAlarmPermissionPending;
    private UpdateDownloadController updateDownloads;

    private static class PendingNotification {
        final String title;
        final String body;
        final String key;

        PendingNotification(String title, String body, String key) {
            this.title = title;
            this.body = body;
            this.key = key;
        }
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        NotificationScheduler.restore(this);
        updateDownloads = new UpdateDownloadController(this);
        getBridge().getWebView().addJavascriptInterface(new JishiNativeBridge(), "JishiNative");
        getBridge().getWebView().setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) -> {
            try {
                String filename = uniqueDownloadName(URLUtil.guessFileName(url, contentDisposition, mimeType));
                DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url))
                    .setTitle(filename)
                    .setDescription("正在导出记时数据")
                    .setMimeType(mimeType)
                    .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                    .setAllowedOverMetered(true)
                    .setAllowedOverRoaming(true);
                String cookies = CookieManager.getInstance().getCookie(url);
                if (cookies != null && !cookies.isEmpty()) request.addRequestHeader("Cookie", cookies);
                if (userAgent != null && !userAgent.isEmpty()) request.addRequestHeader("User-Agent", userAgent);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, filename);
                }
                DownloadManager manager = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
                manager.enqueue(request);
                Toast.makeText(this, "文件正在保存到下载目录", Toast.LENGTH_SHORT).show();
            } catch (RuntimeException error) {
                Toast.makeText(this, "无法开始下载，请稍后重试", Toast.LENGTH_LONG).show();
            }
        });
    }

    @Override
    public void onStart() {
        super.onStart();
        if (updateDownloads != null) updateDownloads.startObserving();
    }

    @Override
    public void onStop() {
        if (updateDownloads != null) updateDownloads.stopObserving();
        super.onStop();
    }

    @Override
    public void onResume() {
        super.onResume();
        if (exactAlarmPermissionPending) {
            exactAlarmPermissionPending = false;
            NotificationScheduler.restore(this);
            dispatchReminderPrecision();
        }
    }

    private String uniqueDownloadName(String filename) {
        int dot = filename.lastIndexOf('.');
        String suffix = "-" + System.currentTimeMillis();
        return dot > 0 ? filename.substring(0, dot) + suffix + filename.substring(dot) : filename + suffix;
    }

    private void requestOrShowNotification(String title, String body, String key) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            pendingNotifications.add(new PendingNotification(title, body, key));
            if (!notificationPermissionPending) {
                notificationPermissionPending = true;
                requestPermissions(new String[] { Manifest.permission.POST_NOTIFICATIONS }, NOTIFICATION_PERMISSION_REQUEST);
            }
            return;
        }
        showNotification(title, body, key);
    }

    private void showNotification(String title, String body, String key) {
        NotificationScheduler.show(this, title, body, key);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != NOTIFICATION_PERMISSION_REQUEST) return;
        boolean granted = grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED;
        if (granted) {
            for (PendingNotification notification : pendingNotifications) {
                showNotification(notification.title, notification.body, notification.key);
            }
        }
        pendingNotifications.clear();
        notificationPermissionPending = false;
        dispatchNotificationPermission(granted ? "granted" : "denied");
        if (granted) requestExactAlarmAccess();
    }

    private void dispatchNotificationPermission(String state) {
        getBridge().getWebView().post(() -> getBridge().getWebView().evaluateJavascript(
            "window.dispatchEvent(new CustomEvent('jishi-native-notification-permission',{detail:'" + state + "'}));",
            null
        ));
    }

    private void requestExactAlarmAccess() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
            dispatchReminderPrecision();
            return;
        }
        AlarmManager alarms = (AlarmManager) getSystemService(Context.ALARM_SERVICE);
        if (alarms.canScheduleExactAlarms()) {
            dispatchReminderPrecision();
            return;
        }
        try {
            exactAlarmPermissionPending = true;
            startActivity(new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:" + getPackageName())));
        } catch (RuntimeException error) {
            exactAlarmPermissionPending = false;
            dispatchReminderPrecision();
        }
    }

    private void dispatchReminderPrecision() {
        boolean exact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || ((AlarmManager) getSystemService(Context.ALARM_SERVICE)).canScheduleExactAlarms();
        String state = exact ? "exact" : "approximate";
        getBridge().getWebView().post(() -> getBridge().getWebView().evaluateJavascript(
            "window.dispatchEvent(new CustomEvent('jishi-native-reminder-permission',{detail:'" + state + "'}));",
            null
        ));
    }

    private class JishiNativeBridge {
        @JavascriptInterface
        public void notify(String title, String body, String key) {
            runOnUiThread(() -> requestOrShowNotification(title, body, key));
        }

        @JavascriptInterface
        public void requestNotificationPermission() {
            runOnUiThread(() -> {
                if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) {
                    dispatchNotificationPermission("granted");
                    requestExactAlarmAccess();
                    return;
                }
                if (!notificationPermissionPending) {
                    notificationPermissionPending = true;
                    requestPermissions(new String[] { Manifest.permission.POST_NOTIFICATIONS }, NOTIFICATION_PERMISSION_REQUEST);
                }
            });
        }

        @JavascriptInterface
        public String notificationPermissionState() {
            return Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED ? "granted" : "denied";
        }

        @JavascriptInterface
        public void syncReminders(String payload) {
            runOnUiThread(() -> NotificationScheduler.sync(MainActivity.this, payload, true));
        }

        @JavascriptInterface
        public String reminderPermissionState() {
            boolean exact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || ((AlarmManager) getSystemService(Context.ALARM_SERVICE)).canScheduleExactAlarms();
            return exact ? "exact" : "approximate";
        }

        @JavascriptInterface
        public String downloadUpdate(String payload) {
            return updateDownloads.start(payload);
        }

        @JavascriptInterface
        public String updateDownloadState() {
            return updateDownloads.currentState();
        }
    }
}
