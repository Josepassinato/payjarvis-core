/**
 * Zero-Knowledge Vault — AES-256-GCM encryption with user-derived keys
 *
 * The user's PIN/passphrase is NEVER stored. Only a verification hash and salt
 * are persisted. The encryption key is derived at runtime from the PIN via PBKDF2.
 */

import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const PBKDF2_ITERATIONS = 100_000;
const SALT_LENGTH = 32;
const IV_LENGTH = 16;
const KEY_LENGTH = 32;

/** Derive an AES-256 key from a PIN/passphrase and salt using PBKDF2-SHA512 */
export function deriveKey(pin: string, salt: Buffer): Buffer {
  return crypto.pbkdf2Sync(pin, salt, PBKDF2_ITERATIONS, KEY_LENGTH, "sha512");
}

/** Generate a unique salt for a user (stored in DB, not secret) */
export function generateSalt(): Buffer {
  return crypto.randomBytes(SALT_LENGTH);
}

/** Encrypt plaintext with a derived key. Returns base64 strings. */
export function encrypt(
  data: string,
  key: Buffer
): { encrypted: string; iv: string; tag: string } {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(data, "utf8", "base64");
  encrypted += cipher.final("base64");
  const tag = cipher.getAuthTag();
  return {
    encrypted,
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
  };
}

/** Decrypt ciphertext with a derived key */
export function decrypt(
  encryptedData: string,
  key: Buffer,
  iv: string,
  tag: string
): string {
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(iv, "base64")
  );
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  let decrypted = decipher.update(encryptedData, "base64", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

/** Hash the PIN for verification (separate from encryption key derivation) */
export function hashPin(pin: string, salt: Buffer): string {
  return crypto
    .pbkdf2Sync(pin, Buffer.concat([salt, Buffer.from("verify")]), PBKDF2_ITERATIONS, 64, "sha512")
    .toString("hex");
}

/** Validate PIN format: 4-32 characters */
export function validatePin(pin: string): { valid: boolean; error?: string } {
  if (!pin || typeof pin !== "string") return { valid: false, error: "PIN is required" };
  if (pin.length < 4) return { valid: false, error: "PIN must be at least 4 characters" };
  if (pin.length > 32) return { valid: false, error: "PIN must be at most 32 characters" };
  return { valid: true };
}

/**
 * Mask a card number for display: "4242 4242 4242 4242" → "Visa ending 4242"
 */
export function maskCard(number: string): string {
  const cleaned = number.replace(/\D/g, "");
  const last4 = cleaned.slice(-4);
  const first = cleaned[0];
  let brand = "Card";
  if (first === "4") brand = "Visa";
  else if (first === "5") brand = "Mastercard";
  else if (first === "3") brand = "Amex";
  else if (first === "6") brand = "Discover";
  return `${brand} ending ${last4}`;
}
