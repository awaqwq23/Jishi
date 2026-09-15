package cn.jishi.todo;

import android.app.DownloadManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.net.Uri;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.webkit.WebView;

import org.json.JSONObject;

import java.io.InputStream;
import java.security.MessageDigest;
import java.util.Locale;

final class UpdateDownloadController {
    private static final String PREFS = "jishi-update-download-v1";
    private static final String ID = "id";
    private static final String URL = "url";
    private static final String FILE = "filename";
    private static final String SIZE = "size";
    private static final String SHA = "sha256";
    private static final long POLL_MS = 700L;

    private final MainActivity activity;
    private final WebView webView;
    private final DownloadManager manager;
    private final SharedPreferences preferences;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private long lastBytes;
    private long lastAt;
    private boolean observing;
    private boolean verifying;
    private JSONObject lastState = state("idle", 0, 0, 0, null, "", "");
    private final Runnable poll = this::poll;

    UpdateDownloadController(MainActivity activity) {
        this.activity = activity;
        this.webView = activity.getBridge().getWebView();
        this.manager = (DownloadManager) activity.getSystemService(Context.DOWNLOAD_SERVICE);
        this.preferences = activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    String start(String payload) {
        try {
            JSONObject request = new JSONObject(payload);
            String url = request.optString("url", "");
            String filename = request.optString("filename", "");
            long size = request.optLong("size", 0);
            String sha256 = request.optString("sha256", "").toUpperCase(Locale.ROOT);
            Uri uri = Uri.parse(url);
            String host = uri.getHost();
            boolean trustedHost = "awaqwq233.com".equals(host) || "jishi.awaqwq233.com".equals(host) || "jishi-104-214-169-232.nip.io".equals(host);
            if (!"https".equals(uri.getScheme()) || !trustedHost || !filename.matches("Jishi-Android-[0-9]+(?:\\.[0-9]+){2}\\.apk") || size <= 0 || size > 1024L * 1024L * 1024L || !sha256.matches("[A-F0-9]{64}")) {
                return state("failed", 0, size, 0, null, filename, "更新信息无效").toString();
            }
            long existingId = preferences.getLong(ID, -1);
            if (existingId >= 0 && url.equals(preferences.getString(URL, "")) && sha256.equals(preferences.getString(SHA, ""))) {
                startObserving();
                return currentState();
            }
            DownloadManager.Request download = new DownloadManager.Request(uri)
                .setTitle("记时 " + filename.replace("Jishi-Android-", "v").replace(".apk", "") + " 更新")
                .setDescription("下载完成后可安装新版本")
                .setMimeType("application/vnd.android.package-archive")
                .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                .setAllowedOverMetered(true)
                .setAllowedOverRoaming(true);
            download.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, filename);
            long id = manager.enqueue(download);
            preferences.edit().putLong(ID, id).putString(URL, url).putString(FILE, filename).putLong(SIZE, size).putString(SHA, sha256).apply();
            lastBytes = 0; lastAt = System.currentTimeMillis();
            lastState = state("starting", 0, size, 0, null, filename, "已交给 Android 系统下载；关闭记时不会中断");
            emit(lastState);
            startObserving();
            return lastState.toString();
        } catch (Exception error) {
            lastState = state("failed", 0, 0, 0, null, "", "无法开始下载，请稍后重试");
            emit(lastState);
            return lastState.toString();
        }
    }

    void startObserving() {
        if (preferences.getLong(ID, -1) < 0 || observing) return;
        observing = true;
        handler.post(poll);
    }

    void stopObserving() {
        observing = false;
        handler.removeCallbacks(poll);
    }

    String currentState() {
        if (preferences.getLong(ID, -1) < 0) return lastState.toString();
        pollOnce(false);
        return lastState.toString();
    }

    private void poll() {
        if (!observing) return;
        boolean keep = pollOnce(true);
        if (keep) handler.postDelayed(poll, POLL_MS);
        else observing = false;
    }

    private boolean pollOnce(boolean dispatch) {
        long id = preferences.getLong(ID, -1);
        if (id < 0) return false;
        try (Cursor cursor = manager.query(new DownloadManager.Query().setFilterById(id))) {
            if (!cursor.moveToFirst()) {
                lastState = state("paused", 0, preferences.getLong(SIZE, 0), 0, null, preferences.getString(FILE, ""), "系统下载记录暂时不可用；重新点击可继续");
                if (dispatch) emit(lastState);
                return false;
            }
            int status = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
            long received = Math.max(0, cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR)));
            long total = cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES));
            if (total <= 0) total = preferences.getLong(SIZE, 0);
            long now = System.currentTimeMillis();
            long speed = lastAt > 0 && now > lastAt && received >= lastBytes ? (received - lastBytes) * 1000L / (now - lastAt) : 0;
            lastAt = now; lastBytes = received;
            Long eta = speed > 0 && total >= received ? (total - received + speed - 1) / speed : null;
            String filename = preferences.getString(FILE, "");
            if (status == DownloadManager.STATUS_SUCCESSFUL) {
                if (!verifying) verifyAsync(id, cursor.getString(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_LOCAL_URI)));
                lastState = state("verifying", total, total, 0, 0L, filename, "下载完成，正在校验安装包");
                if (dispatch) emit(lastState);
                return false;
            }
            if (status == DownloadManager.STATUS_FAILED) {
                lastState = state("failed", received, total, 0, null, filename, "系统下载失败；重新点击可再次下载");
                preferences.edit().remove(ID).apply();
                if (dispatch) emit(lastState);
                return false;
            }
            String message = status == DownloadManager.STATUS_PAUSED ? "系统已暂停下载，将自动继续；关闭记时不会丢失进度" : "Android 系统后台下载中；关闭记时不会中断";
            lastState = state(status == DownloadManager.STATUS_PAUSED ? "paused" : "downloading", received, total, speed, eta, filename, message);
            if (dispatch) emit(lastState);
            return true;
        } catch (Exception error) {
            lastState = state("paused", lastBytes, preferences.getLong(SIZE, 0), 0, null, preferences.getString(FILE, ""), "读取系统下载进度失败；下载仍由 Android 继续管理");
            if (dispatch) emit(lastState);
            return false;
        }
    }

    private void verifyAsync(long id, String localUri) {
        verifying = true;
        new Thread(() -> {
            boolean valid = false;
            try (InputStream input = activity.getContentResolver().openInputStream(Uri.parse(localUri))) {
                MessageDigest digest = MessageDigest.getInstance("SHA-256");
                byte[] buffer = new byte[64 * 1024];
                long size = 0; int count;
                while (input != null && (count = input.read(buffer)) >= 0) { if (count > 0) { digest.update(buffer, 0, count); size += count; } }
                StringBuilder hash = new StringBuilder();
                for (byte value : digest.digest()) hash.append(String.format(Locale.ROOT, "%02X", value));
                valid = size == preferences.getLong(SIZE, 0) && hash.toString().equals(preferences.getString(SHA, ""));
            } catch (Exception ignored) { }
            boolean verified = valid;
            activity.runOnUiThread(() -> {
                verifying = false;
                if (verified) {
                    lastState = state("completed", preferences.getLong(SIZE, 0), preferences.getLong(SIZE, 0), 0, 0L, preferences.getString(FILE, ""), "安装包已校验并保存到系统下载目录");
                } else {
                    manager.remove(id);
                    preferences.edit().remove(ID).apply();
                    lastState = state("failed", 0, preferences.getLong(SIZE, 0), 0, null, preferences.getString(FILE, ""), "安装包校验失败，已删除损坏文件；请重新下载");
                }
                emit(lastState);
            });
        }, "jishi-update-verify").start();
    }

    private JSONObject state(String status, long received, long total, long speed, Long eta, String filename, String message) {
        JSONObject value = new JSONObject();
        try {
            value.put("status", status); value.put("receivedBytes", received); value.put("totalBytes", total);
            value.put("bytesPerSecond", speed); value.put("percent", total > 0 ? received * 100.0 / total : 0);
            value.put("etaSeconds", eta == null ? JSONObject.NULL : eta); value.put("filename", filename); value.put("message", message);
        } catch (Exception ignored) { }
        return value;
    }

    private void emit(JSONObject value) {
        String script = "window.dispatchEvent(new CustomEvent('jishi-update-download',{detail:" + value.toString() + "}));";
        webView.post(() -> webView.evaluateJavascript(script, null));
    }
}
