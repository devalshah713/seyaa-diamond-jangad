import { beforeAll, describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import {
  buildBoard,
  dayOfWeek,
  DEFAULT_CONFIG,
  foldStatus,
  isClosingStatus,
  parseDate,
  serialFromYMD,
  serialToISO,
  stageFor,
  toBlocks,
  todaySerial,
  workingDayNumber,
  type Grid,
} from "../src/rules";

const d = (iso: string) => {
  const [y, m, dd] = iso.split("-").map(Number);
  return serialFromYMD(y, m, dd);
};

describe("dates", () => {
  it("serials round-trip and know the weekday", () => {
    expect(serialToISO(d("2026-03-01"))).toBe("2026-03-01");
    expect(dayOfWeek(d("2026-03-01"))).toBe(0); // Sunday
    expect(dayOfWeek(d("2026-10-11"))).toBe(0); // Sunday
    expect(dayOfWeek(d("2026-10-10"))).toBe(6); // Saturday
  });

  it("matches Google's serial epoch", () => {
    expect(d("1899-12-30")).toBe(0);
    expect(d("2026-10-11")).toBe(46306);
  });

  it("parses text dates day-first", () => {
    expect(parseDate("01/05/2026")).toBe(d("2026-05-01"));
    expect(parseDate("2026-05-01")).toBe(d("2026-05-01"));
    expect(parseDate(46306.75)).toBe(46306);
    expect(parseDate("31/02/2026")).toBeNull();
    expect(parseDate("pending")).toBeNull();
  });

  it("computes today in Asia/Kolkata", () => {
    // 2026-10-10 20:00 UTC is already 11 Oct 01:30 in India
    expect(serialToISO(todaySerial(Date.UTC(2026, 9, 10, 20, 0)))).toBe("2026-10-11");
    expect(serialToISO(todaySerial(Date.UTC(2026, 9, 10, 18, 0)))).toBe("2026-10-10");
  });
});

describe("§3 worked example — issued Sunday 1 Mar 2026", () => {
  const issue = d("2026-03-01");
  it.each([
    ["2026-03-01", 0],
    ["2026-03-02", 1],
    ["2026-03-06", 5],
    ["2026-03-07", 6],
    ["2026-03-08", 6], // Sunday doesn't count
    ["2026-03-10", 8],
    ["2026-03-12", 10],
    ["2026-03-14", 12],
    ["2026-03-15", 12],
    ["2026-03-16", 13],
  ])("%s is day %i", (today, day) => {
    expect(workingDayNumber(issue, d(today))).toBe(day);
  });

  it("stock stages", () => {
    const at = (t: string) => stageFor("Stock", workingDayNumber(issue, d(t)));
    expect(at("2026-03-09")).toBe("On Track"); // day 7
    expect(at("2026-03-10")).toBe("Warning 1"); // day 8
    expect(at("2026-03-12")).toBe("Warning 2"); // day 10
    expect(at("2026-03-14")).toBe("Final Warning"); // day 12
    expect(at("2026-03-16")).toBe("Breach"); // day 13
  });

  it("buyer stages", () => {
    const at = (t: string) => stageFor("Buyer", workingDayNumber(issue, d(t)));
    expect(at("2026-03-05")).toBe("On Track"); // day 4 — no pre-warning
    expect(at("2026-03-06")).toBe("Due Today"); // day 5
    expect(at("2026-03-07")).toBe("Critical"); // day 6
  });

  it("day 1 is the issue date itself on a weekday", () => {
    expect(workingDayNumber(d("2026-03-02"), d("2026-03-02"))).toBe(1);
  });
});

describe("status folding", () => {
  it.each(["Received", "Recieved", "Return Received", "Retrun received", "RETURN RECEIVED", "ReturnReceived", "Cancelled"])(
    "%s closes",
    (s) => expect(isClosingStatus(s)).toBe(true),
  );
  it("Return Received can be switched to open", () => {
    expect(isClosingStatus("Retrun received", { ...DEFAULT_CONFIG, returnReceivedClosesOrder: false })).toBe(false);
    expect(isClosingStatus("Received", { ...DEFAULT_CONFIG, returnReceivedClosesOrder: false })).toBe(true);
  });
  it("other statuses stay open", () => {
    expect(isClosingStatus("Pending")).toBe(false);
    expect(foldStatus(" Return-Recieved ")).toBe("returnreceived");
  });
});

const HEADER = ["Date", "Design Number", "Sub Design No", "Product", "Buyer Name", "SETTING", "Diamond Pcs", "Diamond Carats", "Status", "Received date", "Memo No."];

describe("design blocks", () => {
  const grid: Grid = [
    HEADER,
    [d("2026-10-01"), "SN-BR-TN-001", "A", "Bracelet", "", "Prong", 10, 1.5, "", "", "M1"],
    ["", "", "", "", "", "", 20, 2.25, "", "", ""],
    ["", "", "", "", "", "", 5, 0.25, "", "", ""],
    [d("2026-10-05"), "SS-RG-002", "", "Ring", "Mr Shah", "", 1, 0.5, "", "", "M2"],
  ];

  it("counts blocks, not rows, and sums every row", () => {
    const blocks = toBlocks("PRATIK C-6", grid);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ row: 2, rowCount: 3, pcs: 35, carats: 4, memo: "M1", buyer: "" });
    expect(blocks[1]).toMatchObject({ row: 5, buyer: "Mr Shah" });
  });

  it("finds the header below row 1 and in any column order", () => {
    const shuffled: Grid = [["Jangad"], [], ["Status", "Diamond Carats", "design number", "DATE", "Buyer Name"], ["", 2, "X-1", d("2026-10-01"), ""]];
    const [b] = toBlocks("T", shuffled);
    expect(b).toMatchObject({ design: "X-1", carats: 2, issue: d("2026-10-01"), row: 4 });
  });

  it("SETTING is not the buyer", () => {
    expect(toBlocks("T", grid)[0].buyer).toBe("");
  });
});

describe("board", () => {
  const today = d("2026-10-11"); // Sunday
  const grid: Grid = [
    HEADER,
    // open stock, issued 1 Oct (Thu) → day 9 on Sun 11 Oct → Warning 1
    [d("2026-10-01"), "A-1", "", "", "", "", 1, 1, "", "", ""],
    ["", "", "", "", "", "", 1, 1, "", "", ""],
    // closed by a status on a later row of the block
    [d("2026-09-01"), "A-2", "", "", "", "", 1, 3, "", "", ""],
    ["", "", "", "", "", "", 1, 3, "Recieved", d("2026-09-10"), ""],
    // received date but no status → likely received
    [d("2026-09-01"), "A-3", "", "", "", "", 1, 1, "", "05/09/2026", ""],
    // no date
    ["", "A-4", "", "", "", "", 1, 1, "", "", ""],
    // buyer, issued Tue 6 Oct → day 5 on Sat 10 / Sun 11 → Due Today
    [d("2026-10-06"), "A-5", "", "", "Buyer X", "", 1, 0.5, "", "", ""],
    // odd status, still open
    [d("2026-10-09"), "A-6", "", "", "", "", 1, 0.5, "Hold???", "", ""],
  ];
  const board = buildBoard([{ name: "Seyaa Solitaire", grid }], today, {
    ...DEFAULT_CONFIG,
    knownStatuses: ["Pending", "Received", "Return Received", "Cancelled"],
  });

  it("builds open orders, buyer first", () => {
    expect(board.orders.map((o) => [o.design, o.stage, o.day])).toEqual([
      ["A-5", "Due Today", 5],
      ["A-1", "Warning 1", 9],
      ["A-6", "On Track", 2],
    ]);
    expect(board.totals).toMatchObject({ open: 3, carats: 3, buyer: 1 });
  });

  it("buckets exceptions", () => {
    expect(board.exceptions.likelyReceived.map((e) => e.design)).toEqual(["A-3"]);
    expect(board.exceptions.noDate.map((e) => e.design)).toEqual(["A-4"]);
    expect(board.exceptions.oddStatus).toEqual([{ factory: "Seyaa Solitaire", row: 9, design: "A-6", detail: "Hold???" }]);
  });

  it("measures turnaround on closed blocks", () => {
    // 1 Sep (Tue) → 10 Sep (Thu): 8 working days after issue
    expect(board.factories[0].tat).toEqual({ n: 1, mean: 8, median: 8 });
  });

  it("applies the cut-off", () => {
    const b = buildBoard([{ name: "S", grid }], today, { ...DEFAULT_CONFIG, cutoffSerial: d("2026-10-02") });
    expect(b.orders.map((o) => o.design)).toEqual(["A-5", "A-6"]);
    expect(b.exceptions.beforeCutoff).toBe(1);
  });
});

// §4 baseline — runs only when a snapshot of the live sheet is present (npm run snapshot).
const FIXTURE = new URL("./fixtures/sheet-2026-10-11.json", import.meta.url);
describe.skipIf(!existsSync(FIXTURE))("§4 baseline, 11 Oct 2026", () => {
  let board: ReturnType<typeof buildBoard>;
  beforeAll(() => {
    const snap = JSON.parse(readFileSync(FIXTURE, "utf8")) as { tabs: { name: string; grid: Grid }[] };
    board = buildBoard(snap.tabs, d("2026-10-11"));
  });
  const f = (name: string) => board.factories.find((x) => x.factory === name)!;

  it("open orders and carats", () => {
    expect(board.totals.open).toBe(379);
    expect(board.totals.carats).toBeCloseTo(13609.6, 1);
    expect(board.totals.buyer).toBe(7);
  });

  it("stages", () => {
    const s = board.totals.byStage;
    expect([s["Breach"].count, s["Final Warning"].count, s["Warning 2"].count, s["Warning 1"].count, s["On Track"].count, s["Due Today"].count]).toEqual([
      166, 17, 16, 30, 146, 4,
    ]);
  });

  it("by factory", () => {
    expect([f("PRATIK C-6").open, f("Seyaa Solitaire").open, f("RAJKUMAR").open, f("Anthem Jewels").open, f("RAKESH BABU").open]).toEqual([183, 177, 17, 2, 0]);
    expect(f("PRATIK C-6").carats).toBeCloseTo(8929.1, 1);
    expect(f("Seyaa Solitaire").carats).toBeCloseTo(3598.2, 1);
    expect(f("RAJKUMAR").carats).toBeCloseTo(1081.6, 1);
    expect(f("Anthem Jewels").carats).toBeCloseTo(0.8, 1);
  });

  it("exceptions", () => {
    expect(board.exceptions.likelyReceived).toHaveLength(9);
    expect(board.exceptions.noDate).toHaveLength(16);
  });

  it("turnaround", () => {
    expect(f("Seyaa Solitaire").tat).toEqual({ n: 96, mean: 74.9, median: 79 });
    expect(f("PRATIK C-6").tat).toEqual({ n: 72, mean: 53.5, median: 21 });
    expect(f("RAKESH BABU").tat).toEqual({ n: 5, mean: 20.8, median: 16 });
    expect(f("RAJKUMAR").tat).toEqual({ n: 9, mean: 46.3, median: 45 });
    expect(f("Anthem Jewels").tat).toEqual({ n: 7, mean: 131.4, median: 129 });
  });
});

describe("add-ons belong to the original order", () => {
  it("recognises the add-on spellings and strips them", async () => {
    const { isAddOn, baseDesign } = await import("../src/rules");
    for (const d of ["SN-RG-SL-EM-014 ADD-ON", "SN-RG-SL-EM-014 add on", "SN-RG-SL-EM-014-ADDON", "SN-RG-SL-EM-014 (Add-On 2)", "SN-RG-SL-EM-014 ADD ON-1"]) {
      expect(isAddOn(d), d).toBe(true);
      expect(baseDesign(d), d).toBe("SN-RG-SL-EM-014");
    }
    expect(isAddOn("SN-RG-SL-EM-014")).toBe(false);
    expect(isAddOn("SN-PADDON-01")).toBe(false);
    expect(baseDesign(" sn-rg-sl-em-014 ")).toBe("SN-RG-SL-EM-014");
  });

  const today = d("2026-10-12");
  const tab = (rows: Grid) => [{ name: "Seyaa Solitaire", grid: [HEADER, ...rows] }];

  it("merges an add-on into the original: one order, original clock, summed diamonds", () => {
    const board = buildBoard(tab([
      [d("2026-10-01"), "SN-RG-SL-EM-014", "", "", "", "", 10, 1.5, "", "", "M1"],
      [d("2026-10-02"), "SN-OTHER-001", "", "", "", "", 1, 0.2, "", "", ""],
      [d("2026-10-08"), "SN-RG-SL-EM-014 ADD-ON", "", "", "", "", 4, 0.5, "", "", ""],
      ["", "", "", "", "", "", 2, 0.25, "", "", ""],
    ]), today);
    expect(board.orders.map((o) => o.design).sort()).toEqual(["SN-OTHER-001", "SN-RG-SL-EM-014"]);
    const main = board.orders.find((o) => o.design === "SN-RG-SL-EM-014")!;
    expect(main).toMatchObject({ issueDate: "2026-10-01", pcs: 16, carats: 2.25, day: workingDayNumber(d("2026-10-01"), today) });
    expect(main.addOns).toEqual([{ design: "SN-RG-SL-EM-014 ADD-ON", sub: "", product: "", row: 4, issueDate: "2026-10-08" }]);
  });

  it("recognises an add-on marked in the Sub Design No column (design number unchanged)", () => {
    const board = buildBoard(tab([
      [d("2026-09-01"), "SN-RG-SL-EM-014", "014", "RING", "", "", 6, 0.6, "", "", ""],
      [d("2026-09-18"), "SN-RG-SL-EM-014", "ADD ON 014", "RING", "", "", 6, 0.1, "", "", ""],
      [d("2026-09-18"), "SN-BR-RD-3CT-025", "ADD ON 025", "BRACELET", "", "", 1, 0, "", "", ""],
    ]), today);
    expect(board.orders.map((o) => [o.design, o.sub, o.issueDate])).toEqual([["SN-RG-SL-EM-014", "014", "2026-09-01"]]);
    expect(board.orders[0].addOns).toMatchObject([{ design: "SN-RG-SL-EM-014", sub: "ADD ON 014", issueDate: "2026-09-18" }]);
    expect(board.exceptions.addOnOrphans.map((e) => e.design)).toEqual(["SN-BR-RD-3CT-025"]);
  });

  it("a sub-column add-on whose original was received leaves the board with it", () => {
    const board = buildBoard(tab([
      [d("2026-09-01"), "SN-RG-SL-EM-014", "014", "RING", "", "", 6, 0.6, "Received", d("2026-09-15"), ""],
      [d("2026-09-18"), "SN-RG-SL-EM-014", "ADD ON 014", "RING", "", "", 6, 0.1, "", "", ""],
    ]), today);
    expect(board.orders).toHaveLength(0);
    expect(board.exceptions.addOnOrphans).toHaveLength(0);
  });

  it("an add-on marked Received closes the whole order", () => {
    const board = buildBoard(tab([
      [d("2026-10-01"), "SN-RG-SL-EM-014", "", "", "", "", 10, 1.5, "", "", ""],
      [d("2026-10-08"), "SN-RG-SL-EM-014 ADD ON", "", "", "", "", 4, 0.5, "Received", d("2026-10-10"), ""],
    ]), today);
    expect(board.orders).toHaveLength(0);
  });

  it("an add-on with no earlier original is flagged, not given its own clock", () => {
    const board = buildBoard(tab([
      [d("2026-10-08"), "SN-RG-SL-EM-099 ADD-ON", "", "", "", "", 4, 0.5, "", "", ""],
      [d("2026-10-09"), "SN-RG-SL-EM-099", "", "", "", "", 4, 0.5, "", "", ""],
    ]), today);
    expect(board.orders.map((o) => o.design)).toEqual(["SN-RG-SL-EM-099"]);
    expect(board.exceptions.addOnOrphans.map((e) => e.design)).toEqual(["SN-RG-SL-EM-099 ADD-ON"]);
  });
});

describe("every sub design is its own order", () => {
  const today = d("2026-10-12");
  const H = ["Date", "Design Number", "Sub Design No", "Product", "Buyer Name", "Diamond Pcs", "Diamond Carats", "Status", "Received date"];
  // SN-BR-TN-3CT-YG with subs 54…58, each sub on its own row, plus an extra diamond-size row under 55
  const grid: Grid = [
    H,
    [d("2026-09-14"), "SN-BR-TN-3CT-YG", "54", "Bracelet", "", 10, 3, "", ""],
    ["", "", "55", "", "", 10, 3, "", ""],
    ["", "", "", "", "", 2, 0.5, "", ""],
    ["", "", "56", "", "", 10, 3, "Received", d("2026-09-30")],
    ["", "", "57", "", "", 10, 3, "", ""],
    ["", "", "58", "", "", 10, 3, "", ""],
    [d("2026-09-20"), "SN-RG-ONE", "", "Ring", "Mr Shah", 1, 0.2, "", ""],
  ];
  const board = buildBoard([{ name: "Seyaa Solitaire", grid }], today);

  it("lists every pending sub, not just the first", () => {
    const subs = board.orders.filter((o) => o.design === "SN-BR-TN-3CT-YG").map((o) => o.sub).sort();
    expect(subs).toEqual(["54", "55", "57", "58"]); // 56 was received
  });

  it("each sub carries the block's date and product and its own diamonds", () => {
    const s55 = board.orders.find((o) => o.sub === "55")!;
    expect(s55).toMatchObject({ issueDate: "2026-09-14", product: "Bracelet", pcs: 12, carats: 3.5, row: 3 });
  });

  it("a block without sub designs is still one order", () => {
    expect(board.orders.filter((o) => o.design === "SN-RG-ONE")).toHaveLength(1);
    expect(board.orders.find((o) => o.design === "SN-RG-ONE")!.tier).toBe("Buyer");
  });

  it("an 'ADD ON 055' row joins sub 55 specifically", () => {
    const g: Grid = [...grid, [d("2026-10-01"), "SN-BR-TN-3CT-YG", "ADD ON 055", "Bracelet", "", 1, 0.1, "", ""]];
    const b = buildBoard([{ name: "Seyaa Solitaire", grid: g }], today);
    const s55 = b.orders.find((o) => o.sub === "55")!;
    expect(s55.addOns.map((a) => a.sub)).toEqual(["ADD ON 055"]);
    expect(b.orders.find((o) => o.sub === "58")!.addOns).toEqual([]);
  });
});
