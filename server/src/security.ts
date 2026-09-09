export class ApiError extends Error {
  constructor(public status: number, message: string, public retryAfter?: number) { super(message); }
}

export interface SecurityEnv {
  DB: D1Database;
  ALLOWED_ORIGINS?: string;
  TRUST_PROXY_HEADERS?: string;
  AUTH_PROXY_SECRET?: string;
}

export function allowedOrigins(env: SecurityEnv): string[] {
  return (env.ALLOWED_ORIGINS || "http://localhost:3000").split(",").map(value => value.trim()).filter(Boolean);
}

export function checkRequestOrigin(request: Request, env: SecurityEnv) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
  const origin = request.headers.get("origin");
  // Old native clients and command-line clients can omit Origin. Their session
  // cookie is still required; browser cross-origin writes are rejected.
  if (request.headers.get("sec-fetch-site") === "cross-site" && !origin) throw new ApiError(403, "请求来源不受信任");
  if (origin && !allowedOrigins(env).includes(origin)) throw new ApiError(403, "请求来源不受信任");
}

export async function readBytes(request: Request, limit: number): Promise<Uint8Array> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) throw new ApiError(413, "请求内容过大");
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new ApiError(413, "请求内容过大"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

export async function readJson(request: Request, limit = 1024 * 1024): Promise<Record<string, unknown>> {
  let value: unknown;
  try { value = JSON.parse(new TextDecoder().decode(await readBytes(request, limit))); }
  catch (error) { if (error instanceof ApiError) throw error; throw new ApiError(400, "请求必须是有效 JSON 对象"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ApiError(400, "请求必须是有效 JSON 对象");
  return value as Record<string, unknown>;
}

export async function sameSecret(left: string, right: string): Promise<boolean> {
  const digest = (value: string) => crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  const [a, b] = await Promise.all([digest(left), digest(right)]);
  const first = new Uint8Array(a), second = new Uint8Array(b);
  let difference = 0;
  for (let index = 0; index < first.length; index++) difference |= first[index] ^ second[index];
  return difference === 0;
}

export async function trustedGateway(request: Request, env: SecurityEnv): Promise<boolean> {
  const secret = env.AUTH_PROXY_SECRET;
  const supplied = request.headers.get("x-jishi-auth-proxy-secret");
  return Boolean(secret && secret.length >= 32 && supplied && supplied.length <= 256 && await sameSecret(secret, supplied));
}

export async function limitAuth(request: Request, env: SecurityEnv, email: string, kind: "login" | "register") {
  const now = Math.floor(Date.now() / 1000);
  const source = env.TRUST_PROXY_HEADERS === "true" ? request.headers.get("x-real-ip") || "unknown" : "untrusted";
  const windowSeconds = kind === "login" ? 900 : 3600;
  const bucket = Math.floor(now / windowSeconds);
  const entries: Array<[string, number]> = [[`${kind}:source:${source.slice(0, 64)}`, kind === "login" ? 120 : 20]];
  if (kind === "login") entries.push([`login:account:${email}`, 20]);
  await env.DB.prepare("DELETE FROM auth_rate_limits WHERE expires_at<=?").bind(now).run();
  for (const [identity, maximum] of entries) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(identity));
    const key = `${bucket}:${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("")}`;
    const row = await env.DB.prepare("INSERT INTO auth_rate_limits (key,attempts,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=attempts+1 RETURNING attempts")
      .bind(key, (bucket + 1) * windowSeconds).first<{ attempts: number }>();
    if (!row || row.attempts > maximum) throw new ApiError(429, "尝试过于频繁，请稍后再试", (bucket + 1) * windowSeconds - now);
  }
}
