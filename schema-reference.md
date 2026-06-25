# Schema Reference — Fortuna Civils Training Matrix (RECONSTRUCTED)

> The original `schema-reference.md` referenced by the handover was **not included**
> in the package. This file was reconstructed by introspecting the **live** Supabase
> database (project `klftjnzbncabueycooct`) on 2026-06-22. It reflects reality, not a guess.
> Tables/columns below are verified against `information_schema`. Do not migrate this DB.

Project URL: `https://klftjnzbncabueycooct.supabase.co`
Storage bucket (private): `tm-cards`

## Training-matrix tables (`tm_` prefix)

### tm_sections  (4 rows)
- `id` uuid PK, default gen_random_uuid()
- `name` text, unique
- `position` int, default 0
- `created_at`, `updated_at` timestamptz default now()

### tm_competencies  (23 rows)
- `id` uuid PK
- `section_id` uuid → tm_sections.id
- `name` text
- `position` int default 0
- `no_expiry` bool default false
- `created_at`, `updated_at` timestamptz

### tm_roles  (6 rows)
- `id` uuid PK
- `name` text unique
- `created_at`, `updated_at` timestamptz

### tm_role_requirements  (23 rows)
- `role_id` uuid → tm_roles.id  (composite PK)
- `competency_id` uuid → tm_competencies.id  (composite PK)

### tm_operatives  (1 row: Nathan Annables)
- `id` uuid PK
- `profile_id` uuid NULL — **reserved for future self-service; leave null**
- `full_name` text
- `role_id` uuid NULL → tm_roles.id
- `archived` bool default false
- `notes` text NULL
- `created_at`, `updated_at` timestamptz

### tm_cards  (7 rows; 2 superseded)
- `id` uuid PK
- `operative_id` uuid → tm_operatives.id
- `scheme` text NULL
- `card_type` text NULL
- `registration_no` text NULL
- `holder_name` text NULL
- `issue_date` date NULL
- `expiry_date` date NULL
- `superseded` bool default false
- `superseded_by` uuid NULL → tm_cards.id  (self-FK supersede chain)
- `front_image_path` text NULL  (path in `tm-cards` bucket)
- `back_image_path` text NULL
- `source_filename` text NULL
- `created_at`, `updated_at` timestamptz

### tm_card_competencies  (6 rows)
- `id` uuid PK
- `card_id` uuid → tm_cards.id
- `competency_id` uuid → tm_competencies.id
- `endorsement_code` text NULL
- `expiry_date` date NULL
- `created_at` timestamptz

### tm_tickets  (6 rows)
- `id` uuid PK
- `operative_id` uuid → tm_operatives.id
- `competency_id` uuid → tm_competencies.id
- `source_card_competency_id` uuid NULL → tm_card_competencies.id
- `expiry_date` date NULL
- `status` text default 'not_held' — CHECK in ('in_date','expiring','lapsed','not_held','no_expiry')
- `card_type` text NULL
- `created_at`, `updated_at` timestamptz

### tm_audit_log  (1 row)
- `id` bigint identity PK
- `actor` uuid NULL  (= auth.uid())
- `action` text
- `entity_table` text
- `entity_id` text
- `detail` jsonb NULL
- `created_at` timestamptz

### tm_ingest_jobs / tm_ingest_items  (0 rows — OUT OF SCOPE this build)
Future ingest pipeline. Leave untouched.

## RLS (verified)
Every `tm_` table has an `authenticated` policy allowing `ALL` with `USING true / WITH CHECK true`.
`tm_audit_log` allows `authenticated` INSERT (check true) and SELECT (using true).
=> Any signed-in user can read/write. The app relies on auth, not per-row ownership.

## Do NOT touch (different app)
`profiles`, `timesheets`, `admin_emails`.

## Verified seed data (Nathan Annables — Phase 2 expected output)
| Competency | Section | Expiry | Derived status |
|---|---|---|---|
| CSCS Card | Health & Safety | 2028-11-30 | in_date (Labourer/Green) |
| 360 Excavator ≥10t | Plant — CPCS/NPORS | 2025-11-30 | lapsed |
| Fwd Tipping Dumper | Plant — CPCS/NPORS | 2025-11-30 | lapsed |
| NRSWA Operative | Streetworks | 2030-09-05 | in_date |
| Confined Space | Specialist | 2029-02-02 | in_date |
| SSSTS | Specialist | 2031-02-28 | in_date |

All other competencies: no ticket → renders grey (not_held). ✅ Matches the brief.
