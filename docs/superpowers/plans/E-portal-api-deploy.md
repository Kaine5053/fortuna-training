# Phase E — Portal, API and Deploy Implementation Plan (S23–S26)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan one
> section at a time. Steps use checkbox (`- [ ]`) syntax for tracking. One section per terminal session.

**Goal:** Operatives sign in on their phone, see their cards, upload renewals and keep their own profile;
the main Fortuna Civils App can read competencies over a token-protected API; the whole thing is live on
`training-matrix.fortunacivils.co.uk` with the crons and Graph subscriptions running.

**Architecture:** The portal is a second route group `src/app/portal/` in the same Next.js app, sharing
`globals.css` and the ledger tokens, phone-first layout. Middleware routes by role: admins to `/`,
operatives to `/portal`, neither to `/not-authorised`. All portal writes go through server actions that
rely on RLS (S5) rather than re-checking ownership in code, and the tests prove RLS is doing the work.

**Tech Stack:** Next.js 15, Supabase Auth (email+password, invite token flow), Supabase Storage, Netlify.

**Spec:** sections 8 (Portal), 9, 10, 13.

## Global Constraints

- No public sign-up. A portal account exists only through an invite link from the ledger.
- Portal pages render in under 200 KB of JS on first load (no jsPDF, no drag-and-drop libraries).
- Every portal form field maps to a column from S2; nothing new is added to the schema in this phase.
- The API never returns `tm_operative_private` columns, chase bodies or query text.
- Deploy only from `main` with the full suite green.

## Review Focus

1. Invite link opened twice: second open says "this link has been used, ask the office for a new one".
   S23 test.
2. An operative who is archived after registering: login succeeds, portal shows "Your account is
   inactive, contact the office" and nothing else. S23 test.
3. A phone upload of a 12 MB HEIC: accepted, downscaled server-side by S9's normaliser, never rejected
   for size below 25 MB. S24 test on the size gate.
4. Profile form submitted with only some required fields: saved as a draft, `profile_completed_at`
   stays null, the missing fields are listed. S25 test.
5. API called with a revoked key: 401 with no body detail. S26 test.

---

## S23 — Portal auth: invite, login, role routing, account

**Files:**
- Create: `src/app/portal/layout.tsx`, `src/app/portal/login/page.tsx`, `src/app/portal/invite/[token]/page.tsx`,
  `src/app/portal/invite/[token]/actions.ts`, `src/app/portal/account/page.tsx`, `src/app/portal/inactive/page.tsx`,
  `src/lib/role.ts`, `supabase/functions/accept-invite/index.ts`, `tests/unit/role.test.ts`,
  `tests/integration/s23_invite.test.ts`
- Modify: `src/middleware.ts` + `src/lib/supabaseMiddleware.ts` (role routing), `src/app/login/page.tsx`
  (admin login unchanged, but a link "Operative? Sign in here" to `/portal/login`)

**Interfaces:**
- Produces: `resolveRole(supabase, userId): Promise<"admin" | "operative" | "none">`;
  `routeFor(role, pathname): string | null` (null = allow); `accept-invite` function:
  `{ token, password }` → creates the auth user (or links an existing one by the operative's email), sets
  `auth_user_id`, clears `invite_token`, returns a session.

- [ ] **Step 1: Failing tests**

```ts
import { routeFor } from "@/lib/role";
it("admins on /portal go to /, operatives on / go to /portal, none go to /not-authorised", () => {
  expect(routeFor("admin", "/portal")).toBe("/");
  expect(routeFor("operative", "/")).toBe("/portal");
  expect(routeFor("operative", "/portal/upload")).toBeNull();
  expect(routeFor("none", "/portal")).toBe("/not-authorised");
});
it("public paths need no role", () => { for (const p of ["/login", "/portal/login", "/portal/invite/abc", "/auth/signout"]) expect(routeFor("none", p)).toBeNull(); });
```

Integration (`s23_invite.test.ts`): insert an operative with email and token → call `accept-invite`
with the token → assert `auth_user_id` set, token null, a session returned. Call again with the same
token → 410 with body `{ reason: "used" }`. Insert with `invite_sent_at` 8 days ago → 410 `{ reason: "expired" }`.
Archive the operative → sign in → `resolveRole` still "operative" and the layout renders the inactive page.

- [ ] **Step 2: Implement**

`role.ts`:

```ts
export type Role = "admin" | "operative" | "none";
const PUBLIC = [/^\/login$/, /^\/portal\/login$/, /^\/portal\/invite\//, /^\/auth\//, /^\/not-authorised$/, /^\/api\//];
export function routeFor(role: Role, pathname: string): string | null {
  if (PUBLIC.some((r) => r.test(pathname))) return null;
  const inPortal = pathname.startsWith("/portal");
  if (role === "admin") return inPortal ? "/" : null;
  if (role === "operative") return inPortal ? null : "/portal";
  return "/not-authorised";
}
export async function resolveRole(supabase, userId): Promise<Role> {
  if (await isAdmin(supabase, userId)) return "admin";
  const { data } = await supabase.from("tm_operatives").select("id").eq("auth_user_id", userId).maybeSingle();
  return data ? "operative" : "none";
}
```

`supabaseMiddleware.ts`: after `getUser()`, call `resolveRole` and `routeFor`; redirect if non-null.
`accept-invite/index.ts`: service role; look up operative by `invite_token`; check TTL from
`tm_settings.invite_ttl_days`; `auth.admin.createUser({ email, password, email_confirm: true })` or find
existing by email; update operative; `signInWithPassword` server-side and return the session tokens; audit
`invite.accepted`. The page `/portal/invite/[token]` shows the operative's name and a set-password form,
then sets the session cookies and redirects to `/portal/profile`.
`/portal/account`: change password (reuse the admin `account` page logic). `/portal/login`: email +
password, ledger styling, phone-first.
`portal/layout.tsx`: header with the Fortuna wordmark, the operative's name, links My cards · Upload ·
Profile · Account · Sign out; if `archived`, render `/portal/inactive` content only.

- [ ] **Step 3: Tests green, commit**

```bash
git add -A && git commit -m "feat(s23): portal auth with invites, role routing and account page" && git push
```

---

## S24 — Portal my cards + upload (`ingest-portal`)

**Files:**
- Create: `src/app/portal/page.tsx`, `src/app/portal/upload/page.tsx`, `src/app/portal/upload/actions.ts`,
  `src/components/portal/MyCards.tsx`, `src/components/portal/UploadForm.tsx`, `src/components/portal/UploadStatus.tsx`,
  `supabase/functions/ingest-portal/index.ts`, `src/lib/portalCards.ts`, `tests/unit/portal_cards.test.ts`,
  `tests/integration/s24_portal_upload.test.ts`

**Interfaces:**
- Produces: `myCards(supabase): Promise<MyCardRow[]>` where `MyCardRow = { competency; section; status; expiry; daysLeft; cardType; frontUrl }`
  (RLS restricts to own rows; the function adds nothing); `uploadCard(formData): Promise<{ itemIds }>`;
  `myUploads(supabase): Promise<{ itemId; fileName; state; friendly: string }[]>`.

- [ ] **Step 1: Failing tests**

```ts
it("maps ticket + competency + card into a row with derived status and the ledger glyph", () => {});
it("friendly upload states: received→'Received, being read', queried→'The office has a question', entered→'Entered ✓', rejected→'Could not use this file'", () => {});
it("size gate: 25 MB accepted, 25.1 MB refused with a message", () => {});
```

Integration: sign in as operative A, call `ingest-portal` with a fixture image → item has
`operative_id = A`, `source = portal`; A can read the item, B cannot (`s24` extends the S5 pattern).

- [ ] **Step 2: Build**

`/portal` (My cards): a single column list grouped by section, each row = competency name, status glyph
+ colour from `STATUS_COLOUR`, expiry and "n days left" or "lapsed n days ago"; lapsed and expiring rows
first. A banner at the top when anything is within 30 days: "2 tickets need renewing — upload the new
card". Tap a row → the card image (signed URL) in the existing lightbox.
`/portal/upload`: one file input with `capture="environment"`, "Front" and "Reverse" slots, optional
"What is it?" free-text note that becomes `operative_hint` suffix, Submit. Below: "Your recent uploads"
list with friendly states, polling every 3 s while any is `received`/`read`.
`ingest-portal/index.ts`: operative JWT required; resolve `tm_my_operative_id()` via a select on
`tm_operatives` with the user's client; `receiveFile({ source: "portal", operativeHint: full_name })`, set
`operative_id` on the item; 202 + `EdgeRuntime.waitUntil(runBatch(...))`.

- [ ] **Step 3: Tests green, drive on a phone-width viewport, commit**

```bash
git add -A && git commit -m "feat(s24): portal my cards and upload through the shared ingest pipeline" && git push
```

---

## S25 — Portal profile form

**Files:**
- Create: `src/app/portal/profile/page.tsx`, `src/app/portal/profile/actions.ts`,
  `src/components/portal/ProfileForm.tsx`, `tests/unit/profile_completion.test.ts`,
  `tests/integration/s25_profile_rls.test.ts`
- Modify: `src/lib/profileForm.ts` (from S20; add `requiredFor(employmentType)` and `completion(operative, priv)`)

**Interfaces:**
- Produces: `requiredFor(type): string[]` (paye: name, phone, email, dob, address, postcode, NI, emergency
  contact name+phone; subbie: paye set + UTR + CIS status; agency: name, phone, email, dob, emergency
  contact); `completion(op, priv): { complete: boolean; missing: string[] }`;
  `saveMyProfile(formData): Promise<{ saved: true; missing: string[] }>`.

- [ ] **Step 1: Failing tests**

```ts
it("subbie requires UTR and CIS status; paye does not", () => {});
it("completion lists missing fields by label and is false until all present", () => {});
it("saving a partial form keeps profile_completed_at null and returns the missing list", async () => {});
it("saving a complete form sets profile_completed_at once and never clears it", async () => {});
```

Integration: operative A saves their profile → `tm_operative_private` row upserted for A; A attempting
to update B's row via the same action with B's id → RLS refuses (0 rows), and the action reports "not
saved".

- [ ] **Step 2: Build**

One page, sections: **About you** (name, phone, email, employment type read-only with "ask the office to
change", start date read-only), **Home** (address, postcode), **Personal** (date of birth, NI number),
**Emergency contact** (name, phone, relation), **Medical** (free text, "only what the site needs to know"),
**Subcontractor** (UTR, CIS status; shown only for subbies). Save button; after save a completion strip:
"Profile complete" or "Still needed: …". Basic layout, ledger tokens, no extras.

- [ ] **Step 3: Tests green, commit**

```bash
git add -A && git commit -m "feat(s25): portal profile form with completion tracking" && git push
```

---

## S26 — Read-only API v1, deploy checklist, website link

**Files:**
- Create: `src/app/api/v1/_auth.ts`, `src/app/api/v1/operatives/route.ts`,
  `src/app/api/v1/operatives/[id]/competencies/route.ts`, `src/app/api/v1/expiring/route.ts`,
  `src/app/(app)/settings/api-keys.tsx` (create/revoke keys, shows the key once),
  `docs/DEPLOY-CHECKLIST.md`, `docs/API.md`, `tests/unit/api_auth.test.ts`, `tests/integration/s26_api.test.ts`
- Modify: `DEPLOY.md` (superseded note pointing to the checklist), `netlify.toml` (headers: no-store on `/api/*`)

**Interfaces:**
- Produces: `authenticateApiKey(req, db): Promise<{ ok: true; keyId } | { ok: false }>` (bearer token, sha256
  compared to `tm_api_keys.key_hash`, `revoked_at is null`);
  `GET /api/v1/operatives` → `[{ id, full_name, role, employment_type, archived }]`;
  `GET /api/v1/operatives/:id/competencies` → `[{ competency, section, status, expiry_date, card_type, verified }]`;
  `GET /api/v1/expiring?days=90` → `[{ operative_id, full_name, competency, expiry_date, days_left, status }]`.

- [ ] **Step 1: Failing tests**

```ts
it("missing, malformed, unknown and revoked keys all give 401 with an empty body", async () => {});
it("competencies response carries derived status and never private columns", async () => {});
it("expiring honours days and excludes archived operatives", async () => {});
```

- [ ] **Step 2: Implement** the three routes with the service client (RLS bypass is fine: the key is the
gate), response shaped exactly as above, `Cache-Control: no-store`. Keys page under Settings.

- [ ] **Step 3: Deploy checklist** — write `docs/DEPLOY-CHECKLIST.md` with these steps in order, each
with the exact command or click path:

1. `npm run test:all && npm run typecheck && npm run build` green on `main`.
2. `supabase db push` (migrations S1–S26 applied to `klftjnzbncabueycooct`; confirm with `supabase migration list`).
3. `supabase functions deploy` for: `read-card apply-answer sweep-expiry digest-admin ingest-onedrive onedrive-catchup ingest-modal ingest-email ingest-portal accept-invite send-invite`.
4. `supabase secrets set` for the seven secrets in `docs/HANDOFF.md` plus `GRAPH_CLIENT_STATE`.
5. `alter database` settings for `app.settings.functions_url` and `app.settings.service_key` (crons).
6. Confirm the five cron jobs in `cron.job`: `tm-read-card`, `tm-sweep-expiry`, `tm-digest-admin`, `tm-onedrive-catchup`, plus the mail subscription renewal.
7. Netlify: env vars `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`; deploy from `main`; add
   domain `training-matrix.fortunacivils.co.uk`; CNAME at the DNS provider; wait for SSL.
8. Agent page → Renew Graph subscriptions (creates the drive and mail subscriptions against the live URL).
9. Agent page → Backfill OneDrive (dry run first, then real).
10. Smoke: sign in as admin; upload a synthetic card via the modal; watch it enter; answer one query;
    sign in as a test operative via an invite; upload from a phone; check the sweep by setting one test
    ticket to expire in 30 days and pressing Run sweep.
11. Website: add "Staff login" → `https://training-matrix.fortunacivils.co.uk/portal` (owed by Kaine;
    record the date in the ledger when done).

- [ ] **Step 4: Tests green, commit, tag**

```bash
git add -A && git commit -m "feat(s26): read-only API v1, API keys, deploy checklist" && git tag v1.0.0 && git push --tags && git push
```

Build complete. The ledger should show S1–S26 ticked; the owed list is the only remaining work.
