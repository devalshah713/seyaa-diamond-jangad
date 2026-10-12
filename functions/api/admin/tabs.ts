// Admin: which tabs of the Jangad sheet appear as parties.
// GET  /api/admin/tabs                     → every tab with on/off and the reason
// POST /api/admin/tabs {title, on: boolean} → switch a tab on or off (overrides the automatic rule)

import { findUser } from "../../../src/auth";
import { BOARD_CACHE_KEY, loadPartyTabs, loadTabsState, loadUsers, resolvePartyTabs, type Env, type SessionData } from "../../../src/env";
import { setTab, TABS_STATE_KEY } from "../../../src/tabs";

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

/** Same rule as user management: the caller must still be an active Admin in the users sheet. */
async function isAdmin(env: Env, user: string) {
  const me = findUser((await loadUsers(env)).users, user);
  return !!me && me.active && me.role === "Admin";
}

export const onRequestGet: PagesFunction<Env, string, SessionData> = async ({ env, data }) => {
  try {
    if (!(await isAdmin(env, data.user))) return json({ error: "Admins only" }, 403);
    return json({ tabs: (await loadPartyTabs(env)).decisions });
  } catch (err) {
    console.error(err);
    return json({ error: (err as Error).message }, 502);
  }
};

export const onRequestPost: PagesFunction<Env, string, SessionData> = async ({ env, data, request }) => {
  try {
    if (!(await isAdmin(env, data.user))) return json({ error: "Admins only" }, 403);
    if (!env.BOARD_CACHE) return json({ error: "BOARD_CACHE is not bound on this project." }, 500);
    const body = (await request.json()) as { title?: string; on?: boolean };
    const title = String(body.title ?? "");
    const tabs = await resolvePartyTabs(env); // also creates the state on first use
    if (!tabs.some((t) => t.title === title)) return json({ error: "No such tab in the sheet." }, 404);
    const state = (await loadTabsState(env))!;
    await env.BOARD_CACHE.put(TABS_STATE_KEY, JSON.stringify(setTab(state, title, !!body.on)));
    await env.BOARD_CACHE.delete(BOARD_CACHE_KEY); // show the change on the next board load
    return json({ ok: true, message: `"${title}" switched ${body.on ? "on" : "off"}.` });
  } catch (err) {
    console.error(err);
    return json({ error: (err as Error).message }, 502);
  }
};
