// Login against an existing users sheet, and a signed session cookie.
// No passwords are stored by the board: each login re-reads the users sheet.

import type { Grid } from "./rules";

export const SESSION_COOKIE = "jb_session";

export interface UsersConfig {
  usernameHeaders: string[]; // header text that names the username column (case-insensitive)
  passwordHeaders: string[];
  activeHeaders?: string[]; // optional column; "No" / "N" / "False" / "0" / "Inactive" blocks that user
  allowlist: string[]; // if non-empty, only these usernames may log in
}

const norm = (v: unknown) => (v == null ? "" : String(v).trim().toLowerCase().replace(/\s+/g, " "));

const INACTIVE = new Set(["no", "n", "false", "0", "inactive", "disabled", "blocked"]);

/** Constant-time string comparison. */
export function safeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}

/** Locate the header row (first 9 rows) and the username / password columns. */
export function findUserColumns(
  grid: Grid,
  c: UsersConfig,
): { row: number; user: number; pass: number; active: number } | null {
  const uh = c.usernameHeaders.map(norm);
  const ph = c.passwordHeaders.map(norm);
  for (let r = 0; r < Math.min(9, grid.length); r++) {
    const cells = (grid[r] ?? []).map(norm);
    const user = cells.findIndex((h) => uh.includes(h));
    const pass = cells.findIndex((h) => ph.includes(h));
    const ah = (c.activeHeaders ?? []).map(norm);
    if (user >= 0 && pass >= 0) return { row: r, user, pass, active: cells.findIndex((h) => ah.includes(h)) };
  }
  return null;
}

/**
 * Returns the username as written in the sheet if the credentials match, else null.
 * Usernames match case-insensitively; passwords must match exactly.
 */
export function checkLogin(grid: Grid, c: UsersConfig, username: string, password: string): string | null {
  const cols = findUserColumns(grid, c);
  if (!cols) throw new Error("Users sheet: could not find the username and password columns.");
  const want = norm(username);
  if (!want || !password) return null;
  if (c.allowlist.length && !c.allowlist.map(norm).includes(want)) return null;
  let found: string | null = null;
  for (let r = cols.row + 1; r < grid.length; r++) {
    const row = grid[r] ?? [];
    const u = row[cols.user];
    const p = row[cols.pass] == null ? "" : String(row[cols.pass]);
    const active = cols.active < 0 || !INACTIVE.has(norm(row[cols.active]));
    // compare every row so timing doesn't reveal which usernames exist
    if (norm(u) === want && p !== "" && safeEqual(p, password) && active && found === null) found = String(u).trim();
  }
  return found;
}

// ---------------------------------------------------------------- session cookie

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
}

async function hmac(secret: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data)));
}

export async function signSession(secret: string, user: string, nowMs: number, ttlHours: number): Promise<string> {
  const payload = b64url(new TextEncoder().encode(JSON.stringify({ u: user, exp: nowMs + ttlHours * 3_600_000 })));
  return `${payload}.${b64url(await hmac(secret, payload))}`;
}

/** Returns the username if the token is genuine and unexpired, else null. */
export async function verifySession(secret: string, token: string | null | undefined, nowMs: number): Promise<string | null> {
  if (!token || !secret) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  if (!safeEqual(b64url(await hmac(secret, payload)), sig)) return null;
  try {
    const { u, exp } = JSON.parse(new TextDecoder().decode(fromB64url(payload))) as { u: string; exp: number };
    return typeof u === "string" && exp > nowMs ? u : null;
  } catch {
    return null;
  }
}

export function readCookie(header: string | null, name: string): string | null {
  for (const part of (header ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}
