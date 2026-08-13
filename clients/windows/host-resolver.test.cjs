const test = require("node:test");
const assert = require("node:assert/strict");
const { isJishiHost, resolveAppUrl, uniqueUrls } = require("./host-resolver.cjs");

test("normalizes and de-duplicates candidate origins", () => {
  assert.deepEqual(uniqueUrls(["https://example.com/note", "https://example.com/note/", "https://backup.example"]), [
    "https://example.com/note/",
    "https://backup.example/",
  ]);
});

test("rejects a healthy-looking response from an unrelated service", async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => ({ status: "ok", service: "heartbeat" }) });
  assert.equal(await isJishiHost("https://wrong.example", fetchImpl), false);
});

test("falls back when the primary domain is not the Jishi API", async () => {
  const fetchImpl = async (url) => ({
    ok: url.origin === "https://working.example",
    json: async () => ({ status: "ok", service: "jishi-api" }),
  });
  assert.equal(
    await resolveAppUrl(["https://wrong.example", "https://working.example"], fetchImpl),
    "https://working.example/",
  );
});

test("checks health relative to a subpath deployment", async () => {
  let requested;
  const fetchImpl = async (url) => { requested = url.toString(); return { ok: true, json: async () => ({ status: "ok", service: "jishi-api" }) }; };
  assert.equal(await isJishiHost("https://example.com/note/", fetchImpl), true);
  assert.equal(requested, "https://example.com/note/health");
});
