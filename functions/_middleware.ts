// Every request passes through here. Without a valid session cookie:
// pages redirect to /login, API calls get 401. The login page and its API stay public.

import { readCookie, SESSION_COOKIE, verifySession } from "../src/auth";
import type { Env } from "../src/env";

const PUBLIC = new Set(["/login", "/login.html", "/api/login", "/api/logout", "/favicon.ico"]);

export const onRequest: PagesFunction<Env, string, { user: string }> = async (ctx) => {
  const url = new URL(ctx.request.url);
  if (PUBLIC.has(url.pathname)) return ctx.next();

  const user = await verifySession(
    ctx.env.SESSION_SECRET,
    readCookie(ctx.request.headers.get("cookie"), SESSION_COOKIE),
    Date.now(),
  );
  if (!user) {
    if (url.pathname.startsWith("/api/")) return Response.json({ error: "Not logged in" }, { status: 401 });
    return Response.redirect(new URL("/login", url).toString(), 302);
  }
  ctx.data.user = user;
  const res = await ctx.next();
  // logged-in pages must never be served from a shared cache
  const out = new Response(res.body, res);
  out.headers.set("cache-control", "private, no-store");
  return out;
};
