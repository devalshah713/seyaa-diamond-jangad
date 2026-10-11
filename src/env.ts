// Bindings and settings shared by every Pages Function. Values come from wrangler.toml [vars];
// GOOGLE_PRIVATE_KEY and SESSION_SECRET are secrets set in the Cloudflare dashboard.

export interface Env {
  BOARD_CACHE?: KVNamespace;
  SHEET_ID: string;
  TABS: string;
  STOCK_DUE?: string;
  BUYER_DUE?: string;
  WARN2_DAY?: string;
  FINAL_DAY?: string;
  RETURN_RECEIVED_CLOSES_ORDER?: string;
  CUTOFF_DATE?: string;
  KNOWN_STATUSES?: string;
  CACHE_SECONDS?: string;
  GOOGLE_CLIENT_EMAIL: string;
  GOOGLE_PRIVATE_KEY: string; // secret
  // login
  SESSION_SECRET: string; // secret: any long random string
  SESSION_HOURS?: string;
  USERS_SHEET_ID: string;
  USERS_TAB?: string; // empty = first tab
  USERS_USERNAME_HEADER?: string; // comma-separated header names accepted
  USERS_PASSWORD_HEADER?: string;
  BOARD_USERS?: string; // optional comma-separated allowlist of usernames
}

export const list = (v: string | undefined) =>
  (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);

// ---------------------------------------------------------------- users sheet helpers

import { parseUsers, type UsersConfig } from "./auth";
import { readFormattedTab, type ServiceAccount } from "./sheets";

export const serviceAccount = (env: Env): ServiceAccount => ({
  clientEmail: env.GOOGLE_CLIENT_EMAIL,
  privateKey: env.GOOGLE_PRIVATE_KEY,
});

export const usersConfig = (env: Env): UsersConfig => ({
  usernameHeaders: list(env.USERS_USERNAME_HEADER || "username,user name,user id,login"),
  passwordHeaders: list(env.USERS_PASSWORD_HEADER || "password"),
  allowlist: list(env.BOARD_USERS),
});

/** Fresh read of the users sheet. */
export async function loadUsers(env: Env) {
  const grid = await readFormattedTab(serviceAccount(env), env.USERS_SHEET_ID, env.USERS_TAB ?? "");
  return { grid, ...parseUsers(grid, usersConfig(env)) };
}

/** Data the login middleware attaches to every authenticated request. */
export interface SessionData extends Record<string, unknown> {
  user: string;
  role: "Admin" | "Staff";
}
