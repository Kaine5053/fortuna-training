# Fortuna Training Matrix — session rules

This build runs as **numbered 30-minute section sessions (S1–S26)**, the same way the Fortuna Civils App
and Forge builds ran. These rules apply to **every** session opened in this repo.

- **Spec:** `docs/superpowers/specs/2026-09-25-live-training-matrix-design.md` — the source of truth.
- **Approved front end:** `docs/option-3-ledger.html` — implemented as drawn, never reinterpreted.
- **Plans (one per phase):** `docs/superpowers/plans/` — `A-foundation`, `B-agent`, `C-intake`,
  `D-ledger`, `E-portal-api-deploy`. Each section names the plan file it lives in.
- **Ledger (resume map):** `docs/Build-Sections.md`
- **Recaps:** `docs/Session-Recaps.md`
- **Kick-off / how to run a session:** `docs/HANDOFF.md`

## Starting a session

1. Read `CLAUDE.md`, the spec, the ledger and the plan file for the section named in the prompt,
   **before** touching code. The ledger sequences; it never adds scope.
2. Build **one section only**. Nothing is invented, renamed or reinterpreted outside the spec.
3. TDD: failing test first, cite real file paths, paste real test output. Never claim green without it.
4. **Human decision points auto-accept Claude's recommendation.** Record it as "decided by default rule"
   in the recap and keep building. Things Claude physically cannot do (Azure consent, DNS, mailbox
   creation, Netlify clicks) go on the "owed by Kaine" list in the ledger and **never block** a section.
5. Secrets never enter the repo. `.env.local` and `supabase/.env` are git-ignored. If a section needs a
   secret Kaine has not supplied, build against a stub and add the secret to the owed list.

## Ending a session (in this order)

1. Full relevant suite green, output pasted: `npm test` (unit) and, when Docker is up,
   `npm run test:integration` (RLS + migrations against local Supabase).
2. **Commit + push** to `Kaine5053/fortuna-training`. The repo is public: no card images with real
   people, no real personal data in fixtures, no keys.
3. **Tick the section in the ledger** (`⬜` → `✅ <date>`) and update "owed by Kaine" if it changed.
4. **Append the recap** to `docs/Session-Recaps.md`, newest at the bottom, heading
   `## <date> — Section <ID> (<short title>)`. Never overwrite earlier entries. The recap **ends in plain
   English**: what exists now that didn't, what it lets Kaine do, no file paths / function names / hashes /
   test counts in that part.
5. Stop. Kaine launches the next section from the terminal himself (see `docs/HANDOFF.md`). Do not
   auto-launch tabs and do not self-close.

## Build doctrine (from the spec)

- **The card is the record.** Status is derived from cards and today's date, never stored as truth.
- **Nothing below the confidence threshold is ever entered.** Uncertain reads become queries to Kaine.
- **Gates live in the tools and the database, not the UI.** Each gate has a test proving a direct call
  is refused: `enter_card` below threshold, `send_email` to an unknown address, an operative JWT reading
  another operative's rows or the private table.
- **Forward-only migrations**, one per section that needs one, under `supabase/migrations/`,
  named `<timestamp>_s<ID>_<slug>.sql`. Never edit a shipped migration.
- **Every write audits.** App and agent writes produce a `tm_audit_log` row.
- **The private table is the special-category boundary.** The agent's role has no grant on it.
- **A card expiring on the 30th is valid all day on the 30th.** Day-of-expiry counts as in date.

## Stack facts a fresh session needs

- Next.js 15 (App Router, TypeScript), Tailwind, `@supabase/ssr`. App code in `src/`.
- Supabase project `klftjnzbncabueycooct` (eu-west-2). Local dev via Supabase CLI + Docker
  (`supabase start`). Edge Functions in `supabase/functions/` (Deno). Shared pure logic in
  `supabase/functions/_shared/` written in runtime-neutral TypeScript so Vitest can test it.
- Tests: Vitest. `tests/unit/**` runs anywhere; `tests/integration/**` needs `SUPABASE_LOCAL=1`.
- Claude: `@anthropic-ai/sdk`, model `claude-fable-5-1`, prompt caching on the knowledge-base block.
- Microsoft Graph: client-credentials app; mailbox `support@fortunacivilsltd.co.uk`; drive = the
  OneDrive holding `FORTUNA CIVILS LTD/PERSONELL FILES`.
- Deploy: Netlify (`netlify.toml` present), domain `training-matrix.fortunacivils.co.uk`.
