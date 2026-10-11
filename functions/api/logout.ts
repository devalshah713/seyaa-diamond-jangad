// POST /api/logout → clears the session cookie.
import { SESSION_COOKIE } from "../../src/auth";

export const onRequestPost: PagesFunction = async () =>
  new Response(null, {
    status: 204,
    headers: { "set-cookie": `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0` },
  });
