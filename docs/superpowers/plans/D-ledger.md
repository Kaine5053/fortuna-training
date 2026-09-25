# Phase D — Ledger Additions Implementation Plan (S19–S22)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan one
> section at a time. Steps use checkbox (`- [ ]`) syntax for tracking. One section per terminal session.

**Goal:** Give the admin ledger the four things the agent needs a human for: a Queries tab, a full
operative profile panel, the card-type knowledge base editor with settings, and an Agent page that shows
what the agent did and lets Kaine run it by hand.

**Architecture:** Every screen follows the pattern already in the repo: a server component under
`src/app/(app)/<route>/page.tsx` fetches through `@/lib/supabaseServer`, a client component under
`src/components/` renders the mock's markup, server actions in the route's `actions.ts` write and audit.
Styling is the ledger's: Fraunces/Inter, ivory/brass/ink tokens already in `globals.css` and
`tailwind.config.ts`. Nothing new is invented visually; the Queries tab reuses the Expiring view's list
and badge idiom, and the profile panel extends `OperativeEditPanel`.

**Tech Stack:** Next.js 15 App Router, React 19, Tailwind, Supabase SSR.

**Spec:** section 8 (Ledger).

## Global Constraints

- Nav order: Matrix · Expiring · Role gaps · **Queries** · (menu) Agent · Card types · Settings.
  Badges: Expiring = 90-day count (existing), Role gaps = gap count (existing), Queries = open count.
- The private block of a profile is collapsed by default and shows a "sensitive" label; it never renders
  in the PDF export.
- Every write goes through a server action that checks `isAdmin` and writes `tm_audit_log`.
- No new colours or fonts. Status glyphs and colours come only from `STATUS_COLOUR` in `src/lib/types.ts`.

## Review Focus

1. Answering a query that another admin has already answered (two tabs open) must show "already
   answered by James at 10:42", not double-apply. S19 test on the 409 path.
2. Editing a card type's validity must not rewrite existing cards' expiries; it only affects future
   validation. S21 test asserts no `tm_cards` update.
3. The profile panel's "Send invite" for an operative with no email must be disabled with the reason
   shown, not fail on click. S20 test.
4. The Agent page's "Run sweep now" must be idempotent on the day (the sweep's unique index) and show
   "0 sent, all already chased" rather than an error. S22 test.
5. Card types marked `active = false` must disappear from the reader's knowledge block on the next
   run without a deploy: S21 makes `knowledgeBlock()` read from the DB at run time with the seed as
   fallback. Test in S21.

---

## S19 — Queries tab, badge, answer UI

**Files:**
- Create: `src/app/(app)/queries/page.tsx`, `src/app/(app)/queries/actions.ts`,
  `src/components/QueriesView.tsx`, `src/components/QueryCard.tsx`, `src/lib/queries.ts`,
  `tests/unit/queries.test.ts`
- Modify: `src/components/AppHeader.tsx` (add the tab + badge), `src/app/(app)/layout.tsx` (count open
  queries into the header props)

**Interfaces:**
- Produces: `getOpenQueries(): Promise<QueryView[]>` with the card's signed image URLs, the extraction,
  candidates; `answerQuery(queryId, answer: Answer): Promise<{ ok: true } | { ok: false; reason: string }>`
  (calls the `apply-answer` function with the admin's JWT).

- [ ] **Step 1: Failing tests (pure view mapping + action result mapping)**

```ts
import { toQueryView, sortQueries } from "@/lib/queries";
it("sorts urgent kinds first, then oldest", () => {
  const rows = [{ kind: "other", created_at: "2026-09-01" }, { kind: "unknown_operative", created_at: "2026-09-10" }, { kind: "date_conflict", created_at: "2026-09-05" }];
  expect(sortQueries(rows as any).map((r) => r.kind)).toEqual(["unknown_operative", "date_conflict", "other"]);
});
it("maps a 409 from apply-answer into a friendly reason", async () => {});
```

- [ ] **Step 2: Build the view**

`QueryCard` layout (matches the mock's ingest review row idiom): card image thumbnails (front/back,
lightbox on click, reusing `CellLightbox`), the agent's question in serif, what it read as a small
key/value table, then the controls by kind:
- `ambiguous_operative` / `unknown_operative`: radio list of candidates + "New operative" (name prefilled
  from the card, folder prefilled from the hint) + "Remember this name for them" checkbox (writes alias).
- `unreadable_expiry` / `date_conflict`: date input prefilled with the guess, "Confirm".
- `unknown_card`: scheme + card type selects from `tm_card_types`, competency multi-select, "Enter".
- `name_mismatch`: "Enter for <matched>" / "Pick someone else".
- Always: "Reject" with a one-line reason.
Badge on the tab = open count; the tab label reads `Queries` as the nav does elsewhere.

- [ ] **Step 3: Action**

```ts
"use server";
export async function answerQuery(queryId: string, answer: Answer) {
  const supabase = await createSupabaseServerClient();
  const { data: { session } } = await supabase.auth.getSession();
  const r = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/apply-answer`, {
    method: "POST", headers: { Authorization: `Bearer ${session!.access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ queryId, answer }) });
  if (r.status === 409) { const q = await getQuery(queryId); return { ok: false, reason: `Already answered by ${q.answered_by_name} at ${q.answered_at}` }; }
  if (!r.ok) return { ok: false, reason: await r.text() };
  revalidatePath("/queries"); revalidatePath("/");
  return { ok: true };
}
```

- [ ] **Step 4: Tests green, drive in browser, commit**

```bash
git add -A && git commit -m "feat(s19): queries tab with answer controls and badge" && git push
```

---

## S20 — Operative profile panel

**Files:**
- Create: `src/components/OperativeProfilePanel.tsx`, `src/components/ProfilePrivateBlock.tsx`,
  `src/components/ProfileCardsList.tsx`, `src/components/ProfileChaseLog.tsx`,
  `src/app/(app)/operatives/actions.ts`, `src/lib/invites.ts`, `tests/unit/invites.test.ts`,
  `tests/unit/profile_form.test.ts`
- Modify: `src/components/OperativeEditPanel.tsx` (becomes the "Tickets" tab inside the new panel),
  `src/components/MatrixGrid.tsx` (clicking a name opens the profile panel)

**Interfaces:**
- Produces: `getOperativeProfile(id): Promise<{ operative; private?; cards; chases; queries; portal: { invited; registered; lastLogin } }>`;
  `saveOperative(id, fields)`, `savePrivate(id, fields)`, `sendInvite(id)`, `markVerified(cardId, method)`;
  `makeInviteToken(): string` (32 bytes base64url), `inviteLink(token): string`
  (`https://training-matrix.fortunacivils.co.uk/portal/invite/<token>`), `inviteExpired(sentAt, ttlDays, now)`.

- [ ] **Step 1: Failing tests**

```ts
import { inviteExpired, makeInviteToken } from "@/lib/invites";
it("tokens are 43 chars url-safe and unique", () => { const a = makeInviteToken(), b = makeInviteToken(); expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/); expect(a).not.toBe(b); });
it("expires after ttl days", () => { expect(inviteExpired("2026-09-01T00:00:00Z", 7, "2026-09-08T00:00:01Z")).toBe(true); expect(inviteExpired("2026-09-01T00:00:00Z", 7, "2026-09-07T23:59:59Z")).toBe(false); });
import { validateOperativeForm, validatePrivateForm } from "@/lib/profileForm";
it("requires name, employment type, phone or email", () => { expect(validateOperativeForm({ full_name: "", employment_type: null, phone: null, email: null }).ok).toBe(false); });
it("NI number format", () => { expect(validatePrivateForm({ ni_number: "AB123456C" }).ok).toBe(true); expect(validatePrivateForm({ ni_number: "12345" }).errors.ni_number).toBeDefined(); });
it("UTR required only for subbies", () => {});
it("send invite disabled reason when no email", () => { expect(inviteDisabledReason({ email: null, auth_user_id: null })).toBe("Add an email address first"); expect(inviteDisabledReason({ email: "x@y", auth_user_id: "u" })).toBe("Already registered"); });
```

- [ ] **Step 2: Build the panel**

A right-hand slide-over (the existing `OperativeEditPanel` idiom) with tabs: **Profile**, **Tickets**
(existing panel content), **Cards** (every card incl. superseded, images via signed URL, read-by and
confidence, verification method + "Mark verified via Smart Check" button which records method/date/by),
**Chases** (the `tm_chases` log with rung, sent at, replied), **Portal** (invited / registered / last
sign-in, the Send invite button, the reason when disabled).
Profile tab: two forms. Public: name, role, employment type, start date, phone, email, OneDrive folder,
notes. Private block (collapsed, "Sensitive — admin only"): the `tm_operative_private` fields; subbie-only
fields shown when `employment_type = 'subbie'`.

- [ ] **Step 3: Actions**

`sendInvite`: generate token, set `invite_token`, `invite_sent_at`, send `inviteEmail` through the
`send_email` tool by calling a small Edge Function `send-invite` (admin JWT) so the Graph secret stays
server-side; audit `invite.sent`. `savePrivate` audits `private.updated` with only the field names, never
the values.

- [ ] **Step 4: Tests green, drive in browser, commit**

```bash
git add -A && git commit -m "feat(s20): operative profile panel with private block, cards, chases and invites" && git push
```

---

## S21 — Card types + settings admin

**Files:**
- Create: `src/app/(app)/card-types/page.tsx`, `src/app/(app)/card-types/actions.ts`,
  `src/components/CardTypesTable.tsx`, `src/components/CardTypeEditor.tsx`,
  `src/app/(app)/settings/page.tsx`, `src/app/(app)/settings/actions.ts`, `src/components/SettingsForm.tsx`,
  `supabase/functions/_shared/knowledge/live.ts`, `tests/unit/knowledge_live.test.ts`, `tests/unit/settings.test.ts`

**Interfaces:**
- Produces: `loadKnowledge(db): Promise<CardTypeSeed[]>` (DB rows → seed shape; falls back to `CARD_TYPES`
  if the query fails) and `knowledgeBlockFrom(types)`; `S9`'s reader switches to `knowledgeBlockFrom(await loadKnowledge(db))`.
  Settings: `getSettings()`, `saveSettings(patch)` with validation (rungs are 1–365 ascending, threshold 0.5–1).

- [ ] **Step 1: Failing tests**

```ts
it("inactive card types are absent from the live block", async () => {});
it("falls back to the seed when the db errors", async () => {});
it("rejects rungs that are not ascending or a threshold below 0.5", () => {});
it("editing validity does not touch tm_cards", async () => { /* action's fake db records no tm_cards call */ });
```

- [ ] **Step 2: Build**

Card types page: table grouped by scheme, columns name · colour · validity · rule · competencies · active.
Row click opens `CardTypeEditor` (all fields from the spec; competencies as a multi-select from
`tm_competencies`; `code_synonyms` as a small key/value editor). "Add card type" and "Add scheme".
Settings page: chase rungs (three numbers), digest weekday, confidence threshold, sender address (read-only,
from secrets), watch root, invite TTL, retention years, Claude price per million tokens (for the cost
meter). Save → `tm_settings` upsert + audit.

- [ ] **Step 3: Tests green, commit**

```bash
git add -A && git commit -m "feat(s21): card-type knowledge base editor and settings page; reader uses live knowledge" && git push
```

---

## S22 — Agent page: runs, cost, run now, backfill

**Files:**
- Create: `src/app/(app)/agent/page.tsx`, `src/app/(app)/agent/actions.ts`, `src/components/AgentRunsTable.tsx`,
  `src/components/AgentControls.tsx`, `src/lib/agentStats.ts`, `tests/unit/agent_stats.test.ts`

**Interfaces:**
- Produces: `summariseRuns(runs, priceIn, priceOut): { last24h; last7d; byFunction; costGbp }`;
  actions `runSweepNow()`, `runReadQueueNow()`, `runBackfill()` (each POSTs to the function with the
  admin JWT and `{ trigger: "manual" }`), `resubscribeGraph()`.

- [ ] **Step 1: Failing tests**

```ts
it("cost = tokens × price, in pounds to 2dp", () => {});
it("groups by function and shows last error", () => {});
it("sweep now on a day already swept reports 0 sent, all already chased", async () => {});
```

- [ ] **Step 2: Build**

Top: four stat cards in the ledger style: items entered (7d), queries open, emails sent (7d), agent cost
(7d). Then the runs table: started · function · trigger · seen · entered · queried · emails · tokens ·
error, newest first, 50 rows, "load more". Then controls: Run read queue · Run sweep · Run digest ·
Backfill OneDrive · Renew Graph subscriptions, each with a confirmation and a result toast. Subscription
status (expiry countdown) shown beside the OneDrive and mail rows.

- [ ] **Step 3: Tests green, commit**

```bash
git add -A && git commit -m "feat(s22): agent page with runs, cost and manual controls" && git push
```

Phase D complete. Phase E (`E-portal-api-deploy.md`) starts at S23.
