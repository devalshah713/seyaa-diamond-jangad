// Pages Function: GET /api/board → the computed board as JSON.
// Everything else on the site is the static UI in /web.
// Read-only: this never writes to the sheet.

import { buildBoard, DEFAULT_CONFIG, parseDate, RATE_HEADER_OVERRIDE, todaySerial, type RulesConfig } from "../../src/rules";
import { BOARD_CACHE_KEY, list, loadPartyTabs, type Env, type SessionData } from "../../src/env";

const CACHE_KEY = BOARD_CACHE_KEY;

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
  RATE_HEADER_OVERRIDE.value = env.RATE_HEADER ?? "";
  const { decisions, grids } = await loadPartyTabs(env);
  const cfg = config(env);
  const board = buildBoard(grids, todaySerial(Date.now()), cfg);
  return {
    generatedAt: new Date().toISOString(),
    config: { ...cfg, cutoffDate: env.CUTOFF_DATE || null, tabs: grids.map((g) => g.name), tabDecisions: decisions },
    ...board,
  };
}

/**
 * The cached payload is shared; the viewer's name is added per request.
 * Prices are for admins only: staff get the board without value / priced-carat figures.
 */
function withUser(body: string, s: SessionData): string {
  let payload = body;
  if (s.role !== "Admin") {
    const b = JSON.parse(body);
    for (const o of b.orders) { delete o.value; delete o.pricedCarats; }
    for (const f of b.factories) delete f.priceColumn;
    payload = JSON.stringify(b);
  }
  return `{"user":${JSON.stringify(s.user)},"role":${JSON.stringify(s.role)},${payload.slice(1)}`;
}

export const onRequestGet: PagesFunction<Env, string, SessionData> = async ({ request, env, data }) => {
  const headers = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
  try {
    const refresh = new URL(request.url).searchParams.has("refresh");
    if (!refresh && env.BOARD_CACHE) {
      const hit = await env.BOARD_CACHE.get(CACHE_KEY);
      if (hit) return new Response(withUser(hit, data), { headers: { ...headers, "x-board-cache": "hit" } });
    }
    const body = JSON.stringify(await computeBoard(env));
    const ttl = Math.max(60, Number(env.CACHE_SECONDS) || 60); // KV's minimum TTL is 60s
    if (env.BOARD_CACHE) await env.BOARD_CACHE.put(CACHE_KEY, body, { expirationTtl: ttl });
    return new Response(withUser(body, data), { headers: { ...headers, "x-board-cache": "miss" } });
  } catch (err) {
    console.error(err);
    return Response.json({ error: String((err as Error).message ?? err) }, { status: 502, headers });
  }
};
