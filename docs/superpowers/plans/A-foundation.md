# Phase A — Foundation Implementation Plan (S1–S5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan one
> section at a time. Steps use checkbox (`- [ ]`) syntax for tracking. One section per terminal session.

**Goal:** Give the existing Next.js + Supabase app a test harness, the full data model from the spec, and
row-level security that is proven by tests, so every later phase builds on a locked schema.

**Architecture:** Forward-only SQL migrations under `supabase/migrations/`, one per section. Pure
TypeScript logic lives in `src/lib/` (app) or `supabase/functions/_shared/` (agent) and is tested with
Vitest. Integration tests run against a local Supabase started with Docker and are skipped when it is not
running, so a section is never blocked by environment.

**Tech Stack:** Next.js 15, TypeScript 5, Supabase CLI ≥ 1.200, Postgres 15, Vitest 2, `@supabase/supabase-js` 2.

**Spec:** `docs/superpowers/specs/2026-09-25-live-training-matrix-design.md` (sections 4 and 9).

## Global Constraints

- All new tables are `tm_` prefixed. `profiles`, `timesheets`, `admin_emails` are never touched.
- Migrations are named `<YYYYMMDDHHMMSS>_s<ID>_<slug>.sql`; a shipped migration is never edited.
- Existing columns are never repurposed; new columns are added with defaults so existing rows stay valid.
- No real personal data in fixtures or seeds. Seed operatives use the names already in the approved mock
  (Connor Whitfield, Priya Anand, …) except Nathan Annables, who already exists in the live database.
- Day-of-expiry counts as in date (`daysUntil(expiry) >= 0` → not lapsed).
- `.env.local` is git-ignored; tests read `SUPABASE_LOCAL=1` to enable integration tests.

## Review Focus

1. A migration run twice (`supabase db reset` then `db push`) must not fail: every `create` is
   `if not exists` and every `alter table add column` is `if not exists`. Test in S2 step 6.
2. Existing 5 auth users who are not in `tm_admins` and have no `tm_operatives.auth_user_id` must be
   redirected to `/not-authorised`, not crash. Test in S2 (access) step 3.
3. An operative with `archived = true` still has RLS-readable rows for admin but is invisible to the
   operative portal queries (own row only, but archived shows a notice). Covered in S5 policies test.
4. `tm_card_types.default_validity_months` of `null` (permanent) must not break validation later; the
   seed test in S3 asserts every `renewal_rule = 'permanent'` row has null validity and vice versa.
5. Ticket status trigger (S4) must never write `expiring`/`lapsed` from a `null` expiry: test asserts
   `no_expiry` or `not_held` for null.

---

## S1 — Test harness, Supabase local, scripts

**Files:**
- Create: `vitest.config.ts`, `tests/unit/smoke.test.ts`, `tests/integration/_client.ts`,
  `tests/integration/smoke.test.ts`, `supabase/config.toml` (via `supabase init`), `.env.test.example`
- Modify: `package.json` (scripts, devDependencies), `.gitignore`, `tsconfig.json` (exclude `supabase/functions`)

**Interfaces:**
- Produces: `tests/integration/_client.ts` exporting `localAdmin()` (service-role client),
  `localAnon()` (anon client), `signInAs(email, password)` returning a user-scoped client, and
  `integrationEnabled` boolean. Every later integration test imports these.

- [ ] **Step 1: Install and configure Vitest**

```bash
npm i -D vitest @vitest/coverage-v8 dotenv
```

`vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/_setup.ts"],
    coverage: { reporter: ["text"], include: ["src/lib/**", "supabase/functions/_shared/**"] },
  },
});
```

`tests/_setup.ts`:

```ts
import { config } from "dotenv";
config({ path: ".env.test" });
```

`.env.test.example` (copy to `.env.test`, git-ignored):

```
SUPABASE_LOCAL=1
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_ANON_KEY=<from supabase start>
SUPABASE_SERVICE_ROLE_KEY=<from supabase start>
```

Add to `.gitignore`: `.env.test`, `supabase/.env`, `supabase/.temp`.

- [ ] **Step 2: Write the failing smoke test**

`tests/unit/smoke.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { statusFromExpiry } from "@/lib/types";

describe("harness", () => {
  it("resolves the @ alias and runs existing logic", () => {
    expect(statusFromExpiry(null, true)).toBe("no_expiry");
  });
});
```

- [ ] **Step 3: Run it and watch it fail (no script yet)**

Run: `npm test`
Expected: `Missing script: "test"`.

- [ ] **Step 4: Add scripts**

In `package.json`:

```json
"test": "vitest run tests/unit",
"test:watch": "vitest tests/unit",
"test:integration": "vitest run tests/integration",
"test:all": "vitest run",
"db:start": "supabase start",
"db:reset": "supabase db reset",
"db:push": "supabase db push",
"typecheck": "tsc --noEmit"
```

In `tsconfig.json` `exclude`: add `"supabase/functions/**"` (Deno files are type-checked by Deno, not tsc).

- [ ] **Step 5: Run and pass**

Run: `npm test`
Expected: `1 passed`.

- [ ] **Step 6: Initialise Supabase locally**

```bash
supabase init
supabase link --project-ref klftjnzbncabueycooct
supabase db pull   # writes supabase/migrations/<ts>_remote_schema.sql — the baseline of the live DB
```

Commit the pulled baseline as-is. It is the only migration that was not written by hand and it is never
edited. If Docker is not installed, `supabase db pull` still works (it uses the remote); only
`supabase start` needs Docker.

- [ ] **Step 7: Integration client helper**

`tests/integration/_client.ts`:

```ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const integrationEnabled = process.env.SUPABASE_LOCAL === "1";
const url = process.env.SUPABASE_URL ?? "";
const anon = process.env.SUPABASE_ANON_KEY ?? "";
const service = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

export function localAdmin(): SupabaseClient {
  return createClient(url, service, { auth: { persistSession: false } });
}
export function localAnon(): SupabaseClient {
  return createClient(url, anon, { auth: { persistSession: false } });
}
/** Creates the user if missing (service role), then signs in and returns a user-scoped client. */
export async function signInAs(email: string, password: string): Promise<SupabaseClient> {
  const admin = localAdmin();
  const { data: list } = await admin.auth.admin.listUsers();
  if (!list.users.some((u) => u.email === email)) {
    await admin.auth.admin.createUser({ email, password, email_confirm: true });
  }
  const client = localAnon();
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return client;
}
```

`tests/integration/smoke.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { integrationEnabled, localAdmin } from "./_client";

describe.skipIf(!integrationEnabled)("local supabase", () => {
  it("answers on the tm_sections table", async () => {
    const { error } = await localAdmin().from("tm_sections").select("id").limit(1);
    expect(error).toBeNull();
  });
});
```

- [ ] **Step 8: Run integration (with Docker) or confirm the skip (without)**

Run: `npm run db:start && npm run test:integration`
Expected with Docker: `1 passed`. Without Docker: `1 skipped` and the recap says integration deferred.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "chore(s1): vitest harness, supabase local, baseline migration"
```

---

## S2 — Profiles migration + admins table replaces allowlist

**Files:**
- Create: `supabase/migrations/<ts>_s2_profiles.sql`, `src/lib/admins.ts`, `tests/unit/admins.test.ts`,
  `tests/integration/s2_profiles.test.ts`, `supabase/seed.sql`
- Modify: `src/app/(app)/layout.tsx:17` (replace `isAllowedEmail`), `src/lib/types.ts` (operative type)
- Delete: `src/lib/access.ts` (after the layout no longer imports it)

**Interfaces:**
- Produces: `isAdmin(supabase, userId): Promise<boolean>` in `src/lib/admins.ts`;
  `TmOperative` gains `email, phone, auth_user_id, employment_type, start_date, onedrive_folder,
  invite_token, invite_sent_at, profile_completed_at`; new type `TmOperativePrivate`.

- [ ] **Step 1: Write the migration**

`supabase/migrations/<ts>_s2_profiles.sql`:

```sql
-- S2: operative profiles, private table, admins, settings
alter table tm_operatives
  add column if not exists email text,
  add column if not exists phone text,
  add column if not exists auth_user_id uuid unique references auth.users(id) on delete set null,
  add column if not exists employment_type text check (employment_type in ('paye','subbie','agency')),
  add column if not exists start_date date,
  add column if not exists onedrive_folder text,
  add column if not exists invite_token text unique,
  add column if not exists invite_sent_at timestamptz,
  add column if not exists profile_completed_at timestamptz;

create table if not exists tm_operative_private (
  operative_id uuid primary key references tm_operatives(id) on delete cascade,
  date_of_birth date,
  ni_number text,
  address_line1 text, address_line2 text, address_line3 text, postcode text,
  emergency_contact_name text, emergency_contact_phone text, emergency_contact_relation text,
  medical_notes text,
  utr text, cis_status text check (cis_status in ('gross','net','unmatched')), cis_verified_at date,
  right_to_work_checked_at date, right_to_work_document_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists tm_admins (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  added_by uuid references auth.users(id),
  added_at timestamptz not null default now()
);

create table if not exists tm_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

insert into tm_settings (key, value) values
  ('chase_rungs', '[90,60,30]'),
  ('digest_weekday', '1'),
  ('confidence_threshold', '0.85'),
  ('sender_address', '"support@fortunacivilsltd.co.uk"'),
  ('invite_ttl_days', '7'),
  ('retention_years_after_archive', '6'),
  ('watch_root', '"FORTUNA CIVILS LTD/PERSONELL FILES"'),
  ('claude_price_per_mtok', '{"in": 3, "out": 15}')
on conflict (key) do nothing;

-- Seed admins from the existing allowlist (ids resolved from auth.users by email).
insert into tm_admins (auth_user_id, email)
select id, email from auth.users
where lower(email) in ('kainesmith123@live.com','james@fortunacivilsltd.co.uk')
on conflict do nothing;

-- updated_at trigger shared by later tables
create or replace function tm_touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists tm_operative_private_touch on tm_operative_private;
create trigger tm_operative_private_touch before update on tm_operative_private
  for each row execute function tm_touch_updated_at();
```

- [ ] **Step 2: Write the failing unit test for `isAdmin`**

`tests/unit/admins.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { isAdmin } from "@/lib/admins";

function fakeSupabase(rows: { auth_user_id: string }[]) {
  return {
    from: () => ({
      select: () => ({
        eq: (_c: string, v: string) => ({
          maybeSingle: async () => ({ data: rows.find((r) => r.auth_user_id === v) ?? null, error: null }),
        }),
      }),
    }),
  } as unknown as Parameters<typeof isAdmin>[0];
}

describe("isAdmin", () => {
  it("is true only for a row in tm_admins", async () => {
    const sb = fakeSupabase([{ auth_user_id: "u1" }]);
    expect(await isAdmin(sb, "u1")).toBe(true);
    expect(await isAdmin(sb, "u2")).toBe(false);
  });
});
```

- [ ] **Step 3: Run, fail, implement**

Run: `npm test -- admins` → FAIL "Cannot find module '@/lib/admins'".

`src/lib/admins.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

export async function isAdmin(supabase: SupabaseClient, userId: string): Promise<boolean> {
  const { data } = await supabase.from("tm_admins").select("auth_user_id").eq("auth_user_id", userId).maybeSingle();
  return !!data;
}
```

In `src/app/(app)/layout.tsx` replace the allowlist line:

```ts
if (!(await isAdmin(supabase, user.id))) redirect("/not-authorised");
```

and the import. Delete `src/lib/access.ts`. Run `npm run typecheck` to confirm nothing else imports it.

- [ ] **Step 4: Extend types**

In `src/lib/types.ts` add to `TmOperative`:

```ts
email: string | null; phone: string | null; auth_user_id: string | null;
employment_type: "paye" | "subbie" | "agency" | null; start_date: string | null;
onedrive_folder: string | null; invite_token: string | null; invite_sent_at: string | null;
profile_completed_at: string | null;
```

and:

```ts
export interface TmOperativePrivate {
  operative_id: string; date_of_birth: string | null; ni_number: string | null;
  address_line1: string | null; address_line2: string | null; address_line3: string | null; postcode: string | null;
  emergency_contact_name: string | null; emergency_contact_phone: string | null; emergency_contact_relation: string | null;
  medical_notes: string | null; utr: string | null; cis_status: "gross" | "net" | "unmatched" | null;
  cis_verified_at: string | null; right_to_work_checked_at: string | null; right_to_work_document_path: string | null;
  created_at: string; updated_at: string;
}
```

- [ ] **Step 5: Integration test**

`tests/integration/s2_profiles.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { integrationEnabled, localAdmin } from "./_client";

describe.skipIf(!integrationEnabled)("S2 profiles migration", () => {
  it("has the new columns and tables", async () => {
    const sb = localAdmin();
    const { error: e1 } = await sb.from("tm_operatives").select("email, phone, auth_user_id, employment_type").limit(1);
    const { error: e2 } = await sb.from("tm_operative_private").select("operative_id").limit(1);
    const { error: e3 } = await sb.from("tm_admins").select("email").limit(1);
    const { data: s } = await sb.from("tm_settings").select("key,value").eq("key", "confidence_threshold").single();
    expect(e1).toBeNull(); expect(e2).toBeNull(); expect(e3).toBeNull();
    expect(s?.value).toBe(0.85);
  });
  it("rejects an unknown employment_type", async () => {
    const { error } = await localAdmin().from("tm_operatives").insert({ full_name: "Zed Test", employment_type: "volunteer" });
    expect(error?.message).toMatch(/employment_type/);
  });
});
```

- [ ] **Step 6: Apply twice and run**

Run: `npm run db:reset && npm run db:reset && npm run test:integration`
Expected: both resets succeed (idempotent), tests pass. Then `npm test`, `npm run typecheck`.

- [ ] **Step 7: Seed file for local dev**

`supabase/seed.sql`: insert two admins as auth users is not possible from SQL; instead insert
operatives from the approved mock's first ten names with roles, e.g.

```sql
insert into tm_operatives (full_name, employment_type, onedrive_folder)
values ('Connor Whitfield','paye','Connor Whitfield'), ('Priya Anand','subbie','Priya Anand'),
       ('Lewis Marsh','paye','Lewis Marsh'), ('Tomasz Kowal','agency','Tomasz Kowal')
on conflict do nothing;
```

- [ ] **Step 8: Commit and push**

```bash
git add -A && git commit -m "feat(s2): operative profiles, private table, admins table, settings"
git push
```

---

## S3 — Knowledge base: schemes, card types, seed

**Files:**
- Create: `supabase/migrations/<ts>_s3_knowledge_base.sql`, `supabase/functions/_shared/knowledge/seed.ts`
  (the seed as typed data, used by both the SQL seed generator and the reader prompt),
  `supabase/functions/_shared/knowledge/index.ts`, `tests/unit/knowledge.test.ts`,
  `scripts/gen-kb-seed.ts` (turns `seed.ts` into SQL inserts so the data is written once)
- Modify: `src/lib/types.ts` (add `TmScheme`, `TmCardType`)

**Interfaces:**
- Produces: `CardTypeSeed` type, `CARD_TYPES: CardTypeSeed[]`, `SCHEMES: SchemeSeed[]`,
  `findCardType(scheme: string, name: string): CardTypeSeed | undefined`,
  `knowledgeBlock(): string` (the text block the reader prompt embeds; cached by Claude).

- [ ] **Step 1: Migration**

```sql
create table if not exists tm_schemes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  issuer text,
  verify_url text,
  verify_method text check (verify_method in ('smart_check','issuer_site','phone','none')) default 'none',
  notes text,
  created_at timestamptz not null default now()
);
create table if not exists tm_card_types (
  id uuid primary key default gen_random_uuid(),
  scheme_id uuid not null references tm_schemes(id),
  name text not null,
  colour text,
  what_it_proves text,
  default_validity_months int,
  renewal_rule text not null check (renewal_rule in ('renew','progression','permanent','grace')),
  grace_months int default 0,
  progression_note text,
  front_features text,
  back_features text,
  maps_to_competency_ids uuid[] not null default '{}',
  endorsement_pattern text,
  code_synonyms jsonb not null default '{}',   -- e.g. {"N202":"360 Excavator ≥10t","A59":"360 Excavator ≥10t"}
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (scheme_id, name),
  check ((renewal_rule = 'permanent') = (default_validity_months is null))
);
drop trigger if exists tm_card_types_touch on tm_card_types;
create trigger tm_card_types_touch before update on tm_card_types for each row execute function tm_touch_updated_at();
-- seed inserts appended by scripts/gen-kb-seed.ts
```

- [ ] **Step 2: Failing unit test for the seed data**

`tests/unit/knowledge.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { CARD_TYPES, SCHEMES, findCardType, knowledgeBlock } from "../../supabase/functions/_shared/knowledge";

describe("knowledge base seed", () => {
  it("covers the schemes Fortuna meets", () => {
    for (const c of ["CSCS","CPCS","NPORS","NRSWA","EUSR","CITB","FAW","IPAF","PASMA","CISRS"])
      expect(SCHEMES.some((s) => s.code === c), c).toBe(true);
  });
  it("permanent ⇔ null validity", () => {
    for (const t of CARD_TYPES)
      expect(t.renewal_rule === "permanent", `${t.scheme} ${t.name}`).toBe(t.default_validity_months === null);
  });
  it("finds the CSCS blue skilled card at 60 months, renew", () => {
    const t = findCardType("CSCS", "Blue Skilled Worker")!;
    expect(t.default_validity_months).toBe(60);
    expect(t.renewal_rule).toBe("renew");
  });
  it("marks CSCS red trainee as progression, 6 months", () => {
    const t = findCardType("CSCS", "Red Trainee")!;
    expect(t.renewal_rule).toBe("progression");
    expect(t.default_validity_months).toBe(6);
  });
  it("knowledge block names every active card type once", () => {
    const block = knowledgeBlock();
    for (const t of CARD_TYPES.filter((x) => x.active)) expect(block).toContain(`${t.scheme} — ${t.name}`);
  });
});
```

- [ ] **Step 3: Run, fail, write the seed**

`supabase/functions/_shared/knowledge/seed.ts` (excerpt; complete the list from the spec's validity
clusters — the file is data, keep it flat):

```ts
export interface SchemeSeed { code: string; name: string; issuer: string; verify_url: string | null; verify_method: "smart_check"|"issuer_site"|"phone"|"none"; notes?: string }
export interface CardTypeSeed {
  scheme: string; name: string; colour: string | null; what_it_proves: string;
  default_validity_months: number | null; renewal_rule: "renew"|"progression"|"permanent"|"grace";
  grace_months: number; progression_note: string | null; front_features: string; back_features: string;
  competencies: string[]; endorsement_pattern: string | null; code_synonyms: Record<string, string>; active: boolean;
}
export const SCHEMES: SchemeSeed[] = [
  { code: "CSCS", name: "Construction Skills Certification Scheme", issuer: "CSCS Ltd", verify_url: "https://www.cscs.uk.com/cscs-smart-check", verify_method: "smart_check" },
  { code: "CPCS", name: "Construction Plant Competence Scheme", issuer: "NOCN Job Cards", verify_url: "https://www.cscs.uk.com/cscs-smart-check", verify_method: "smart_check" },
  { code: "NPORS", name: "National Plant Operators Registration Scheme", issuer: "NPORS Ltd", verify_url: "https://www.cscs.uk.com/cscs-smart-check", verify_method: "smart_check" },
  { code: "NRSWA", name: "Street Works Qualifications Register", issuer: "SWQR", verify_url: "https://www.swqr.co.uk", verify_method: "issuer_site" },
  { code: "EUSR", name: "Energy & Utility Skills Register", issuer: "EU Skills", verify_url: "https://www.eusr.co.uk", verify_method: "issuer_site" },
  { code: "CITB", name: "CITB Health, Safety & Environment Test", issuer: "CITB", verify_url: null, verify_method: "none" },
  { code: "FAW", name: "First Aid at Work / Emergency First Aid at Work", issuer: "Various (HSE-compliant providers)", verify_url: null, verify_method: "phone" },
  { code: "IPAF", name: "IPAF PAL Card", issuer: "IPAF", verify_url: "https://www.ipaf.org/en/verify-pal-card", verify_method: "issuer_site" },
  { code: "PASMA", name: "PASMA Card", issuer: "PASMA", verify_url: "https://pasma.co.uk/card-check", verify_method: "issuer_site" },
  { code: "CISRS", name: "Construction Industry Scaffolders Record Scheme", issuer: "CISRS", verify_url: "https://www.cscs.uk.com/cscs-smart-check", verify_method: "smart_check" },
];
export const CARD_TYPES: CardTypeSeed[] = [
  { scheme: "CSCS", name: "Green Labourer", colour: "green", what_it_proves: "Labourer with CITB HS&E test and L1 award", default_validity_months: 60, renewal_rule: "renew", grace_months: 0, progression_note: null,
    front_features: "Green band, CSCS logo, holder photo, name, registration number, expiry date bottom-right", back_features: "Occupation 'Labourer', QR / smart chip", competencies: ["CSCS Card"], endorsement_pattern: null, active: true },
  { scheme: "CSCS", name: "Blue Skilled Worker", colour: "blue", what_it_proves: "NVQ/SVQ L2 in the occupation", default_validity_months: 60, renewal_rule: "renew", grace_months: 0, progression_note: null,
    front_features: "Blue band, occupation printed, photo, expiry", back_features: "Qualification and occupation", competencies: ["CSCS Card"], endorsement_pattern: null, active: true },
  { scheme: "CSCS", name: "Red Trainee", colour: "red", what_it_proves: "Registered for a qualification, not yet achieved", default_validity_months: 6, renewal_rule: "progression", grace_months: 0,
    progression_note: "Not renewable. Holder must achieve the NVQ and apply for the skilled card.", front_features: "Red band, 'Trainee'", back_features: "", competencies: ["CSCS Card"], endorsement_pattern: null, active: true },
  { scheme: "CPCS", name: "Blue Competent Operator", colour: "blue", what_it_proves: "Plant categories held with NVQ", default_validity_months: 60, renewal_rule: "renew", grace_months: 0, progression_note: null,
    front_features: "Blue CPCS card, photo, expiry", back_features: "Category codes with descriptions and per-category expiry, e.g. A59 Excavator 360 above 10 tonnes, A09 Forward tipping dumper",
    competencies: [], endorsement_pattern: "^[A-Z]\\d{2}[A-Z]?$", active: true },
  { scheme: "CPCS", name: "Red Trained Operator", colour: "red", what_it_proves: "Passed CPCS tests, NVQ pending", default_validity_months: 24, renewal_rule: "progression", grace_months: 0,
    progression_note: "Not renewable. NVQ required within 2 years to move to blue.", front_features: "Red CPCS card", back_features: "Category codes", competencies: [], endorsement_pattern: "^[A-Z]\\d{2}[A-Z]?$", active: true },
  { scheme: "NPORS", name: "Blue Competent Operator (CSCS logo)", colour: "blue", what_it_proves: "Plant categories held with NVQ", default_validity_months: 60, renewal_rule: "renew", grace_months: 0, progression_note: null,
    front_features: "Blue NPORS card with CSCS logo", back_features: "Category codes N-prefixed, e.g. N202 Excavator 360, N204 Forward tipping dumper, N214 Roller, N010 Telehandler",
    competencies: [], endorsement_pattern: "^N\\d{3}$", active: true },
  { scheme: "NPORS", name: "Red Trained Operator", colour: "red", what_it_proves: "Passed NPORS tests, NVQ pending", default_validity_months: 24, renewal_rule: "progression", grace_months: 0,
    progression_note: "Not renewable; NVQ required.", front_features: "Red NPORS card", back_features: "N-codes", competencies: [], endorsement_pattern: "^N\\d{3}$", active: true },
  { scheme: "NRSWA", name: "Street Works Operative", colour: null, what_it_proves: "NRSWA units held (O1–O8)", default_validity_months: 60, renewal_rule: "renew", grace_months: 0,
    progression_note: "Early renewal carries unexpired time over.", front_features: "SWQR card, photo, expiry", back_features: "Unit codes O1..O8 / S1..S7", competencies: ["NRSWA Operative"], endorsement_pattern: "^[OS]\\d$", active: true },
  { scheme: "NRSWA", name: "Street Works Supervisor", colour: null, what_it_proves: "Supervisor units held", default_validity_months: 60, renewal_rule: "renew", grace_months: 0, progression_note: null,
    front_features: "SWQR card", back_features: "S-unit codes", competencies: ["NRSWA Supervisor"], endorsement_pattern: "^[OS]\\d$", active: true },
  { scheme: "CITB", name: "SSSTS", colour: null, what_it_proves: "Site Supervisor Safety Training Scheme", default_validity_months: 60, renewal_rule: "grace", grace_months: 6,
    progression_note: "Refresher must be booked within 6 months of expiry or full course is required.", front_features: "CITB certificate, not a card", back_features: "", competencies: ["SSSTS"], endorsement_pattern: null, active: true },
  { scheme: "CITB", name: "SMSTS", colour: null, what_it_proves: "Site Management Safety Training Scheme", default_validity_months: 60, renewal_rule: "grace", grace_months: 6,
    progression_note: "Refresher within 6 months of expiry.", front_features: "CITB certificate", back_features: "", competencies: ["SMSTS"], endorsement_pattern: null, active: true },
  { scheme: "CITB", name: "HS&E Test pass", colour: null, what_it_proves: "Health, safety and environment test", default_validity_months: null, renewal_rule: "permanent", grace_months: 0,
    progression_note: "Valid 2 years for card applications only; the register treats it as no-expiry.", front_features: "Test pass letter/certificate", back_features: "", competencies: ["CITB HS&E Test"], endorsement_pattern: null, active: true },
  { scheme: "FAW", name: "First Aid at Work (3 day)", colour: null, what_it_proves: "FAW", default_validity_months: 36, renewal_rule: "renew", grace_months: 0, progression_note: null,
    front_features: "Certificate with provider logo, course dates, expiry", back_features: "", competencies: ["First Aid at Work"], endorsement_pattern: null, active: true },
  { scheme: "FAW", name: "Emergency First Aid at Work (1 day)", colour: null, what_it_proves: "EFAW", default_validity_months: 36, renewal_rule: "renew", grace_months: 0, progression_note: null,
    front_features: "Certificate", back_features: "", competencies: ["First Aid at Work"], endorsement_pattern: null, active: true },
  { scheme: "EUSR", name: "Confined Space (Water) / SHEA Water", colour: null, what_it_proves: "EUSR registration", default_validity_months: 36, renewal_rule: "renew", grace_months: 0, progression_note: null,
    front_features: "EUSR card with photo and expiry", back_features: "Registered categories", competencies: ["Confined Space"], endorsement_pattern: null, active: true },
  { scheme: "EUSR", name: "PE Fusion (Butt/Electrofusion)", colour: null, what_it_proves: "PE pipe fusion", default_validity_months: 36, renewal_rule: "renew", grace_months: 0, progression_note: null,
    front_features: "EUSR card", back_features: "Fusion categories", competencies: [], endorsement_pattern: null, active: true },
];
```

Continue the list for Asbestos Awareness (12 months recommended, `renew`), Manual Handling (36, `renew`),
COSHH (36), Fire Awareness (36), Abrasive Wheels (36), Face Fit (24), Safety-Critical Medical (36),
Temporary Works Coordinator (60), IPAF 3a/3b (60), PASMA Towers (60), CISRS Scaffolder (60),
Slinger/Signaller (CPCS A40 / NPORS N402) and Plant Banksman mapped to their competencies.

`supabase/functions/_shared/knowledge/index.ts`:

```ts
import { CARD_TYPES, SCHEMES, type CardTypeSeed } from "./seed";
export { CARD_TYPES, SCHEMES };
export type { CardTypeSeed };

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function findCardType(scheme: string, name: string): CardTypeSeed | undefined {
  const s = norm(scheme), n = norm(name);
  return CARD_TYPES.find((t) => norm(t.scheme) === s && norm(t.name) === n);
}

/** The block embedded in the reader prompt. Stable text ⇒ prompt-cacheable. */
export function knowledgeBlock(): string {
  return CARD_TYPES.filter((t) => t.active).map((t) =>
    `${t.scheme} — ${t.name}${t.colour ? ` (${t.colour})` : ""}\n` +
    `  proves: ${t.what_it_proves}\n` +
    `  validity: ${t.default_validity_months === null ? "no expiry" : `${t.default_validity_months} months`}; rule: ${t.renewal_rule}${t.progression_note ? `; ${t.progression_note}` : ""}\n` +
    `  front: ${t.front_features}\n  back: ${t.back_features || "n/a"}\n` +
    `  competencies: ${t.competencies.join(", ") || "from category codes"}${t.endorsement_pattern ? `; code pattern ${t.endorsement_pattern}` : ""}`
  ).join("\n\n");
}
```

- [ ] **Step 4: Generate the SQL seed from the data**

`scripts/gen-kb-seed.ts` (run with `npx tsx scripts/gen-kb-seed.ts >> supabase/migrations/<ts>_s3_knowledge_base.sql`):

```ts
import { CARD_TYPES, SCHEMES } from "../supabase/functions/_shared/knowledge/seed";
const q = (v: string | number | null) => v === null ? "null" : typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`;
for (const s of SCHEMES)
  console.log(`insert into tm_schemes (code,name,issuer,verify_url,verify_method,notes) values (${q(s.code)},${q(s.name)},${q(s.issuer)},${q(s.verify_url)},${q(s.verify_method)},${q(s.notes ?? null)}) on conflict (code) do nothing;`);
for (const t of CARD_TYPES)
  console.log(`insert into tm_card_types (scheme_id,name,colour,what_it_proves,default_validity_months,renewal_rule,grace_months,progression_note,front_features,back_features,maps_to_competency_ids,endorsement_pattern,active)
 select id,${q(t.name)},${q(t.colour)},${q(t.what_it_proves)},${q(t.default_validity_months)},${q(t.renewal_rule)},${t.grace_months},${q(t.progression_note)},${q(t.front_features)},${q(t.back_features)},
 coalesce((select array_agg(c.id) from tm_competencies c where c.name = any(array[${t.competencies.map(q).join(",") || "''"}]::text[])),'{}'),${q(t.endorsement_pattern)},${t.active}
 from tm_schemes where code=${q(t.scheme)} on conflict (scheme_id,name) do nothing;`);
```

Install `tsx` as a dev dependency. Competency ids resolve against the live `tm_competencies` names
(the mock's column names, already in the DB).

- [ ] **Step 5: Types, run, commit**

Add `TmScheme` and `TmCardType` interfaces to `src/lib/types.ts` mirroring the columns.
Run: `npm test && npm run db:reset && npm run test:integration && npm run typecheck`.

```bash
git add -A && git commit -m "feat(s3): scheme + card-type knowledge base with seed" && git push
```

---

## S4 — Agent tables migration

**Files:**
- Create: `supabase/migrations/<ts>_s4_agent_tables.sql`, `tests/integration/s4_agent_tables.test.ts`
- Modify: `src/lib/types.ts` (add `TmIngestItem`, `TmQuery`, `TmChase`, `TmAgentRun`, `TmOperativeAlias`; extend `TmCard`)

**Interfaces:**
- Produces the column names every agent tool uses. State enums:
  ingest `received|read|matched|queried|entered|rejected|duplicate`; query
  `open|answered|dismissed`; rung `d90|d60|d30|lapsed|digest|query|invite|welcome`.

- [ ] **Step 1: Migration**

```sql
-- cards: provenance + knowledge links
alter table tm_cards
  add column if not exists ingest_item_id uuid,
  add column if not exists read_by text check (read_by in ('agent','person')),
  add column if not exists read_confidence numeric(4,3),
  add column if not exists verified_at timestamptz,
  add column if not exists verified_by uuid references auth.users(id),
  add column if not exists verification_method text check (verification_method in ('smart_check','issuer_site','paper','none')) default 'none',
  add column if not exists card_colour text,
  add column if not exists scheme_id uuid references tm_schemes(id),
  add column if not exists card_type_id uuid references tm_card_types(id),
  add column if not exists holder_photo_path text;

-- ingest items: redefine (table exists, empty)
drop table if exists tm_ingest_items;
create table tm_ingest_items (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references tm_ingest_jobs(id),
  source text not null check (source in ('onedrive','portal','modal','email_reply')),
  source_ref text not null,
  file_hash text not null,
  file_name text,
  mime text,
  storage_path text,            -- where the raw upload sits in tm-cards/incoming/
  operative_hint text,
  operative_id uuid references tm_operatives(id),
  state text not null default 'received' check (state in ('received','read','matched','queried','entered','rejected','duplicate')),
  extraction jsonb,
  confidence numeric(4,3),
  error text,
  read_at timestamptz,
  entered_card_id uuid references tm_cards(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, file_hash)
);
alter table tm_cards add constraint tm_cards_ingest_fk foreign key (ingest_item_id) references tm_ingest_items(id);

create table if not exists tm_queries (
  id uuid primary key default gen_random_uuid(),
  ingest_item_id uuid references tm_ingest_items(id),
  operative_id uuid references tm_operatives(id),
  kind text not null check (kind in ('unknown_operative','ambiguous_operative','unknown_card','unreadable_expiry','date_conflict','name_mismatch','duplicate','other')),
  question text not null,
  agent_guess jsonb,
  options jsonb,
  status text not null default 'open' check (status in ('open','answered','dismissed')),
  answer jsonb,
  answered_by uuid references auth.users(id),
  answered_at timestamptz,
  applied_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists tm_operative_aliases (
  operative_id uuid not null references tm_operatives(id) on delete cascade,
  alias text not null,
  source text not null check (source in ('query_answer','manual')),
  created_at timestamptz not null default now(),
  primary key (operative_id, alias)
);

create table if not exists tm_chases (
  id uuid primary key default gen_random_uuid(),
  operative_id uuid references tm_operatives(id),
  ticket_id uuid references tm_tickets(id),
  rung text not null check (rung in ('d90','d60','d30','lapsed','digest','query','invite','welcome')),
  channel text not null default 'email',
  to_address text not null,
  subject text not null,
  body_hash text not null,
  sent_at timestamptz not null default now(),
  graph_message_id text,
  replied_at timestamptz,
  reply_summary text
);
create unique index if not exists tm_chases_ticket_rung on tm_chases (ticket_id, rung) where ticket_id is not null;

create table if not exists tm_agent_runs (
  id uuid primary key default gen_random_uuid(),
  function text not null,
  trigger text not null check (trigger in ('webhook','cron','manual','portal')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  items_seen int not null default 0,
  items_entered int not null default 0,
  queries_raised int not null default 0,
  emails_sent int not null default 0,
  tokens_in int not null default 0,
  tokens_out int not null default 0,
  error text
);

create table if not exists tm_api_keys (
  id uuid primary key default gen_random_uuid(),
  key_hash text not null unique,
  label text not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

-- tickets.status becomes derived: trigger keeps the column honest for old readers
create or replace function tm_ticket_status_from_expiry() returns trigger language plpgsql as $$
declare ne boolean;
begin
  select no_expiry into ne from tm_competencies where id = new.competency_id;
  if new.expiry_date is null then
    new.status := case when coalesce(ne,false) then 'no_expiry' else 'not_held' end;
  elsif new.expiry_date < current_date then new.status := 'lapsed';
  elsif new.expiry_date <= current_date + 183 then new.status := 'expiring';
  else new.status := 'in_date';
  end if;
  return new;
end $$;
drop trigger if exists tm_tickets_status on tm_tickets;
create trigger tm_tickets_status before insert or update of expiry_date, competency_id on tm_tickets
  for each row execute function tm_ticket_status_from_expiry();

drop trigger if exists tm_ingest_items_touch on tm_ingest_items;
create trigger tm_ingest_items_touch before update on tm_ingest_items for each row execute function tm_touch_updated_at();
```

- [ ] **Step 2: Failing integration test**

`tests/integration/s4_agent_tables.test.ts`:

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { integrationEnabled, localAdmin } from "./_client";

describe.skipIf(!integrationEnabled)("S4 agent tables", () => {
  const sb = localAdmin();
  let opId = "", compId = "";
  beforeAll(async () => {
    const { data: o } = await sb.from("tm_operatives").insert({ full_name: "S4 Test" }).select("id").single();
    const { data: c } = await sb.from("tm_competencies").select("id").eq("no_expiry", false).limit(1).single();
    opId = o!.id; compId = c!.id;
  });
  it("derives ticket status on insert (day of expiry is in date)", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const { data } = await sb.from("tm_tickets").insert({ operative_id: opId, competency_id: compId, expiry_date: today }).select("status").single();
    expect(data!.status).toBe("expiring");
    const { data: n } = await sb.from("tm_tickets").insert({ operative_id: opId, competency_id: compId, expiry_date: null }).select("status").single();
    expect(n!.status).toBe("not_held");
  });
  it("refuses a second chase for the same ticket and rung", async () => {
    const { data: t } = await sb.from("tm_tickets").select("id").eq("operative_id", opId).limit(1).single();
    const row = { operative_id: opId, ticket_id: t!.id, rung: "d30", to_address: "x@example.com", subject: "s", body_hash: "h" };
    expect((await sb.from("tm_chases").insert(row)).error).toBeNull();
    expect((await sb.from("tm_chases").insert(row)).error?.message).toMatch(/duplicate key/);
  });
  it("refuses a duplicate ingest file per source", async () => {
    const row = { source: "onedrive", source_ref: "a", file_hash: "abc" };
    expect((await sb.from("tm_ingest_items").insert(row)).error).toBeNull();
    expect((await sb.from("tm_ingest_items").insert({ ...row, source_ref: "b" })).error?.message).toMatch(/duplicate key/);
  });
});
```

- [ ] **Step 3: Apply, run, add types, commit**

Run: `npm run db:reset && npm run test:integration` → 3 passed. Add the TypeScript interfaces mirroring
the tables to `src/lib/types.ts`. `npm run typecheck`.

```bash
git add -A && git commit -m "feat(s4): ingest, queries, aliases, chases, agent runs, api keys; ticket status trigger" && git push
```

---

## S5 — Row-level security + refusal tests

**Files:**
- Create: `supabase/migrations/<ts>_s5_rls.sql`, `tests/integration/s5_rls.test.ts`
- Modify: `src/lib/supabaseServer.ts` (no change in behaviour; confirm it uses the anon key + user JWT)

**Interfaces:**
- Produces SQL helper functions `tm_is_admin()` and `tm_my_operative_id()` used by every policy and by
  later portal server actions.

- [ ] **Step 1: Migration**

```sql
create or replace function tm_is_admin() returns boolean language sql stable security definer as $$
  select exists (select 1 from tm_admins where auth_user_id = auth.uid());
$$;
create or replace function tm_my_operative_id() returns uuid language sql stable security definer as $$
  select id from tm_operatives where auth_user_id = auth.uid();
$$;

-- drop the blanket policies from the June build
do $$ declare r record; begin
  for r in select schemaname, tablename, policyname from pg_policies where tablename like 'tm\_%' loop
    execute format('drop policy if exists %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop; end $$;

-- enable RLS everywhere
do $$ declare t text; begin
  foreach t in array array['tm_sections','tm_competencies','tm_roles','tm_role_requirements','tm_operatives','tm_operative_private',
    'tm_cards','tm_card_competencies','tm_tickets','tm_audit_log','tm_ingest_jobs','tm_ingest_items','tm_queries','tm_operative_aliases',
    'tm_chases','tm_agent_runs','tm_api_keys','tm_schemes','tm_card_types','tm_settings','tm_admins'] loop
    execute format('alter table %I enable row level security', t);
  end loop; end $$;

-- admin: everything
do $$ declare t text; begin
  foreach t in array array['tm_sections','tm_competencies','tm_roles','tm_role_requirements','tm_operatives','tm_operative_private',
    'tm_cards','tm_card_competencies','tm_tickets','tm_ingest_jobs','tm_ingest_items','tm_queries','tm_operative_aliases',
    'tm_chases','tm_agent_runs','tm_api_keys','tm_schemes','tm_card_types','tm_settings','tm_admins'] loop
    execute format('create policy %I on %I for all to authenticated using (tm_is_admin()) with check (tm_is_admin())', t||'_admin_all', t);
  end loop; end $$;
create policy tm_audit_log_admin_read on tm_audit_log for select to authenticated using (tm_is_admin());
create policy tm_audit_log_insert on tm_audit_log for insert to authenticated with check (true);

-- operative: reference data read
do $$ declare t text; begin
  foreach t in array array['tm_sections','tm_competencies','tm_roles','tm_role_requirements','tm_schemes','tm_card_types'] loop
    execute format('create policy %I on %I for select to authenticated using (tm_my_operative_id() is not null)', t||'_operative_read', t);
  end loop; end $$;

-- operative: own rows
create policy tm_operatives_own_read on tm_operatives for select to authenticated using (id = tm_my_operative_id());
create policy tm_operatives_own_update on tm_operatives for update to authenticated
  using (id = tm_my_operative_id()) with check (id = tm_my_operative_id() and archived = false);
create policy tm_operative_private_own on tm_operative_private for all to authenticated
  using (operative_id = tm_my_operative_id()) with check (operative_id = tm_my_operative_id());
create policy tm_cards_own_read on tm_cards for select to authenticated using (operative_id = tm_my_operative_id());
create policy tm_card_competencies_own_read on tm_card_competencies for select to authenticated
  using (exists (select 1 from tm_cards c where c.id = card_id and c.operative_id = tm_my_operative_id()));
create policy tm_tickets_own_read on tm_tickets for select to authenticated using (operative_id = tm_my_operative_id());
create policy tm_ingest_items_own_read on tm_ingest_items for select to authenticated using (operative_id = tm_my_operative_id());

-- column-level: operatives may not change these on their own row
revoke update (auth_user_id, archived, role_id, onedrive_folder, invite_token, invite_sent_at, notes) on tm_operatives from authenticated;
grant update (full_name, email, phone, employment_type, start_date, profile_completed_at) on tm_operatives to authenticated;

-- the agent role: service_role bypasses RLS, but the private table is explicitly denied via a
-- separate role used by the Edge Functions' non-private client (see B-agent S9).
create role tm_agent nologin;
grant usage on schema public to tm_agent;
grant select, insert, update on all tables in schema public to tm_agent;
revoke all on tm_operative_private from tm_agent;
alter default privileges in schema public grant select, insert, update on tables to tm_agent;
```

- [ ] **Step 2: Refusal tests**

`tests/integration/s5_rls.test.ts`:

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { integrationEnabled, localAdmin, signInAs } from "./_client";

describe.skipIf(!integrationEnabled)("S5 RLS", () => {
  const admin = localAdmin();
  let opA: any, opB: any, a: any, b: any, stranger: any;
  beforeAll(async () => {
    a = await signInAs("opa@test.local", "Passw0rd!"); b = await signInAs("opb@test.local", "Passw0rd!");
    stranger = await signInAs("nobody@test.local", "Passw0rd!");
    const ua = (await a.auth.getUser()).data.user!.id, ub = (await b.auth.getUser()).data.user!.id;
    opA = (await admin.from("tm_operatives").insert({ full_name: "Op A", auth_user_id: ua }).select().single()).data;
    opB = (await admin.from("tm_operatives").insert({ full_name: "Op B", auth_user_id: ub }).select().single()).data;
    await admin.from("tm_operative_private").insert([{ operative_id: opA.id, ni_number: "AA" }, { operative_id: opB.id, ni_number: "BB" }]);
  });
  it("operative sees only own operative row", async () => {
    const { data } = await a.from("tm_operatives").select("id");
    expect(data?.map((r: any) => r.id)).toEqual([opA.id]);
  });
  it("operative cannot read another operative's private row", async () => {
    const { data } = await a.from("tm_operative_private").select("ni_number");
    expect(data).toEqual([{ ni_number: "AA" }]);
  });
  it("operative cannot promote themselves or archive", async () => {
    const { error } = await a.from("tm_operatives").update({ archived: true }).eq("id", opA.id);
    expect(error?.message).toMatch(/permission denied|violates row-level/);
  });
  it("operative cannot read queries, chases or agent runs", async () => {
    for (const t of ["tm_queries", "tm_chases", "tm_agent_runs", "tm_admins"]) {
      const { data, error } = await a.from(t).select("*");
      expect(error ?? data?.length, t).toBeFalsy();
    }
  });
  it("a signed-in user with no role sees nothing", async () => {
    const { data } = await stranger.from("tm_operatives").select("id");
    expect(data).toEqual([]);
  });
  it("admin sees everything", async () => {
    const kaine = await signInAs("kainesmith123@live.com", "Passw0rd!");
    const uid = (await kaine.auth.getUser()).data.user!.id;
    await admin.from("tm_admins").upsert({ auth_user_id: uid, email: "kainesmith123@live.com" });
    const { data } = await kaine.from("tm_operative_private").select("ni_number");
    expect(data?.length).toBeGreaterThanOrEqual(2);
  });
});
```

- [ ] **Step 3: Run, fix, commit**

Run: `npm run db:reset && npm run test:integration` → all pass. Then `npm test`, `npm run typecheck`,
and start the app (`npm run dev`) to confirm the ledger still loads for an admin.

```bash
git add -A && git commit -m "feat(s5): row-level security with admin/operative/agent roles and refusal tests" && git push
```

Phase A complete. Phase B (`B-agent.md`) starts at S6.
