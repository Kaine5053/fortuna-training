# Fortuna Civils Live Training Matrix — Design Spec

Date: 2026-09-25
Status: draft for Kaine's review
Repo: `Kaine5053/fortuna-training` (this repo). Supabase project `klftjnzbncabueycooct` (eu-west-2).
Host: Netlify, `training-matrix.fortunacivils.co.uk`.
Approved front end: `docs/option-3-ledger.html` (the ledger mock). It is the design; it is not reinterpreted.

## 1. Purpose

A register of operative competency that keeps itself current. Cards and certificates go in as photos or
PDFs. A resident agent reads them with knowledge of every UK construction scheme, enters what it is sure
of, queries Kaine on what it is not, chases people at 90, 60 and 30 days and on lapse, and keeps a record
of every read, decision and message. Operatives hold their own profile and add their own cards through a
portal on the same domain, linked from the main website.

Success looks like: Kaine uploads nothing by hand except when he chooses to, no card expires without
three warnings having gone out, every entry in the register can be traced to a card image and a reader
(agent or person), and a PQQ or SSIP evidence request can be answered from the register alone.

## 2. Decisions already taken

| Decision | Choice | Why |
|---|---|---|
| Codebase | Standalone, this repo | Ships fastest; main Fortuna Civils App reads it later via API |
| Agent runtime | Supabase Edge Functions + Postgres cron (Approach A) | No new hosting; one project holds data, agent and secrets |
| Intake now | OneDrive personnel folders via Microsoft Graph | Matches Kaine's current habit; zero behaviour change to start |
| Intake later | Operative portal (built in this spec, basic layout) | Operatives own their cards |
| Messaging | Email only, via Kaine's Fortuna mailbox (Graph) | No approvals, replies land in a real inbox |
| Card reading | Claude vision with a scheme knowledge base | No OCR; reads front and reverse, understands the card |
| Status | Always derived from cards and today's date, never stored | One truth; a bug cannot leave a stale status behind |
| Profiles | Full operative profile, in scope now | Kaine's decision 2026-09-25 |

## 3. Architecture

```
                 ┌──────────────────────────────┐
  OneDrive ──►   │  Supabase (klftjnzbncabueycooct)│
  (Graph webhook)│  ─ Postgres: tm_* tables, RLS   │   ◄── Next.js app on Netlify
  Operative ──►  │  ─ Storage: tm-cards (private)  │        /        ledger (admin)
  portal upload  │  ─ Edge Functions: the agent    │        /portal  operative portal
  Ingest modal ─►│  ─ pg_cron: daily sweep 06:00   │        /api     thin JSON for main app
  Email reply ──►│  ─ Secrets: Claude, Graph       │
                 └──────────────┬─────────────────┘
                                │ Graph sendMail
                                ▼
                     Kaine's mailbox / operative inboxes
```

The Next.js app is a thin client. It reads tables through Supabase with RLS and calls server actions for
writes. All agent behaviour lives in Edge Functions so the same pipeline serves every intake door.

## 4. Data model

All tables `tm_` prefixed. Forward-only SQL migrations under `supabase/migrations/`, one file per section
of the build plan, never edited after shipping. Existing tables are kept; columns are added, never
repurposed. `profiles`, `timesheets`, `admin_emails` belong to another app and are not touched.

### 4.1 Existing, kept

`tm_sections`, `tm_competencies`, `tm_roles`, `tm_role_requirements`, `tm_operatives`, `tm_cards`,
`tm_card_competencies`, `tm_tickets`, `tm_audit_log`, `tm_ingest_jobs`, `tm_ingest_items`.

### 4.2 Changed

**`tm_operatives`** gains: `email`, `phone`, `auth_user_id` (uuid, unique, null until the operative
registers), `employment_type` (`paye` | `subbie` | `agency`), `start_date`, `onedrive_folder` (the
personnel folder name the agent watches for this person), `invite_token`, `invite_sent_at`,
`profile_completed_at`. `profile_id` stays null and is deprecated in favour of `auth_user_id`.

**`tm_cards`** gains: `ingest_item_id` (source read), `read_by` (`agent` | `person`), `read_confidence`
(0–1), `verified_at`, `verified_by`, `verification_method` (`smart_check` | `issuer_site` | `paper` |
`none`), `card_colour`, `scheme_id` → `tm_schemes`, `card_type_id` → `tm_card_types`, `holder_photo_path`.
`scheme` and `card_type` text columns stay for display but are populated from the linked rows.

**`tm_tickets`**: `status` column is no longer written by the app or agent. It stays for compatibility and
is set by a trigger from `expiry_date` so old readers keep working; the app derives status in code as now.

### 4.3 New

**`tm_operative_private`** — one row per operative, sensitive fields only: `date_of_birth`, `ni_number`,
`address_line1..3`, `postcode`, `emergency_contact_name`, `emergency_contact_phone`,
`emergency_contact_relation`, `medical_notes`, `utr` (subbies), `cis_status`, `cis_verified_at`,
`right_to_work_checked_at`, `right_to_work_document_path`. Never readable by the agent's default role,
never returned by the public API. Admin and the operative themselves only.

**`tm_schemes`** — the issuing bodies: `code` (CSCS, CPCS, NPORS, CISRS, NRSWA, EUSR, IPAF, PASMA, CITB,
FAIB/HSE, LANTRA, ECS, JIB, ALLMI, CCNSG, and so on), `name`, `issuer`, `verify_url`, `verify_method`,
`notes`.

**`tm_card_types`** — the knowledge base: `scheme_id`, `name` (e.g. "Blue Skilled Worker"), `colour`,
`what_it_proves`, `default_validity_months`, `renewal_rule` (`renew` | `progression` | `permanent` |
`grace`), `grace_months`, `progression_note` (e.g. "CSCS Red Trainee → must achieve NVQ within 6 months,
not renewable"), `front_features` and `back_features` (text the reader uses to recognise the card and to
know where the expiry and categories live), `maps_to_competency_ids` (uuid[] default mapping),
`endorsement_pattern` (regex for category codes such as N202, A59, N010), `active`.

Seed on first migration with the schemes and card types Fortuna actually meets (from the Build-Plan P4
validity clusters): 5-year CSCS skilled, CPCS/NPORS blue, NRSWA, SSSTS/SMSTS, SHEA; 3-year FAW/EFAW,
EUSR PE fusion, confined space; progression cards CSCS red, CPCS/NPORS red; permanent CITB HS&E test
pass (2 years for card application only), asbestos awareness (annual refresher recommended, not
statutory). Editable in the admin UI.

**`tm_queries`** — the review queue: `ingest_item_id`, `operative_id` (null if unknown),
`kind` (`unknown_operative` | `ambiguous_operative` | `unknown_card` | `unreadable_expiry` |
`date_conflict` | `name_mismatch` | `duplicate` | `other`), `question`, `agent_guess` (jsonb),
`options` (jsonb), `status` (`open` | `answered` | `dismissed`), `answer` (jsonb), `answered_by`,
`answered_at`, `applied_at`, `created_at`. Answers are reused: once Kaine says "Jimmy Mellor is James
Mellor", an alias row is written (`tm_operative_aliases`) and the next read matches without asking.

**`tm_operative_aliases`** — `operative_id`, `alias` (lower-cased, whitespace-collapsed), `source`
(`query_answer` | `manual`).

**`tm_chases`** — every message: `operative_id`, `ticket_id` (null for digests), `rung`
(`d90` | `d60` | `d30` | `lapsed` | `digest` | `query` | `invite` | `welcome`), `channel` (`email`),
`to_address`, `subject`, `body_hash`, `sent_at`, `graph_message_id`, `replied_at`, `reply_summary`.
Unique on (`ticket_id`, `rung`) so a rung is never sent twice for the same ticket.

**`tm_ingest_items`** (existing, empty) is defined as: `job_id`, `source` (`onedrive` | `portal` |
`modal` | `email_reply`), `source_ref` (Graph item id, storage path or message id), `file_hash` (sha256,
unique with source), `operative_hint` (folder name or logged-in operative), `state` (`received` |
`read` | `matched` | `queried` | `entered` | `rejected` | `duplicate`), `extraction` (jsonb, the full
reader output), `confidence`, `error`, `read_at`, `entered_card_id`.

**`tm_agent_runs`** — one row per Edge Function invocation: `function`, `trigger` (`webhook` | `cron` |
`manual` | `portal`), `started_at`, `finished_at`, `items_seen`, `items_entered`, `queries_raised`,
`emails_sent`, `tokens_in`, `tokens_out`, `error`. This is the agent's own log and the cost meter.

**`tm_settings`** — key/value: chase rungs, digest day, confidence threshold, sender address, watched
OneDrive root, invite link TTL. Read by the agent at the start of each run.

**`tm_admins`** — `auth_user_id`, `email`, `added_by`, `added_at`. Replaces the hard-coded allowlist in
`src/lib/access.ts`; Kaine and James are the seed rows.

**`tm_api_keys`** — `key_hash`, `label`, `created_at`, `revoked_at`. Bearer tokens for the read-only API
in section 10.

The ledger grid keeps its 6-month amber (the approved mock's legend). The agent's chase ladder is
90/60/30 and lapsed. Both read the same expiry date; they are two views, not two statuses.

### 4.4 Row-level security

Two app roles derived from `auth.users`: `admin` (allowlist in `tm_admins` table replaces the hard-coded
list in `src/lib/access.ts`) and `operative` (an `auth_user_id` on a `tm_operatives` row).

| Table | admin | operative | agent (service role) |
|---|---|---|---|
| tm_operatives | all | own row, limited columns | all |
| tm_operative_private | all | own row | none (explicit deny; the reader never needs it) |
| tm_cards, tm_card_competencies, tm_tickets | all | own rows read; insert via portal function only | all |
| tm_queries, tm_chases, tm_ingest_items, tm_agent_runs | all | none | all |
| tm_schemes, tm_card_types, tm_sections, tm_competencies, tm_roles | all | read | read |
| tm_audit_log | read, insert | none | insert |

The blanket "authenticated can do anything" policies are dropped in the RLS migration. There is a test per
row of this table proving a direct PostgREST request with an operative JWT is refused.

## 5. The agent

One agent, one system prompt, one toolset. It runs as Edge Functions in `supabase/functions/`:

| Function | Trigger | Job |
|---|---|---|
| `ingest-onedrive` | Graph change notification webhook, plus hourly cron catch-up | Pull new/changed files under the watched personnel root, create ingest items |
| `ingest-portal` | Called by the portal upload server action | Create ingest item from a portal upload |
| `ingest-modal` | Called by the ledger ingest modal | Same, `source = modal`, returns extraction for review |
| `ingest-email` | Graph webhook on the mailbox inbox | Attachments on replies to a chase become ingest items for that operative |
| `read-card` | Queue worker (pg_cron every minute, batch of 10) | Runs the reader on `received` items, moves them to `matched`, `queried` or `entered` |
| `sweep-expiry` | pg_cron daily 06:00 Europe/London | Computes days-to-expiry, sends the next unsent rung, writes `tm_chases` |
| `digest-admin` | pg_cron Monday 07:00 | Kaine's weekly digest grouped by person, plus open queries |
| `apply-answer` | Called when Kaine answers a query | Applies the answer, enters the card, writes alias if relevant |

### 5.1 The reader (`read-card`)

Input: one ingest item and its file(s). Steps:

1. Normalise: PDF pages rendered to images; a photo holding several cards is split by asking Claude for
   bounding boxes and cropping; front and reverse paired by card number or by adjacency.
2. Identify: Claude vision, with the `tm_card_types` knowledge base in the prompt (name, colour, front
   and back features), returns structured JSON: `scheme`, `card_type`, `holder_name`, `registration_no`,
   `issue_date`, `expiry_date`, `categories[]` (code, description, expiry), `side`, `confidence`,
   `reasons[]`. The prompt demands one of the known types or `unknown`, never a free-text guess.
3. Validate: expiry after issue; validity length matches the card type within tolerance (flag
   `date_conflict` if not); holder name fuzzy-matches the operative hint or an alias (flag
   `name_mismatch` otherwise); file hash not seen before (`duplicate`).
4. Decide: confidence ≥ threshold (default 0.85) and no flags → `enter_card`. Otherwise → `raise_query`
   with the agent's best guess and the options it considered. Nothing below threshold is ever entered.
5. Enter: write `tm_cards` (+ `tm_card_competencies` from the categories, mapped via `tm_card_types`),
   supersede any older card for the same competency (the existing supersede chain), upsert `tm_tickets`,
   move the file into `tm-cards/<operative_id>/<card_id>/front|back.<ext>`, audit.

Claude model: `claude-fable-5-1` for reads. Prompt caching on the knowledge base block. Cost is logged per
run in `tm_agent_runs`.

### 5.2 Tools

The agent's tools are TypeScript functions in `supabase/functions/_shared/tools/`, each with a schema,
unit tests, and an audit write. Claude is given exactly these and nothing else:

`read_card`, `find_operative` (name + aliases + folder hint, returns candidates with scores),
`enter_card`, `raise_query`, `send_email`, `list_expiring`, `get_card_type`, `log`.

`send_email` refuses any address not belonging to a `tm_operatives` row or the admin list. `enter_card`
refuses below threshold. Both refusals are tested with direct calls.

### 5.3 Queries to Kaine

A query is created in `tm_queries`, appears in the Queries tab with a badge, and is emailed to Kaine at
once if `kind` is `unknown_operative` or `date_conflict`, otherwise batched into the digest. Each query
shows the card image, what the agent read, its guess, and buttons: accept guess, pick another operative,
correct a field, reject. Answering runs `apply-answer`. The answer is recorded with who and when.

## 6. Intake doors

**OneDrive (now).** Kaine grants the app a Graph subscription on
`FORTUNA CIVILS LTD/PERSONELL FILES`. Each operative row stores its folder name; new folders raise an
`unknown_operative` query offering "create operative from folder name". A one-off backfill reads every
existing file in the personnel folders and the `Fortuna Tickets` folders. Files the reader rejects (a
payslip, a contract) are marked `rejected` with the reason, not queried, unless the folder is a
`- Training` folder, in which case everything is queried.

**Portal (built now).** Upload from the operative's own account. The operative is known. The card enters
the same queue. The operative sees "received, being read" then "entered" or "the office has a question".

**Ledger ingest modal.** As drawn in the mock: place files, review before entry, enter to register. The
review step shows the reader's extraction per card with confidence; Kaine confirms or edits; anything he
edits is entered as `read_by = person`.

**Email replies.** Attachments on a reply to a chase email are ingested for that operative. The thread is
matched by `graph_message_id`.

## 7. Chase ladder and messaging

Daily at 06:00: for every active operative and every ticket with an expiry, compute days left. Rungs are
`d90` (≤90), `d60` (≤60), `d30` (≤30), `lapsed` (<0). Send the highest rung not yet sent for that ticket.
A ticket renewed by a new card resets the ladder because the ticket row changes.

Operative email: plain, branded header, list of the operative's items in this window, what to do, a link
to the portal upload page. One email per operative per day at most, all items combined.

Kaine: immediate email on `lapsed` and on urgent queries; Monday digest with expiring by person, lapsed,
open queries, cards entered last week, reads that failed, and the agent's cost for the week. The Expiring
view's "Email this list" button sends the current list to Kaine on demand.

Messages are sent through Microsoft Graph `sendMail` from a dedicated mailbox
(`support@fortunacivils.co.uk`, to be created by Kaine; owed item) so replies are readable by the
`ingest-email` function without touching Kaine's personal inbox.

## 8. Front end

**Ledger (admin)** — `docs/option-3-ledger.html` implemented as is. Existing React screens stay. Additions:

- **Queries** tab beside Expiring and Role gaps, badge = open count.
- **Ingest modal** made live per section 6.
- **Operative panel** expanded into a full profile: employment and contact (from `tm_operatives`),
  private details (from `tm_operative_private`, admin only, collapsed by default), cards with images,
  verification status, chase history, invite and portal status. "Send invite" button.
- **Card types** admin page (the knowledge base editor), under a Settings menu with `tm_settings`.
- **Agent** page: last runs, cost, errors, "run sweep now", "backfill OneDrive".

**Portal (operative)** — `/portal`, same domain, same ledger styling, phone-first, basic layout:

- `/portal/login` — email + password, or the invite link which sets the password.
- `/portal` — my cards: each card with status glyph and colour as the ledger, expiry, days left.
- `/portal/upload` — take a photo or choose files, front and reverse, submit. Shows read state.
- `/portal/profile` — the operative's profile form: name, phone, email, employment type, start date,
  role, then the private block: date of birth, address, NI number, emergency contact, medical notes the
  operative wants the site to know, UTR and CIS for subbies. Saved via server action with RLS. Required
  fields are marked; `profile_completed_at` is set when all required fields are present.
- `/portal/account` — change password.

**Website link.** `www.fortunacivils.co.uk` gains a "Staff login" link to `training-matrix.fortunacivils.co.uk/portal`.
The website's platform is not in this repo; the link is a one-line change Kaine makes or authorises
(owed item). Nothing on the public site changes otherwise.

## 9. Security and hosting

- Supabase Auth. Admins are rows in `tm_admins`. Operatives are created by Kaine (or by an accepted
  `unknown_operative` query) and invited; the invite token is single-use, 7-day TTL. No public sign-up.
- RLS per section 4.4. Service role key used only inside Edge Functions.
- Secrets: `ANTHROPIC_API_KEY`, `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET`,
  `GRAPH_MAILBOX`, `GRAPH_DRIVE_ID` live in Supabase secrets. Netlify holds only the public Supabase URL
  and anon key.
- Card images and right-to-work documents in the private bucket, signed URLs of 10 minutes, never
  embedded in emails (emails link to the portal).
- Audit: every write by app or agent produces a `tm_audit_log` row with actor (user id or `agent`).
- Data protection: the private table is the special-category boundary. Retention rule recorded in
  `tm_settings` (default: keep 6 years after archive, in line with the Build-Plan's health-surveillance
  note). Deletion is a soft archive; hard delete is an admin-only action with an audit row.

## 10. API for the main Fortuna Civils App

A read-only JSON surface under `/api/v1/`, bearer-token protected (`tm_api_keys`):
`GET /operatives`, `GET /operatives/:id/competencies` (derived status per competency),
`GET /expiring?days=`. This is what P4 of the main app consumes for gates like "no excavator check sheet
without an in-date N202". No write endpoints.

## 11. Testing

- Unit: every tool, the status derivation, the ladder against a fixed clock (`d89`, `d90`, `d91`, day of
  expiry counts as in date), name matching and aliases, card-type mapping, PDF split.
- Reader fixtures: a folder of real card images with personal data redacted plus synthetic bad cases:
  blurred, reverse only, wrong holder, expired, unknown scheme, two cards in one photo. Each has an
  expected extraction. The reader test asserts the decision (enter vs query and query kind), not exact
  wording.
- RLS: for each row of the table in 4.4, a test with an operative JWT proving refusal.
- Gates: direct calls to `enter_card` below threshold and `send_email` to an unknown address are refused.
- End to end: drop a fixture into a test OneDrive folder → item received → entered → appears on the
  ledger → sweep sends `d30` once and not twice.
- Full suite green before every deploy. Netlify deploy previews per PR.

## 12. Out of scope (this build)

WhatsApp or SMS. Automated CSCS Smart Check verification (API is partner-gated; manual method recorded).
Health surveillance records. Company compliance library (insurances, policies). Scheduler and role-match
blocking at allocation (belongs to the main app, reads this API). Portal design beyond the basic layout.

## 13. Owed by Kaine (never block the build)

1. Create `support@fortunacivils.co.uk` and an Azure app registration with `Mail.Send`,
   `Mail.Read`, `Files.Read.All` application permissions, admin consent.
2. Netlify: add `training-matrix` CNAME at the DNS provider.
3. Website: add the "Staff login" link.
4. Confirm the initial operative list and folder names (the register can be seeded from
   `FORTUNA CIVILS TRAINING MATRIX.xlsx`).
