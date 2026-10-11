// POST /api/login {username, password} → sets the session cookie.
// Credentials are checked against the users sheet on every login; nothing is stored here.

import { checkLogin, SESSION_COOKIE, signSession, type Session } from "../../src/auth";
import { loadUsers, usersConfig, type Env } from "../../src/env";

const MAX_FAILS = 10; // per IP per 15 minutes
const FAIL_WINDOW_S = 900;

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.SESSION_SECRET) return Response.json({ error: "SESSION_SECRET is not set on this project." }, { status: 500 });
  if (!env.USERS_SHEET_ID) return Response.json({ error: "USERS_SHEET_ID is not set." }, { status: 500 });
  if (!env.GOOGLE_PRIVATE_KEY) return Response.json({ error: "GOOGLE_PRIVATE_KEY is not set on this project." }, { status: 500 });

  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
  const failKey = `loginfail:${ip}`;
  const fails = Number((await env.BOARD_CACHE?.get(failKey)) ?? 0);
  if (fails >= MAX_FAILS) {
    return Response.json({ error: "Too many failed attempts. Try again in 15 minutes." }, { status: 429 });
  }

  let username = "";
  let password = "";
  try {
    const body = (await request.json()) as { username?: unknown; password?: unknown };
    username = String(body.username ?? "");
    password = String(body.password ?? "");
  } catch {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }

  let session: Session | null;
  try {
    const { grid } = await loadUsers(env);
    session = await checkLogin(grid, usersConfig(env), username, password);
  } catch (err) {
    console.error(err);
    return Response.json({ error: "Login is not available right now: " + (err as Error).message }, { status: 502 });
  }

  if (!session) {
    await env.BOARD_CACHE?.put(failKey, String(fails + 1), { expirationTtl: FAIL_WINDOW_S });
    return Response.json({ error: "Wrong username or password." }, { status: 401 });
  }

  const hours = Math.max(1, Number(env.SESSION_HOURS) || 12);
  const token = await signSession(env.SESSION_SECRET, session, Date.now(), hours);
  return Response.json(
    session,
    {
      headers: {
        "set-cookie": `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${hours * 3600}`,
        "cache-control": "no-store",
      },
    },
  );
};
