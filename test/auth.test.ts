import { describe, expect, it } from "vitest";
import { checkLogin, readCookie, signSession, verifySession, type UsersConfig } from "../src/auth";

const cfg: UsersConfig = { usernameHeaders: ["username", "user name"], passwordHeaders: ["password"], allowlist: [] };
const grid = [
  ["Staff list"],
  ["Name", "User Name", "Password", "Role"],
  ["Ravi", "ravi", "0123", "Office"],
  ["Meena", "Meena.S", "s3cret!", "Office"],
  ["Blank", "blank", "", "Office"],
];

describe("checkLogin", () => {
  it("accepts a matching username (any case) and exact password", () => {
    expect(checkLogin(grid, cfg, "RAVI", "0123")).toBe("ravi");
    expect(checkLogin(grid, cfg, " meena.s ", "s3cret!")).toBe("Meena.S");
  });
  it("rejects wrong or empty passwords", () => {
    expect(checkLogin(grid, cfg, "ravi", "123")).toBeNull();
    expect(checkLogin(grid, cfg, "ravi", "0123 ")).toBeNull();
    expect(checkLogin(grid, cfg, "blank", "")).toBeNull();
    expect(checkLogin(grid, cfg, "nobody", "0123")).toBeNull();
  });
  it("respects the allowlist", () => {
    const only = { ...cfg, allowlist: ["Meena.S"] };
    expect(checkLogin(grid, only, "ravi", "0123")).toBeNull();
    expect(checkLogin(grid, only, "meena.s", "s3cret!")).toBe("Meena.S");
  });
  it("fails loudly when the columns are missing", () => {
    expect(() => checkLogin([["a", "b"]], cfg, "x", "y")).toThrow(/username and password columns/);
  });
});

describe("session cookie", () => {
  const now = Date.UTC(2026, 9, 11, 10);
  it("round-trips and expires", async () => {
    const t = await signSession("k", "ravi", now, 12);
    expect(await verifySession("k", t, now + 3_600_000)).toBe("ravi");
    expect(await verifySession("k", t, now + 13 * 3_600_000)).toBeNull();
  });
  it("rejects tampering and the wrong secret", async () => {
    const t = await signSession("k", "ravi", now, 12);
    const [p, s] = t.split(".");
    const forged = btoa(JSON.stringify({ u: "admin", exp: now + 1e9 })).replace(/=+$/, "");
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
