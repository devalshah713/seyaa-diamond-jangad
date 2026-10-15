# Jangad Follow-Up Board

Read-only audit board over the **Diamond Issue Jangad From Office** Google Sheet: which karigar orders
are late, by how much, and at which factory. Runs on **Cloudflare Pages** (static UI + one Pages Function).
Full requirements: [SPEC.md](SPEC.md).

```
web/index.html            the UI (Pages build output) — filters, KPI tiles, Follow-Up Today, All Pending Orders,
                          Factory Scorecard, Carats at Risk, Exceptions
functions/_middleware.ts  login guard: no valid session cookie → /login (pages) or 401 (API)
functions/api/login.ts    checks username/password live against the users sheet, sets a signed 12h cookie
functions/api/board.ts    GET /api/board → JSON, cached 60s in KV, ?refresh=1 bypasses
functions/api/admin/      admin-only user management (list, add, reset password, activate, role) → writes the users sheet
src/auth.ts               users-sheet parsing, PBKDF2 password hashes, HMAC session cookie (user + role)
web/admin.html            admin page (Role = Admin only)
src/rules.ts              THE LOGIC — pure functions: blocks, working-day clock, stages, closing, exceptions, TAT
src/sheets.ts             service-account JWT → access token → Sheets values:batchGet (read-only scope)
test/                     unit tests: §3 worked example, block/closing/exception rules, §4 baseline (needs snapshot)
wrangler.toml             Pages config: vars + KV binding (source of truth; the dashboard reads it on each build)
apps-script/              the Apps Script reference implementation (to be added)
```

## Develop

```sh
npm install
npm test                       # rules unit tests
npm run typecheck
cp .dev.vars.example .dev.vars # fill in the private key
npm run dev                    # http://localhost:8788
```

## Go live on Cloudflare Pages

Already done: code, `wrangler.toml`, KV namespace `jangad-board-cache`, service account
`jangad-board@vibrant-sound-511310-m3.iam.gserviceaccount.com`.

1. Share the sheet with the service-account email as **Viewer**.
2. Cloudflare → Workers & Pages → Create → **Pages** → Connect to Git → this repo.
   Project name `jangad-board` · framework preset *None* · build command *empty* · build output `web` · root directory *empty*.
3. Settings → Variables and Secrets → add **Secret** `GOOGLE_PRIVATE_KEY` (the `private_key` value from the JSON key),
   then Deployments → latest → *Retry deployment* so it takes effect.
4. Login: create a users sheet with row-1 headers `Username, Password, Full Name, Role, Active, Notes`, add the
   first admin row by hand (Role `Admin`, Active `Yes`), share it with the service account as **Editor**, set
   `USERS_SHEET_ID` in `wrangler.toml`, and add **Secret** `SESSION_SECRET` (any long random string).
   After that, users are managed from `/admin`. Failed logins are limited to 10 per IP per 15 minutes.
5. Verify against SPEC §4 (`npm run snapshot` then `npm test`, or compare the KPI tiles on 11 Oct 2026).

## Configuration (`wrangler.toml` `[vars]`)

| Var | Default | |
|---|---|---|
| `TABS` | the 5 in-scope tabs | exact tab names |
| `STOCK_DUE` / `BUYER_DUE` / `WARN2_DAY` / `FINAL_DAY` | 8 / 5 / 10 / 12 | stage thresholds |
| `RETURN_RECEIVED_CLOSES_ORDER` | `true` | SPEC §3 open decision |
| `CUTOFF_DATE` | empty | `yyyy-mm-dd`; hide orders issued before it |
| `KNOWN_STATUSES` | empty | Status dropdown values; enables the "odd status" exception |
| `CACHE_SECONDS` | 60 | KV minimum is 60 |
| `RATE_HEADER` | empty | exact heading of the per-carat price column; empty = found automatically (Rate, Price, Price/Ct …) |

## Unverified choices (check against Code.gs or the §4 baseline)

`rules.ts` was written from the spec without the Apps Script source. These points are interpretations:

- **Turnaround** = working days strictly after the issue date up to and including the received date.
- **Exception order**: an open block with a received date is "likely received" even if it also has no issue date.
- **Odd status** blocks are flagged but stay on the open list.
- **Issue date / buyer / memo** = first non-empty value anywhere in the block (normally its first row).
- **Status dropdown** values aren't in the spec, so the odd-status check is off until `KNOWN_STATUSES` is set.
