# Fortuna Training Matrix — Build Sections (ledger)

Spec: `docs/superpowers/specs/2026-09-25-live-training-matrix-design.md`
Rules: `CLAUDE.md`. Plans: `docs/superpowers/plans/`. Recaps: `docs/Session-Recaps.md`.

Tick a section only when its suite is green, it is pushed, and its recap is appended.
`⬜` not started · `🔶` in progress · `✅ <date>` done.

## Phase A — Foundation (`A-foundation.md`)

| ID | Section | Status |
|---|---|---|
| S1 | Test harness, Supabase local, scripts | ⬜ |
| S2 | Profiles migration + admins table replaces allowlist | ⬜ |
| S3 | Knowledge base: schemes + card types + seed | ⬜ |
| S4 | Agent tables migration (ingest, queries, aliases, chases, runs, api keys, card columns, ticket trigger) | ⬜ |
| S5 | Row-level security + refusal tests | ⬜ |

## Phase B — The agent (`B-agent.md`)

| ID | Section | Status |
|---|---|---|
| S6 | Status and chase-ladder logic (fixed clock) | ⬜ |
| S7 | Operative matching + aliases (`find_operative`) | ⬜ |
| S8 | Reader contract: prompt, extraction schema, validation | ⬜ |
| S9 | `read_card` tool: Claude vision, PDF/image normalise, split | ⬜ |
| S10 | `enter_card` tool: supersede chain, tickets, threshold gate | ⬜ |
| S11 | `raise_query` tool + `apply-answer` function | ⬜ |
| S12 | `send_email` tool: Graph client + address gate | ⬜ |
| S13 | `read-card` queue worker + agent runs log | ⬜ |
| S14 | `sweep-expiry` cron + chases | ⬜ |
| S15 | `digest-admin` cron + "Email this list" | ⬜ |

## Phase C — Intake doors (`C-intake.md`)

| ID | Section | Status |
|---|---|---|
| S16 | OneDrive: Graph drive client, webhook, hourly catch-up, backfill | ⬜ |
| S17 | Ledger ingest modal live (`ingest-modal`) | ⬜ |
| S18 | Email replies (`ingest-email`) | ⬜ |

## Phase D — Ledger additions (`D-ledger.md`)

| ID | Section | Status |
|---|---|---|
| S19 | Queries tab, badge, answer UI | ⬜ |
| S20 | Operative profile panel (public, private, cards, chases, invite) | ⬜ |
| S21 | Card types + settings admin | ⬜ |
| S22 | Agent page: runs, cost, run now, backfill | ⬜ |

## Phase E — Portal, API, deploy (`E-portal-api-deploy.md`)

| ID | Section | Status |
|---|---|---|
| S23 | Portal auth: invite, login, role routing, account | ⬜ |
| S24 | Portal my cards + upload (`ingest-portal`) | ⬜ |
| S25 | Portal profile form | ⬜ |
| S26 | Read-only API v1, deploy checklist, website link | ⬜ |

## Owed by Kaine (never block a section)

- [ ] Docker Desktop installed so `supabase start` runs locally (S1). Fallback: sections run unit tests only and integration tests are marked "deferred" in the recap.
- [ ] Mailbox `support@fortunacivilsltd.co.uk` created in Microsoft 365 (S12).
- [ ] Azure app registration: `Mail.Send`, `Mail.Read`, `Files.Read.All` application permissions, admin consent; tenant id, client id, client secret into Supabase secrets (S12, S16).
- [ ] The OneDrive drive id for `FORTUNA CIVILS LTD` (S16). Command in the plan.
- [ ] Netlify: CNAME `training-matrix` at the DNS provider (S26).
- [ ] Website: "Staff login" link to `https://training-matrix.fortunacivils.co.uk/portal` (S26).
- [ ] Confirm the operative list and personnel folder names (S2 seeds from `FORTUNA CIVILS TRAINING MATRIX.xlsx`).
- [ ] `ANTHROPIC_API_KEY` into Supabase secrets (S9).
