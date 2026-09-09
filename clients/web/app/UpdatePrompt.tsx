"use client";

import { Download, RefreshCw, ShieldCheck, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { withRuntimeBase } from "./runtime-path";

type NativePlatform = "windows" | "android";
type ClientRelease = {
  version: string;
  downloadUrl: string;
  sha256: string;
  size: number;
  required?: boolean;
};
type UpdateManifest = {
  schemaVersion: 1;
  releaseId: string;
  publishedAt: string;
  notes: string[];
  clients: Record<NativePlatform, ClientRelease>;
};
type ClientIdentity = { platform: NativePlatform | "web"; version: string | null };
type PromptState = {
  kind: "binary" | "content";
  identity: ClientIdentity;
  manifest: UpdateManifest;
  release?: ClientRelease;
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

  // 0.3.1 did not yet add an explicit Jishi user-agent marker.
  if (/Electron\//i.test(agent) && /Windows/i.test(agent)) return { platform: "windows", version: "0.3.1" };
  if (/Android/i.test(agent) && /\bwv\b/i.test(agent)) return { platform: "android", version: "0.3.1" };

  const standalone = window.matchMedia("(display-mode: standalone)").matches
    || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
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

function storageKey(identity: ClientIdentity, suffix: string) {
  return `jishi:update:${identity.platform}:${suffix}`;
}

export default function UpdatePrompt() {
  const [prompt, setPrompt] = useState<PromptState | null>(null);

  useEffect(() => {
    // Electron uses the page title for its native window title bar. Read the
    // installed version, never the newest version in the update manifest.
    const version = navigator.userAgent.match(/JishiWindows\/([0-9]+(?:\.[0-9]+){1,3})/i)?.[1];
    if (!version) return;
    const previousTitle = document.title;
    document.title = `记时 v${version}`;
    return () => { document.title = previousTitle; };
  }, []);

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
        if (!release.required && snooze?.releaseId === manifest.releaseId && Number(snooze.until) > Date.now()) return;
        setPrompt({ kind: "binary", identity, manifest, release });
        return;
      }

      if (!seenRelease) {
        localStorage.setItem(seenKey, manifest.releaseId);
        return;
      }
      if (seenRelease !== manifest.releaseId) setPrompt({ kind: "content", identity, manifest });
    } catch {
      // Update checks must never interrupt the user's todo workflow.
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void checkForUpdates(), 1200);
    const timer = window.setInterval(() => void checkForUpdates(), CHECK_INTERVAL);
    const onVisible = () => document.visibilityState === "visible" && void checkForUpdates();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
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
  const download = () => {
    if (!prompt.release) return;
    markSeen();
    if (!prompt.release.required) {
      localStorage.setItem(storageKey(prompt.identity, "snooze"), JSON.stringify({ releaseId: prompt.manifest.releaseId, until: Date.now() + SNOOZE_TIME }));
    }
    setPrompt(null);
    window.location.assign(new URL(prompt.release.downloadUrl, window.location.origin).toString());
  };

  const platformName = prompt.identity.platform === "windows" ? "Windows" : prompt.identity.platform === "android" ? "Android" : "应用";
  return <div className="update-layer" role="presentation">
    <section className="update-card" role="dialog" aria-modal="true" aria-labelledby="update-title">
      {!prompt.release?.required && <button className="update-close" onClick={later} aria-label="稍后更新"><X size={19} /></button>}
      <div className="update-icon">{prompt.kind === "binary" ? <Download size={25} /> : <RefreshCw size={25} />}</div>
      <span className="eyebrow">{prompt.kind === "binary" ? `${platformName} 客户端更新` : "应用内容已更新"}</span>
      <h2 id="update-title">{prompt.kind === "binary" ? `新版本 ${prompt.release?.version} 已就绪` : "刷新后即可使用最新功能"}</h2>
      {prompt.kind === "binary" && <p>当前版本 {prompt.identity.version}。安装新版本不会删除你的账号和云端待办。</p>}
      {prompt.kind === "content" && <p>服务器已部署新内容，你的数据已经安全保存。</p>}
      {prompt.manifest.notes.length > 0 && <ul>{prompt.manifest.notes.slice(0, 4).map((note) => <li key={note}>{note}</li>)}</ul>}
      <div className="update-trust"><ShieldCheck size={16} /><span>安装包由记时服务器通过 HTTPS 提供</span></div>
      <div className="update-actions">
        {!prompt.release?.required && <button className="button secondary" onClick={later}>稍后提醒</button>}
        <button className="button primary" onClick={() => prompt.kind === "binary" ? download() : void refresh()}>
          {prompt.kind === "binary" ? <><Download size={17} />下载更新</> : <><RefreshCw size={17} />立即刷新</>}
        </button>
      </div>
    </section>
  </div>;
}
