// Which tabs of the Jangad sheet are parties (factories) on the board.
// Pure logic; the state lives in KV under TABS_STATE_KEY.
//
// A tab is on the board when, in order of precedence:
//   1. an admin switched it off            → off
//   2. an admin switched it on             → on
//   3. it is listed in TABS (wrangler.toml) → on
//   4. it already existed when auto-discovery first ran (the "baseline") → off
//   5. it is hidden in the sheet            → off
//   6. otherwise — a tab added later        → on
// A tab that is "on" but has no "Design Number" header is not a party (e.g. a summary tab) and is skipped.

export const TABS_STATE_KEY = "tabs:v1";

export interface TabsState {
  baseline: string[]; // every tab title present when auto-discovery first ran
  include: string[]; // switched on by an admin
  exclude: string[]; // switched off by an admin
  createdAt: string;
}

export interface SheetTab {
  title: string;
  hidden: boolean;
}

export type TabStatus = "on" | "off";

export interface TabDecision {
  title: string;
  status: TabStatus;
  reason: string;
}

export function newState(tabs: SheetTab[], nowIso: string): TabsState {
  return { baseline: tabs.map((t) => t.title), include: [], exclude: [], createdAt: nowIso };
}

export function decideTabs(tabs: SheetTab[], fixed: string[], state: TabsState | null): TabDecision[] {
  const has = (list: string[] | undefined, t: string) => !!list?.includes(t);
  return tabs.map(({ title, hidden }) => {
    if (has(state?.exclude, title)) return { title, status: "off", reason: "Switched off by an admin" };
    if (has(state?.include, title)) return { title, status: "on", reason: "Switched on by an admin" };
    if (fixed.includes(title)) return { title, status: "on", reason: "Original party" };
    if (!state) return { title, status: "off", reason: "Not in the party list" };
    if (has(state.baseline, title)) return { title, status: "off", reason: "Existed before automatic adding started" };
    if (hidden) return { title, status: "off", reason: "Hidden in the sheet" };
    return { title, status: "on", reason: "New tab — added automatically" };
  });
}

/** Admin switch: on/off overrides whatever the default would be. */
export function setTab(state: TabsState, title: string, on: boolean): TabsState {
  const include = state.include.filter((t) => t !== title);
  const exclude = state.exclude.filter((t) => t !== title);
  (on ? include : exclude).push(title);
  return { ...state, include, exclude };
}
