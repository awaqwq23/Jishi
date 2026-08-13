export function runtimeBasePath() {
  if (typeof window === "undefined") return "";
  return /^\/note(?:\/|$)/.test(window.location.pathname) ? "/note" : "";
}

export function withRuntimeBase(path: string) {
  if (/^(?:[a-z]+:)?\/\//i.test(path) || path.startsWith("data:")) return path;
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${runtimeBasePath()}${normalized}`;
}

export function apiUrl(path: string) {
  const configured = (process.env.NEXT_PUBLIC_API_URL || "").replace(/\/$/, "");
  return `${configured || runtimeBasePath()}${path.startsWith("/") ? path : `/${path}`}`;
}
