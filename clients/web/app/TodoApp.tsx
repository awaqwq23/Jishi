"use client";

import {
  ArchiveRestore, Bell, Check, ChevronRight, CircleUserRound,
  Clock3, Filter, ImagePlus, LayoutList, Menu, MoreHorizontal,
  Palette, Pencil, Plus, RotateCcw, Search, Settings, SlidersHorizontal,
  Sparkles, Trash2, UserRound, X,
} from "lucide-react";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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

const priorityMeta: Record<Priority, { label: string; hint: string }> = {
  low: { label: "不重要", hint: "慢慢来" },
  normal: { label: "一般", hint: "照常安排" },
  important: { label: "较重要", hint: "优先处理" },
  urgent: { label: "很重要", hint: "尽快完成" },
};
const defaultSettings: SettingsShape = { theme: "linen", accent: "#d96f4b", cardOpacity: 92, acrylic: true };

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
  const base = process.env.NEXT_PUBLIC_API_URL || "";
  const response = await fetch(`${base}${url}`, { ...init, credentials: "include", headers: { "Content-Type": "application/json", ...(init?.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "操作没有完成，请稍后重试");
  return data as T;
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
  return <aside className="detail-panel">
    <div className="detail-handle" />
    <header className="detail-head"><span className={`status-badge status-${todo.status}`}>{todo.status === "active" ? "未完成" : todo.status === "completed" ? "已完成" : "回收站"}</span><button className="icon-button" onClick={onClose} aria-label="关闭详情"><X size={20} /></button></header>
    <div className="detail-body"><h2>{todo.title}</h2>{todo.content ? <p className="detail-content">{todo.content}</p> : <p className="detail-muted">没有补充内容</p>}
      <dl className="detail-list"><div><dt>截止时间</dt><dd>{fullDate(todo.deadline)}</dd></div><div><dt>提示时间</dt><dd>{preset ? `${preset.name}（${preset.offsets.map((n) => n >= 1440 ? `${n / 1440}天前` : n >= 60 ? `${n / 60}小时前` : `${n}分钟前`).join("、")}）` : "不提醒"}</dd></div><div><dt>待办分类</dt><dd><span className="tiny-dot" style={{ background: category?.color }} />{category?.name || "默认"}</dd></div><div><dt>重要程度</dt><dd>{priorityMeta[todo.priority].label}</dd></div><div><dt>创建时间</dt><dd>{fullDate(todo.createdAt)}</dd></div>{todo.completedAt && <div><dt>完成时间</dt><dd>{fullDate(todo.completedAt)}</dd></div>}{todo.deletedAt && <div><dt>删除时间</dt><dd>{fullDate(todo.deletedAt)}</dd></div>}</dl>
      <section className="note-box"><span>备注</span><p>{todo.notes || "无"}</p></section>
    </div>
    <footer className="detail-actions">{todo.status === "deleted" ? <><button className="button secondary" onClick={() => onStatus("active")}><RotateCcw size={17} />恢复</button><button className="button danger" onClick={onDeleteForever}><Trash2 size={17} />永久删除</button></> : <><button className="button secondary" onClick={onEdit}><Pencil size={17} />编辑</button><button className="button primary" onClick={() => onStatus(todo.status === "completed" ? "active" : "completed")}><Check size={17} />{todo.status === "completed" ? "重新打开" : "标记完成"}</button><button className="icon-button danger-quiet" onClick={() => onStatus("deleted")} aria-label="移入回收站"><Trash2 size={19} /></button></>}</footer>
  </aside>;
}

function AuthScreen({ onAuthenticated }: { onAuthenticated: () => Promise<void> }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [name, setName] = useState("");
  const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      await api(`/api/auth/${mode}`, { method: "POST", body: JSON.stringify({ email, password, name }) });
      await onAuthenticated();
    } catch (err) { setMessage(err instanceof Error ? err.message : "登录失败，请稍后重试"); }
    finally { setBusy(false); }
  };
  return <main className="signin-screen"><div className="brand-mark">记</div><span className="eyebrow">欢迎来到记时</span><h1>把今天，安放得刚刚好。</h1><p>使用邮箱创建自己的空间，待办、提醒与个人设置会在各端保持一致。</p><form className="auth-form" onSubmit={(event) => void submit(event)}>{mode === "register" && <label><span>昵称</span><input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" maxLength={24} required placeholder="怎么称呼你" /></label>}<label><span>邮箱</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required placeholder="name@example.com" /></label><label><span>密码</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={8} maxLength={128} required placeholder="至少 8 位" /></label>{message && <div className="auth-error">{message}</div>}<button className="button primary" disabled={busy}>{busy ? "请稍候…" : mode === "login" ? "登录" : "注册并登录"}</button></form><button className="auth-switch" onClick={() => { setMode((value) => value === "login" ? "register" : "login"); setMessage(""); }}>{mode === "login" ? "还没有账号？创建一个" : "已有账号？直接登录"}</button></main>;
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

  const load = useCallback(async () => {
    try { setError(""); setData(await api<Bootstrap>("/api/bootstrap")); }
    catch (err) { setError(err instanceof Error ? err.message : "暂时无法同步数据"); }
  }, []);
  useEffect(() => { queueMicrotask(() => void load()); if ("serviceWorker" in navigator) void navigator.serviceWorker.register("/sw.js"); }, [load]);
  useEffect(() => {
    if (!data || Notification.permission !== "granted") return;
    const check = () => {
      const now = Date.now();
      data.todos.filter((todo) => todo.status === "active" && todo.deadline).forEach((todo) => {
        const deadline = new Date(todo.deadline!).getTime();
        if (deadline < now && deadline > now - 60_000) new Notification(`待办已逾期：${todo.title}`, { body: "它还没有完成，点此回到记时。", icon: "/favicon.svg" });
        todo.reminderOffsets.forEach((minutes) => { const moment = deadline - minutes * 60_000; if (moment <= now && moment > now - 60_000) new Notification(todo.title, { body: `${dateTime(todo.deadline)} 截止`, icon: "/favicon.svg" }); });
      });
    };
    check(); const timer = window.setInterval(check, 60_000); return () => window.clearInterval(timer);
  }, [data]);

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
    setData({ ...data, user: result.user }); flash("设置已同步");
  };
  const uploadImage = async (file: File, kind: "avatar" | "background") => {
    const base = process.env.NEXT_PUBLIC_API_URL || "";
    const response = await fetch(`${base}/api/media?kind=${kind}`, { method: "PUT", credentials: "include", headers: { "Content-Type": file.type }, body: file });
    const result = await response.json(); if (!response.ok) throw new Error(result.error);
    if (kind === "avatar") await saveProfile({ avatarUrl: result.url });
    else await saveProfile({ settings: { ...settings, backgroundUrl: result.url } });
  };

  if (!data && error.includes("登录")) return <AuthScreen onAuthenticated={load} />;
  if (!data) return <main className="loading-screen"><div className="brand-mark pulse">记</div><p>{error || "正在整理你的今天…"}</p>{error && <button className="button secondary" onClick={() => void load()}>重新连接</button>}</main>;

  const categoryMap = new Map(data.categories.map((item) => [item.id, item]));
  const presetMap = new Map(data.reminderPresets.map((item) => [item.id, item]));
  const activeCount = data.todos.filter((todo) => todo.status === "active").length;
  const todayLabel = new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "long" }).format(new Date());
  return <div className={`app-shell acrylic-${settings.acrylic}`} style={{ "--accent": settings.accent, "--app-background-image": settings.backgroundUrl ? `url(${settings.backgroundUrl})` : "none" } as React.CSSProperties}>
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark small">记</span><div><strong>记时</strong><small>把今天安放好</small></div></div>
      <nav className="side-nav" aria-label="主导航"><button className={section === "todos" ? "active" : ""} onClick={() => setSection("todos")}><LayoutList size={19} /><span>待办</span><b>{activeCount}</b></button><button className={section === "mine" ? "active" : ""} onClick={() => setSection("mine")}><CircleUserRound size={19} /><span>我的</span></button></nav>
      <div className="sidebar-groups"><span>快捷查看</span><button onClick={() => { setSection("todos"); setStatusFilter("completed"); }}><Check size={17} />已完成</button><button onClick={() => setSection("trash")}><Trash2 size={17} />回收站</button><button onClick={() => setSection("settings")}><Settings size={17} />设置</button></div>
      <div className="sidebar-profile"><span className="avatar">{data.user.avatarUrl ? <Image src={`${process.env.NEXT_PUBLIC_API_URL || ""}${data.user.avatarUrl}`} alt="用户头像" fill sizes="38px" unoptimized /> : data.user.name.slice(0, 1)}</span><div><strong>{data.user.name}</strong><small>已同步</small></div><ChevronRight size={17} /></div>
    </aside>

    <main className="main-surface">
      {(section === "todos" || section === "trash") && <>
        <header className="topbar"><div><span className="eyebrow">{section === "trash" ? "30 天内可恢复" : todayLabel}</span><h1>{section === "trash" ? "回收站" : statusFilter === "active" ? "今天，先做什么？" : "完成记录"}</h1></div><div className="top-actions"><button className="icon-button mobile-menu" aria-label="菜单"><Menu size={21} /></button><button className="button notification-button" onClick={async () => { if (Notification.permission === "default") await Notification.requestPermission(); flash(Notification.permission === "granted" ? "提醒已开启" : "未获得通知权限"); }}><Bell size={18} /><span>提醒</span></button>{section !== "trash" && <button className="button primary desktop-add" onClick={() => setEditor("new")}><Plus size={19} />新建待办</button>}</div></header>
        {section !== "trash" && <div className="status-tabs"><button className={statusFilter === "active" ? "active" : ""} onClick={() => setStatusFilter("active")}>未完成 <span>{activeCount}</span></button><button className={statusFilter === "completed" ? "active" : ""} onClick={() => setStatusFilter("completed")}>已完成 <span>{data.todos.filter((todo) => todo.status === "completed").length}</span></button></div>}
        <div className="filter-row"><label className="search-box"><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标题、内容或备注" /><kbd>⌘ K</kbd></label><button className={`filter-button ${filtersOpen ? "active" : ""}`} onClick={() => setFiltersOpen((value) => !value)}><SlidersHorizontal size={18} />筛选</button></div>
        {filtersOpen && <div className="filter-panel"><label><span>分类</span><select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}><option value="">全部分类</option>{data.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label><label><span>重要程度</span><select value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)}><option value="">全部程度</option>{Object.entries(priorityMeta).map(([key, meta]) => <option key={key} value={key}>{meta.label}</option>)}</select></label><label><span>截止范围</span><select value={dateFilter} onChange={(event) => setDateFilter(event.target.value)}><option value="all">全部时间</option><option value="today">今天截止</option><option value="week">7 天内</option><option value="overdue">已逾期</option></select></label><button className="text-button" onClick={() => { setCategoryFilter(""); setPriorityFilter(""); setDateFilter("all"); }}><RotateCcw size={15} />重置</button></div>}
        <section className="task-list" aria-live="polite">{visibleTodos.length ? visibleTodos.map((todo) => <SwipeTask key={todo.id} todo={todo} category={todo.categoryId ? categoryMap.get(todo.categoryId) : undefined} onOpen={() => setSelectedId(todo.id)} onStatus={(status) => void mutateTodo(todo.id, { status })} cardOpacity={settings.cardOpacity} acrylic={settings.acrylic} />) : <EmptyState kind={section === "trash" ? "deleted" : statusFilter} />}</section>
      </>}
      {(section === "mine" || section === "settings") && <ProfileSettings data={data} settings={settings} section={section} onSection={setSection} onSaveProfile={saveProfile} onUpload={uploadImage} setData={setData} flash={flash} />}
      {selected && <DetailPanel todo={selected} category={selected.categoryId ? categoryMap.get(selected.categoryId) : undefined} preset={selected.reminderPresetId ? presetMap.get(selected.reminderPresetId) : undefined} onClose={() => setSelectedId(null)} onEdit={() => setEditor(selected)} onStatus={(status) => void mutateTodo(selected.id, { status })} onDeleteForever={() => void deleteForever(selected)} />}
    </main>

    <nav className="bottom-nav" aria-label="移动端主导航"><button className={section === "todos" || section === "trash" ? "active" : ""} onClick={() => setSection("todos")}><LayoutList size={22} /><span>待办</span></button><button className="floating-add" onClick={() => setEditor("new")} aria-label="新建待办"><Plus size={26} /></button><button className={section === "mine" || section === "settings" ? "active" : ""} onClick={() => setSection("mine")}><UserRound size={22} /><span>我的</span></button></nav>
    {editor && <TodoEditor initial={editor === "new" ? undefined : editor} categories={data.categories} presets={data.reminderPresets} onClose={() => setEditor(null)} onSave={(value) => void saveTodo(value)} saving={saving} />}
    {notice && <div className="toast"><Check size={17} />{notice}</div>}{error && <div className="error-toast"><span>{error}</span><button onClick={() => setError("")} aria-label="关闭错误"><X size={16} /></button></div>}
  </div>;
}

function ProfileSettings({ data, settings, section, onSection, onSaveProfile, onUpload, setData, flash }: {
  data: Bootstrap; settings: SettingsShape; section: "mine" | "settings"; onSection: (value: "mine" | "settings" | "trash") => void;
  onSaveProfile: (patch: { name?: string; settings?: SettingsShape; avatarUrl?: string }) => Promise<void>;
  onUpload: (file: File, kind: "avatar" | "background") => Promise<void>; setData: React.Dispatch<React.SetStateAction<Bootstrap | null>>; flash: (message: string) => void;
}) {
  const [name, setName] = useState(data.user.name); const [categoryName, setCategoryName] = useState(""); const [presetName, setPresetName] = useState(""); const [offset, setOffset] = useState("60");
  const addCategory = async () => { const result = await api<{ category: Category }>("/api/categories", { method: "POST", body: JSON.stringify({ name: categoryName }) }); setData((old) => old ? ({ ...old, categories: [...old.categories, result.category] }) : old); setCategoryName(""); flash("分类已添加"); };
  const addPreset = async () => { const result = await api<{ preset: Preset }>("/api/presets", { method: "POST", body: JSON.stringify({ name: presetName, offsets: offset.split(/[,，]/).map(Number) }) }); setData((old) => old ? ({ ...old, reminderPresets: [...old.reminderPresets, result.preset] }) : old); setPresetName(""); flash("提醒组已添加"); };
  if (section === "mine") return <div className="profile-page"><header className="topbar"><div><span className="eyebrow">个人中心</span><h1>我的</h1></div></header><section className="profile-hero"><label className="avatar large" aria-label="更换头像">{data.user.avatarUrl ? <Image src={`${process.env.NEXT_PUBLIC_API_URL || ""}${data.user.avatarUrl}`} alt="用户头像" fill sizes="80px" unoptimized /> : data.user.name.slice(0, 1)}<input aria-label="选择头像图片" type="file" accept="image/*" onChange={(event) => event.target.files?.[0] && void onUpload(event.target.files[0], "avatar")} /><span><ImagePlus size={15} /></span></label><div><h2>{data.user.name}</h2><p>{data.user.email}</p><span className="sync-badge"><Check size={14} />云端同步正常</span></div></section><section className="quick-grid"><button onClick={() => onSection("settings")}><span><Palette size={20} /></span><div><strong>外观与设置</strong><small>主题、卡片与提醒</small></div><ChevronRight size={18} /></button><button onClick={() => onSection("trash")}><span><ArchiveRestore size={20} /></span><div><strong>回收站</strong><small>{data.todos.filter((todo) => todo.status === "deleted").length} 个待办</small></div><ChevronRight size={18} /></button></section><section className="insight-card"><span className="eyebrow">本周小结</span><div><strong>{data.todos.filter((todo) => todo.status === "completed").length}</strong><p>件事情已经妥善完成。保持自己的节奏，就很好。</p></div></section><button className="button secondary signout" onClick={async () => { await api("/api/auth/logout", { method: "POST" }); window.location.reload(); }}>退出当前账号</button></div>;
  return <div className="settings-page"><header className="topbar"><div><span className="eyebrow">只属于你的记时</span><h1>设置</h1></div></header>
    <section className="settings-card"><div className="settings-title"><UserRound size={20} /><div><h2>个人资料</h2><p>修改后会同步到所有设备</p></div></div><div className="inline-form"><input value={name} maxLength={24} onChange={(event) => setName(event.target.value)} /><button className="button primary" onClick={() => void onSaveProfile({ name })}>保存姓名</button></div></section>
    <section className="settings-card"><div className="settings-title"><Palette size={20} /><div><h2>主题与背景</h2><p>选择一套让你舒服的界面</p></div></div><div className="theme-options">{(["linen", "sage", "night"] as const).map((theme) => <button key={theme} className={`${theme} ${settings.theme === theme ? "selected" : ""}`} onClick={() => void onSaveProfile({ settings: { ...settings, theme } })}><span /><b>{theme === "linen" ? "暖白" : theme === "sage" ? "青苔" : "夜墨"}</b></button>)}</div><div className="setting-line"><div><strong>主题色</strong><small>按钮与强调内容</small></div><input aria-label="选择主题色" type="color" value={settings.accent} onChange={(event) => void onSaveProfile({ settings: { ...settings, accent: event.target.value } })} /></div><div className="setting-line"><div><strong>亚克力效果</strong><small>为卡片添加轻柔的背景模糊</small></div><button role="switch" aria-checked={settings.acrylic} className={`switch ${settings.acrylic ? "on" : ""}`} onClick={() => void onSaveProfile({ settings: { ...settings, acrylic: !settings.acrylic } })}><span /></button></div><label className="range-line" aria-label="卡片透明度"><span><strong>卡片透明度</strong><small>{settings.cardOpacity}%</small></span><input aria-label="卡片透明度" type="range" min="55" max="100" value={settings.cardOpacity} onChange={(event) => void onSaveProfile({ settings: { ...settings, cardOpacity: Number(event.target.value) } })} /></label><label className="upload-button" aria-label="选择背景图片"><ImagePlus size={18} />选择背景图片<input aria-label="选择背景图片" type="file" accept="image/*" onChange={(event) => event.target.files?.[0] && void onUpload(event.target.files[0], "background")} /></label></section>
    <section className="settings-card"><div className="settings-title"><Filter size={20} /><div><h2>待办分类</h2><p>默认分类会一直保留</p></div></div><div className="chip-list">{data.categories.map((category) => <span key={category.id}><i style={{ background: category.color }} />{category.name}</span>)}</div><div className="inline-form"><input value={categoryName} maxLength={12} onChange={(event) => setCategoryName(event.target.value)} placeholder="新增分类，如：游戏" /><button className="button secondary" disabled={!categoryName.trim()} onClick={() => void addCategory()}><Plus size={17} />添加</button></div></section>
    <section className="settings-card"><div className="settings-title"><Bell size={20} /><div><h2>自定义提示时间</h2><p>时间单位为分钟，可用逗号分隔</p></div></div><div className="preset-list">{data.reminderPresets.map((preset) => <div key={preset.id}><span>{preset.name}</span><small>{preset.offsets.map((n) => n >= 1440 ? `${n / 1440} 天` : n >= 60 ? `${n / 60} 小时` : `${n} 分钟`).join("、")}前</small></div>)}</div><div className="inline-form three"><input value={presetName} onChange={(event) => setPresetName(event.target.value)} placeholder="如：考试" /><input value={offset} onChange={(event) => setOffset(event.target.value)} placeholder="10080,1440" /><button className="button secondary" disabled={!presetName.trim()} onClick={() => void addPreset()}>添加</button></div></section>
  </div>;
}
