import { env } from "cloudflare:workers";
import { apiUser, json, unauthorized } from "../_lib";

function safeKind(value: string | null) {
  return value === "avatar" ? "avatar" : "background";
}

export async function PUT(request: Request) {
  const user = await apiUser(request);
  if (!user) return unauthorized();
  if (!env.MEDIA) return json({ error: "图片存储暂不可用" }, 503);
  const kind = safeKind(new URL(request.url).searchParams.get("kind"));
  const contentType = request.headers.get("content-type") || "image/jpeg";
  if (!contentType.startsWith("image/")) return json({ error: "只支持图片文件" }, 400);
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > 5 * 1024 * 1024) return json({ error: "图片不能超过 5MB" }, 413);
  const key = `users/${user.userId}/${kind}`;
  await env.MEDIA.put(key, bytes, { httpMetadata: { contentType } });
  return json({ url: `/api/media?kind=${kind}&v=${Date.now()}` });
}

export async function GET(request: Request) {
  const user = await apiUser(request);
  if (!user) return unauthorized();
  if (!env.MEDIA) return new Response(null, { status: 404 });
  const kind = safeKind(new URL(request.url).searchParams.get("kind"));
  const object = await env.MEDIA.get(`users/${user.userId}/${kind}`);
  if (!object) return new Response(null, { status: 404 });
  return new Response(object.body, { headers: { "Content-Type": object.httpMetadata?.contentType || "image/jpeg", "Cache-Control": "private, max-age=3600" } });
}
