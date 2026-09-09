import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, readdir, unlink, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBackupKey, transformBackup } from "./backup-crypto.mjs";

test("encrypted backups restore exactly and reject tampering, wrong keys and overwrites", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jishi-crypto-test-"));
  const path = name => join(dir, name);
  try {
    await createBackupKey(path("key")); await createBackupKey(path("other-key"));
    await assert.rejects(createBackupKey(path("key")));
    const data = Buffer.from("private diary\n".repeat(100000));
    await writeFile(path("data"), data);
    await transformBackup("encrypt",path("data"),path("encrypted"),path("key"));
    const encrypted = await readFile(path("encrypted"));
    assert.ok(!encrypted.includes(Buffer.from("private diary")));
    await transformBackup("decrypt",path("encrypted"),path("restored"),path("key"));
    assert.deepEqual(await readFile(path("restored")),data);
    await assert.rejects(transformBackup("decrypt",path("encrypted"),path("restored"),path("key")));
    await assert.rejects(transformBackup("decrypt",path("encrypted"),path("bad-key-output"),path("other-key")));
    encrypted[30] ^= 1; await writeFile(path("tampered"),encrypted);
    await assert.rejects(transformBackup("decrypt",path("tampered"),path("bad-output"),path("key")));
    await assert.rejects(readFile(path("bad-output")));
    assert.ok(!(await readdir(dir)).some(name => name.endsWith(".partial")));
    await writeFile(path("empty"),Buffer.alloc(0));
    await transformBackup("encrypt",path("empty"),path("empty-encrypted"),path("key"));
    await transformBackup("decrypt",path("empty-encrypted"),path("empty-restored"),path("key"));
    assert.equal((await readFile(path("empty-restored"))).length,0);
  } finally {
    // Only exact files inside this freshly created test directory; no recursion.
    for (const name of await readdir(dir)) await unlink(path(name));
    await rmdir(dir);
  }
});
