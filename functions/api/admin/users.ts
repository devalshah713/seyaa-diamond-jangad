// Admin user management. The middleware already requires an Admin session cookie;
// every call here also re-reads the users sheet and checks the caller is still an active Admin there,
// so removing someone's Admin role in the sheet takes effect immediately.
//
// GET  /api/admin/users                                   → list (passwords never leave the server)
// POST /api/admin/users {action:"create", username, password, fullName, role, notes}
// POST /api/admin/users {action:"update", username, fullName?, role?, active?, notes?, password?}

import {
  columnLetter,
  findUser,
  hashPassword,
  rowFor,
  validateNewUser,
  validatePassword,
  type Role,
  type UserColumns,
  type UserRecord,
} from "../../../src/auth";
import { loadUsers, serviceAccount, type Env, type SessionData } from "../../../src/env";
import { appendRow, updateCells } from "../../../src/sheets";

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });

type Ctx = EventContext<Env, string, SessionData>;

/** Load the sheet and confirm the caller is still an active Admin in it. */
async function authorise(ctx: Ctx) {
  const loaded = await loadUsers(ctx.env);
  const me = findUser(loaded.users, ctx.data.user);
  if (!me || !me.active || me.role !== "Admin") return json({ error: "Admins only" }, 403);
  return { ...loaded, me };
}

const publicUser = (u: UserRecord) => ({
  username: u.username,
  fullName: u.fullName,
  role: u.role,
  active: u.active,
  notes: u.notes,
  passwordSet: u.password !== "",
  passwordHashed: u.password.startsWith("pbkdf2$"),
});

const missingColumns = (cols: UserColumns) =>
  (["name", "role", "active", "notes"] as const)
    .filter((k) => cols[k] < 0)
    .map((k) => ({ name: "Full Name", role: "Role", active: "Active", notes: "Notes" })[k]);

export const onRequestGet: PagesFunction<Env, string, SessionData> = async (ctx) => {
  try {
    const a = await authorise(ctx);
    if (a instanceof Response) return a;
    return json({ me: a.me.username, users: a.users.map(publicUser), missingColumns: missingColumns(a.cols) });
  } catch (err) {
    console.error(err);
    return json({ error: (err as Error).message }, 502);
  }
};

interface Body {
  action?: string;
  username?: string;
  password?: string;
  fullName?: string;
  role?: string;
  active?: boolean;
  notes?: string;
}

const str = (v: unknown, max = 200) => String(v ?? "").trim().slice(0, max);
const asRole = (v: unknown): Role => (String(v).toLowerCase() === "admin" ? "Admin" : "Staff");

export const onRequestPost: PagesFunction<Env, string, SessionData> = async (ctx) => {
  let body: Body;
  try {
    body = (await ctx.request.json()) as Body;
  } catch {
    return json({ error: "Bad request" }, 400);
  }
  try {
    const a = await authorise(ctx);
    if (a instanceof Response) return a;
    const { cols, users, me } = a;
    const sa = serviceAccount(ctx.env);
    const sheetId = ctx.env.USERS_SHEET_ID;
    const tab = ctx.env.USERS_TAB ?? "";

    if (body.action === "create") {
      const username = str(body.username, 32);
      const password = String(body.password ?? "");
      const problem = validateNewUser(users, { username, password });
      if (problem) return json({ error: problem }, 400);
      const role = asRole(body.role);
      if (role === "Admin" && cols.role < 0) return json({ error: "Add a Role column to the sheet first." }, 400);
      await appendRow(
        sa,
        sheetId,
        tab,
        rowFor(cols, {
          username,
          password: await hashPassword(password),
          fullName: str(body.fullName),
          role,
          active: true,
          notes: str(body.notes, 500),
        }),
      );
      return json({ ok: true, message: `User "${username}" created.` });
    }

    if (body.action === "update") {
      const target = findUser(users, str(body.username, 64));
      if (!target) return json({ error: "No such user." }, 404);
      const self = target.row === me.row;
      const cells: { cell: string; value: string }[] = [];
      const set = (col: number, value: string) => {
        if (col >= 0) cells.push({ cell: `${columnLetter(col)}${target.row}`, value });
      };

      if (body.fullName !== undefined) set(cols.name, str(body.fullName));
      if (body.notes !== undefined) set(cols.notes, str(body.notes, 500));
      if (body.role !== undefined) {
        const role = asRole(body.role);
        if (self && role !== "Admin") return json({ error: "You can't remove your own Admin role." }, 400);
        if (cols.role < 0) return json({ error: "Add a Role column to the sheet first." }, 400);
        set(cols.role, role);
      }
      if (body.active !== undefined) {
        if (self && !body.active) return json({ error: "You can't deactivate yourself." }, 400);
        if (cols.active < 0) return json({ error: "Add an Active column to the sheet first." }, 400);
        set(cols.active, body.active ? "Yes" : "No");
      }
      if (body.password !== undefined) {
        const problem = validatePassword(String(body.password));
        if (problem) return json({ error: problem }, 400);
        set(cols.pass, await hashPassword(String(body.password)));
      }
      if (!cells.length) return json({ error: "Nothing to change." }, 400);
      await updateCells(sa, sheetId, tab, cells);
      return json({ ok: true, message: `User "${target.username}" updated.` });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (err) {
    console.error(err);
    return json({ error: (err as Error).message }, 502);
  }
};
