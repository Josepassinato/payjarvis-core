/**
 * Vault Crypto — AES-256-CBC encryption for session cookies
 */

import crypto from "crypto";

const ENCRYPTION_KEY = process.env.VAULT_ENCRYPTION_KEY;

if (!ENCRYPTION_KEY || ENCRYPTION_KEY.length !== 64) {
  console.error(
    "[VAULT] VAULT_ENCRYPTION_KEY must be a 64-char hex string (32 bytes). " +
    "Generate with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
  );
}

export function encryptCookies(cookies: object): string {
  if (!ENCRYPTION_KEY) throw new Error("VAULT_ENCRYPTION_KEY not configured");

  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(
    "aes-256-cbc",
    Buffer.from(ENCRYPTION_KEY, "hex"),
    iv
  );
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(cookies)),
    cipher.final(),
  ]);
  return iv.toString("hex") + ":" + encrypted.toString("hex");
}

export function decryptCookies(encrypted: string): object {
  if (!ENCRYPTION_KEY) throw new Error("VAULT_ENCRYPTION_KEY not configured");

  const [ivHex, encHex] = encrypted.split(":");
  if (!ivHex || !encHex) throw new Error("Invalid encrypted data format");

  const iv = Buffer.from(ivHex, "hex");
  const decipher = crypto.createDecipheriv(
    "aes-256-cbc",
    Buffer.from(ENCRYPTION_KEY, "hex"),
    iv
  );
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encHex, "hex")),
    decipher.final(),
  ]);
  return JSON.parse(decrypted.toString());
}
