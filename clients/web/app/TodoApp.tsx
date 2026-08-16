"use client";

import {
  ArchiveRestore, Bell, Check, ChevronRight, CircleUserRound,
  Clock3, Crop, Filter, ImagePlus, LayoutList, Menu, MoreHorizontal,
  Palette, Pencil, Plus, RotateCcw, Search, Settings, SlidersHorizontal,
  Sparkles, Trash2, UserRound, X,
} from "lucide-react";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiUrl, withRuntimeBase } from "./runtime-path";

type Priority = "low" | "normal" | "important" | "urgent";
type TodoStatus = "active" | "completed" | "deleted";
type Todo = {
  id: string; title: string; content: string; deadline: string | null;
  reminderPresetId: string | null; reminderOffsets: number[]; categoryId: string | null;
  priority: Priority; notes: string; status: TodoStatus; createdAt: string;
  completedAt: string | null; deletedAt: string | null; updatedAt: string;
};
type Category = { id: string; name: string; color: string; isDefault: number };
type Preset = { id: string; name: string; offsets: number[]; isDefault: number };
type SettingsShape = {
  theme: "linen" | "night" | "sage"; accent: string; cardOpacity: number;
  acrylic: boolean; backgroundUrl?: string;
};
type Profile = { id: string; email: string; name: string; avatarUrl?: string | null; settings: SettingsShape };
type Bootstrap = { user: Profile; todos: Todo[]; categories: Category[]; reminderPresets: Preset[] };
type DeviceLogin = { rememberAccount: boolean; rememberPassword: boolean; autoLogin: boolean; email: string; password: string };

const DEVICE_LOGIN_KEY = "jishi-device-login-v1";
const NOTIFICATION_KEY = "jishi-notifications-enabled";

const priorityMeta: Record<Priority, { label: string; hint: string }> = {
  low: { label: "不重要", hint: "慢慢来" },
  normal: { label: "一般", hint: "照常安排" },
  important: { label: "较重要", hint: "优先处理" },
  urgent: { label: "很重要", hint: "尽快完成" },
};
const defaultSettings: SettingsShape = { theme: "linen", accent: "#d96f4b", cardOpacity: 92, acrylic: true };
const defaultDeviceLogin: DeviceLogin = { rememberAccount: false, rememberPassword: false, autoLogin: false, email: "", password: "" };

function readDeviceLogin(): DeviceLogin {
  if (typeof window === "undefined") return defaultDeviceLogin;
  try { return { ...defaultDeviceLogin, ...JSON.parse(localStorage.getItem(DEVICE_LOGIN_KEY) || "{}") }; }
  catch { return defaultDeviceLogin; }
}
function writeDeviceLogin(value: DeviceLogin) {
  localStorage.setItem(DEVICE_LOGIN_KEY, JSON.stringify(value));
}
function notificationsSupported() {
  return typeof window !== "undefined" && "Notification" in window;
}
function readNotificationsEnabled() {
  return typeof window !== "undefined" && localStorage.getItem(NOTIFICATION_KEY) === "true";
}
function formatOffsets(offsets: number[]) {
  return offsets.map((n) => n >= 1440 && n % 1440 === 0 ? `${n / 1440} 天` : n >= 60 && n % 60 === 0 ? `${n / 60} 小时` : `${n} 分钟`).join("、");
}
function parseOffsets(value: string) {
  return [...new Set(value.split(/[,，、]/).map((part) => {
    const match = part.trim().match(/^(\d+(?:\.\d+)?)\s*(天|d|小时|h|分钟|m)?$/i);
    if (!match) return Number.NaN;
    const number = Number(match[1]);
    return Math.round(number * (match[2] === "天" || match[2]?.toLowerCase() === "d" ? 1440 : match[2] === "小时" || match[2]?.toLowerCase() === "h" ? 60 : 1));
  }).filter((number) => Number.isFinite(number) && number > 0))].sort((a, b) => b - a);
}

function dateTime(value: string | null, fallback = "未设置") {
  if (!value) return fallback;
  return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}
function fullDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date(value));
}
function toInputDate(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}
async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(apiUrl(url), { ...init, credentials: "include", headers: { "Content-Type": "application/json", ...(init?.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "操作没有完成，请稍后重试");
  return data as T;
}

function DefaultAvatar({ size = 22 }: { size?: number }) {
  return <UserRound className="default-avatar-icon" size={size} aria-hidden="true" />;
}

function ImageCropper({ file, kind, onCancel, onConfirm }: {
  file: File; kind: "avatar" | "background"; onCancel: () => void; onConfirm: (file: File) => Promise<void>;
}) {
  const imageRef = useRef<HTMLImageElement>(null);
  const source = useMemo(() => URL.createObjectURL(file), [file]);
  const [zoom, setZoom] = useState(1);
  const [positionX, setPositionX] = useState(50);
  const [positionY, setPositionY] = useState(50);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const aspect = kind === "avatar" ? 1 : 16 / 9;

  useEffect(() => {
    return () => URL.revokeObjectURL(source);
  }, [source]);

  const confirm = async () => {
    const image = imageRef.current;
    if (!image?.naturalWidth || !image.naturalHeight) return;
    setBusy(true); setError("");
    try {
      const naturalAspect = image.naturalWidth / image.naturalHeight;
      let cropWidth = naturalAspect > aspect ? image.naturalHeight * aspect : image.naturalWidth;
      let cropHeight = naturalAspect > aspect ? image.naturalHeight : image.naturalWidth / aspect;
      cropWidth /= zoom; cropHeight /= zoom;
      const sourceX = (image.naturalWidth - cropWidth) * positionX / 100;
      const sourceY = (image.naturalHeight - cropHeight) * positionY / 100;
      const outputWidth = kind === "avatar" ? 512 : 1600;
      const outputHeight = Math.round(outputWidth / aspect);
      const canvas = document.createElement("canvas");
      canvas.width = outputWidth; canvas.height = outputHeight;
      canvas.getContext("2d")?.drawImage(image, sourceX, sourceY, cropWidth, cropHeight, 0, 0, outputWidth, outputHeight);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", .9));
      if (!blob) throw new Error("图片裁选失败，请换一张图片重试");
      await onConfirm(new File([blob], `${file.name.replace(/\.[^.]+$/, "")}-cropped.webp`, { type: "image/webp" }));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "图片处理失败"); setBusy(false); }
  };

  return <div className="modal-layer crop-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !busy && onCancel()}>
    <section className="crop-panel" role="dialog" aria-modal="true" aria-labelledby="crop-title">
      <header className="editor-head"><div><span className="eyebrow">上传前预览</span><h2 id="crop-title">裁选{kind === "avatar" ? "头像" : "背景图片"}</h2></div><button className="icon-button" disabled={busy} onClick={onCancel} aria-label="关闭裁选"><X size={21} /></button></header>
      <div className={`crop-viewport ${kind}`} style={{ "--crop-x": `${positionX}%`, "--crop-y": `${positionY}%`, "--crop-zoom": zoom } as React.CSSProperties}>
        {/* Local object URLs must stay unoptimized so cropping uses the original pixels. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {source && <img ref={imageRef} src={source} alt="待裁选图片" />}
        <span className="crop-grid" aria-hidden="true" />
      </div>
      <div className="crop-controls">
        <label><span><Crop size={16} />缩放</span><input type="range" min="1" max="3" step="0.05" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} /></label>
        <label><span>水平位置</span><input type="range" min="0" max="100" value={positionX} onChange={(event) => setPositionX(Number(event.target.value))} /></label>
        <label><span>垂直位置</span><input type="range" min="0" max="100" value={positionY} onChange={(event) => setPositionY(Number(event.target.value))} /></label>
        {error && <p className="background-error" role="alert">{error}</p>}
      </div>
      <footer className="editor-actions"><button className="button secondary" disabled={busy} onClick={onCancel}>取消</button><button className="button primary" disabled={busy || !source} onClick={() => void confirm()}>{busy ? "正在上传…" : "确认裁选并上传"}</button></footer>
    </section>
  </div>;
}

function EmptyState({ kind }: { kind: "active" | "completed" | "deleted" }) {
  const copy = kind === "deleted" ? ["回收站是空的", "删除的待办会在这里保留 30 天"] : kind === "completed" ? ["还没有完成记录", "完成一件小事，也值得被记住"] : ["此刻没有待办", "按下右下角的加号，记下第一件事"];
  return <div className="empty-state"><span className="empty-mark"><Sparkles size={24} /></span><h3>{copy[0]}</h3><p>{copy[1]}</p></div>;
}

function SwipeTask({ todo, category, onOpen, onStatus, cardOpacity, acrylic }: {
  todo: Todo; category?: Category; onOpen: () => void; onStatus: (status: TodoStatus) => void;
  cardOpacity: number; acrylic: boolean;
}) {
  const [drag, setDrag] = useState(0);
  const start = useRef<{ x: number; width: number } | null>(null);
  // The current clock is intentionally sampled for live overdue styling.
  // eslint-disable-next-line react-hooks/purity
  const isOverdue = todo.status === "active" && !!todo.deadline && new Date(todo.deadline).getTime() < Date.now();
  const begin = (event: React.PointerEvent<HTMLDivElement>) => {
    if (todo.status !== "active") return;
    start.current = { x: event.clientX, width: event.currentTarget.offsetWidth };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const move = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!start.current) return;
    setDrag(Math.max(-start.current.width * .58, Math.min(start.current.width * .58, event.clientX - start.current.x)));
  };
  const end = () => {
    if (!start.current) return;
    const threshold = start.current.width * .5;
    if (drag <= -threshold) onStatus("completed");
    else if (drag >= threshold) onStatus("deleted");
    setDrag(0); start.current = null;
  };
  return <div className={`swipe-shell ${drag < 0 ? "completing" : drag > 0 ? "deleting" : ""}`}>
    <div className="swipe-action delete-action"><Trash2 size={21} /><span>移入回收站</span></div>
    <div className="swipe-action complete-action"><Check size={22} /><span>标为完成</span></div>
    <button type="button"
      className={`task-card priority-${todo.priority} ${isOverdue ? "overdue" : ""} ${acrylic ? "acrylic" : ""}`}
      style={{ transform: `translateX(${drag}px)`, "--card-opacity": cardOpacity / 100 } as React.CSSProperties}
      onPointerDown={begin} onPointerMove={move} onPointerUp={end} onPointerCancel={end}
      onClick={() => Math.abs(drag) < 4 && onOpen()}
    >
      <div className="task-card-top">
        <div className="task-title-row"><span className="priority-dot" /><h3>{todo.title}</h3></div>
        <span className="icon-button quiet" aria-hidden="true"><MoreHorizontal size={20} /></span>
      </div>
      {todo.content && <p className="task-preview">{todo.content}</p>}
      <div className="task-meta">
        <span className="category-pill" style={{ "--category-color": category?.color || "#9e8d74" } as React.CSSProperties}>{category?.name || "默认"}</span>
        <span className={isOverdue ? "deadline-overdue" : ""}><Clock3 size={14} />{isOverdue ? "已逾期 · " : ""}{dateTime(todo.deadline)}</span>
      </div>
    </button>
  </div>;
}

type EditorValue = Pick<Todo, "title" | "content" | "deadline" | "reminderPresetId" | "categoryId" | "priority" | "notes">;

function TodoEditor({ initial, categories, presets, onClose, onSave, saving }: {
  initial?: Todo; categories: Category[]; presets: Preset[]; onClose: () => void;
  onSave: (value: EditorValue) => void; saving: boolean;
}) {
  const defaultCategory = categories.find((item) => item.isDefault)?.id ?? categories[0]?.id ?? null;
  const defaultPreset = presets.find((item) => item.isDefault)?.id ?? presets[0]?.id ?? null;
  const [value, setValue] = useState<EditorValue>({
    title: initial?.title || "", content: initial?.content || "", deadline: initial?.deadline || null,
    reminderPresetId: initial?.reminderPresetId || defaultPreset, categoryId: initial?.categoryId || defaultCategory,
    priority: initial?.priority || "normal", notes: initial?.notes || "",
  });
  const update = <K extends keyof EditorValue>(key: K, next: EditorValue[K]) => setValue((old) => ({ ...old, [key]: next }));
  return <div className="modal-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="editor-panel" role="dialog" aria-modal="true" aria-labelledby="editor-title">
      <header className="editor-head"><div><span className="eyebrow">{initial ? "编辑记录" : "新的安排"}</span><h2 id="editor-title">{initial ? "修改待办" : "创建待办事项"}</h2></div><button className="icon-button" onClick={onClose} aria-label="关闭"><X size={21} /></button></header>
      <div className="editor-scroll">
        <label className="field"><span>待办标题 <em>必填 · 最多 60 字</em></span><input maxLength={60} value={value.title} onChange={(event) => update("title", event.target.value)} placeholder="例如：整理第三章课程笔记" /><small>{value.title.length}/60</small></label>
        <label className="field"><span>内容</span><textarea rows={3} value={value.content} onChange={(event) => update("content", event.target.value)} placeholder="补充一些背景或步骤…" /></label>
        <div className="field-grid">
          <label className="field"><span>截止时间</span><input type="datetime-local" value={toInputDate(value.deadline)} onChange={(event) => update("deadline", event.target.value ? new Date(event.target.value).toISOString() : null)} /></label>
          <label className="field"><span>提示时间</span><select value={value.reminderPresetId || ""} onChange={(event) => update("reminderPresetId", event.target.value || null)}><option value="">不提醒</option>{presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}</select></label>
        </div>
        <div className="field-grid">
          <label className="field"><span>待办分类</span><select value={value.categoryId || ""} onChange={(event) => update("categoryId", event.target.value || null)}>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
          <label className="field"><span>重要程度</span><select value={value.priority} onChange={(event) => update("priority", event.target.value as Priority)}>{Object.entries(priorityMeta).map(([key, meta]) => <option key={key} value={key}>{meta.label} · {meta.hint}</option>)}</select></label>
        </div>
        <label className="field"><span>备注</span><textarea rows={3} value={value.notes} onChange={(event) => update("notes", event.target.value)} placeholder="只有你会看到的备注" /></label>
      </div>
      <footer className="editor-actions"><button className="button secondary" onClick={onClose}>取消</button><button className="button primary" disabled={saving || !value.title.trim()} onClick={() => onSave(value)}>{saving ? "正在保存…" : initial ? "保存修改" : "创建待办"}</button></footer>
    </section>
  </div>;
}

function DetailPanel({ todo, category, preset, onClose, onEdit, onStatus, onDeleteForever }: {
  todo: Todo; category?: Category; preset?: Preset; onClose: () => void; onEdit: () => void;
  onStatus: (status: TodoStatus) => void; onDeleteForever: () => void;
}) {
  const offsets = preset?.offsets || todo.reminderOffsets;
  return <div className="detail-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><aside className="detail-panel" role="dialog" aria-modal="true" aria-label="待办详情">
    <div className="detail-handle" />
    <header className="detail-head"><span className={`status-badge status-${todo.status}`}>{todo.status === "active" ? "未完成" : todo.status === "completed" ? "已完成" : "回收站"}</span><button className="icon-button" onClick={onClose} aria-label="关闭详情"><X size={20} /></button></header>
    <div className="detail-body"><h2>{todo.title}</h2>{todo.content ? <p className="detail-content">{todo.content}</p> : <p className="detail-muted">没有补充内容</p>}
      <dl className="detail-list"><div><dt>截止时间</dt><dd>{fullDate(todo.deadline)}</dd></div><div><dt>提示时间</dt><dd>{offsets.length ? `${preset?.name || "原提醒组"}（${formatOffsets(offsets)}前）` : "不提醒"}</dd></div><div><dt>待办分类</dt><dd><span className="tiny-dot" style={{ background: category?.color }} />{category?.name || "默认"}</dd></div><div><dt>重要程度</dt><dd>{priorityMeta[todo.priority].label}</dd></div><div><dt>创建时间</dt><dd>{fullDate(todo.createdAt)}</dd></div>{todo.completedAt && <div><dt>完成时间</dt><dd>{fullDate(todo.completedAt)}</dd></div>}{todo.deletedAt && <div><dt>删除时间</dt><dd>{fullDate(todo.deletedAt)}</dd></div>}</dl>
      <section className="note-box"><span>备注</span><p>{todo.notes || "无"}</p></section>
    </div>
    <footer className="detail-actions">{todo.status === "deleted" ? <><button className="button secondary" onClick={() => onStatus("active")}><RotateCcw size={17} />恢复</button><button className="button danger" onClick={onDeleteForever}><Trash2 size={17} />永久删除</button></> : <><button className="button secondary" onClick={onEdit}><Pencil size={17} />编辑</button><button className="button primary" onClick={() => onStatus(todo.status === "completed" ? "active" : "completed")}><Check size={17} />{todo.status === "completed" ? "重新打开" : "标记完成"}</button><button className="icon-button danger-quiet" onClick={() => onStatus("deleted")} aria-label="移入回收站"><Trash2 size={19} /></button></>}</footer>
  </aside></div>;
}

function AuthScreen({ onAuthenticated }: { onAuthenticated: () => Promise<void> }) {
  const initialLogin = useMemo(() => readDeviceLogin(), []);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState(initialLogin.rememberAccount ? initialLogin.email : "");
  const [password, setPassword] = useState(initialLogin.rememberPassword ? initialLogin.password : "");
  const [rememberAccount, setRememberAccount] = useState(initialLogin.rememberAccount);
  const [rememberPassword, setRememberPassword] = useState(initialLogin.rememberPassword);
  const [autoLogin, setAutoLogin] = useState(initialLogin.autoLogin);
  const [name, setName] = useState("");
  const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  const autoAttempted = useRef(false);
  const login = useCallback(async (automatic = false) => {
    setBusy(true); setMessage("");
    try {
      await api(`/api/auth/${mode}`, { method: "POST", body: JSON.stringify({ email, password, name }) });
      if (mode === "login") writeDeviceLogin({
        rememberAccount: rememberAccount || rememberPassword || autoLogin,
        rememberPassword: rememberPassword || autoLogin,
        autoLogin,
        email: rememberAccount || rememberPassword || autoLogin ? email : "",
        password: rememberPassword || autoLogin ? password : "",
      });
      await onAuthenticated();
    } catch (err) { setMessage(`${automatic ? "自动登录失败：" : ""}${err instanceof Error ? err.message : "登录失败，请稍后重试"}`); }
    finally { setBusy(false); }
  }, [autoLogin, email, mode, name, onAuthenticated, password, rememberAccount, rememberPassword]);
  useEffect(() => {
    if (!autoAttempted.current && initialLogin.autoLogin && initialLogin.email && initialLogin.password) {
      autoAttempted.current = true; void login(true);
    }
  }, [initialLogin, login]);
  const submit = (event: React.FormEvent) => { event.preventDefault(); void login(false); };
  return <main className="signin-screen"><div className="brand-mark">记</div><span className="eyebrow">欢迎来到记时</span><h1>把今天，安放得刚刚好。</h1><p>使用邮箱创建自己的空间，待办、提醒与个人设置会在各端保持一致。</p><form className="auth-form" onSubmit={submit}>{mode === "register" && <label><span>昵称</span><input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" maxLength={24} required placeholder="怎么称呼你" /></label>}<label><span>邮箱</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required placeholder="name@example.com" /></label><label><span>密码</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={8} maxLength={128} required placeholder="至少 8 位" /></label>{mode === "login" && <div className="login-options"><label><input type="checkbox" checked={rememberAccount} onChange={(event) => { setRememberAccount(event.target.checked); if (!event.target.checked) { setRememberPassword(false); setAutoLogin(false); } }} /><span>保存账号</span></label><label><input type="checkbox" checked={rememberPassword} onChange={(event) => { setRememberPassword(event.target.checked); if (event.target.checked) setRememberAccount(true); else setAutoLogin(false); }} /><span>保存密码</span></label><label><input type="checkbox" checked={autoLogin} onChange={(event) => { setAutoLogin(event.target.checked); if (event.target.checked) { setRememberAccount(true); setRememberPassword(true); } }} /><span>自动登录</span></label><small>密码只保存在当前设备；公共电脑请勿开启。</small></div>}{message && <div className="auth-error">{message}</div>}<button className="button primary" disabled={busy}>{busy ? "请稍候…" : mode === "login" ? "登录" : "注册并登录"}</button></form><button className="auth-switch" onClick={() => { setMode((value) => value === "login" ? "register" : "login"); setMessage(""); }}>{mode === "login" ? "还没有账号？创建一个" : "已有账号？直接登录"}</button></main>;
}

export default function TodoApp() {
  const [data, setData] = useState<Bootstrap | null>(null);
  const [section, setSection] = useState<"todos" | "mine" | "settings" | "trash">("todos");
  const [statusFilter, setStatusFilter] = useState<"active" | "completed">("active");
  const [query, setQuery] = useState(""); const [categoryFilter, setCategoryFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState(""); const [dateFilter, setDateFilter] = useState("all");
  const [editor, setEditor] = useState<"new" | Todo | null>(null); const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false); const [notice, setNotice] = useState(""); const [error, setError] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [notificationEnabled, setNotificationEnabled] = useState(readNotificationsEnabled);

  const load = useCallback(async () => {
    try { setError(""); setData(await api<Bootstrap>("/api/bootstrap")); }
    catch (err) { setError(err instanceof Error ? err.message : "暂时无法同步数据"); }
  }, []);
  useEffect(() => { queueMicrotask(() => void load()); if ("serviceWorker" in navigator) void navigator.serviceWorker.register(withRuntimeBase("/sw.js")); }, [load]);
  useEffect(() => {
    if (!data || !notificationEnabled || !notificationsSupported() || Notification.permission !== "granted") return;
    const check = () => {
      const now = Date.now();
      data.todos.filter((todo) => todo.status === "active" && todo.deadline).forEach((todo) => {
        const deadline = new Date(todo.deadline!).getTime();
        if (deadline < now && deadline > now - 60_000) new Notification(`待办已逾期：${todo.title}`, { body: "它还没有完成，点此回到记时。", icon: withRuntimeBase("/favicon.svg") });
        todo.reminderOffsets.forEach((minutes) => { const moment = deadline - minutes * 60_000; if (moment <= now && moment > now - 60_000) new Notification(todo.title, { body: `${dateTime(todo.deadline)} 截止`, icon: withRuntimeBase("/favicon.svg") }); });
      });
    };
    check(); const timer = window.setInterval(check, 60_000); return () => window.clearInterval(timer);
  }, [data, notificationEnabled]);

  const settings = { ...defaultSettings, ...(data?.user.settings || {}) };
  useEffect(() => { document.documentElement.dataset.theme = settings.theme; }, [settings.theme]);
  const selected = data?.todos.find((todo) => todo.id === selectedId) || null;
  const visibleTodos = useMemo(() => {
    if (!data) return [];
    const now = new Date(); const endDay = new Date(now); endDay.setHours(23, 59, 59, 999); const endWeek = new Date(now.getTime() + 7 * 86400000);
    return data.todos.filter((todo) => {
      const targetStatus = section === "trash" ? "deleted" : statusFilter;
      if (todo.status !== targetStatus) return false;
      const haystack = `${todo.title} ${todo.content} ${todo.notes}`.toLowerCase();
      if (query && !haystack.includes(query.toLowerCase())) return false;
      if (categoryFilter && todo.categoryId !== categoryFilter) return false;
      if (priorityFilter && todo.priority !== priorityFilter) return false;
      if (dateFilter === "today" && (!todo.deadline || new Date(todo.deadline) > endDay)) return false;
      if (dateFilter === "week" && (!todo.deadline || new Date(todo.deadline) > endWeek)) return false;
      if (dateFilter === "overdue" && (!todo.deadline || new Date(todo.deadline) >= now)) return false;
      return true;
    });
  }, [data, section, statusFilter, query, categoryFilter, priorityFilter, dateFilter]);

  const flash = (message: string) => { setNotice(message); window.setTimeout(() => setNotice(""), 2200); };
  const toggleNotifications = async () => {
    if (notificationEnabled) {
      localStorage.setItem(NOTIFICATION_KEY, "false"); setNotificationEnabled(false);
      flash("提醒已关闭：本设备不会再弹出待办通知"); return;
    }
    if (!notificationsSupported()) { flash("此设备暂不支持网页通知，待办仍会正常同步"); return; }
    const permission = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
    if (permission === "granted") {
      localStorage.setItem(NOTIFICATION_KEY, "true"); setNotificationEnabled(true);
      flash("提醒已开启：页面运行时会按截止时间通知");
    } else flash("提醒未开启：请在系统设置中允许此应用发送通知");
  };
  const mutateTodo = async (id: string, patch: Record<string, unknown>) => {
    try {
      const result = await api<{ todo: Todo }>(`/api/todos/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
      setData((old) => old ? ({ ...old, todos: old.todos.map((todo) => todo.id === id ? result.todo : todo) }) : old);
      if (patch.status === "completed") flash("完成了一件，做得好");
      if (patch.status === "deleted") { flash("已移入回收站"); if (selectedId === id) setSelectedId(null); }
    } catch (err) { setError(err instanceof Error ? err.message : "操作失败"); }
  };
  const saveTodo = async (value: EditorValue) => {
    if (!data) return; setSaving(true);
    try {
      if (editor && editor !== "new") await mutateTodo(editor.id, value);
      else {
        const result = await api<{ todo: Todo }>("/api/todos", { method: "POST", body: JSON.stringify(value) });
        setData({ ...data, todos: [result.todo, ...data.todos] }); flash("待办已创建");
      }
      setEditor(null);
    } catch (err) { setError(err instanceof Error ? err.message : "保存失败"); }
    finally { setSaving(false); }
  };
  const deleteForever = async (todo: Todo) => {
    if (!window.confirm(`永久删除“${todo.title}”？此操作无法恢复。`)) return;
    await api(`/api/todos/${todo.id}`, { method: "DELETE" });
    setData((old) => old ? ({ ...old, todos: old.todos.filter((item) => item.id !== todo.id) }) : old); setSelectedId(null); flash("已永久删除");
  };
  const saveProfile = async (patch: { name?: string; settings?: SettingsShape; avatarUrl?: string }) => {
    if (!data) return;
    const result = await api<{ user: Profile }>("/api/profile", { method: "PATCH", body: JSON.stringify(patch) });
    setData((old) => old ? ({ ...old, user: result.user }) : old); flash("设置已同步");
  };
  const previewSettings = (next: SettingsShape) => setData((old) => old ? ({ ...old, user: { ...old.user, settings: next } }) : old);
  const uploadImage = async (file: File, kind: "avatar" | "background") => {
    const response = await fetch(apiUrl(`/api/media?kind=${kind}`), { method: "PUT", credentials: "include", headers: { "Content-Type": file.type }, body: file });
    const result = await response.json(); if (!response.ok) throw new Error(result.error);
    if (kind === "avatar") await saveProfile({ avatarUrl: result.url });
    else await saveProfile({ settings: { ...settings, backgroundUrl: result.url } });
  };
  const removeBackground = async () => {
    const response = await fetch(apiUrl("/api/media?kind=background"), { method: "DELETE", credentials: "include" });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "移除背景失败");
    await saveProfile({ settings: { ...settings, backgroundUrl: undefined } });
  };

  if (!data && error.includes("登录")) return <AuthScreen onAuthenticated={load} />;
  if (!data) return <main className="loading-screen"><div className="brand-mark pulse">记</div><p>{error || "正在整理你的今天…"}</p>{error && <button className="button secondary" onClick={() => void load()}>重新连接</button>}</main>;

  const categoryMap = new Map(data.categories.map((item) => [item.id, item]));
  const presetMap = new Map(data.reminderPresets.map((item) => [item.id, item]));
  const activeCount = data.todos.filter((todo) => todo.status === "active").length;
  const todayLabel = new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "long" }).format(new Date());
  return <div className={`app-shell acrylic-${settings.acrylic}`} style={{ "--accent": settings.accent, "--app-background-image": settings.backgroundUrl ? `url(${withRuntimeBase(settings.backgroundUrl)})` : "none" } as React.CSSProperties}>
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark small">记</span><div><strong>记时</strong><small>把今天安放好</small></div></div>
      <nav className="side-nav" aria-label="主导航"><button className={section === "todos" ? "active" : ""} onClick={() => setSection("todos")}><LayoutList size={19} /><span>待办</span><b>{activeCount}</b></button><button className={section === "mine" ? "active" : ""} onClick={() => setSection("mine")}><CircleUserRound size={19} /><span>我的</span></button></nav>
      <div className="sidebar-groups"><span>快捷查看</span><button onClick={() => { setSection("todos"); setStatusFilter("completed"); }}><Check size={17} />已完成</button><button onClick={() => setSection("trash")}><Trash2 size={17} />回收站</button><button onClick={() => setSection("settings")}><Settings size={17} />设置</button></div>
      <div className="sidebar-profile"><span className="avatar">{data.user.avatarUrl ? <Image src={apiUrl(data.user.avatarUrl)} alt="用户头像" fill sizes="38px" unoptimized /> : <DefaultAvatar />}</span><div><strong>{data.user.name}</strong><small>已同步</small></div><ChevronRight size={17} /></div>
    </aside>

    <main className="main-surface">
      {(section === "todos" || section === "trash") && <>
        <header className="topbar"><div><span className="eyebrow">{section === "trash" ? "30 天内可恢复" : todayLabel}</span><h1>{section === "trash" ? "回收站" : statusFilter === "active" ? "今天，先做什么？" : "完成记录"}</h1></div><div className="top-actions"><button className="icon-button mobile-menu" aria-label="菜单"><Menu size={21} /></button><button className={`button notification-button ${notificationEnabled ? "enabled" : ""}`} aria-pressed={notificationEnabled} title={notificationEnabled ? "关闭本设备的待办弹窗提醒" : "开启本设备的待办弹窗提醒"} onClick={() => void toggleNotifications()}><Bell size={18} /><span>{notificationEnabled ? "提醒已开" : "提醒已关"}</span></button>{section !== "trash" && <button className="button primary desktop-add" onClick={() => setEditor("new")}><Plus size={19} />新建待办</button>}</div></header>
        {section !== "trash" && <div className="status-tabs"><button className={statusFilter === "active" ? "active" : ""} onClick={() => setStatusFilter("active")}>未完成 <span>{activeCount}</span></button><button className={statusFilter === "completed" ? "active" : ""} onClick={() => setStatusFilter("completed")}>已完成 <span>{data.todos.filter((todo) => todo.status === "completed").length}</span></button></div>}
        <div className="filter-row"><label className="search-box"><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标题、内容或备注" /><kbd>⌘ K</kbd></label><button className={`filter-button ${filtersOpen ? "active" : ""}`} onClick={() => setFiltersOpen((value) => !value)}><SlidersHorizontal size={18} />筛选</button></div>
        {filtersOpen && <div className="filter-panel"><label><span>分类</span><select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}><option value="">全部分类</option>{data.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label><label><span>重要程度</span><select value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)}><option value="">全部程度</option>{Object.entries(priorityMeta).map(([key, meta]) => <option key={key} value={key}>{meta.label}</option>)}</select></label><label><span>截止范围</span><select value={dateFilter} onChange={(event) => setDateFilter(event.target.value)}><option value="all">全部时间</option><option value="today">今天截止</option><option value="week">7 天内</option><option value="overdue">已逾期</option></select></label><button className="text-button" onClick={() => { setCategoryFilter(""); setPriorityFilter(""); setDateFilter("all"); }}><RotateCcw size={15} />重置</button></div>}
        <section className="task-list" aria-live="polite">{visibleTodos.length ? visibleTodos.map((todo) => <SwipeTask key={todo.id} todo={todo} category={todo.categoryId ? categoryMap.get(todo.categoryId) : undefined} onOpen={() => setSelectedId(todo.id)} onStatus={(status) => void mutateTodo(todo.id, { status })} cardOpacity={settings.cardOpacity} acrylic={settings.acrylic} />) : <EmptyState kind={section === "trash" ? "deleted" : statusFilter} />}</section>
      </>}
      {(section === "mine" || section === "settings") && <ProfileSettings data={data} settings={settings} section={section} onSection={setSection} onSaveProfile={saveProfile} onPreviewSettings={previewSettings} onUpload={uploadImage} onRemoveBackground={removeBackground} setData={setData} flash={flash} />}
      {selected && <DetailPanel todo={selected} category={selected.categoryId ? categoryMap.get(selected.categoryId) : undefined} preset={selected.reminderPresetId ? presetMap.get(selected.reminderPresetId) : undefined} onClose={() => setSelectedId(null)} onEdit={() => setEditor(selected)} onStatus={(status) => void mutateTodo(selected.id, { status })} onDeleteForever={() => void deleteForever(selected)} />}
    </main>

    <nav className="bottom-nav" aria-label="移动端主导航"><button className={section === "todos" || section === "trash" ? "active" : ""} onClick={() => setSection("todos")}><LayoutList size={22} /><span>待办</span></button><button className="floating-add" onClick={() => setEditor("new")} aria-label="新建待办"><Plus size={26} /></button><button className={section === "mine" || section === "settings" ? "active" : ""} onClick={() => setSection("mine")}><UserRound size={22} /><span>我的</span></button></nav>
    {editor && <TodoEditor initial={editor === "new" ? undefined : editor} categories={data.categories} presets={data.reminderPresets} onClose={() => setEditor(null)} onSave={(value) => void saveTodo(value)} saving={saving} />}
    {notice && <div className="toast"><Check size={17} />{notice}</div>}{error && <div className="error-toast"><span>{error}</span><button onClick={() => setError("")} aria-label="关闭错误"><X size={16} /></button></div>}
  </div>;
}

function CategorySettingRow({ category, canDelete, onSave, onDelete }: { category: Category; canDelete: boolean; onSave: (id: string, patch: { name: string; color: string }) => Promise<void>; onDelete: (id: string) => Promise<void> }) {
  const [name, setName] = useState(category.name); const [color, setColor] = useState(category.color); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const run = async (action: () => Promise<void>) => { setBusy(true); setError(""); try { await action(); } catch (reason) { setError(reason instanceof Error ? reason.message : "操作失败"); } finally { setBusy(false); } };
  return <div className="manage-row"><input aria-label={`${category.name}分类名称`} value={name} maxLength={12} onChange={(event) => setName(event.target.value)} /><input aria-label={`${category.name}分类颜色`} type="color" value={color} onChange={(event) => setColor(event.target.value)} /><button className="button secondary compact" disabled={busy || !name.trim()} onClick={() => void run(() => onSave(category.id, { name, color }))}>保存</button><button className="icon-button danger-quiet" disabled={busy || !canDelete} title={canDelete ? "删除分类" : "至少保留一个分类"} onClick={() => void run(() => onDelete(category.id))}><Trash2 size={17} /></button>{category.isDefault ? <small className="default-badge">默认</small> : null}{error && <small className="row-error">{error}</small>}</div>;
}

function PresetSettingRow({ preset, canDelete, onSave, onDelete }: { preset: Preset; canDelete: boolean; onSave: (id: string, patch: { name: string; offsets: number[] }) => Promise<void>; onDelete: (id: string) => Promise<void> }) {
  const [name, setName] = useState(preset.name); const [offsets, setOffsets] = useState(preset.offsets.join(", ")); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const parsed = parseOffsets(offsets);
  const run = async (action: () => Promise<void>) => { setBusy(true); setError(""); try { await action(); } catch (reason) { setError(reason instanceof Error ? reason.message : "操作失败"); } finally { setBusy(false); } };
  return <div className="manage-row preset"><input aria-label={`${preset.name}提醒组名称`} value={name} maxLength={20} onChange={(event) => setName(event.target.value)} /><input aria-label={`${preset.name}提前提醒时间`} value={offsets} onChange={(event) => setOffsets(event.target.value)} placeholder="7天, 3小时, 10分钟" /><button className="button secondary compact" disabled={busy || !name.trim() || !parsed.length} onClick={() => void run(() => onSave(preset.id, { name, offsets: parsed }))}>保存</button><button className="icon-button danger-quiet" disabled={busy || !canDelete} title={canDelete ? "删除提醒组" : "至少保留一个提醒组"} onClick={() => void run(() => onDelete(preset.id))}><Trash2 size={17} /></button>{preset.isDefault ? <small className="default-badge">默认</small> : null}{error && <small className="row-error">{error}</small>}</div>;
}

function ProfileSettings({ data, settings, section, onSection, onSaveProfile, onPreviewSettings, onUpload, onRemoveBackground, setData, flash }: {
  data: Bootstrap; settings: SettingsShape; section: "mine" | "settings"; onSection: (value: "mine" | "settings" | "trash") => void;
  onSaveProfile: (patch: { name?: string; settings?: SettingsShape; avatarUrl?: string }) => Promise<void>;
  onPreviewSettings: (settings: SettingsShape) => void;
  onUpload: (file: File, kind: "avatar" | "background") => Promise<void>; onRemoveBackground: () => Promise<void>;
  setData: React.Dispatch<React.SetStateAction<Bootstrap | null>>; flash: (message: string) => void;
}) {
  const [name, setName] = useState(data.user.name); const [categoryName, setCategoryName] = useState(""); const [presetName, setPresetName] = useState(""); const [offset, setOffset] = useState("60");
  const [backgroundBusy, setBackgroundBusy] = useState(false); const [backgroundError, setBackgroundError] = useState("");
  const [cropTarget, setCropTarget] = useState<{ file: File; kind: "avatar" | "background" } | null>(null);
  const [opacityDraft, setOpacityDraft] = useState(settings.cardOpacity); const committedOpacity = useRef(settings.cardOpacity);
  const [deviceLogin, setDeviceLogin] = useState(readDeviceLogin);
  const updateDeviceLogin = (patch: Partial<DeviceLogin>) => { const next = { ...deviceLogin, ...patch }; if (!next.rememberAccount) Object.assign(next, { rememberPassword: false, autoLogin: false, email: "", password: "" }); if (!next.rememberPassword) Object.assign(next, { autoLogin: false, password: "" }); writeDeviceLogin(next); setDeviceLogin(next); };
  const addCategory = async () => { const result = await api<{ category: Category }>("/api/categories", { method: "POST", body: JSON.stringify({ name: categoryName }) }); setData((old) => old ? ({ ...old, categories: [...old.categories, result.category] }) : old); setCategoryName(""); flash("分类已添加"); };
  const updateCategory = async (id: string, patch: { name: string; color: string }) => { const result = await api<{ category: Category }>(`/api/categories?id=${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) }); setData((old) => old ? ({ ...old, categories: old.categories.map((item) => item.id === id ? result.category : item) }) : old); flash("分类已更新"); };
  const deleteCategory = async (id: string) => { if (!window.confirm("删除这个分类？其中的待办会自动移到新的默认分类。")) return; await api(`/api/categories?id=${encodeURIComponent(id)}`, { method: "DELETE" }); setData((old) => { if (!old) return old; const remaining = old.categories.filter((item) => item.id !== id).map((item, index) => ({ ...item, isDefault: index === 0 ? 1 : 0 })); return { ...old, categories: remaining, todos: old.todos.map((todo) => todo.categoryId === id ? ({ ...todo, categoryId: remaining[0]?.id || null }) : todo) }; }); flash("分类已删除"); };
  const addPreset = async () => { const offsets = parseOffsets(offset); const result = await api<{ preset: Preset }>("/api/presets", { method: "POST", body: JSON.stringify({ name: presetName, offsets }) }); setData((old) => old ? ({ ...old, reminderPresets: [...old.reminderPresets, result.preset] }) : old); setPresetName(""); flash("提醒组已添加"); };
  const updatePreset = async (id: string, patch: { name: string; offsets: number[] }) => { const result = await api<{ preset: Preset }>(`/api/presets?id=${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) }); setData((old) => old ? ({ ...old, reminderPresets: old.reminderPresets.map((item) => item.id === id ? result.preset : item), todos: old.todos.map((todo) => todo.reminderPresetId === id ? ({ ...todo, reminderOffsets: result.preset.offsets }) : todo) }) : old); flash("提醒组已更新"); };
  const deletePreset = async (id: string) => { if (!window.confirm("删除这个提醒组？已有待办会保留原来的提醒时间。")) return; await api(`/api/presets?id=${encodeURIComponent(id)}`, { method: "DELETE" }); setData((old) => { if (!old) return old; const remaining = old.reminderPresets.filter((item) => item.id !== id).map((item, index) => ({ ...item, isDefault: index === 0 ? 1 : 0 })); return { ...old, reminderPresets: remaining, todos: old.todos.map((todo) => todo.reminderPresetId === id ? ({ ...todo, reminderPresetId: null }) : todo) }; }); flash("提醒组已删除，已有待办保留原提醒时间"); };
  const chooseImage = (file: File, kind: "avatar" | "background") => {
    const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
    if (!allowedTypes.has(file.type)) { setBackgroundError("请选择 JPEG、PNG、WebP 或 GIF 图片"); return; }
    if (file.size > 5 * 1024 * 1024) { setBackgroundError("图片不能超过 5MB"); return; }
    setBackgroundError(""); setCropTarget({ file, kind });
  };
  const uploadCropped = async (file: File) => { if (!cropTarget) return; await onUpload(file, cropTarget.kind); setCropTarget(null); };
  const clearBackground = async () => { setBackgroundBusy(true); setBackgroundError(""); try { await onRemoveBackground(); } catch (error) { setBackgroundError(error instanceof Error ? error.message : "移除背景失败"); } finally { setBackgroundBusy(false); } };
  const previewOpacity = (value: number) => { setOpacityDraft(value); onPreviewSettings({ ...settings, cardOpacity: value }); };
  const commitOpacity = (value: number) => { if (committedOpacity.current === value) return; committedOpacity.current = value; void onSaveProfile({ settings: { ...settings, cardOpacity: value } }); };
  const cropModal = cropTarget && <ImageCropper file={cropTarget.file} kind={cropTarget.kind} onCancel={() => setCropTarget(null)} onConfirm={uploadCropped} />;

  if (section === "mine") return <><div className="profile-page"><header className="topbar"><div><span className="eyebrow">个人中心</span><h1>我的</h1></div></header><section className="profile-hero"><label className="avatar large" aria-label="更换头像">{data.user.avatarUrl ? <Image src={apiUrl(data.user.avatarUrl)} alt="用户头像" fill sizes="80px" unoptimized /> : <DefaultAvatar size={38} />}<input aria-label="选择头像图片" type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) chooseImage(file, "avatar"); }} /><span><ImagePlus size={15} /></span></label><div><h2>{data.user.name}</h2><p>{data.user.email}</p><span className="sync-badge"><Check size={14} />云端同步正常</span></div></section><section className="quick-grid"><button onClick={() => onSection("settings")}><span><Palette size={20} /></span><div><strong>外观与设置</strong><small>主题、卡片与提醒</small></div><ChevronRight size={18} /></button><button onClick={() => onSection("trash")}><span><ArchiveRestore size={20} /></span><div><strong>回收站</strong><small>{data.todos.filter((todo) => todo.status === "deleted").length} 个待办</small></div><ChevronRight size={18} /></button></section><section className="insight-card"><span className="eyebrow">本周小结</span><div><strong>{data.todos.filter((todo) => todo.status === "completed").length}</strong><p>件事情已经妥善完成。保持自己的节奏，就很好。</p></div></section><button className="button secondary signout" onClick={async () => { const saved = readDeviceLogin(); writeDeviceLogin({ ...saved, autoLogin: false }); await api("/api/auth/logout", { method: "POST" }); window.location.reload(); }}>退出当前账号</button></div>{cropModal}</>;
  return <><div className="settings-page"><header className="topbar"><div><span className="eyebrow">只属于你的记时</span><h1>设置</h1></div></header>
    <section className="settings-card"><div className="settings-title"><UserRound size={20} /><div><h2>个人资料</h2><p>默认头像会自动显示，也可以裁选图片并上传到服务器</p></div></div><div className="profile-settings-row"><label className="avatar settings-avatar" aria-label="上传自定义头像">{data.user.avatarUrl ? <Image src={apiUrl(data.user.avatarUrl)} alt="用户头像" fill sizes="52px" unoptimized /> : <DefaultAvatar size={27} />}<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) chooseImage(file, "avatar"); }} /></label><div className="inline-form"><input value={name} maxLength={24} onChange={(event) => setName(event.target.value)} /><button className="button primary" onClick={() => void onSaveProfile({ name })}>保存姓名</button></div></div></section>
    <section className="settings-card"><div className="settings-title"><CircleUserRound size={20} /><div><h2>当前设备登录</h2><p>账号与密码设置只保存在当前设备，不同步到服务器</p></div></div><div className="setting-line"><div><strong>保存账号</strong><small>{deviceLogin.rememberAccount ? deviceLogin.email || data.user.email : "未保存"}</small></div><button role="switch" aria-checked={deviceLogin.rememberAccount} className={`switch ${deviceLogin.rememberAccount ? "on" : ""}`} onClick={() => updateDeviceLogin(deviceLogin.rememberAccount ? { rememberAccount: false } : { rememberAccount: true, email: data.user.email })}><span /></button></div><div className="setting-line"><div><strong>保存密码</strong><small>{deviceLogin.rememberPassword ? "已保存，可在登录页修改" : "请在下次登录时勾选保存密码"}</small></div><span className="setting-status">{deviceLogin.rememberPassword ? "已保存" : "未保存"}</span></div><div className="setting-line"><div><strong>自动登录</strong><small>启动应用时使用当前设备保存的凭据登录</small></div><button role="switch" aria-checked={deviceLogin.autoLogin} disabled={!deviceLogin.rememberPassword} className={`switch ${deviceLogin.autoLogin ? "on" : ""}`} onClick={() => updateDeviceLogin({ autoLogin: !deviceLogin.autoLogin })}><span /></button></div>{deviceLogin.rememberPassword && <button className="button secondary clear-login" onClick={() => updateDeviceLogin({ rememberAccount: false })}>清除本机保存的登录信息</button>}</section>
    <section className="settings-card"><div className="settings-title"><Palette size={20} /><div><h2>主题与背景</h2><p>选择一套让你舒服的界面，设置会同步到 Web、Windows 和 Android</p></div></div><div className="theme-options">{(["linen", "sage", "night"] as const).map((theme) => <button key={theme} className={`${theme} ${settings.theme === theme ? "selected" : ""}`} onClick={() => void onSaveProfile({ settings: { ...settings, theme } })}><span /><b>{theme === "linen" ? "暖白" : theme === "sage" ? "青苔" : "夜墨"}</b></button>)}</div><div className="setting-line"><div><strong>主题色</strong><small>按钮与强调内容</small></div><input aria-label="选择主题色" type="color" value={settings.accent} onChange={(event) => onPreviewSettings({ ...settings, accent: event.target.value })} onBlur={(event) => void onSaveProfile({ settings: { ...settings, accent: event.target.value } })} /></div><div className="setting-line"><div><strong>亚克力效果</strong><small>为卡片添加轻柔的背景模糊</small></div><button role="switch" aria-checked={settings.acrylic} className={`switch ${settings.acrylic ? "on" : ""}`} onClick={() => void onSaveProfile({ settings: { ...settings, acrylic: !settings.acrylic } })}><span /></button></div><label className="range-line" aria-label="卡片透明度"><span><strong>卡片透明度</strong><small>{opacityDraft}% · 松开后自动保存</small></span><input aria-label="卡片透明度" type="range" min="55" max="100" value={opacityDraft} onChange={(event) => previewOpacity(Number(event.target.value))} onPointerUp={(event) => commitOpacity(Number(event.currentTarget.value))} onBlur={(event) => commitOpacity(Number(event.currentTarget.value))} /></label><div className="background-picker">{settings.backgroundUrl ? <div className="background-preview" role="img" aria-label="当前自定义背景预览" style={{ backgroundImage: `url(${withRuntimeBase(settings.backgroundUrl)})` }} /> : <div className="background-empty"><ImagePlus size={24} /><span>还没有自定义背景</span></div>}<div className="background-actions"><label className={`upload-button ${backgroundBusy ? "disabled" : ""}`} aria-label={settings.backgroundUrl ? "更换背景图片" : "选择背景图片"}><Crop size={18} />{settings.backgroundUrl ? "更换并裁选图片" : "选择并裁选图片"}<input aria-label="选择背景图片" type="file" accept="image/jpeg,image/png,image/webp,image/gif" disabled={backgroundBusy} onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) chooseImage(file, "background"); }} /></label>{settings.backgroundUrl && <button className="button secondary background-remove" disabled={backgroundBusy} onClick={() => void clearBackground()}><Trash2 size={17} />移除背景</button>}</div><small className="background-hint">支持 JPEG、PNG、WebP、GIF，最大 5MB；上传前可调缩放和位置</small>{backgroundError && <p className="background-error" role="alert">{backgroundError}</p>}</div></section>
    <section className="settings-card"><div className="settings-title"><Filter size={20} /><div><h2>待办分类</h2><p>系统自带分类也可以修改名称和颜色；至少保留一个分类</p></div></div><div className="manage-list">{data.categories.map((category) => <CategorySettingRow key={category.id} category={category} canDelete={data.categories.length > 1} onSave={updateCategory} onDelete={deleteCategory} />)}</div><div className="inline-form"><input value={categoryName} maxLength={12} onChange={(event) => setCategoryName(event.target.value)} placeholder="新增分类，如：游戏" /><button className="button secondary" disabled={!categoryName.trim()} onClick={() => void addCategory()}><Plus size={17} />添加</button></div></section>
    <section className="settings-card"><div className="settings-title"><Bell size={20} /><div><h2>自定义提示时间</h2><p>每个提醒组都能改名、增删并自定义多个提前时间</p></div></div><div className="manage-list">{data.reminderPresets.map((preset) => <PresetSettingRow key={preset.id} preset={preset} canDelete={data.reminderPresets.length > 1} onSave={updatePreset} onDelete={deletePreset} />)}</div><small className="input-hint">支持“7天, 3小时, 10分钟”或直接填写分钟数，最多 8 个时间点。</small><div className="inline-form three"><input value={presetName} maxLength={20} onChange={(event) => setPresetName(event.target.value)} placeholder="提醒组名称，如：考试" /><input value={offset} onChange={(event) => setOffset(event.target.value)} placeholder="7天, 1天, 1小时" /><button className="button secondary" disabled={!presetName.trim() || !parseOffsets(offset).length} onClick={() => void addPreset()}>添加</button></div></section>
  </div>{cropModal}</>;
}
