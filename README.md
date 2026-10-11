# Jangad Follow-Up Board

Read-only audit board over the **Diamond Issue Jangad From Office** Google Sheet: which karigar orders
are late, by how much, and at which factory. Runs on **Cloudflare Pages** (static UI + one Pages Function).
Full requirements: [SPEC.md](SPEC.md).

```
web/index.html            the UI (Pages build output) — buyer band, KPI tiles, Follow-Up Today, Action Queue,
                          Factory Scorecard, Carats at Risk, Exceptions
functions/api/board.ts    Pages Function: GET /api/board → JSON, cached 60s in KV, ?refresh=1 bypasses
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
4. Zero Trust → Access → Applications → Self-hosted for `jangad-board.pages.dev` (and `*.jangad-board.pages.dev`),
   policy *Allow* → *Emails* = the staff list.
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

## Unverified choices (check against Code.gs or the §4 baseline)

`rules.ts` was written from the spec without the Apps Script source. These points are interpretations:

- **Turnaround** = working days strictly after the issue date up to and including the received date.
- **Exception order**: an open block with a received date is "likely received" even if it also has no issue date.
- **Odd status** blocks are flagged but stay on the open list.
- **Issue date / buyer / memo** = first non-empty value anywhere in the block (normally its first row).
- **Status dropdown** values aren't in the spec, so the odd-status check is off until `KNOWN_STATUSES` is set.
