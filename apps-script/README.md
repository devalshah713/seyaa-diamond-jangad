# Reference implementation (Google Apps Script)

SPEC §6 asks for `Code.gs` and `Index.html` from the live Apps Script web app to be committed here.
They were not available when the Worker was built, so `worker/src/rules.ts` was written from SPEC.md alone.

To add them: open the Apps Script project (owner `seyaalabjewel@gmail.com`), copy both files into this
folder unchanged, and commit. Then diff the logic against `worker/src/rules.ts` — see "Unverified
choices" in the top-level README.
