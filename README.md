# Jangad Follow-Up Board

Read-only audit board over the **Diamond Issue Jangad From Office** Google Sheet: which karigar orders
are late, by how much, and at which factory. Runs as a Cloudflare Worker. Full requirements: [SPEC.md](SPEC.md).

```
worker/src/rules.ts     THE LOGIC — pure functions: blocks, working-day clock, stages, closing, exceptions, TAT
worker/src/sheets.ts    service-account JWT → access token → Sheets values:batchGet (read-only scope)
worker/src/index.ts     GET /api/board (JSON, cached 60s in KV, ?refresh=1 bypasses) · everything else → /web
worker/test/            unit tests: §3 worked example, block/closing/exception rules, §4 baseline (needs snapshot)
web/index.html          the UI — buyer band, KPI tiles, Follow-Up Today, Action Queue, Scorecard, Carats at Risk, Exceptions
apps-script/            the Apps Script reference implementation (to be added)
```

## Develop

```sh
cd worker
npm install
npm test             # rules unit tests
npm run typecheck
cp .dev.vars.example .dev.vars   # fill in the service account
npm run dev          # http://localhost:8787
```

## Go live — checklist

Already done: Worker code, config, KV namespace `jangad-board-cache` (id in `wrangler.toml`).

1. **Google service account** (Google Cloud Console, any project you own)
   - IAM & Admin → Service Accounts → *Create* (e.g. `jangad-board`). No roles needed.
   - Keys → *Add key* → JSON. Keep the file private; never commit it.
   - APIs & Services → enable **Google Sheets API**.
2. **Share the sheet** with the service account's email as **Viewer** (from `seyaalabjewel@gmail.com`).
3. **Configure the Worker**
   - Put the service-account email in `GOOGLE_CLIENT_EMAIL` in `worker/wrangler.toml`.
   - `npx wrangler secret put GOOGLE_PRIVATE_KEY` and paste the `private_key` value from the JSON key.
4. **Deploy**: `cd worker && npx wrangler login && npm run deploy` (or set `CLOUDFLARE_API_TOKEN`).
   The board is then at `https://jangad-board.<your-subdomain>.workers.dev`.
5. **Lock it down**: Cloudflare Zero Trust → Access → Applications → *Add* → Self-hosted, domain =
   the Worker URL, policy *Allow* → *Emails* = the staff list. Until this is done, anyone with the URL can see the board.
6. **Verify against §4**: `npm run snapshot` writes `test/fixtures/sheet-<date>.json`; with the
   11 Oct 2026 snapshot, `npm test` runs the baseline suite (379 open, 13,609.6 cts, …).

## Configuration (`worker/wrangler.toml` `[vars]`)

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
