# Jangad Follow-Up Board — build spec

Everything needed to rebuild this system from scratch and deploy it on Cloudflare.
Hand this file to a new chat along with the repo.

Last verified against live data: **11 Oct 2026**.

---

## 1. What it is

A read-only audit board over a Google Sheet. Diamonds are issued from the office to karigars
(manufacturers) against a design number. The board shows which orders are late, by how much, and
at which factory — so one follow-up employee can chase them.

**It never writes to the sheet.** Read-only, always.

---

## 2. Data source

Google Sheet: **Diamond Issue Jangad From Office**
ID: `1IhNZlP3YxM8lVTboyxB2EeJkReGN86ONSHi-buNkE3I`
Owner: `seyaalabjewel@gmail.com` · Timezone: `Asia/Kolkata`

15 tabs, one per vendor. **Only these 5 are in scope:**

| Tab | Data rows (11 Oct 2026) |
|---|---|
| `Seyaa Solitaire` | 4,598 |
| `PRATIK C-6` | 6,829 |
| `RAKESH BABU` | 89 |
| `RAJKUMAR` | 2,392 |
| `Anthem Jewels` | 207 |

Tab names are matched exactly, including the hyphen in `PRATIK C-6`.

### Columns

Header is on **row 1** on all five tabs; data starts row 2. Do not hardcode this — find the
header row by scanning the first ~9 rows for a cell equal to `Design Number` (case-insensitive),
then map header text to column index. Column order differs between tabs.

Columns used (match on lowercased header text, accept the aliases):

| Purpose | Header | Aliases |
|---|---|---|
| issue date | `Date` | `DATE` |
| design | `Design Number` | — |
| sub-design | `Sub Design No` | `SUB DESING NO`, `SUB DESIGN NO` |
| product | `Product` | — |
| buyer | `Buyer Name` | — |
| status | `Status` | — |
| received date | `Received date` | `Received Date` |
| memo | `Memo No.` | `Memo No` |
| pieces | `Diamond Pcs` | — |
| carats | `Diamond Carats` | — |

`SETTING` also exists and is genuine setting data — **not** buyer name. Ignore it.

### THE CRITICAL STRUCTURE RULE — design blocks

**One order is a design BLOCK, not a row.**

A block starts on any row where `Design Number` is non-empty. Every following row with an empty
`Design Number` belongs to that same block — these are additional diamond sizes for the same
design. Date, sub-design, product, buyer and memo appear only on the block's first row. A block
can run to 50 rows.

On `PRATIK C-6` only 1,834 of 6,829 rows carry a design number. **Counting rows instead of blocks
overstates order counts by roughly 20×.**

Per block: forward-fill design / date / sub / product / buyer / memo; collect every row's status
and received date; sum `Diamond Pcs` and `Diamond Carats` across all rows in the block.

The date column is also **vertically merged** across each block in the sheet. The Sheets API
returns the value only in the top cell of a merge — forward-filling handles this.

---

## 3. Business rules

### Working days
Mon–Sat count. **Sundays are skipped.** Public holidays count as working days.
**Day 1 = the issue date itself.** If the issue date is a Sunday, day 1 is the Monday.

Worked example — issued Sunday 1 Mar 2026:
day 1 = Mon 2 Mar · day 5 = **Fri 6 Mar** · day 8 = **Tue 10 Mar** · day 10 = Thu 12 Mar ·
day 12 = Sat 14 Mar · breach from Mon 16 Mar.
Use this as a unit test.

### Priority — derived, never typed
| `Buyer Name` cell | Tier | Clock |
|---|---|---|
| filled | **Buyer** (highest) | due day **5** |
| empty | **Stock** | due day **8** |

### Stages
**Stock:** `< 8` On Track · `8–9` Warning 1 · `10–11` Warning 2 · `= 12` Final Warning · `13+` Breach
**Buyer:** `< 5` On Track · `= 5` Due Today · `6+` Critical

No day-4 pre-warning. The first buyer warning is given on day 5, the due day itself.

### Closing
A block is **closed** if any row in it has a status of `Received`, `Return Received` or
`Cancelled`. Closed blocks drop off the board.

Status matching must be **tolerant**: lowercase, strip every non-letter, then compare. The sheet
contains `Received`, `Recieved`, `Return Received`, `Retrun received`, `RETURN RECEIVED`,
`ReturnReceived`. All must fold correctly.

⚠️ **OPEN DECISION:** `Return Received` is currently treated as **closed**. If it actually means
only the leftover stones came back and the product is still owed, flip it to open — this affects
hundreds of orders and would significantly increase the reported exposure.

### Exceptions — excluded from the open list, shown separately
| Case | Rule |
|---|---|
| Received date filled, no Received status | excluded, flagged "likely received" |
| No usable issue date on the block | excluded, no clock can run |
| Status value outside the dropdown | flagged with tab + row + value |

### Turnaround (factory scorecard)
For closed blocks with both an issue date and a received date: working days between them.
Keep only `0 < days < 400`. Report **count, mean and median** per factory — mean and median
diverge sharply because of never-closed rows, so show both.

---

## 4. Baseline for regression testing

A rebuild must reproduce these from the 11 Oct 2026 data:

```
open orders   379          carats out  13,609.6
Breach 166 · Final Warning 17 · Warning 2 16 · Warning 1 30 · On Track 146 · Due Today 4
by factory    PRATIK C-6 183 (8,929.1 cts) · Seyaa Solitaire 177 (3,598.2)
              RAJKUMAR 17 (1,081.6) · Anthem Jewels 2 (0.8) · RAKESH BABU 0
buyer orders  7
exceptions    likely received 9 · no date 16 · odd status 1
TAT           Seyaa 96/74.9/79 · PRATIK 72/53.5/21 · RAKESH 5/20.8/16
              RAJKUMAR 9/46.3/45 · Anthem 7/131.4/129      (n / mean / median)
```

---

## 5. Known data quirks

- **The sheet's locale used to read `01/05` as 5 January instead of 1 May.** 1,017 dates were
  corrected in Oct 2026 and the locale was changed. Dates in the Date column are now real date
  values. **The other date columns — Received date, Date of Dia Return, Sell Given Date — have
  NOT been corrected.** Treat received dates with suspicion until they are.
- Design numbers use both `SN-` and `SS-` prefixes for the same product type. **Never match on
  the prefix.** For tennis bracelets, match on `BR` + `TN` together.
- Sub-design is sometimes embedded in the design string, e.g. `SN-BR-TN-5C-WG-005-010`. Add-on
  diamonds shipped later carry an add-on suffix and belong to the ORIGINAL order — they must not
  start a new clock. *Exact parsing convention still unconfirmed.*
- Some rows show 0.00 carats. Some non-design text sits in the Design Number column
  (e.g. `TRUPTI BHABHI` on RAJKUMAR).
- A long tail of orders reads day 150–250. These are rows nobody ever closed, not goods genuinely
  held for a year. Consider an issue-date cut-off so the chase list stays usable.

---

## 6. Current implementation (the reference)

Google Apps Script web app, deployed from a standalone project:

- `Code.gs` — `doGet()` serves the page; `getBoardData()` reads the 5 tabs via
  `SpreadsheetApp.openById(SHEET_ID)` and returns the computed payload.
- `Index.html` — the UI; calls `google.script.run.getBoardData()`.

Live URL:
`https://script.google.com/macros/s/AKfycbws3zRd86Hp-IIP9zXuKfYpPdHlFqOKf2w-BXbU7kgSQraP0UwrcGpb61QwvUtmzSyo/exec`

**Commit both files to the repo.** The rules above are already implemented there correctly and
verified against real data — port the logic, don't re-derive it.

Note: an Apps Script web-app deployment is pinned to a **version**. After editing: Save, then
Deploy ▸ Manage deployments ▸ pencil ▸ Version: **New version** ▸ Deploy. Saving alone changes
nothing on the live URL.

---

## 7. Cloudflare deployment — the one hard part

Apps Script reads the sheet for free because it runs inside Google. **A Cloudflare Worker has no
such access and this is the main thing to solve.**

### Authentication: Google service account
1. Google Cloud Console → create a service account → create a **JSON key**.
2. **Share the Google Sheet with the service account's email** (Viewer is enough).
3. Enable the **Google Sheets API** on that project.
4. In the Worker, build a JWT (`RS256`), sign it with Web Crypto
   (`crypto.subtle.importKey` with `pkcs8` + `RSASSA-PKCS1-v1_5`), exchange it at
   `https://oauth2.googleapis.com/token` for an access token, then call:
   `GET https://sheets.googleapis.com/v4/spreadsheets/{id}/values:batchGet`
   with `ranges=` for each of the 5 tabs and `valueRenderOption=UNFORMATTED_VALUE`,
   `dateTimeRenderOption=SERIAL_NUMBER`.
5. Store the private key as a **Worker secret** (`wrangler secret put GOOGLE_PRIVATE_KEY`).
   Never commit it.

### Date handling
With `SERIAL_NUMBER`, dates arrive as Google serials. Convert:
`new Date(Date.UTC(1899, 11, 30) + serial * 86400000)`, then read as a date-only value.
Do not let the Worker's UTC default shift the day — all day arithmetic must be done on
date-only values, not timestamps.

### Caching
The sheet is ~15,000 rows across 5 tabs. Cache the computed payload in **Workers KV** or the
Cache API for 30–60 seconds, keyed by nothing (single global). Add a cache-bypass query param for
a "Refresh now" button. Show the data timestamp on the page so nobody acts on a stale view.

### Suggested shape
```
/worker/src/index.ts     routes: GET / (page), GET /api/board (JSON)
/worker/src/sheets.ts    service-account JWT, token exchange, batchGet
/worker/src/rules.ts     THE LOGIC — blocks, clock, stages, closing, exceptions, TAT
/worker/test/rules.test.ts   unit tests against the §3 example and §4 baseline
/web/                    the UI (port Index.html)
/apps-script/            Code.gs + Index.html, the reference implementation
SPEC.md                  this file
```

Keep `rules.ts` free of any I/O — pure functions over arrays of rows. That is what makes the §4
baseline testable in CI.

### Access control
The Apps Script version runs as the owner, so staff see the board without access to the sheet.
On Cloudflare the Worker holds the credentials, so the same is true — but the board is then open
to anyone with the URL. Put **Cloudflare Access** in front of it and allow only the staff emails.

---

## 8. Configuration to expose

```
SHEET_ID        1IhNZlP3YxM8lVTboyxB2EeJkReGN86ONSHi-buNkE3I
TZ              Asia/Kolkata
TABS            Seyaa Solitaire, PRATIK C-6, RAKESH BABU, RAJKUMAR, Anthem Jewels
STOCK_DUE       8
BUYER_DUE       5
WARN2_DAY       10
FINAL_DAY       12
RETURN_RECEIVED_CLOSES_ORDER   true    // see the open decision in §3
CUTOFF_DATE     (unset)                // optional: ignore orders issued before this
```

---

## 9. The UI

Five screens behind tabs, plus a pinned band and a KPI strip:

- **Buyer band** — pinned above everything, dark, always visible. Buyer orders at or past day 5.
- **KPI tiles** — Open · On Track · Warning 1 · Warning 2+Final · Breached. Count **and** carats.
- **Follow-Up Today** — the default tab. Only orders at or past a warning step, buyer first then
  longest overdue. Each line states the action in words ("Warning 2 — final reminder").
- **Action Queue** — every open order. Filter by factory, priority, stage; search by design number.
- **Factory Scorecard** — mean and median actual TAT per factory against the 8-day target, with
  open count, breached count and carats out.
- **Carats at Risk** — stacked bar per factory by stage, measured in carats not count.
- **Exceptions** — the §3 exception buckets, each with counts and examples.

Severity is encoded in form as well as colour (a left stripe on the day number, solid chips for
Breach and Critical) so it reads at a glance. Dark and light themes both.

---

## 10. Open decisions

1. **`Return Received` — closed, or product still owed?** Affects hundreds of orders.
2. **Backlog cut-off** — 166 orders are breached, some at day 248. Cut-off date, or bulk-close the
   old rows in the sheet?
3. **Add-on parsing convention** — which segment of `SN-BR-TN-5C-WG-005-010` is the sub-design and
   which is the add-on.
4. The other date columns still need the locale correction applied.
