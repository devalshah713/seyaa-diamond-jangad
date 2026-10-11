import { describe, expect, it } from "vitest";
import {
  checkLogin,
  columnLetter,
  hashPassword,
  parseUsers,
  readCookie,
  rowFor,
  signSession,
  validateNewUser,
  verifyPassword,
  verifySession,
  type UsersConfig,
} from "../src/auth";

const cfg: UsersConfig = { usernameHeaders: ["username", "user name"], passwordHeaders: ["password"], allowlist: [] };
const grid = [
  ["Staff list"],
  ["Full Name", "User Name", "Password", "Role", "Active", "Notes"],
  ["Ravi", "ravi", "0123", "Staff", "Yes", ""],
  ["Meena", "Meena.S", "s3cret!!", "Admin", "", "owner"],
  ["Blank", "blank", "", "Staff", "Yes", ""],
  ["Old", "old", "pw123456", "Staff", "No", ""],
];

describe("parseUsers", () => {
  it("reads every column wherever it sits", () => {
    const { cols, users } = parseUsers(grid, cfg);
    expect(cols).toEqual({ headerRow: 1, user: 1, pass: 2, name: 0, role: 3, active: 4, notes: 5 });
    expect(users[1]).toEqual({
      row: 4, username: "Meena.S", password: "s3cret!!", fullName: "Meena", role: "Admin", active: true, notes: "owner",
    });
    expect(users[3]).toMatchObject({ username: "old", active: false, role: "Staff" });
  });
  it("fails loudly when the columns are missing", () => {
    expect(() => parseUsers([["a", "b"]], cfg)).toThrow(/Username and Password columns/);
  });
});

describe("checkLogin", () => {
  it("accepts a matching username (any case) and exact password, with the role", async () => {
    expect(await checkLogin(grid, cfg, "RAVI", "0123")).toEqual({ user: "ravi", role: "Staff" });
    expect(await checkLogin(grid, cfg, " meena.s ", "s3cret!!")).toEqual({ user: "Meena.S", role: "Admin" });
  });
  it("rejects wrong, empty, unknown and inactive", async () => {
    expect(await checkLogin(grid, cfg, "ravi", "123")).toBeNull();
    expect(await checkLogin(grid, cfg, "ravi", "0123 ")).toBeNull();
    expect(await checkLogin(grid, cfg, "blank", "")).toBeNull();
    expect(await checkLogin(grid, cfg, "nobody", "0123")).toBeNull();
    expect(await checkLogin(grid, cfg, "old", "pw123456")).toBeNull();
  });
  it("respects the allowlist", async () => {
    const only = { ...cfg, allowlist: ["Meena.S"] };
    expect(await checkLogin(grid, only, "ravi", "0123")).toBeNull();
    expect(await checkLogin(grid, only, "meena.s", "s3cret!!")).not.toBeNull();
  });
  it("accepts a hashed password", async () => {
    const g = [["Username", "Password"], ["amit", await hashPassword("Amit@2026")]];
    expect(await checkLogin(g, cfg, "amit", "Amit@2026")).toEqual({ user: "amit", role: "Staff" });
    expect(await checkLogin(g, cfg, "amit", "amit@2026")).toBeNull();
  });
});

describe("password hashing", () => {
  it("salts every hash and verifies", async () => {
    const a = await hashPassword("Ravi@4821");
    const b = await hashPassword("Ravi@4821");
    expect(a).toMatch(/^pbkdf2\$100000\$/);
    expect(a).not.toBe(b);
    expect(await verifyPassword(a, "Ravi@4821")).toBe(true);
    expect(await verifyPassword(a, "Ravi@4822")).toBe(false);
    expect(await verifyPassword("pbkdf2$broken", "x")).toBe(false);
  });
});

describe("admin helpers", () => {
  const { cols, users } = parseUsers(grid, cfg);
  it("validates new users", () => {
    expect(validateNewUser(users, { username: "amit", password: "12345678" })).toBeNull();
    expect(validateNewUser(users, { username: "RAVI", password: "12345678" })).toMatch(/already exists/);
    expect(validateNewUser(users, { username: "a b", password: "12345678" })).toMatch(/no spaces/);
    expect(validateNewUser(users, { username: "amit", password: "short" })).toMatch(/at least 8/);
  });
  it("lays a new row out in the sheet's column order", () => {
    expect(rowFor(cols, { username: "amit", password: "h", fullName: "Amit", role: "Staff", active: true, notes: "n" })).toEqual([
      "Amit", "amit", "h", "Staff", "Yes", "n",
    ]);
    const minimal = { headerRow: 0, user: 0, pass: 1, name: -1, role: -1, active: -1, notes: -1 };
    expect(rowFor(minimal, { username: "x", password: "h", fullName: "X", role: "Admin", active: true, notes: "" })).toEqual(["x", "h"]);
  });
  it("names columns", () => {
    expect([0, 1, 25, 26, 27, 51, 52].map(columnLetter)).toEqual(["A", "B", "Z", "AA", "AB", "AZ", "BA"]);
  });
});

describe("session cookie", () => {
  const now = Date.UTC(2026, 9, 11, 10);
  it("round-trips user and role, and expires", async () => {
    const t = await signSession("k", { user: "ravi", role: "Admin" }, now, 12);
    expect(await verifySession("k", t, now + 3_600_000)).toEqual({ user: "ravi", role: "Admin" });
    expect(await verifySession("k", t, now + 13 * 3_600_000)).toBeNull();
  });
  it("rejects tampering (e.g. promoting yourself) and the wrong secret", async () => {
    const t = await signSession("k", { user: "ravi", role: "Staff" }, now, 12);
    const [p, s] = t.split(".");
    const forged = btoa(JSON.stringify({ u: "ravi", r: "Admin", exp: now + 1e9 })).replace(/=+$/, "");
    expect(await verifySession("k", `${forged}.${s}`, now)).toBeNull();
    expect(await verifySession("other", t, now)).toBeNull();
    expect(await verifySession("k", `${p}.`, now)).toBeNull();
    expect(await verifySession("", t, now)).toBeNull();
  });
  it("reads the cookie header", () => {
    expect(readCookie("a=1; jb_session=x.y=; b=2", "jb_session")).toBe("x.y=");
    expect(readCookie(null, "jb_session")).toBeNull();
  });
});
