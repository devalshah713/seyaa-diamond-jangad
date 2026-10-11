// GET /api/me → who is signed in.
import type { Env, SessionData } from "../../src/env";

export const onRequestGet: PagesFunction<Env, string, SessionData> = async ({ data }) =>
  Response.json({ user: data.user, role: data.role }, { headers: { "cache-control": "no-store" } });
