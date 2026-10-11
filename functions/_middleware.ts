// Every request passes through here. Without a valid session cookie:
// pages redirect to /login, API calls get 401. The login page and its API stay public.
// /admin and /api/admin/* additionally require the Admin role.

import { readCookie, SESSION_COOKIE, verifySession } from "../src/auth";
import type { Env, SessionData } from "../src/env";

const PUBLIC = new Set(["/login", "/login.html", "/api/login", "/api/logout", "/favicon.ico"]);
const isAdminPath = (p: string) => p === "/admin" || p === "/admin.html" || p.startsWith("/api/admin/");

export const onRequest: PagesFunction<Env, string, SessionData> = async (ctx) => {
  const url = new URL(ctx.request.url);
  if (PUBLIC.has(url.pathname)) return ctx.next();

  const session = await verifySession(
    ctx.env.SESSION_SECRET,
    readCookie(ctx.request.headers.get("cookie"), SESSION_COOKIE),
    Date.now(),
  );
  const isApi = url.pathname.startsWith("/api/");
  if (!session) {
    if (isApi) return Response.json({ error: "Not logged in" }, { status: 401 });
    return Response.redirect(new URL("/login", url).toString(), 302);
  }
  if (isAdminPath(url.pathname) && session.role !== "Admin") {
    if (isApi) return Response.json({ error: "Admins only" }, { status: 403 });
    return Response.redirect(new URL("/", url).toString(), 302);
  }
  // state-changing calls must come from this site's own pages
  if (ctx.request.method !== "GET" && ctx.request.method !== "HEAD") {
    const origin = ctx.request.headers.get("origin");
    if (origin && origin !== url.origin) return Response.json({ error: "Bad origin" }, { status: 403 });
  }

  ctx.data.user = session.user;
  ctx.data.role = session.role;
  const res = await ctx.next();
  // logged-in pages must never be served from a shared cache
  const out = new Response(res.body, res);
  out.headers.set("cache-control", "private, no-store");
  return out;
};
