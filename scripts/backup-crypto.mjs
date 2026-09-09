import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, open, readFile, link, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const MAGIC = Buffer.from("JISHI-BACKUP-1\n");
const IV_BYTES = 12, TAG_BYTES = 16;
async function regular(path) {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Expected a regular non-symlink file");
  return stat;
}
async function keyBytes(path) {
  const stat = await regular(path);
  if (process.platform !== "win32" && (stat.mode & 0o777) !== 0o600) throw new Error("Backup key must have mode 600");
  const bytes = await readFile(path);
  if (bytes.length !== 32) throw new Error("Backup key must contain exactly 32 random bytes");
  return bytes;
}
export async function createBackupKey(path) {
  const file = await open(path, "wx", 0o600);
  try { await file.writeFile(randomBytes(32)); await file.sync(); } finally { await file.close(); }
}

export async function transformBackup(mode, input, output, keyPath) {
  if (!["encrypt", "decrypt"].includes(mode)) throw new Error("Expected encrypt or decrypt");
  const paths = [input, output, keyPath].map(value => resolve(value));
  if (new Set(paths).size !== 3) throw new Error("Input, output and key must use different paths");
  const stat = await regular(input), key = await keyBytes(keyPath);
  const temporary = `${output}.${randomUUID()}.partial`;
  const file = await open(temporary, "wx", 0o600);
  try {
    let cipher, start, end;
    if (mode === "encrypt") {
      const iv = randomBytes(IV_BYTES);
      cipher = createCipheriv("aes-256-gcm", key, iv);
      cipher.setAAD(MAGIC);
      await file.writeFile(Buffer.concat([MAGIC, iv]));
    } else {
      if (stat.size < MAGIC.length + IV_BYTES + TAG_BYTES) throw new Error("Truncated encrypted backup");
      const source = await open(input, "r");
      const header = Buffer.alloc(MAGIC.length + IV_BYTES), tag = Buffer.alloc(TAG_BYTES);
      try { await source.read(header, 0, header.length, 0); await source.read(tag, 0, tag.length, stat.size - TAG_BYTES); }
      finally { await source.close(); }
      if (!header.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error("Unknown backup format");
      cipher = createDecipheriv("aes-256-gcm", key, header.subarray(MAGIC.length));
      cipher.setAAD(MAGIC); cipher.setAuthTag(tag);
      start = header.length; end = stat.size - TAG_BYTES - 1;
    }
    if (end === undefined || end >= start) {
      for await (const chunk of createReadStream(input, { start, end })) await file.writeFile(cipher.update(chunk));
    }
    await file.writeFile(cipher.final());
    if (mode === "encrypt") await file.writeFile(cipher.getAuthTag());
    await file.sync(); await file.close();
    // Exclusive publication: never replace an existing backup or restore file.
    // Decrypted output is published only after GCM authentication succeeds.
    await link(temporary, output);
  } finally {
    key.fill(0);
    await file.close().catch(() => {});
    await unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error; });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [mode, ...args] = process.argv.slice(2);
  try {
    if (mode === "create-key" && args.length === 1) await createBackupKey(args[0]);
    else if (["encrypt", "decrypt"].includes(mode) && args.length === 3) await transformBackup(mode, ...args);
    else throw new Error("Usage: backup-crypto.mjs create-key <keyfile> | encrypt|decrypt <input> <output> <keyfile>");
    console.log("Backup operation completed");
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
