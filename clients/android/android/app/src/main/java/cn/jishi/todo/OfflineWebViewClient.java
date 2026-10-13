package cn.jishi.todo;

import android.net.Uri;
import android.graphics.Bitmap;
import android.os.Handler;
import android.os.Looper;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;
import java.io.IOException;
import java.util.Collections;

/** Keep the original HTTPS origin, storage and cookie isolation while offline. */
final class OfflineWebViewClient extends BridgeWebViewClient {
    private final Bridge bridge;
    private volatile boolean offlineShell;
    private final Handler timer = new Handler(Looper.getMainLooper());
    private Runnable timeout;
    OfflineWebViewClient(Bridge bridge) { super(bridge); this.bridge = bridge; }
    private static boolean trusted(Uri uri) {
        return "https".equals(uri.getScheme()) && (uri.getPort() == -1 || uri.getPort() == 443) && uri.getUserInfo() == null
            && ("jishi.awaqwq233.com".equals(uri.getHost()) || ("awaqwq233.com".equals(uri.getHost()) && uri.getPath().startsWith("/note/")));
    }
    @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        if (offlineShell && "GET".equals(request.getMethod()) && trusted(request.getUrl())) {
            String relative = request.getUrl().getPath().replaceFirst("^/note/", "/").replaceFirst("^/", "");
            if (relative.isEmpty()) relative = "index.html";
            if (relative.matches("(index\\.html|app-icon\\.png|favicon\\.svg|manifest\\.webmanifest|assets/[a-zA-Z0-9_.-]+\\.(js|css))")) {
                String type = relative.endsWith(".js") ? "application/javascript" : relative.endsWith(".css") ? "text/css" : relative.endsWith(".png") ? "image/png" : relative.endsWith(".svg") ? "image/svg+xml" : relative.endsWith(".webmanifest") ? "application/manifest+json" : "text/html";
                try { return new WebResourceResponse(type, "UTF-8", 200, "OK", Collections.singletonMap("Cache-Control", "no-store"), bridge.getContext().getAssets().open("public/offline-shell/" + relative)); }
                catch (IOException ignored) { /* Preserve the normal error page if a packaged asset is absent. */ }
            }
        }
        return super.shouldInterceptRequest(view, request);
    }
    @Override public void onPageStarted(WebView view, String url, Bitmap favicon) {
        super.onPageStarted(view, url, favicon);
        if (timeout != null) timer.removeCallbacks(timeout);
        if (!offlineShell && trusted(Uri.parse(url))) {
            timeout = () -> { if (!offlineShell && view.getProgress() < 100 && url.equals(view.getUrl())) { offlineShell = true; view.loadUrl(url); } };
            timer.postDelayed(timeout, 6000);
        }
    }
    @Override public void onPageFinished(WebView view, String url) {
        if (timeout != null) timer.removeCallbacks(timeout);
        super.onPageFinished(view, url);
    }
    @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
        if (request.isForMainFrame() && trusted(request.getUrl()) && !offlineShell) {
            offlineShell = true; view.loadUrl(request.getUrl().toString()); return;
        }
        super.onReceivedError(view, request, error);
    }
    @Override public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
        if (request.isForMainFrame() && trusted(request.getUrl()) && response.getStatusCode() >= 500 && !offlineShell) {
            offlineShell = true; view.loadUrl(request.getUrl().toString()); return;
        }
        super.onReceivedHttpError(view, request, response);
    }
}
