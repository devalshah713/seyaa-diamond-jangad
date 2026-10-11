// Pages Function: GET /api/board → the computed board as JSON.
// Everything else on the site is the static UI in /web.
// Read-only: this never writes to the sheet.

import { buildBoard, DEFAULT_CONFIG, parseDate, todaySerial, type RulesConfig } from "../../src/rules";
import { readTabs } from "../../src/sheets";
import { list, type Env } from "../../src/env";

const CACHE_KEY = "board:v1";

function config(env: Env): RulesConfig {
  const int = (v: string | undefined, d: number) => (v && /^\d+$/.test(v.trim()) ? +v : d);
  return {
    stockDue: int(env.STOCK_DUE, DEFAULT_CONFIG.stockDue),
    buyerDue: int(env.BUYER_DUE, DEFAULT_CONFIG.buyerDue),
    warn2Day: int(env.WARN2_DAY, DEFAULT_CONFIG.warn2Day),
    finalDay: int(env.FINAL_DAY, DEFAULT_CONFIG.finalDay),
    returnReceivedClosesOrder: (env.RETURN_RECEIVED_CLOSES_ORDER ?? "true").trim().toLowerCase() !== "false",
    cutoffSerial: env.CUTOFF_DATE ? parseDate(env.CUTOFF_DATE) : null,
    knownStatuses: list(env.KNOWN_STATUSES),
  };
}

async function computeBoard(env: Env) {
  if (!env.GOOGLE_PRIVATE_KEY) throw new Error("GOOGLE_PRIVATE_KEY secret is not set on this Pages project.");
  const tabs = env.TABS.split(",").map((s) => s.trim()).filter(Boolean);
  const grids = await readTabs(
    { clientEmail: env.GOOGLE_CLIENT_EMAIL, privateKey: env.GOOGLE_PRIVATE_KEY },
    env.SHEET_ID,
    tabs,
  );
  const cfg = config(env);
  const board = buildBoard(grids, todaySerial(Date.now()), cfg);
  return {
    generatedAt: new Date().toISOString(),
    config: { ...cfg, cutoffDate: env.CUTOFF_DATE || null, tabs },
    ...board,
  };
}

/** The cached payload is shared; the viewer's name is added per request. */
const withUser = (body: string, user: string) => `{"user":${JSON.stringify(user)},${body.slice(1)}`;

export const onRequestGet: PagesFunction<Env, string, { user: string }> = async ({ request, env, data }) => {
  const headers = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
  try {
    const refresh = new URL(request.url).searchParams.has("refresh");
    if (!refresh && env.BOARD_CACHE) {
      const hit = await env.BOARD_CACHE.get(CACHE_KEY);
      if (hit) return new Response(withUser(hit, data.user), { headers: { ...headers, "x-board-cache": "hit" } });
    }
    const body = JSON.stringify(await computeBoard(env));
    const ttl = Math.max(60, Number(env.CACHE_SECONDS) || 60); // KV's minimum TTL is 60s
    if (env.BOARD_CACHE) await env.BOARD_CACHE.put(CACHE_KEY, body, { expirationTtl: ttl });
    return new Response(withUser(body, data.user), { headers: { ...headers, "x-board-cache": "miss" } });
  } catch (err) {
    console.error(err);
    return Response.json({ error: String((err as Error).message ?? err) }, { status: 502, headers });
  }
};
