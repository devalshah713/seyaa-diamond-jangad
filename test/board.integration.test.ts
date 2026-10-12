// Runs the real /api/board and /api/admin/tabs handlers against a fake Google Sheets API and an
// in-memory KV, to check automatic party-tab discovery end to end.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { onRequestGet as boardGet } from "../functions/api/board";
import { onRequestGet as tabsGet, onRequestPost as tabsPost } from "../functions/api/admin/tabs";
import { serialFromYMD } from "../src/rules";

const HEADER = ["Date", "Design Number", "Buyer Name", "Diamond Pcs", "Diamond Carats", "Status", "Received date"];
const party = (design: string) => [HEADER, [serialFromYMD(2026, 10, 1), design, "", 1, 1, "", ""]];

let sheetTabs: Record<string, unknown[][]>;
let sheetMerges: Record<string, unknown[]> = {};
const usersGrid = [["Username", "Password", "Role", "Active"], ["boss", "pw", "Admin", "Yes"]];

function fakeKV() {
  const m = new Map<string, string>();
  return {
    get: async (k: string, type?: string) => (m.has(k) ? (type === "json" ? JSON.parse(m.get(k)!) : m.get(k)) : null),
    put: async (k: string, v: string) => void m.set(k, v),
    delete: async (k: string) => void m.delete(k),
  };
}

let env: Record<string, unknown>;
beforeAll(() => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  env = {
    SHEET_ID: "jangad",
    USERS_SHEET_ID: "users",
    TABS: "Seyaa Solitaire,PRATIK C-6",
    GOOGLE_CLIENT_EMAIL: "sa@test",
    GOOGLE_PRIVATE_KEY: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
});

function mockGoogle() {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.host === "oauth2.googleapis.com") return Response.json({ access_token: "t", expires_in: 3600 });
    const path = decodeURIComponent(url.pathname);
    if (path === "/v4/spreadsheets/jangad") {
      return Response.json({ sheets: Object.keys(sheetTabs).map((title) => ({ properties: { title }, merges: sheetMerges[title] })) });
    }
    if (path === "/v4/spreadsheets/jangad/values:batchGet") {
      const ranges = url.searchParams.getAll("ranges").map((r) => r.replace(/^'|'$/g, ""));
      return Response.json({ valueRanges: ranges.map((r) => ({ values: sheetTabs[r] })) });
    }
    if (path.startsWith("/v4/spreadsheets/users/values/")) return Response.json({ values: usersGrid });
    return new Response("unexpected " + url, { status: 500 });
  });
}
afterEach(() => vi.unstubAllGlobals());

const call = async (fn: Function, extra: Record<string, unknown> = {}) => {
  const res: Response = await fn({
    request: new Request("https://x/api/board?refresh=1", extra.body ? { method: "POST", body: JSON.stringify(extra.body) } : {}),
    env,
    data: { user: "boss", role: "Admin" },
  });
  return res.json() as Promise<any>;
};

describe("automatic party tabs", () => {
  it("keeps today's extra tabs out, then adds new party tabs and skips non-party ones", async () => {
    env.BOARD_CACHE = fakeKV();
    mockGoogle();
    sheetTabs = { "Seyaa Solitaire": party("S-1"), "PRATIK C-6": party("P-1"), "OLD VENDOR": party("O-1") };

    let board = await call(boardGet);
    expect(board.factories.map((f: any) => f.factory)).toEqual(["Seyaa Solitaire", "PRATIK C-6"]);

    // a new party and a summary tab are added to the sheet later
    sheetTabs = { ...sheetTabs, "NEW PARTY": party("N-1"), Summary: [["Total"], [42]] };
    board = await call(boardGet);
    expect(board.factories.map((f: any) => f.factory)).toEqual(["Seyaa Solitaire", "PRATIK C-6", "NEW PARTY"]);
    expect(board.orders.map((o: any) => o.design)).toContain("N-1");
    const why = Object.fromEntries(board.config.tabDecisions.map((d: any) => [d.title, d.reason]));
    expect(why["OLD VENDOR"]).toMatch(/Existed before/);
    expect(why["Summary"]).toMatch(/Design Number/);

    // a merged Status cell marks both of PRATIK's rows received
    sheetTabs["PRATIK C-6"] = [HEADER, [serialFromYMD(2026, 10, 1), "P-1", "", 1, 1, "Received", ""], ["", "P-1b", "", 1, 1, "", ""]];
    sheetMerges = { "PRATIK C-6": [{ startRowIndex: 1, endRowIndex: 3, startColumnIndex: 5, endColumnIndex: 6 }] };
    board = await call(boardGet);
    expect(board.orders.filter((o: any) => o.factory === "PRATIK C-6")).toEqual([]);
    sheetMerges = {};

    // an admin switches the old vendor on
    const r = await call(tabsPost, { body: { title: "OLD VENDOR", on: true } });
    expect(r.ok).toBe(true);
    board = await call(boardGet);
    expect(board.factories.map((f: any) => f.factory)).toContain("OLD VENDOR");
    const list = await call(tabsGet);
    expect(list.tabs.find((t: any) => t.title === "OLD VENDOR").status).toBe("on");
    expect(list.tabs.find((t: any) => t.title === "Summary").status).toBe("off");
  });
});
