// THE LOGIC — blocks, clock, stages, closing, exceptions, TAT.
// Pure functions over arrays of cell values. No I/O, no Date.now(): "today" is passed in.
//
// Dates are handled as Google Sheets serial day numbers (days since 1899-12-30) — plain integers,
// so there is no timezone to drift. Serial 0 was a Saturday.

export type Cell = string | number | boolean | null | undefined;
export type Grid = Cell[][];

export interface RulesConfig {
  stockDue: number; // 8
  buyerDue: number; // 5
  warn2Day: number; // 10
  finalDay: number; // 12
  returnReceivedClosesOrder: boolean;
  cutoffSerial: number | null; // ignore orders issued before this
  knownStatuses: string[]; // the sheet's Status dropdown; empty = don't check
}

export const DEFAULT_CONFIG: RulesConfig = {
  stockDue: 8,
  buyerDue: 5,
  warn2Day: 10,
  finalDay: 12,
  returnReceivedClosesOrder: true,
  cutoffSerial: null,
  knownStatuses: [],
};

export type Tier = "Buyer" | "Stock";
export type Stage =
  | "On Track"
  | "Warning 1"
  | "Warning 2"
  | "Final Warning"
  | "Breach"
  | "Due Today"
  | "Critical";

export const STAGES: Stage[] = [
  "Critical",
  "Due Today",
  "Breach",
  "Final Warning",
  "Warning 2",
  "Warning 1",
  "On Track",
];

// ---------------------------------------------------------------- dates

const MS_PER_DAY = 86_400_000;
const UNIX_EPOCH_SERIAL = 25_569; // 1970-01-01

/** 0 = Sunday … 6 = Saturday */
export function dayOfWeek(serial: number): number {
  return (((serial + 6) % 7) + 7) % 7;
}

export function serialFromYMD(y: number, m: number, d: number): number {
  return Math.round(Date.UTC(y, m - 1, d) / MS_PER_DAY) + UNIX_EPOCH_SERIAL;
}

export function serialToISO(serial: number): string {
  return new Date((serial - UNIX_EPOCH_SERIAL) * MS_PER_DAY).toISOString().slice(0, 10);
}

/** Today's serial in a fixed UTC offset (Asia/Kolkata = +330 min, no DST). */
export function todaySerial(nowMs: number, utcOffsetMinutes = 330): number {
  return Math.floor((nowMs + utcOffsetMinutes * 60_000) / MS_PER_DAY) + UNIX_EPOCH_SERIAL;
}

/**
 * Accepts a serial number (UNFORMATTED_VALUE + SERIAL_NUMBER) or a text date.
 * Text is read as dd/mm/yyyy (Indian order) or yyyy-mm-dd. Returns null if unusable.
 */
export function parseDate(v: Cell): number | null {
  if (typeof v === "number") return v > 0 ? Math.floor(v) : null;
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return validYMD(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2}|\d{4})$/);
  if (m) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return validYMD(y, +m[2], +m[1]);
  }
  return null;
}

function validYMD(y: number, m: number, d: number): number | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null;
  return serialFromYMD(y, m, d);
}

// ---------------------------------------------------------------- working days

/**
 * Which working day `today` is for an order issued on `issue`.
 * Mon–Sat count, Sundays skipped, holidays count. Day 1 = the issue date itself
 * (or the following Monday if issued on a Sunday). Returns 0 before day 1.
 */
export function workingDayNumber(issue: number, today: number): number {
  return countWorkingDays(issue, today);
}

/** Working days strictly after `from`, up to and including `to`. Used for turnaround. */
export function workingDaysBetween(from: number, to: number): number {
  return countWorkingDays(from + 1, to);
}

/** Non-Sunday days in [from, to] inclusive. */
function countWorkingDays(from: number, to: number): number {
  if (to < from) return 0;
  const days = to - from + 1;
  const weeks = Math.floor(days / 7);
  let n = weeks * 6;
  for (let s = from + weeks * 7; s <= to; s++) if (dayOfWeek(s) !== 0) n++;
  return n;
}

// ---------------------------------------------------------------- stages

export function tierFor(buyer: string): Tier {
  return buyer.trim() ? "Buyer" : "Stock";
}

export function stageFor(tier: Tier, day: number, c: RulesConfig = DEFAULT_CONFIG): Stage {
  if (tier === "Buyer") {
    if (day < c.buyerDue) return "On Track";
    if (day === c.buyerDue) return "Due Today";
    return "Critical";
  }
  if (day < c.stockDue) return "On Track";
  if (day < c.warn2Day) return "Warning 1";
  if (day < c.finalDay) return "Warning 2";
  if (day === c.finalDay) return "Final Warning";
  return "Breach";
}

export const ACTION_TEXT: Record<Stage, string> = {
  "On Track": "On track — no action",
  "Warning 1": "Warning 1 — first reminder",
  "Warning 2": "Warning 2 — final reminder",
  "Final Warning": "Final warning — last day before breach, escalate",
  Breach: "Breach — overdue, escalate to factory owner",
  "Due Today": "Buyer order due today — confirm dispatch",
  Critical: "Buyer order overdue — call now",
};

/** Stages that belong on the Follow-Up Today list. */
export function needsFollowUp(stage: Stage): boolean {
  return stage !== "On Track";
}

// ---------------------------------------------------------------- status

/** lowercase, strip every non-letter, fold the common misspellings */
export function foldStatus(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z]/g, "")
    .replace(/recieved/g, "received")
    .replace(/^retrun/, "return")
    .replace(/^canceled$/, "cancelled");
}

export function isClosingStatus(s: string, c: RulesConfig = DEFAULT_CONFIG): boolean {
  const f = foldStatus(s);
  if (f === "received" || f === "cancelled") return true;
  if (f === "returnreceived") return c.returnReceivedClosesOrder;
  return false;
}

// ---------------------------------------------------------------- header + blocks

type Field =
  | "date"
  | "design"
  | "sub"
  | "product"
  | "buyer"
  | "status"
  | "received"
  | "memo"
  | "pcs"
  | "carats";

const HEADERS: Record<Field, string[]> = {
  date: ["date"],
  design: ["design number"],
  sub: ["sub design no", "sub desing no"],
  product: ["product"],
  buyer: ["buyer name"],
  status: ["status"],
  received: ["received date"],
  memo: ["memo no.", "memo no"],
  pcs: ["diamond pcs"],
  carats: ["diamond carats"],
};

function norm(v: Cell): string {
  return v == null ? "" : String(v).trim().toLowerCase().replace(/\s+/g, " ");
}

function text(v: Cell): string {
  return v == null ? "" : String(v).trim();
}

function num(v: Cell): number {
  if (typeof v === "number") return v;
  const n = parseFloat(text(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export type ColumnMap = Partial<Record<Field, number>> & { headerRow: number };

/** Find the header row by scanning the first 9 rows for "Design Number". */
export function findColumns(grid: Grid): ColumnMap | null {
  for (let r = 0; r < Math.min(9, grid.length); r++) {
    const row = grid[r] ?? [];
    if (!row.some((c) => norm(c) === "design number")) continue;
    const map: ColumnMap = { headerRow: r };
    row.forEach((c, i) => {
      const h = norm(c);
      for (const f of Object.keys(HEADERS) as Field[]) {
        if (map[f] === undefined && HEADERS[f].includes(h)) map[f] = i;
      }
    });
    return map;
  }
  return null;
}

export interface Block {
  factory: string;
  row: number; // 1-based sheet row of the block's first line
  rowCount: number;
  design: string;
  sub: string;
  product: string;
  buyer: string;
  memo: string;
  issue: number | null;
  received: number | null; // first received date in the block
  statuses: { row: number; value: string }[];
  pcs: number;
  carats: number;
}

/**
 * One order = one SUB DESIGN of a design block.
 *
 * A block starts on a row with a Design Number; following rows without one belong to it. Inside a block, every
 * row that carries a new Sub Design No starts its own order (e.g. SN-BR-TN-3CT-YG with subs 54…85 is 32 orders);
 * rows with an empty Sub Design No are further diamond sizes of the sub above. Each order has its own status,
 * received date, pieces and carats. Date, product, buyer and memo are written once per block and fill down to
 * every sub that has none of its own.
 */
export function toBlocks(factory: string, grid: Grid): Block[] {
  const cols = findColumns(grid);
  if (!cols || cols.design === undefined) return [];
  const get = (row: Cell[], f: Field): Cell => (cols[f] === undefined ? null : row[cols[f]!]);

  const items: Block[] = [];
  let group: Block[] = []; // the subs of the current design block
  const shared = { product: "", buyer: "", memo: "", issue: null as number | null };
  let cur: Block | null = null;

  const fillDown = () => {
    for (const it of group) {
      if (!it.product) it.product = shared.product;
      if (!it.buyer) it.buyer = shared.buyer;
      if (!it.memo) it.memo = shared.memo;
      if (it.issue === null) it.issue = shared.issue;
    }
    group = [];
  };
  const startItem = (r: number, design: string): Block => {
    const it: Block = {
      factory,
      row: r + 1,
      rowCount: 0,
      design,
      sub: "",
      product: "",
      buyer: "",
      memo: "",
      issue: null,
      received: null,
      statuses: [],
      pcs: 0,
      carats: 0,
    };
    items.push(it);
    group.push(it);
    return it;
  };

  for (let r = cols.headerRow + 1; r < grid.length; r++) {
    const row = grid[r] ?? [];
    const design = text(get(row, "design"));
    const sub = text(get(row, "sub"));
    if (design) {
      fillDown();
      Object.assign(shared, { product: "", buyer: "", memo: "", issue: null });
      cur = startItem(r, design);
    } else if (!cur) {
      continue; // rows above the first design number
    } else if (sub && cur.sub && norm(sub) !== norm(cur.sub)) {
      cur = startItem(r, cur.design); // next sub design under the same design number
    }
    cur.rowCount++;
    if (!cur.sub) cur.sub = sub;
    const product = text(get(row, "product"));
    const buyer = text(get(row, "buyer"));
    const memo = text(get(row, "memo"));
    const issue = parseDate(get(row, "date"));
    if (!cur.product) cur.product = product;
    if (!cur.buyer) cur.buyer = buyer;
    if (!cur.memo) cur.memo = memo;
    if (cur.issue === null) cur.issue = issue;
    if (!shared.product) shared.product = product;
    if (!shared.buyer) shared.buyer = buyer;
    if (!shared.memo) shared.memo = memo;
    if (shared.issue === null) shared.issue = issue;
    const rec = get(row, "received");
    if (cur.received === null && text(rec)) cur.received = parseDate(rec) ?? -1; // -1 = filled but unreadable
    const st = text(get(row, "status"));
    if (st) cur.statuses.push({ row: r + 1, value: st });
    cur.pcs += num(get(row, "pcs"));
    cur.carats += num(get(row, "carats"));
  }
  fillDown();
  return items;
}

/**
 * Copy the value of a merged Status / Received date / Date cell into every row it covers.
 * In the sheet a single merged "Received" spanning a design's rows means every sub design in those rows came back,
 * but the Sheets API returns the value only in the merge's top row. Other columns are left alone (a merged
 * Design Number or carats cell must not be repeated).
 */
export function fillMerges(
  grid: Grid,
  merges: { startRowIndex: number; endRowIndex: number; startColumnIndex: number; endColumnIndex: number }[],
): Grid {
  const cols = findColumns(grid);
  if (!cols || !merges.length) return grid;
  const targets = [cols.status, cols.received, cols.date].filter((c): c is number => c !== undefined);
  const out = grid.map((row) => [...(row ?? [])]);
  for (const m of merges) {
    for (const c of targets) {
      if (c < m.startColumnIndex || c >= m.endColumnIndex) continue;
      const top = out[m.startRowIndex]?.[c];
      if (top === undefined || top === null || top === "") continue;
      for (let r = m.startRowIndex + 1; r < m.endRowIndex && r < out.length; r++) {
        const row = (out[r] ??= []);
        while (row.length <= c) row.push("");
        if (row[c] === undefined || row[c] === null || row[c] === "") row[c] = top;
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------- add-ons (hidden from the board)

// "ADD-ON", "ADD ON", "ADDON", "Add-on 2", "(add on)" … anywhere in the design string
const ADD_ON = /\(?\badd[\s\-_.]*on\b\)?[\s\-_.#]*\d*\)?/i;

export function isAddOn(design: string): boolean {
  return ADD_ON.test(design);
}

/**
 * The sheet marks add-ons either in the Design Number ("SN-RG-SL-EM-014 ADD-ON") or, more often, in the
 * Sub Design No column ("ADD ON 014") with the Design Number unchanged.
 */
export function isAddOnBlock(b: { design: string; sub: string }): boolean {
  return isAddOn(b.design) || isAddOn(b.sub);
}

/** Design with any add-on marker removed, normalised for matching: "SN-RG-SL-EM-014 ADD-ON" → "SN-RG-SL-EM-014". */
export function baseDesign(design: string): string {
  return design
    .replace(ADD_ON, " ")
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/[-_.]{2,}/g, "-")
    .replace(/^[-_.]+|[-_.]+$/g, "");
}

// ---------------------------------------------------------------- the board

export interface Order {
  factory: string;
  row: number;
  design: string;
  sub: string;
  product: string;
  buyer: string;
  memo: string;
  issueDate: string;
  day: number;
  tier: Tier;
  stage: Stage;
  action: string;
  pcs: number;
  carats: number;
  statuses: string[];
}

export interface ExceptionItem {
  factory: string;
  row: number;
  design: string;
  detail: string;
}

export interface FactorySummary {
  factory: string;
  open: number;
  carats: number;
  breached: number;
  byStage: Record<Stage, { count: number; carats: number }>;
  tat: { n: number; mean: number | null; median: number | null };
}

export interface Board {
  today: string;
  orders: Order[]; // every open order, buyer first then longest overdue
  totals: {
    open: number;
    carats: number;
    buyer: number;
    byStage: Record<Stage, { count: number; carats: number }>;
  };
  factories: FactorySummary[];
  exceptions: {
    likelyReceived: ExceptionItem[];
    noDate: ExceptionItem[];
    oddStatus: ExceptionItem[];
    beforeCutoff: number;
  };
}

function emptyStages(): Record<Stage, { count: number; carats: number }> {
  const o = {} as Record<Stage, { count: number; carats: number }>;
  for (const s of STAGES) o[s] = { count: 0, carats: 0 };
  return o;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Build the whole board.
 * @param tabs  factory name → raw grid (header row included), in display order
 * @param today serial day number of "today" in Asia/Kolkata
 */
export function buildBoard(
  tabs: { name: string; grid: Grid }[],
  today: number,
  c: RulesConfig = DEFAULT_CONFIG,
): Board {
  const known = new Set(c.knownStatuses.map(foldStatus));
  const orders: Order[] = [];
  const ex: Board["exceptions"] = { likelyReceived: [], noDate: [], oddStatus: [], beforeCutoff: 0 };
  const factories: FactorySummary[] = [];

  for (const { name, grid } of tabs) {
    const fs: FactorySummary = {
      factory: name,
      open: 0,
      carats: 0,
      breached: 0,
      byStage: emptyStages(),
      tat: { n: 0, mean: null, median: null },
    };
    factories.push(fs);
    const tats: number[] = [];

    // add-on diamonds ("ADD ON 014" in Sub Design No, or "… ADD-ON" in Design Number) are not tracked: only main designs
    const blocks = toBlocks(name, grid).filter((b) => !isAddOnBlock(b));
    for (const b of blocks) {
      const ref = { factory: name, row: b.row, design: b.design };

      if (known.size) {
        for (const s of b.statuses) {
          if (!known.has(foldStatus(s.value))) {
            ex.oddStatus.push({ ...ref, row: s.row, detail: s.value });
          }
        }
      }

      const closed = b.statuses.some((s) => isClosingStatus(s.value, c));
      if (closed) {
        if (b.issue !== null && b.received !== null && b.received > 0) {
          const d = workingDaysBetween(b.issue, b.received);
          if (d > 0 && d < 400) tats.push(d);
        }
        continue;
      }

      if (b.received !== null) {
        ex.likelyReceived.push({
          ...ref,
          detail:
            b.received > 0 ? `received date ${serialToISO(b.received)}` : "received date filled (unreadable)",
        });
        continue;
      }
      if (b.issue === null) {
        ex.noDate.push({ ...ref, detail: "no usable issue date" });
        continue;
      }
      if (c.cutoffSerial !== null && b.issue < c.cutoffSerial) {
        ex.beforeCutoff++;
        continue;
      }

      const tier = tierFor(b.buyer);
      const day = workingDayNumber(b.issue, today);
      const stage = stageFor(tier, day, c);
      orders.push({
        factory: name,
        row: b.row,
        design: b.design,
        sub: b.sub,
        product: b.product,
        buyer: b.buyer,
        memo: b.memo,
        issueDate: serialToISO(b.issue),
        day,
        tier,
        stage,
        action: ACTION_TEXT[stage],
        pcs: b.pcs,
        carats: Math.round(b.carats * 1000) / 1000,
        statuses: b.statuses.map((s) => s.value),
      });
      fs.open++;
      fs.carats += b.carats;
      fs.byStage[stage].count++;
      fs.byStage[stage].carats += b.carats;
      if (stage === "Breach" || stage === "Critical") fs.breached++;
    }

    fs.tat = {
      n: tats.length,
      mean: tats.length ? round1(tats.reduce((a, x) => a + x, 0) / tats.length) : null,
      median: median(tats),
    };
  }

  orders.sort((a, b) => (a.tier === b.tier ? b.day - a.day : a.tier === "Buyer" ? -1 : 1));

  const byStage = emptyStages();
  const totalCarats = factories.reduce((a, f) => a + f.carats, 0);
  for (const f of factories) {
    f.carats = round1(f.carats);
    for (const s of STAGES) {
      byStage[s].count += f.byStage[s].count;
      byStage[s].carats += f.byStage[s].carats;
      f.byStage[s].carats = round1(f.byStage[s].carats);
    }
  }
  for (const s of STAGES) byStage[s].carats = round1(byStage[s].carats);

  return {
    today: serialToISO(today),
    orders,
    totals: {
      open: orders.length,
      carats: round1(totalCarats),
      buyer: orders.filter((o) => o.tier === "Buyer").length,
      byStage,
    },
    factories,
    exceptions: ex,
  };
}
