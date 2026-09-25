# Phase C — Intake Doors Implementation Plan (S16–S18)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan one
> section at a time. Steps use checkbox (`- [ ]`) syntax for tracking. One section per terminal session.

**Goal:** Three ways for card files to reach the agent's queue: OneDrive personnel folders (Kaine's current
habit), the ledger's ingest modal (review before entry), and attachments on email replies. The portal door
is built in Phase E and reuses the same helpers.

**Architecture:** Every door does the same four things: fetch bytes, hash them, copy them to
`tm-cards/incoming/<uuid>.<ext>`, insert a `tm_ingest_items` row in state `received`. That is one shared
function, `receiveFile()`, and each door is a thin adapter around it. The `read-card` worker from S13
does the rest.

**Tech Stack:** Microsoft Graph (drive delta + change notifications + mail), Supabase Storage, Deno.

**Spec:** section 6.

## Global Constraints

- `receiveFile` is idempotent on `(source, file_hash)`; a duplicate returns the existing item and
  does not touch storage.
- The watched root is `tm_settings.watch_root` (default `FORTUNA CIVILS LTD/PERSONELL FILES`). Only
  files under `<root>/<Operative Folder>/**` are eligible; the first path segment under the root is the
  `operative_hint`.
- Accepted MIME: `image/jpeg`, `image/png`, `image/webp`, `image/heic`, `application/pdf`. Others are
  recorded as `rejected` with `error = "unsupported type"` so Kaine sees them once and never again.
- Graph subscriptions expire after 3 days maximum for drive items; the hourly catch-up job renews them
  and also walks the delta link, so a missed webhook costs at most an hour.
- Webhook validation: Graph sends `validationToken` on subscribe; the function must echo it as
  `text/plain` within 10 seconds. Notifications are acknowledged with 202 before any work is done; the
  work runs in the same invocation after the response is queued (`EdgeRuntime.waitUntil`).

## Review Focus

1. A file renamed in OneDrive (same bytes) must not be re-read: hash match → `duplicate`. S16 test.
2. A new operative folder created with a typo ("Conor Whitfield") must raise one `unknown_operative`
   query offering "create operative" and "this is Connor Whitfield", not a query per file. S16 test
   asserts the query is deduplicated per hint while open.
3. An email reply from an address that is not an operative must be ignored, logged, never ingested.
   S18 test.
4. The ingest modal receiving 20 files at once must not time out: it returns item ids immediately and
   the review list polls. S17 test asserts the action returns within one round-trip.
5. A PDF holding 6 pages of unrelated paperwork with one card on page 4 must yield one card, five
   rejections attributed to the same source_ref (page suffix). S9's normaliser plus S16 test.

---

## S16 — OneDrive: Graph drive client, webhook, hourly catch-up, backfill

**Files:**
- Create: `supabase/functions/_shared/receive.ts`, `supabase/functions/_shared/graph-drive.ts`,
  `supabase/functions/ingest-onedrive/index.ts`, `supabase/functions/onedrive-catchup/index.ts`,
  `supabase/migrations/<ts>_s16_onedrive.sql` (`tm_graph_subscriptions`, `tm_graph_delta` tables + cron),
  `tests/unit/receive.test.ts`, `tests/unit/onedrive.test.ts`, `scripts/backfill-onedrive.ts`

**Interfaces:**
- Produces: `receiveFile(db, storage, { source, sourceRef, fileName, mime, bytes, operativeHint }): Promise<{ itemId; state: "received"|"duplicate"|"rejected" }>`;
  `eligiblePath(path, root): { hint: string } | null`;
  `GraphDriveLike = { delta(link?): Promise<{ items: DriveItem[]; nextLink?: string; deltaLink?: string }>; download(itemId): Promise<Uint8Array>; subscribe(root, notifyUrl): Promise<{ id; expiry }>; renew(id): Promise<{ expiry }> }`.

- [ ] **Step 1: Failing tests for the path rule and receive**

```ts
import { eligiblePath } from "../../supabase/functions/_shared/graph-drive";
const root = "FORTUNA CIVILS LTD/PERSONELL FILES";
it("takes the first folder under the root as the hint", () => {
  expect(eligiblePath(`${root}/James Mellor/CSCS front.jpg`, root)).toEqual({ hint: "James Mellor" });
  expect(eligiblePath(`${root}/James Mellor/James Mellor - Training/NRSWA.pdf`, root)).toEqual({ hint: "James Mellor" });
});
it("ignores files at the root and outside it", () => {
  expect(eligiblePath(`${root}/FORTUNA CIVILS TRAINING MATRIX.xlsx`, root)).toBeNull();
  expect(eligiblePath(`FORTUNA CIVILS LTD/PAYROLL/x.pdf`, root)).toBeNull();
});
```

```ts
import { receiveFile } from "../../supabase/functions/_shared/receive";
it("stores once and returns duplicate on the same bytes", async () => {
  const { db, storage, inserted, uploaded } = fakes();
  const bytes = new TextEncoder().encode("jpegbytes");
  const a = await receiveFile(db, storage, { source: "onedrive", sourceRef: "item1", fileName: "a.jpg", mime: "image/jpeg", bytes, operativeHint: "James Mellor" });
  const b = await receiveFile(db, storage, { source: "onedrive", sourceRef: "item2", fileName: "renamed.jpg", mime: "image/jpeg", bytes, operativeHint: "James Mellor" });
  expect(a.state).toBe("received"); expect(b.state).toBe("duplicate"); expect(b.itemId).toBe(a.itemId);
  expect(uploaded.length).toBe(1); expect(inserted.length).toBe(1);
});
it("rejects an unsupported type without uploading", async () => {
  const { db, storage, uploaded } = fakes();
  const r = await receiveFile(db, storage, { source: "onedrive", sourceRef: "i", fileName: "pay.xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", bytes: new Uint8Array([1]), operativeHint: "X" });
  expect(r.state).toBe("rejected"); expect(uploaded.length).toBe(0);
});
```

- [ ] **Step 2: Implement `receiveFile` and `eligiblePath`**

```ts
const ACCEPTED = new Set(["image/jpeg","image/png","image/webp","image/heic","application/pdf"]);
export async function sha256(bytes: Uint8Array) { const h = await crypto.subtle.digest("SHA-256", bytes); return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join(""); }

export async function receiveFile(db, storage, f) {
  const hash = await sha256(f.bytes);
  const { data: existing } = await db.from("tm_ingest_items").select("id, state").eq("source", f.source).eq("file_hash", hash).maybeSingle();
  if (existing) return { itemId: existing.id, state: "duplicate" as const };
  if (!ACCEPTED.has(f.mime)) {
    const { data } = await db.from("tm_ingest_items").insert({ source: f.source, source_ref: f.sourceRef, file_hash: hash, file_name: f.fileName, mime: f.mime, operative_hint: f.operativeHint, state: "rejected", error: "unsupported type" }).select("id").single();
    return { itemId: data.id, state: "rejected" as const };
  }
  const ext = f.mime === "application/pdf" ? "pdf" : f.mime.split("/")[1];
  const path = `incoming/${crypto.randomUUID()}.${ext}`;
  const up = await storage.from("tm-cards").upload(path, f.bytes, { contentType: f.mime });
  if (up.error) throw up.error;
  const { data } = await db.from("tm_ingest_items").insert({ source: f.source, source_ref: f.sourceRef, file_hash: hash, file_name: f.fileName, mime: f.mime, storage_path: path, operative_hint: f.operativeHint, state: "received" }).select("id").single();
  return { itemId: data.id, state: "received" as const };
}

export function eligiblePath(path: string, root: string): { hint: string } | null {
  const norm = (s: string) => s.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  const p = norm(path), r = norm(root);
  if (!p.toLowerCase().startsWith(r.toLowerCase() + "/")) return null;
  const rest = p.slice(r.length + 1).split("/");
  if (rest.length < 2) return null;            // file directly under the root
  return { hint: rest[0] };
}
```

- [ ] **Step 3: Graph drive client**

`graph-drive.ts` uses `graphToken()` from S12. Endpoints:
`GET /drives/{driveId}/root:/{root}:/delta` (first run) then the stored `deltaLink`;
`GET /drives/{driveId}/items/{id}/content` (follows the 302);
`POST /subscriptions` with `{ changeType: "updated", notificationUrl, resource: "/drives/{driveId}/root", expirationDateTime: now+4230min, clientState: <secret> }`;
`PATCH /subscriptions/{id}` to renew. Store subscription id, expiry and the current `deltaLink` in
`tm_graph_subscriptions` / `tm_graph_delta` (S16 migration). Unit-test the client against a fake
`fetch` for the 302 download and the `validationToken` echo.

- [ ] **Step 4: Webhook + catch-up functions**

`ingest-onedrive/index.ts`:

```ts
Deno.serve(async (req) => {
  const url = new URL(req.url);
  const vt = url.searchParams.get("validationToken");
  if (vt) return new Response(vt, { headers: { "content-type": "text/plain" } });
  const body = await req.json();
  if (!body.value?.every((n: any) => n.clientState === Deno.env.get("GRAPH_CLIENT_STATE"))) return new Response("bad state", { status: 401 });
  EdgeRuntime.waitUntil(walkDelta({ trigger: "webhook" }));
  return new Response(null, { status: 202 });
});
```

`walkDelta` (shared): open a `tm_agent_runs` row, follow the delta from the stored link, for each
`file` item with an eligible path → `download` → `receiveFile`; store the new `deltaLink`; close the run.
Query dedup for unknown folders: before raising `unknown_operative` for a hint, check for an open query
with the same `agent_guess.hint`; if present, attach the item id to that query's `options.items[]`.

`onedrive-catchup/index.ts`: renew the subscription if it expires within 24 h (create it if none), then
`walkDelta({ trigger: "cron" })`. Cron `15 * * * *`.

- [ ] **Step 5: Backfill script**

`scripts/backfill-onedrive.ts` (run once from the terminal with the service key in env): lists the
whole watched root via `/root:/{root}:/children` recursively (not delta), calls `receiveFile` for every
eligible file, prints a table of received / duplicate / rejected per operative folder. Covers the
existing personnel folders and the `Fortuna Tickets` folders. Run it against local Supabase first with
a `--dry-run` flag that only prints.

- [ ] **Step 6: Tests green, commit**

`npm test -- receive onedrive`; `supabase functions serve` and hit the webhook with a
`validationToken` and with a fake notification body.

```bash
git add -A && git commit -m "feat(s16): OneDrive intake via Graph delta + webhook, hourly catch-up, backfill" && git push
```

Owed: Azure app with `Files.Read.All`, `GRAPH_DRIVE_ID`, and the public function URL registered as the
notification URL (`https://klftjnzbncabueycooct.supabase.co/functions/v1/ingest-onedrive`).

---

## S17 — Ledger ingest modal live (`ingest-modal`)

**Files:**
- Create: `supabase/functions/ingest-modal/index.ts`, `src/app/(app)/ingest/actions.ts`,
  `src/components/IngestReviewList.tsx`, `tests/unit/ingest_modal.test.ts`
- Modify: `src/components/IngestModal.tsx` (replace the stub with the three-step flow from the mock:
  place files, review before entry, enter to register), `src/app/(app)/page.tsx` (mount)

**Interfaces:**
- Produces: server action `uploadForIngest(formData): Promise<{ itemIds: string[] }>` (streams each
  file to the `ingest-modal` function, which calls `receiveFile` with `source: "modal"`);
  `getIngestReview(itemIds): Promise<ReviewRow[]>` where `ReviewRow = { itemId; state; fileName; extraction?; confidence?; match?: { decision; candidates }; queryId? }`;
  `confirmIngest(itemId, overrides: Partial<Extraction>, operativeId): Promise<void>` (person entry via
  `apply-answer` semantics: it creates a `tm_queries` row of kind `other` pre-answered with `correct`, so
  every manual confirmation has the same audit trail as an answered query).

- [ ] **Step 1: Failing unit tests**

```ts
it("uploadForIngest returns item ids without waiting for reads", async () => { /* fake fetch to the function returns 202 + ids within one call */ });
it("review rows show confidence and candidate names once read", () => { /* pure mapping from item+query rows */ });
it("rows below threshold render the 'held back' label from the mock", () => {});
```

- [ ] **Step 2: Implement the modal as drawn**

Step 1 area: drag-and-drop + file input (`accept="image/*,application/pdf"`, `capture="environment"` on
mobile). On drop → `uploadForIngest` → keep `itemIds` in state → poll `getIngestReview` every 2 s until
every item is in `entered | queried | rejected | duplicate`.
Step 2 list: one row per card, exactly the mock's markup: operative name + confidence badge, competency
lines, `+ New operative` when `unknown_operative`. Rows in `queried` show the question and inline
controls (select operative / edit expiry / reject). Rows `entered` show a tick.
Footer button `Enter N to register` enabled only when N > 0 rows are confirmed-but-not-entered; it calls
`confirmIngest` per row.
The mock's sentence "Anything below confidence is held back for you to assign — never entered
automatically" stays verbatim.

- [ ] **Step 3: Function**

`ingest-modal/index.ts`: admin JWT required (same check as `apply-answer`), multipart body, one
`receiveFile` per part with `operative_hint = null`, returns `{ itemIds }` with 202, then
`EdgeRuntime.waitUntil(runBatch(...))` so the reads start at once rather than waiting for the minute cron.

- [ ] **Step 4: Tests green, drive it in the browser, commit**

Drop the three fixture images from `tests/fixtures/cards/` (synthetic cards, no real people) and confirm
the review list matches the mock's states.

```bash
git add -A && git commit -m "feat(s17): live ingest modal with review before entry" && git push
```

---

## S18 — Email replies (`ingest-email`)

**Files:**
- Create: `supabase/functions/ingest-email/index.ts`, `supabase/functions/_shared/graph-mail.ts`
  (`listNewMessages(since)`, `getAttachments(messageId)`), `supabase/migrations/<ts>_s18_mail.sql`
  (mail subscription row + `tm_chases.replied_at` index), `tests/unit/ingest_email.test.ts`

**Interfaces:**
- Produces: `matchReplyToChase(message: { from; inReplyTo?; conversationId?; subject }, chases): ChaseRow | null`;
  `ingestReply(deps, message): Promise<{ ingested: number; ignored: boolean }>`.

- [ ] **Step 1: Failing tests**

```ts
it("matches a reply by conversation id, then by sender + subject prefix", () => {});
it("ignores a sender that is not an operative or admin and logs it", async () => {});
it("ingests image and pdf attachments for the chase's operative with source email_reply", async () => {});
it("skips inline signature images under 20 KB", async () => {});
it("marks the chase replied_at and stores a one-line reply summary", async () => {});
```

- [ ] **Step 2: Implement**

Graph mail subscription on `/users/{mailbox}/mailFolders('inbox')/messages` (renewed by the S16
catch-up job, same table). Webhook handler mirrors S16: validate, 202, then `EdgeRuntime.waitUntil`.
For each notification: fetch the message with `$expand=attachments`; `matchReplyToChase`; if none and
sender unknown → `tm_audit_log` `email.ignored`; else for each `fileAttachment` with accepted MIME and
size ≥ 20 KB → `receiveFile({ source: "email_reply", sourceRef: messageId + ":" + attachmentId, operativeHint: operative.full_name })`
and set `operative_id` on the item directly (the operative is known). Update the chase
`replied_at`, `reply_summary` = first 200 chars of the text body. Kaine is not emailed for a plain
reply; the Monday digest lists replies received.

- [ ] **Step 3: Tests green, commit**

```bash
git add -A && git commit -m "feat(s18): ingest card attachments from chase email replies" && git push
```

Phase C complete. Phase D (`D-ledger.md`) starts at S19.
