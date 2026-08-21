package cn.jishi.todo;

import android.Manifest;
import android.app.DownloadManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.webkit.CookieManager;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.URLUtil;
import android.widget.Toast;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.BridgeActivity;

import java.util.ArrayList;
import java.util.List;

public class MainActivity extends BridgeActivity {
    private static final String NOTIFICATION_CHANNEL = "jishi-reminders";
    private static final int NOTIFICATION_PERMISSION_REQUEST = 2045;
    private final List<PendingNotification> pendingNotifications = new ArrayList<>();
    private boolean notificationPermissionPending;

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
        createNotificationChannel();
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

    private String uniqueDownloadName(String filename) {
        int dot = filename.lastIndexOf('.');
        String suffix = "-" + System.currentTimeMillis();
        return dot > 0 ? filename.substring(0, dot) + suffix + filename.substring(dot) : filename + suffix;
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel channel = new NotificationChannel(NOTIFICATION_CHANNEL, "待办与定期任务提醒", NotificationManager.IMPORTANCE_DEFAULT);
        channel.setDescription("在手机消息栏显示记时的待办和定期任务提醒");
        getSystemService(NotificationManager.class).createNotificationChannel(channel);
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
        Intent launchIntent = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pendingIntent = PendingIntent.getActivity(this, 0, launchIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        NotificationCompat.Builder notification = new NotificationCompat.Builder(this, NOTIFICATION_CHANNEL)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setContentIntent(pendingIntent)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT);
        NotificationManagerCompat.from(this).notify(key.hashCode(), notification.build());
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
        String state = granted ? "granted" : "denied";
        getBridge().getWebView().post(() -> getBridge().getWebView().evaluateJavascript(
            "window.dispatchEvent(new CustomEvent('jishi-native-notification-permission',{detail:'" + state + "'}));",
            null
        ));
    }

    private class JishiNativeBridge {
        @JavascriptInterface
        public void notify(String title, String body, String key) {
            runOnUiThread(() -> requestOrShowNotification(title, body, key));
        }
    }
}
