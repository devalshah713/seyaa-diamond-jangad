import { describe, expect, it } from "vitest";
import { decideTabs, newState, setTab, type SheetTab } from "../src/tabs";

const FIXED = ["Seyaa Solitaire", "PRATIK C-6"];
const today: SheetTab[] = [
  { title: "Seyaa Solitaire", hidden: false },
  { title: "PRATIK C-6", hidden: false },
  { title: "OLD VENDOR", hidden: false },
  { title: "Summary", hidden: false },
];
const on = (ds: ReturnType<typeof decideTabs>) => ds.filter((d) => d.status === "on").map((d) => d.title);

describe("party tabs", () => {
  const state = newState(today, "2026-10-12T00:00:00Z");

  it("keeps today's extra tabs out and the fixed parties in", () => {
    expect(on(decideTabs(today, FIXED, state))).toEqual(["Seyaa Solitaire", "PRATIK C-6"]);
  });

  it("adds a tab created later automatically", () => {
    const later = [...today, { title: "NEW PARTY", hidden: false }];
    const d = decideTabs(later, FIXED, state);
    expect(on(d)).toEqual(["Seyaa Solitaire", "PRATIK C-6", "NEW PARTY"]);
    expect(d.at(-1)!.reason).toMatch(/added automatically/);
  });

  it("does not add a new hidden tab", () => {
    expect(on(decideTabs([...today, { title: "Scratch", hidden: true }], FIXED, state))).not.toContain("Scratch");
  });

  it("lets an admin switch tabs on and off", () => {
    let s = setTab(state, "OLD VENDOR", true);
    expect(on(decideTabs(today, FIXED, s))).toContain("OLD VENDOR");
    s = setTab(s, "PRATIK C-6", false);
    expect(on(decideTabs(today, FIXED, s))).not.toContain("PRATIK C-6");
    s = setTab(s, "PRATIK C-6", true);
    expect(on(decideTabs(today, FIXED, s))).toContain("PRATIK C-6");
    expect(s.exclude).toEqual([]);
  });

  it("without stored state, only the fixed list is used", () => {
    expect(on(decideTabs([...today, { title: "NEW PARTY", hidden: false }], FIXED, null))).toEqual(FIXED);
  });
});
