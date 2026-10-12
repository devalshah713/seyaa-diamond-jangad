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

// ---------------------------------------------------------------- party tabs

import { decideTabs, newState, TABS_STATE_KEY, type TabDecision, type TabsState } from "./tabs";
import { listTabs, readMerges, readTabs } from "./sheets";
import { fillMerges, findColumns, type Grid } from "./rules";

export const BOARD_CACHE_KEY = "board:v1";

export async function loadTabsState(env: Env): Promise<TabsState | null> {
  return ((await env.BOARD_CACHE?.get(TABS_STATE_KEY, "json")) as TabsState | null) ?? null;
}

/**
 * Decide which tabs are parties. The first time this runs it records every existing tab as the
 * baseline, so tabs present today stay off unless listed in TABS; tabs created later come on by themselves.
 */
export async function resolvePartyTabs(env: Env): Promise<TabDecision[]> {
  const tabs = await listTabs(serviceAccount(env), env.SHEET_ID);
  let state = await loadTabsState(env);
  if (!state && env.BOARD_CACHE) {
    state = newState(tabs, new Date().toISOString());
    await env.BOARD_CACHE.put(TABS_STATE_KEY, JSON.stringify(state));
  }
  return decideTabs(tabs, list(env.TABS), state);
}

/** Party tabs with their data. A tab without a "Design Number" header is not a party and is turned off. */
export async function loadPartyTabs(env: Env): Promise<{ decisions: TabDecision[]; grids: { name: string; grid: Grid }[] }> {
  const decisions = await resolvePartyTabs(env);
  const wanted = decisions.filter((d) => d.status === "on").map((d) => d.title);
  const [read, merges] = await Promise.all([
    readTabs(serviceAccount(env), env.SHEET_ID, wanted),
    readMerges(serviceAccount(env), env.SHEET_ID),
  ]);
  const grids = read
    .filter((g) => findColumns(g.grid))
    .map((g) => ({ name: g.name, grid: fillMerges(g.grid, merges.get(g.name) ?? []) }));
  for (const d of decisions) {
    if (d.status === "on" && !grids.some((g) => g.name === d.title)) {
      d.status = "off";
      d.reason = "No “Design Number” column — not a party tab";
    }
  }
  return { decisions, grids };
}
