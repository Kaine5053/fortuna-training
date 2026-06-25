# Build Notes & Audit — Fortuna Training Matrix

## Audit of the handover (mistakes / drift / hallucinations)

**Verified accurate.** Every table, column, and the Phase 2 verification data in
`BUILD_BRIEF.md` matches the live Supabase DB exactly. No schema drift, no hallucinated
tables/columns. The `tm-cards` bucket exists and is private. RLS policies are present and
correct (`authenticated` can read/write all `tm_` tables).

**Issues found:**

1. **Missing files (the main problem).** `START_HERE.md` and `BUILD_BRIEF.md` both refer to
   four files as the "single source of truth" that were **not in the package**:
   `schema-reference.md`, `types.ts`, `supabaseClient.ts`, and the approved mock
   `option-3-ledger.html`. I reconstructed the first three from the live database
   (`schema-reference.md` here, plus `src/lib/types.ts` and `src/lib/supabaseClient.ts`).
   The visual mock could not be recovered — the ledger styling below follows the brief's
   written description (Fraunces/Inter, ivory/brass/ink palette, glyph cells). If you still
   have `option-3-ledger.html`, drop it in and I'll match it pixel-for-pixel.

2. **"Create your admin login" is partly moot.** The brief says to create an admin user in
   the dashboard, but **5 auth users already exist** (e.g. `james@fortunacivilsltd.co.uk`).
   You can sign in with an existing account, or add yours under Authentication → Users.

3. **Single-file `supabaseClient.ts` won't compile.** The brief implies one client file with
   both browser + server setup, but mixing `next/headers` into a module imported by a Client
   Component breaks the build. Split into `supabaseClient.ts` (browser) and
   `supabaseServer.ts` (server) — standard Supabase SSR pattern.

4. **Next.js version.** Pinned to `15.5.19` (latest patched 15.x) rather than an older 15.x
   flagged by CVE-2025-66478.

## What's built (Phases 0–10 — ALL COMPLETE)

- **Phase 0** — Next.js 15.5 (App Router, TS), Tailwind, `@supabase/ssr`, session-refresh
  middleware protecting everything except `/login`, `netlify.toml` with `@netlify/plugin-nextjs`
  (SSR, not static export). Production build compiles clean.
- **Phase 1** — `/login` (email+password), protected app shell (dark header, brass rule,
  Matrix/Expiring/Role-gaps nav), logout. Unauthenticated users redirect to `/login` (verified: 307).
- **Phase 2** — Ledger matrix grid reading live `tm_` data: frozen operative column (name+role),
  sticky section headers, vertical competency labels, colour+glyph cells via `STATUS_COLOUR` +
  `statusFromExpiry`, search, section filter chips, Active/Archive toggle. Status is always derived.
- **Phase 3** — Cell lightbox (card front/back via signed URLs); operative edit panel (role +
  per-competency tickets, evidence card creation, audit-logged).
- **Phase 4** — Add operative / competency / section / role + role-requirements editor (`+ Add` menu).
- **Phase 5** — Multi-select archive / reactivate (select-all with indeterminate, per-row reactivate).
- **Phase 6** — Expiring dashboard (30/60/90/lapsed windows, summary cards, soonest-first list, renew).
- **Phase 7** — Role gaps view (missing/lapsed vs role requirements, nav badge, requirements editor).
- **Phase 8** — Renew with supersede history (single + bulk), optional card-image replacement.
- **Phase 9** — Branded per-operative PDF export (jsPDF, one page each, embedded card images,
  S63 9HN footer + colour key, code-split so it loads on demand).
- **Phase 10** — Arrange modal: drag to reorder sections and move/reorder competencies between
  sections (persists `position` / `section_id`).

Every mutation writes a `tm_audit_log` row. Each phase's DB write path was validated against the
live database inside a rolled-back transaction (nothing test-related was persisted).

## Run locally

```bash
cd fortuna-training
npm install
# .env.local already contains the project URL + anon key
npm run dev      # http://localhost:3000
```

Sign in with an existing Supabase auth user. The matrix should show Nathan Annables with
CSCS in-date, 360 + Dumper lapsed, NRSWA/Confined Space/SSSTS in-date, the rest grey.

## Deploy (Netlify, subdomain `training-matrix`)

1. `git init` + push `fortuna-training` to GitHub.
2. Netlify → Add new site → Import from GitHub. Build command `next build` (the committed
   `netlify.toml` + `@netlify/plugin-nextjs` handle SSR automatically).
3. Site settings → Environment variables: add `NEXT_PUBLIC_SUPABASE_URL` and
   `NEXT_PUBLIC_SUPABASE_ANON_KEY` (values in `.env.local`).
4. Domain management → add `training-matrix.<yourdomain>` → create a CNAME at your DNS
   provider pointing the `training-matrix` host at the Netlify target. SSL auto-provisions.

## Remaining phases (not yet built)
3 — cell lightbox + operative edit panel · 4 — add operative/competency/section/roles ·
5 — archive/reactivate · 6 — expiring dashboard · 7 — role gaps · 8 — renew (single+bulk) ·
9 — PDF export · 10 — drag-arrange. Each writes a `tm_audit_log` row per the brief.
