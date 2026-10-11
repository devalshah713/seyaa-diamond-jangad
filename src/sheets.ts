// Read-only access to the Google Sheet via a service account.
// JWT (RS256, signed with Web Crypto) → OAuth access token → values:batchGet.

import type { Grid } from "./rules";

export const READ_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";
// Used only for the users sheet. The service account has Viewer on the Jangad sheet,
// so even this scope cannot write there.
export const WRITE_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

export interface ServiceAccount {
  clientEmail: string;
  privateKey: string; // PEM, "-----BEGIN PRIVATE KEY-----…"; literal "\n" sequences are accepted
}

const tokenCache = new Map<string, { token: string; expires: number }>();

function b64url(data: ArrayBuffer | Uint8Array | string): string {
  const bytes =
    typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data as ArrayBuffer);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function importKey(pem: string): Promise<CryptoKey> {
  const body = pem
    .replace(/\\n/g, "\n")
    .replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
}

export async function getAccessToken(sa: ServiceAccount, scope = READ_SCOPE): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const cacheKey = `${sa.clientEmail} ${scope}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expires > now + 60) return cached.token;
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({ iss: sa.clientEmail, scope, aud: TOKEN_URL, iat: now, exp: now + 3600 }),
  );
  const key = await importKey(sa.privateKey);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${header}.${claims}`));
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${header}.${claims}.${b64url(sig)}`,
    }),
  });
  if (!res.ok) throw new Error(`Google token exchange failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache.set(cacheKey, { token: json.access_token, expires: now + json.expires_in });
  return json.access_token;
}

/** Whole-tab values for each named tab, as unformatted values with dates as serial numbers. */
export async function readTabs(
  sa: ServiceAccount,
  sheetId: string,
  tabs: string[],
): Promise<{ name: string; grid: Grid }[]> {
  const token = await getAccessToken(sa);
  const qs = new URLSearchParams({
    valueRenderOption: "UNFORMATTED_VALUE",
    dateTimeRenderOption: "SERIAL_NUMBER",
    majorDimension: "ROWS",
  });
  for (const t of tabs) qs.append("ranges", `'${t.replace(/'/g, "''")}'`);
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values:batchGet?${qs}`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`Sheets batchGet failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { valueRanges?: { values?: Grid }[] };
  return tabs.map((name, i) => ({ name, grid: json.valueRanges?.[i]?.values ?? [] }));
}

/**
 * One range as the user sees it (FORMATTED_VALUE), so a password typed as 0123 stays "0123".
 * `tab` empty = the spreadsheet's first tab.
 */
export async function readFormattedTab(sa: ServiceAccount, sheetId: string, tab: string): Promise<Grid> {
  const token = await getAccessToken(sa);
  const range = tab ? `'${tab.replace(/'/g, "''")}'` : "A:ZZ";
  const qs = new URLSearchParams({ valueRenderOption: "FORMATTED_VALUE", majorDimension: "ROWS" });
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${encodeURIComponent(range)}?${qs}`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`Reading the users sheet failed: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { values?: Grid }).values ?? [];
}

const tabPrefix = (tab: string) => (tab ? `'${tab.replace(/'/g, "''")}'!` : "");

/** Append one row after the last row of the table. RAW keeps "0123" and "pbkdf2$…" exactly as given. */
export async function appendRow(sa: ServiceAccount, sheetId: string, tab: string, row: string[]): Promise<void> {
  const token = await getAccessToken(sa, WRITE_SCOPE);
  const range = encodeURIComponent(`${tabPrefix(tab)}A1`);
  const qs = new URLSearchParams({ valueInputOption: "RAW", insertDataOption: "INSERT_ROWS" });
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${range}:append?${qs}`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ values: [row] }),
    },
  );
  if (!res.ok) throw new Error(`Saving the new user failed: ${res.status} ${await res.text()}`);
}

/** Overwrite individual cells, e.g. [{ cell: "B7", value: "pbkdf2$…" }]. */
export async function updateCells(
  sa: ServiceAccount,
  sheetId: string,
  tab: string,
  cells: { cell: string; value: string }[],
): Promise<void> {
  if (!cells.length) return;
  const token = await getAccessToken(sa, WRITE_SCOPE);
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values:batchUpdate`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        valueInputOption: "RAW",
        data: cells.map((c) => ({ range: `${tabPrefix(tab)}${c.cell}`, values: [[c.value]] })),
      }),
    },
  );
  if (!res.ok) throw new Error(`Updating the user failed: ${res.status} ${await res.text()}`);
}
