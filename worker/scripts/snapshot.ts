// Pull the 5 tabs into test/fixtures/sheet-<today>.json so the §4 baseline test can run offline.
// Credentials come from the environment or worker/.dev.vars (GOOGLE_CLIENT_EMAIL, GOOGLE_PRIVATE_KEY).
// Usage: npm run snapshot
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { readTabs } from "../src/sheets.ts";

const vars: Record<string, string> = { ...(process.env as Record<string, string>) };
if (existsSync(".dev.vars")) {
  for (const line of readFileSync(".dev.vars", "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*"?(.*?)"?\s*$/);
    if (m && !vars[m[1]]) vars[m[1]] = m[2];
  }
}
const toml = readFileSync("wrangler.toml", "utf8");
const tomlVar = (k: string) => toml.match(new RegExp(`^${k}\\s*=\\s*"([^"]*)"`, "m"))?.[1] ?? "";
const sheetId = vars.SHEET_ID || tomlVar("SHEET_ID");
const tabs = (vars.TABS || tomlVar("TABS")).split(",").map((s) => s.trim());
const clientEmail = vars.GOOGLE_CLIENT_EMAIL || tomlVar("GOOGLE_CLIENT_EMAIL");

const grids = await readTabs({ clientEmail, privateKey: vars.GOOGLE_PRIVATE_KEY }, sheetId, tabs);
const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
mkdirSync("test/fixtures", { recursive: true });
const out = `test/fixtures/sheet-${today}.json`;
writeFileSync(out, JSON.stringify({ takenAt: new Date().toISOString(), sheetId, tabs: grids }));
for (const g of grids) console.log(`${g.name.padEnd(16)} ${g.grid.length - 1} rows`);
console.log(`→ ${out}`);
