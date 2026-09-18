"use client";

import { Check, Download, ExternalLink, RefreshCw, ShieldCheck, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { withRuntimeBase } from "./runtime-path";

type NativePlatform = "windows" | "android";
type ClientRelease = { version: string; downloadUrl: string; githubUrl?: string; sha256: string; size: number; required?: boolean };
type UpdateManifest = { schemaVersion: 1; releaseId: string; publishedAt: string; notes: string[]; clients: Record<NativePlatform, ClientRelease> };
type ClientIdentity = { platform: NativePlatform | "web"; version: string | null };
type PromptState = { kind: "binary" | "content"; identity: ClientIdentity; manifest: UpdateManifest; release?: ClientRelease };
type DownloadStatus = "idle" | "starting" | "downloading" | "background" | "paused" | "verifying" | "completed" | "failed";
type DownloadState = {
  status: DownloadStatus; receivedBytes: number; totalBytes: number; bytesPerSecond: number;
  percent: number; etaSeconds: number | null; filename: string; message?: string;
};
type UpdateBridge = {
  downloadUpdate?: (payload: string) => DownloadState | string | Promise<DownloadState | string>;
  updateDownloadState?: () => DownloadState | string | Promise<DownloadState | string>;
  onUpdateDownload?: (listener: (state: DownloadState | string) => void) => (() => void) | void;
};

const CHECK_INTERVAL = 5 * 60_000;
const SNOOZE_TIME = 12 * 60 * 60_000;

function detectClient(): ClientIdentity | null {
  const parameters = new URLSearchParams(window.location.search);
  const requestedPlatform = parameters.get("client");
  const requestedVersion = parameters.get("version");
  if ((requestedPlatform === "windows" || requestedPlatform === "android") && requestedVersion && /^[0-9]+(?:\.[0-9]+){1,3}$/.test(requestedVersion)) {
    return { platform: requestedPlatform, version: requestedVersion };
  }
  const agent = navigator.userAgent;
  const windows = agent.match(/JishiWindows\/([0-9]+(?:\.[0-9]+){1,3})/i);
  if (windows) return { platform: "windows", version: windows[1] };
  const android = agent.match(/JishiAndroid\/([0-9]+(?:\.[0-9]+){1,3})/i);
  if (android) return { platform: "android", version: android[1] };
  if (/Electron\//i.test(agent) && /Windows/i.test(agent)) return { platform: "windows", version: "0.3.1" };
  if (/Android/i.test(agent) && /\bwv\b/i.test(agent)) return { platform: "android", version: "0.3.1" };
  const standalone = window.matchMedia("(display-mode: standalone)").matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
  return standalone ? { platform: "web", version: null } : null;
}

function compareVersions(left: string, right: string) {
  const a = left.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const b = right.split(".").map((part) => Number.parseInt(part, 10) || 0);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    if ((a[index] || 0) !== (b[index] || 0)) return (a[index] || 0) > (b[index] || 0) ? 1 : -1;
  }
  return 0;
}

function storageKey(identity: ClientIdentity, suffix: string) { return `jishi:update:${identity.platform}:${suffix}`; }

function currentHostDownloadUrl(advertisedUrl: string) {
  const advertised = new URL(advertisedUrl, window.location.href);
  const filename = advertised.pathname.split("/").at(-1) || "";
  if (!/^Jishi-(?:Windows-Setup|Android)-[0-9]+(?:\.[0-9]+){2}\.(?:exe|apk)$/.test(filename)) return advertised.toString();
  return new URL(withRuntimeBase(`/downloads/${filename}`), window.location.origin).toString();
}

function trustedGithubUrl(release: ClientRelease, manifest: UpdateManifest) {
  if (!release.githubUrl) return null;
  try {
    const url = new URL(release.githubUrl);
    const filename = new URL(release.downloadUrl).pathname.split("/").at(-1);
    if (url.protocol !== "https:" || url.hostname !== "github.com" || url.username || url.password || url.search || url.hash) return null;
    const tag = `clients-v${manifest.clients.windows.version}-a${manifest.clients.android.version}`;
    if (url.pathname !== `/awaqwq23/Jishi/releases/download/${tag}/${filename}`) return null;
    return url.toString();
  } catch { return null; }
}

function updateBridge() { return (window as Window & { JishiNative?: UpdateBridge }).JishiNative; }

function normalizedDownloadState(value: DownloadState | string | null | undefined): DownloadState | null {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) as DownloadState : value;
    if (!parsed || typeof parsed !== "object" || typeof parsed.status !== "string") return null;
    return {
      status: parsed.status, receivedBytes: Number(parsed.receivedBytes) || 0, totalBytes: Number(parsed.totalBytes) || 0,
      bytesPerSecond: Number(parsed.bytesPerSecond) || 0, percent: Number(parsed.percent) || 0,
      etaSeconds: Number.isFinite(parsed.etaSeconds) ? Number(parsed.etaSeconds) : null,
      filename: String(parsed.filename || ""), message: parsed.message ? String(parsed.message) : undefined,
    };
  } catch { return null; }
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KiB", "MiB", "GiB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}

function formatEta(seconds: number | null) {
  if (!Number.isFinite(seconds) || seconds === null || seconds < 0) return "正在估算剩余时间";
  if (seconds < 60) return `约 ${Math.max(1, Math.ceil(seconds))} 秒`;
  if (seconds < 3600) return `约 ${Math.ceil(seconds / 60)} 分钟`;
  return `约 ${(seconds / 3600).toFixed(1)} 小时`;
}

export default function UpdatePrompt() {
  const [prompt, setPrompt] = useState<PromptState | null>(null);
  const [downloadState, setDownloadState] = useState<DownloadState | null>(null);

  useEffect(() => {
    const version = navigator.userAgent.match(/JishiWindows\/([0-9]+(?:\.[0-9]+){1,3})/i)?.[1];
    if (!version) return;
    const previousTitle = document.title;
    document.title = `记时 v${version}`;
    return () => { document.title = previousTitle; };
  }, []);

  useEffect(() => {
    const bridge = updateBridge();
    let mounted = true;
    const receive = (value: DownloadState | string) => {
      const next = normalizedDownloadState(value);
      if (mounted && next && next.status !== "idle") setDownloadState(next);
    };
    if (bridge?.updateDownloadState) void Promise.resolve(bridge.updateDownloadState()).then(receive).catch(() => {});
    const dispose = bridge?.onUpdateDownload?.(receive);
    return () => { mounted = false; dispose?.(); };
  }, []);

  useEffect(() => {
    const busy = downloadState?.status === "starting" || downloadState?.status === "downloading" || downloadState?.status === "verifying";
    if (!busy || updateBridge()?.downloadUpdate) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [downloadState?.status]);

  const checkForUpdates = useCallback(async () => {
    const identity = detectClient();
    if (!identity) return;
    try {
      const response = await fetch(`${withRuntimeBase("/updates/latest.json")}?time=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) return;
      const manifest = await response.json() as UpdateManifest;
      if (manifest.schemaVersion !== 1 || !manifest.releaseId || !manifest.clients) return;
      const seenKey = storageKey(identity, "seen");
      const seenRelease = localStorage.getItem(seenKey);
      const release = identity.platform === "web" ? undefined : manifest.clients[identity.platform];
      const hasBinaryUpdate = Boolean(release && identity.version && compareVersions(release.version, identity.version) > 0);
      if (hasBinaryUpdate && release) {
        const snoozeRaw = localStorage.getItem(storageKey(identity, "snooze"));
        const snooze = snoozeRaw ? JSON.parse(snoozeRaw) as { releaseId?: string; until?: number } : null;
        if (!release.required && snooze?.releaseId === manifest.releaseId && Number(snooze.until) > Date.now() && !downloadState) return;
        setPrompt({ kind: "binary", identity, manifest, release });
        return;
      }
      if (!seenRelease) { localStorage.setItem(seenKey, manifest.releaseId); return; }
      if (seenRelease !== manifest.releaseId) setPrompt({ kind: "content", identity, manifest });
    } catch { /* Update checks must never interrupt the user's todo workflow. */ }
  }, [downloadState]);

  useEffect(() => {
    const initial = window.setTimeout(() => void checkForUpdates(), 1200);
    const timer = window.setInterval(() => void checkForUpdates(), CHECK_INTERVAL);
    const onVisible = () => document.visibilityState === "visible" && void checkForUpdates();
    document.addEventListener("visibilitychange", onVisible);
    return () => { window.clearTimeout(initial); window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [checkForUpdates]);

  if (!prompt) return null;
  const markSeen = () => localStorage.setItem(storageKey(prompt.identity, "seen"), prompt.manifest.releaseId);
  const later = () => {
    markSeen();
    localStorage.setItem(storageKey(prompt.identity, "snooze"), JSON.stringify({ releaseId: prompt.manifest.releaseId, until: Date.now() + SNOOZE_TIME }));
    setPrompt(null);
  };
  const refresh = async () => {
    markSeen();
    if ("serviceWorker" in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.update()));
    }
    window.location.reload();
  };

  const downloadInPage = async (url: string, release: ClientRelease, filename: string) => {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok || !response.body) throw new Error(`服务器返回 HTTP ${response.status}`);
    const total = Number(response.headers.get("content-length")) || release.size;
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0; let sampledBytes = 0; let sampledAt = performance.now(); let speed = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      chunks.push(value); received += value.byteLength;
      const now = performance.now();
      if (now - sampledAt >= 400) {
        const current = (received - sampledBytes) * 1000 / (now - sampledAt);
        speed = speed ? speed * 0.7 + current * 0.3 : current;
        sampledAt = now; sampledBytes = received;
        setDownloadState({ status: "downloading", receivedBytes: received, totalBytes: total, bytesPerSecond: speed, percent: received / total * 100, etaSeconds: speed ? Math.ceil((total - received) / speed) : null, filename, message: "旧版客户端兼容下载中；关闭窗口会转入托盘继续" });
      }
    }
    if (received !== total) throw new Error("安装包未完整下载");
    setDownloadState({ status: "verifying", receivedBytes: received, totalBytes: total, bytesPerSecond: speed, percent: 100, etaSeconds: 0, filename, message: "下载完成，正在校验安装包" });
    const blob = new Blob(chunks, { type: response.headers.get("content-type") || "application/octet-stream" });
    const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
    const sha256 = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("").toUpperCase();
    if (sha256 !== release.sha256.toUpperCase()) throw new Error("安装包校验失败，请重新下载");
    const blobUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a"); anchor.href = blobUrl; anchor.download = filename;
    document.body.appendChild(anchor); anchor.click(); anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
    setDownloadState({ status: "completed", receivedBytes: received, totalBytes: total, bytesPerSecond: speed, percent: 100, etaSeconds: 0, filename, message: "安装包已下载，正在保存到下载目录" });
  };

  const download = async () => {
    if (!prompt.release) return;
    markSeen();
    localStorage.removeItem(storageKey(prompt.identity, "snooze"));
    const url = currentHostDownloadUrl(prompt.release.downloadUrl);
    const filename = new URL(url).pathname.split("/").at(-1) || `${prompt.identity.platform}-update`;
    setDownloadState({ status: "starting", receivedBytes: 0, totalBytes: prompt.release.size, bytesPerSecond: 0, percent: 0, etaSeconds: null, filename, message: "正在连接更新服务器" });
    const bridge = updateBridge();
    if (bridge?.downloadUpdate) {
      try {
        const returned = await bridge.downloadUpdate(JSON.stringify({ url, filename, size: prompt.release.size, sha256: prompt.release.sha256 }));
        const next = normalizedDownloadState(returned); if (next) setDownloadState(next);
      } catch (error) {
        setDownloadState((old) => ({ ...(old || { receivedBytes: 0, totalBytes: prompt.release!.size, bytesPerSecond: 0, percent: 0, etaSeconds: null, filename }), status: "failed", message: error instanceof Error ? error.message : "无法开始下载" }));
      }
      return;
    }
    if (prompt.identity.platform === "windows") {
      try { await downloadInPage(url, prompt.release, filename); }
      catch (error) { setDownloadState((old) => ({ ...(old || { receivedBytes: 0, totalBytes: prompt.release!.size, bytesPerSecond: 0, percent: 0, etaSeconds: null, filename }), status: "paused", message: `${error instanceof Error ? error.message : "下载中断"}；请再次点击继续` })); }
      return;
    }
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = filename;
    document.body.appendChild(anchor); anchor.click(); anchor.remove();
    setDownloadState({ status: "background", receivedBytes: 0, totalBytes: prompt.release.size, bytesPerSecond: 0, percent: 0, etaSeconds: null, filename, message: "已交给手机系统下载；关闭记时不会中断，请在通知栏查看进度" });
  };

  const platformName = prompt.identity.platform === "windows" ? "Windows" : prompt.identity.platform === "android" ? "Android" : "应用";
  const busy = downloadState?.status === "starting" || downloadState?.status === "downloading" || downloadState?.status === "verifying";
  const done = downloadState?.status === "completed";
  const githubUrl = prompt.release ? trustedGithubUrl(prompt.release, prompt.manifest) : null;
  return <div className="update-layer" role="presentation">
    <section className="update-card" role="dialog" aria-modal="true" aria-labelledby="update-title">
      {!prompt.release?.required && !busy && <button className="update-close" onClick={later} aria-label="稍后更新"><X size={19} /></button>}
      <div className="update-icon">{done ? <Check size={25} /> : prompt.kind === "binary" ? <Download size={25} /> : <RefreshCw size={25} />}</div>
      <span className="eyebrow">{prompt.kind === "binary" ? `${platformName} 客户端更新` : "应用内容已更新"}</span>
      <h2 id="update-title">{prompt.kind === "binary" ? done ? "安装包下载完成" : `新版本 ${prompt.release?.version} 已就绪` : "刷新后即可使用最新功能"}</h2>
      {prompt.kind === "binary" && <p>当前版本 {prompt.identity.version}。安装新版本不会删除你的账号和云端待办。</p>}
      {prompt.kind === "content" && <p>服务器已部署新内容，你的数据已经安全保存。</p>}
      {prompt.kind === "binary" && downloadState && <div className={`update-progress ${downloadState.status}`} aria-live="polite">
        <div className="update-progress-heading"><strong>{Math.min(100, Math.max(0, downloadState.percent)).toFixed(downloadState.percent >= 10 ? 0 : 1)}%</strong><span>{downloadState.message}</span></div>
        <progress max="100" value={Math.min(100, Math.max(0, downloadState.percent))} aria-label="更新下载进度" />
        <div className="update-progress-meta"><span>{formatBytes(downloadState.receivedBytes)} / {formatBytes(downloadState.totalBytes)}</span><span>{downloadState.bytesPerSecond > 0 ? `${formatBytes(downloadState.bytesPerSecond)}/s · ${formatEta(downloadState.etaSeconds)}` : formatEta(downloadState.etaSeconds)}</span></div>
      </div>}
      {prompt.manifest.notes.length > 0 && <ul>{prompt.manifest.notes.slice(0, 4).map((note) => <li key={note}>{note}</li>)}</ul>}
      <div className="update-trust"><ShieldCheck size={16} /><span>安装包通过 HTTPS 下载；新版客户端完成后自动校验 SHA-256</span></div>
      <div className="update-actions">
        {!prompt.release?.required && !busy && !done && <button className="button secondary" onClick={later}>稍后提醒</button>}
        {prompt.kind === "binary" && githubUrl && !done && <a className="button secondary" href={githubUrl} target={prompt.identity.platform === "windows" ? "_blank" : undefined} rel="noopener noreferrer"><ExternalLink size={17} />从 GitHub 下载</a>}
        {prompt.kind === "binary"
          ? <button className="button primary" disabled={busy || done || downloadState?.status === "background"} onClick={() => void download()}><Download size={17} />{busy ? "下载中…" : done ? "已保存" : downloadState?.status === "paused" || downloadState?.status === "failed" ? "继续下载" : "下载更新"}</button>
          : <button className="button primary" onClick={() => void refresh()}><RefreshCw size={17} />立即刷新</button>}
      </div>
      {prompt.kind === "binary" && githubUrl && <p className="update-install-note">下载完成后打开安装包，按提示覆盖安装；账号和云端待办仍会保留。请确认文件名与此版本一致。</p>}
    </section>
  </div>;
}
