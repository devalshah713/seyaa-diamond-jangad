// Routes: GET /api/board (JSON), everything else → static UI in /web.
// Read-only: this Worker never writes to the sheet.

import { buildBoard, DEFAULT_CONFIG, parseDate, todaySerial, type RulesConfig } from "./rules";
import { readTabs } from "./sheets";

export interface Env {
  ASSETS: Fetcher;
  BOARD_CACHE?: KVNamespace;
  SHEET_ID: string;
  TABS: string; // comma-separated
  STOCK_DUE?: string;
  BUYER_DUE?: string;
  WARN2_DAY?: string;
  FINAL_DAY?: string;
  RETURN_RECEIVED_CLOSES_ORDER?: string;
  CUTOFF_DATE?: string; // yyyy-mm-dd, optional
  KNOWN_STATUSES?: string; // comma-separated Status dropdown values, optional
  CACHE_SECONDS?: string;
  GOOGLE_CLIENT_EMAIL: string;
  GOOGLE_PRIVATE_KEY: string; // secret
}

const CACHE_KEY = "board:v1";

function config(env: Env): RulesConfig {
  const int = (v: string | undefined, d: number) => (v && /^\d+$/.test(v.trim()) ? +v : d);
  const list = (v: string | undefined) => (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
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

async function boardResponse(env: Env, refresh: boolean): Promise<Response> {
  const ttl = Math.max(60, Number(env.CACHE_SECONDS) || 60); // KV's minimum TTL is 60s
  const headers = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

  if (!refresh && env.BOARD_CACHE) {
    const hit = await env.BOARD_CACHE.get(CACHE_KEY);
    if (hit) return new Response(hit, { headers: { ...headers, "x-board-cache": "hit" } });
  }
  const body = JSON.stringify(await computeBoard(env));
  if (env.BOARD_CACHE) await env.BOARD_CACHE.put(CACHE_KEY, body, { expirationTtl: ttl });
  return new Response(body, { headers: { ...headers, "x-board-cache": "miss" } });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/api/board") {
      if (req.method !== "GET") return new Response("Method not allowed", { status: 405 });
      try {
        return await boardResponse(env, url.searchParams.has("refresh"));
      } catch (err) {
        console.error(err);
        return Response.json({ error: String((err as Error).message ?? err) }, { status: 502 });
      }
    }
    return env.ASSETS.fetch(req);
  },
} satisfies ExportedHandler<Env>;
