// Users live in a Google Sheet ("Jangad Board Users"): Username, Password, Full Name, Role, Active, Notes.
// Passwords set from the admin page are stored as PBKDF2 hashes ("pbkdf2$…"); a password typed into the
// sheet by hand is plain text and still works, so the first admin can be created without the portal.
// Sessions are an HMAC-signed cookie carrying the username and role.

import type { Grid } from "./rules";

export const SESSION_COOKIE = "jb_session";

export type Role = "Admin" | "Staff";

export interface UsersConfig {
  usernameHeaders: string[]; // header text that names the username column (case-insensitive)
  passwordHeaders: string[];
  allowlist: string[]; // if non-empty, only these usernames may log in
}

export interface UserColumns {
  headerRow: number; // 0-based index into the grid
  user: number;
  pass: number;
  name: number; // -1 when the column is absent
  role: number;
  active: number;
  notes: number;
}

export interface UserRecord {
  row: number; // 1-based sheet row
  username: string;
  password: string; // as stored: plain text or "pbkdf2$…"
  fullName: string;
  role: Role;
  active: boolean;
  notes: string;
}

const norm = (v: unknown) => (v == null ? "" : String(v).trim().toLowerCase().replace(/\s+/g, " "));
const text = (v: unknown) => (v == null ? "" : String(v).trim());

const INACTIVE = new Set(["no", "n", "false", "0", "inactive", "disabled", "blocked"]);

/** Constant-time string comparison. */
export function safeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}

// ---------------------------------------------------------------- reading the users sheet

/** Locate the header row (first 9 rows) and the columns. Username and Password are required. */
export function findUserColumns(grid: Grid, c: UsersConfig): UserColumns | null {
  const uh = c.usernameHeaders.map(norm);
  const ph = c.passwordHeaders.map(norm);
  for (let r = 0; r < Math.min(9, grid.length); r++) {
    const cells = (grid[r] ?? []).map(norm);
    const user = cells.findIndex((h) => uh.includes(h));
    const pass = cells.findIndex((h) => ph.includes(h));
    if (user < 0 || pass < 0) continue;
    const col = (...names: string[]) => cells.findIndex((h) => names.includes(h));
    return {
      headerRow: r,
      user,
      pass,
      name: col("full name", "name"),
      role: col("role"),
      active: col("active"),
      notes: col("notes", "note"),
    };
  }
  return null;
}

export function parseUsers(grid: Grid, c: UsersConfig): { cols: UserColumns; users: UserRecord[] } {
  const cols = findUserColumns(grid, c);
  if (!cols) throw new Error("Users sheet: could not find the Username and Password columns.");
  const at = (row: Grid[number], i: number) => (i < 0 ? "" : text(row[i]));
  const users: UserRecord[] = [];
  for (let r = cols.headerRow + 1; r < grid.length; r++) {
    const row = grid[r] ?? [];
    const username = at(row, cols.user);
    if (!username) continue;
    users.push({
      row: r + 1,
      username,
      password: row[cols.pass] == null ? "" : String(row[cols.pass]),
      fullName: at(row, cols.name),
      role: norm(at(row, cols.role)) === "admin" ? "Admin" : "Staff",
      active: cols.active < 0 || !INACTIVE.has(norm(at(row, cols.active))),
      notes: at(row, cols.notes),
    });
  }
  return { cols, users };
}

export function findUser(users: UserRecord[], username: string): UserRecord | undefined {
  const want = norm(username);
  return want ? users.find((u) => norm(u.username) === want) : undefined;
}

/** The signed-in user if the credentials match an active row, else null. */
export async function checkLogin(
  grid: Grid,
  c: UsersConfig,
  username: string,
  password: string,
): Promise<{ user: string; role: Role } | null> {
  if (!username.trim() || !password) return null;
  if (c.allowlist.length && !c.allowlist.map(norm).includes(norm(username))) return null;
  const u = findUser(parseUsers(grid, c).users, username);
  if (!u || !u.active || !u.password) return null;
  return (await verifyPassword(u.password, password)) ? { user: u.username, role: u.role } : null;
}

// ---------------------------------------------------------------- password hashing

const PBKDF2_ITERATIONS = 100_000; // the Workers runtime's maximum

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${b64url(salt)}$${b64url(hash)}`;
}

/** Stored value is either a "pbkdf2$…" hash or a password typed into the sheet by hand. */
export async function verifyPassword(stored: string, password: string): Promise<boolean> {
  if (stored.startsWith("pbkdf2$")) {
    const [, iter, salt, hash] = stored.split("$");
    if (!iter || !salt || !hash) return false;
    const got = await pbkdf2(password, fromB64url(salt), Number(iter));
    return safeEqual(b64url(got), hash);
  }
  return safeEqual(stored, password);
}

// ---------------------------------------------------------------- validation for the admin page

export const USERNAME_RULE = /^[A-Za-z0-9._-]{3,32}$/;
export const MIN_PASSWORD = 8;

export function validateNewUser(
  users: UserRecord[],
  input: { username: string; password: string },
): string | null {
  if (!USERNAME_RULE.test(input.username)) {
    return "Username must be 3–32 characters: letters, numbers, dot, dash or underscore, no spaces.";
  }
  if (findUser(users, input.username)) return `Username "${input.username}" already exists.`;
  return validatePassword(input.password);
}

export function validatePassword(password: string): string | null {
  return password.length >= MIN_PASSWORD ? null : `Password must be at least ${MIN_PASSWORD} characters.`;
}

/** Cells for a new row, placed in whatever column order the sheet uses. */
export function rowFor(
  cols: UserColumns,
  u: { username: string; password: string; fullName: string; role: Role; active: boolean; notes: string },
): string[] {
  const width = Math.max(cols.user, cols.pass, cols.name, cols.role, cols.active, cols.notes) + 1;
  const row = new Array<string>(width).fill("");
  row[cols.user] = u.username;
  row[cols.pass] = u.password;
  if (cols.name >= 0) row[cols.name] = u.fullName;
  if (cols.role >= 0) row[cols.role] = u.role;
  if (cols.active >= 0) row[cols.active] = u.active ? "Yes" : "No";
  if (cols.notes >= 0) row[cols.notes] = u.notes;
  return row;
}

/** 0 → A, 25 → Z, 26 → AA */
export function columnLetter(i: number): string {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

// ---------------------------------------------------------------- session cookie

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

export interface Session {
  user: string;
  role: Role;
}

export async function signSession(secret: string, s: Session, nowMs: number, ttlHours: number): Promise<string> {
  const body = JSON.stringify({ u: s.user, r: s.role, exp: nowMs + ttlHours * 3_600_000 });
  const payload = b64url(new TextEncoder().encode(body));
  return `${payload}.${b64url(await hmac(secret, payload))}`;
}

/** The session if the token is genuine and unexpired, else null. */
export async function verifySession(
  secret: string,
  token: string | null | undefined,
  nowMs: number,
): Promise<Session | null> {
  if (!token || !secret) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  if (!safeEqual(b64url(await hmac(secret, payload)), sig)) return null;
  try {
    const { u, r, exp } = JSON.parse(new TextDecoder().decode(fromB64url(payload))) as {
      u: string;
      r?: string;
      exp: number;
    };
    if (typeof u !== "string" || !(exp > nowMs)) return null;
    return { user: u, role: r === "Admin" ? "Admin" : "Staff" };
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
