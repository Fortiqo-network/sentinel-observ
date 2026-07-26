/**
 * Dashboard access control.
 *
 * Edge-runtime compatible: everything here uses WebCrypto only, because the
 * gate runs in `middleware.ts` where Node's `crypto` module is unavailable.
 *
 * The password is never stored — only a PBKDF2-SHA256 hash, in the
 * `DASHBOARD_PASSWORD_HASH` env var, formatted `pbkdf2:iterations:salt:hash`
 * (salt and hash base64). Verification runs once at login; every subsequent
 * request is authenticated by a short HMAC-signed cookie, so the expensive KDF
 * is not on the hot path.
 *
 * The separator is `:` rather than the conventional `$` because dotenv performs
 * variable expansion: a `$210000` segment silently expands to an empty string
 * in `.env` files, producing a hash that can never match and a login that fails
 * with no visible cause. Base64 never emits `:`, so it is unambiguous.
 */

const encoder = new TextEncoder();

export const SESSION_COOKIE = "observ_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 14;

/** True when a password hash is configured. Without one the gate fails closed. */
export function isAuthConfigured(): boolean {
  return Boolean(process.env.DASHBOARD_PASSWORD_HASH);
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  // Re-pad: session signatures are stored base64url without trailing '=',
  // and atob rejects an unpadded string.
  const padded = value + "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Constant-time comparison, so a wrong password leaks no prefix information. */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** Check a submitted password against `DASHBOARD_PASSWORD_HASH`. */
export async function verifyPassword(candidate: string): Promise<boolean> {
  const stored = process.env.DASHBOARD_PASSWORD_HASH;
  if (!stored) return false;

  const [scheme, iterationsRaw, saltB64, hashB64] = stored.split(":");
  if (scheme !== "pbkdf2" || !iterationsRaw || !saltB64 || !hashB64) return false;

  const iterations = Number(iterationsRaw);
  if (!Number.isFinite(iterations) || iterations < 1) return false;

  const expected = base64ToBytes(hashB64);
  const key = await crypto.subtle.importKey("raw", encoder.encode(candidate), "PBKDF2", false, [
    "deriveBits",
  ]);
  const derived = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "PBKDF2", salt: base64ToBytes(saltB64), iterations, hash: "SHA-256" },
      key,
      expected.length * 8,
    ),
  );

  return timingSafeEqual(derived, expected);
}

/**
 * The signing key for session cookies is derived from the password hash rather
 * than from a separate secret: it is already server-side-only and unique per
 * deployment, and it means changing the password invalidates every existing
 * session for free.
 */
async function signingKey(): Promise<CryptoKey> {
  const secret = process.env.DASHBOARD_PASSWORD_HASH ?? "";
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(`observ-session:${secret}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

/** Mint a signed `expiry.signature` session token. */
export async function createSessionToken(): Promise<string> {
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const payload = String(expiresAt);
  const signature = await crypto.subtle.sign("HMAC", await signingKey(), encoder.encode(payload));
  return `${payload}.${bytesToBase64Url(new Uint8Array(signature))}`;
}

/** Validate a session cookie: signature must match and the token must not be expired. */
export async function verifySessionToken(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const separator = token.lastIndexOf(".");
  if (separator <= 0) return false;

  const payload = token.slice(0, separator);
  const expiresAt = Number(payload);
  if (!Number.isFinite(expiresAt) || expiresAt * 1000 < Date.now()) return false;

  const expected = await crypto.subtle.sign("HMAC", await signingKey(), encoder.encode(payload));
  return timingSafeEqual(
    base64ToBytes(token.slice(separator + 1).replace(/-/g, "+").replace(/_/g, "/")),
    new Uint8Array(expected),
  );
}

/**
 * Cookie attributes for the session.
 *
 * `secure` is off outside production only because `next dev` serves plain HTTP
 * on localhost, where a Secure cookie is never sent back and login appears to
 * silently fail. Every deployed environment is HTTPS and therefore gets it.
 */
export const sessionCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/",
  maxAge: SESSION_TTL_SECONDS,
} as const;
