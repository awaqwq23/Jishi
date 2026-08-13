function uniqueUrls(values) {
  return [...new Set(values.filter(Boolean).map((value) => new URL(value).origin))];
}

async function isJishiHost(baseUrl, fetchImpl, timeoutMs = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(new URL("/health", baseUrl), {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) return false;
    const health = await response.json();
    return health?.status === "ok" && health?.service === "jishi-api";
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function resolveAppUrl(candidates, fetchImpl, timeoutMs) {
  const urls = uniqueUrls(candidates);
  for (const url of urls) {
    if (await isJishiHost(url, fetchImpl, timeoutMs)) return url;
  }
  throw new Error("没有可用的记时服务器");
}

module.exports = { isJishiHost, resolveAppUrl, uniqueUrls };
