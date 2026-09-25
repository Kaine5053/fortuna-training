# Phase B — The Agent Implementation Plan (S6–S15)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan one
> section at a time. Steps use checkbox (`- [ ]`) syntax for tracking. One section per terminal session.

**Goal:** A resident agent, running as Supabase Edge Functions, that reads cards with Claude vision,
enters what it is sure of, queries Kaine on the rest, chases expiries at 90/60/30 and lapse, and logs
every run.

**Architecture:** Pure logic (status, ladder, matching, validation, prompt building, decision) lives in
`supabase/functions/_shared/` as runtime-neutral TypeScript with Vitest tests. Edge Function entrypoints
in `supabase/functions/<name>/index.ts` are thin Deno wrappers that wire a Supabase client, the Claude
client and the Graph client into that logic. Tools are functions with schemas; Claude is only ever
given those tools.

**Tech Stack:** Deno (Supabase Edge runtime), `@anthropic-ai/sdk` (npm specifier), `@supabase/supabase-js`,
`pdf-lib`/`pdfjs` for PDF page rasterising, Microsoft Graph REST via `fetch`, `pg_cron` + `pg_net`.

**Spec:** `docs/superpowers/specs/2026-09-25-live-training-matrix-design.md` (sections 5 and 7).

## Global Constraints

- Claude model: `claude-fable-5-1`. Knowledge block sent as a cached system block.
- Confidence threshold read from `tm_settings.confidence_threshold` (default 0.85). Nothing below it is
  entered, by code in `enter_card`, not by the caller.
- `send_email` only to an address on a `tm_operatives` row or in `tm_admins`.
- Day of expiry counts as in date. Ladder rungs: `d90` ≤ 90, `d60` ≤ 60, `d30` ≤ 30, `lapsed` < 0.
  Send the highest applicable rung not yet sent; never two rungs for the same ticket on one day.
- Every tool call writes `tm_audit_log` with `actor = null` and `detail.actor = 'agent'`.
- Edge Functions use the service-role key for tables the agent may write, and a second client with the
  `tm_agent` role for reads, so the private table is unreachable by construction.
- Shared code imports nothing Deno-specific; entrypoints do the I/O.

## Review Focus

1. A card photographed upside down or rotated: the reader must still identify it or return
   `unknown` with low confidence, never a confident wrong holder. S8 fixture `rotated.json` asserts
   `confidence < 0.85` or correct extraction.
2. Two operatives with the same name (e.g. two "James Land"): `find_operative` must return both as
   candidates and the decision must be `ambiguous_operative`, never pick the first. S7 test.
3. A renewal card with an expiry earlier than the card it supersedes: refused, `date_conflict` query.
   S10 test.
4. The sweep running twice in one day (cron retry): no duplicate emails. S14 test relies on the unique
   index and asserts one `tm_chases` row.
5. Graph returns 429/5xx mid-run: the run records the error, items stay `received`, next run retries.
   S13 test with a throwing sender.

---

## S6 — Status and chase-ladder logic

**Files:**
- Create: `supabase/functions/_shared/ladder.ts`, `tests/unit/ladder.test.ts`
- Modify: `src/lib/types.ts` (re-export `daysUntilOn` so the app and agent share one clock rule)

**Interfaces:**
- Produces: `daysUntilOn(expiry: string, today: string): number`;
  `rungFor(daysLeft: number, rungs: number[]): Rung | null` where `Rung = "d90"|"d60"|"d30"|"lapsed"`;
  `nextRungToSend(daysLeft, rungs, alreadySent: Rung[]): Rung | null`.

- [ ] **Step 1: Failing tests**

```ts
import { describe, it, expect } from "vitest";
import { daysUntilOn, rungFor, nextRungToSend } from "../../supabase/functions/_shared/ladder";

describe("ladder", () => {
  it("day of expiry is 0 days left, not lapsed", () => {
    expect(daysUntilOn("2026-09-30", "2026-09-30")).toBe(0);
    expect(rungFor(0, [90, 60, 30])).toBe("d30");
  });
  it("picks the tightest rung", () => {
    expect(rungFor(91, [90, 60, 30])).toBeNull();
    expect(rungFor(90, [90, 60, 30])).toBe("d90");
    expect(rungFor(60, [90, 60, 30])).toBe("d60");
    expect(rungFor(30, [90, 60, 30])).toBe("d30");
    expect(rungFor(-1, [90, 60, 30])).toBe("lapsed");
  });
  it("does not resend a rung and skips rungs already passed", () => {
    expect(nextRungToSend(45, [90, 60, 30], ["d90", "d60"])).toBeNull();
    expect(nextRungToSend(45, [90, 60, 30], [])).toBe("d60");
    expect(nextRungToSend(-3, [90, 60, 30], ["d30"])).toBe("lapsed");
    expect(nextRungToSend(-3, [90, 60, 30], ["lapsed"])).toBeNull();
  });
});
```

- [ ] **Step 2: Run → FAIL. Implement**

```ts
export type Rung = "d90" | "d60" | "d30" | "lapsed";

export function daysUntilOn(expiry: string, today: string): number {
  const e = Date.parse(expiry + "T00:00:00Z"), t = Date.parse(today + "T00:00:00Z");
  return Math.round((e - t) / 86_400_000);
}

export function rungFor(daysLeft: number, rungs: number[]): Rung | null {
  if (daysLeft < 0) return "lapsed";
  const sorted = [...rungs].sort((a, b) => a - b); // [30,60,90]
  for (const r of sorted) if (daysLeft <= r) return (`d${r}` as Rung);
  return null;
}

export function nextRungToSend(daysLeft: number, rungs: number[], alreadySent: Rung[]): Rung | null {
  const r = rungFor(daysLeft, rungs);
  if (!r || alreadySent.includes(r)) return null;
  return r;
}
```

- [ ] **Step 3: Pass, wire app clock, commit**

Run: `npm test -- ladder`. In `src/lib/types.ts` make `daysUntil(expiry)` call `daysUntilOn(expiry,
todayIso())` so both sides share the rule (add `import { daysUntilOn } from "../../supabase/functions/_shared/ladder"`
and a `todayIso()` helper returning UTC date). `npm run typecheck`.

```bash
git add -A && git commit -m "feat(s6): shared expiry clock and chase ladder" && git push
```

---

## S7 — Operative matching + aliases (`find_operative`)

**Files:**
- Create: `supabase/functions/_shared/match.ts`, `supabase/functions/_shared/tools/find_operative.ts`,
  `tests/unit/match.test.ts`

**Interfaces:**
- Produces: `normaliseName(s)`, `scoreName(a, b): number` (0–1),
  `matchOperative(input: { holderName?: string; hint?: string }, ops: OpRow[], aliases: AliasRow[]): MatchResult`
  where `MatchResult = { decision: "match"|"ambiguous"|"none"; candidates: { id: string; name: string; score: number }[] }`.
  `OpRow = { id, full_name, onedrive_folder, archived }`, `AliasRow = { operative_id, alias }`.

- [ ] **Step 1: Failing tests**

```ts
import { describe, it, expect } from "vitest";
import { matchOperative, scoreName } from "../../supabase/functions/_shared/match";

const ops = [
  { id: "1", full_name: "James Mellor", onedrive_folder: "James Mellor", archived: false },
  { id: "2", full_name: "James Land", onedrive_folder: "James Land", archived: false },
  { id: "3", full_name: "James Land", onedrive_folder: "James Land (Agency)", archived: false },
  { id: "4", full_name: "Old Hand", onedrive_folder: "Old Hand", archived: true },
];
const aliases = [{ operative_id: "1", alias: "jimmy mellor" }];

describe("matchOperative", () => {
  it("matches by folder hint first", () => {
    const r = matchOperative({ holderName: "J MELLOR", hint: "James Mellor" }, ops, aliases);
    expect(r.decision).toBe("match"); expect(r.candidates[0].id).toBe("1");
  });
  it("matches an alias", () => {
    expect(matchOperative({ holderName: "Jimmy Mellor" }, ops, aliases).candidates[0].id).toBe("1");
  });
  it("is ambiguous when two operatives share a name and no hint separates them", () => {
    const r = matchOperative({ holderName: "James Land" }, ops, aliases);
    expect(r.decision).toBe("ambiguous"); expect(r.candidates.map((c) => c.id).sort()).toEqual(["2", "3"]);
  });
  it("is none for a stranger, and never matches archived", () => {
    expect(matchOperative({ holderName: "Old Hand" }, ops, aliases).decision).toBe("none");
    expect(matchOperative({ holderName: "Nobody Here" }, ops, aliases).decision).toBe("none");
  });
  it("scores initials + surname above 0.7", () => {
    expect(scoreName("J MELLOR", "James Mellor")).toBeGreaterThan(0.7);
  });
});
```

- [ ] **Step 2: Implement**

```ts
export interface OpRow { id: string; full_name: string; onedrive_folder: string | null; archived: boolean }
export interface AliasRow { operative_id: string; alias: string }
export interface MatchResult { decision: "match" | "ambiguous" | "none"; candidates: { id: string; name: string; score: number }[] }

export const normaliseName = (s: string) => s.toLowerCase().replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();

function tokens(s: string) { return normaliseName(s).split(" ").filter(Boolean); }

/** 1.0 exact; 0.8 same surname + first-name initial; 0.6 surname only; else Jaro-like ratio. */
export function scoreName(a: string, b: string): number {
  const ta = tokens(a), tb = tokens(b);
  if (!ta.length || !tb.length) return 0;
  if (ta.join(" ") === tb.join(" ")) return 1;
  const sa = ta[ta.length - 1], sb = tb[tb.length - 1];
  if (sa === sb) {
    if (ta[0][0] === tb[0][0]) return 0.8;
    return 0.6;
  }
  // fallback: shared bigrams
  const bg = (t: string[]) => { const s = new Set<string>(); for (const w of t) for (let i = 0; i < w.length - 1; i++) s.add(w.slice(i, i + 2)); return s; };
  const A = bg(ta), B = bg(tb); let hit = 0; for (const x of A) if (B.has(x)) hit++;
  return (2 * hit) / (A.size + B.size);
}

export function matchOperative(input: { holderName?: string; hint?: string }, ops: OpRow[], aliases: AliasRow[]): MatchResult {
  const live = ops.filter((o) => !o.archived);
  const byId = new Map(live.map((o) => [o.id, o]));
  const scored = new Map<string, number>();
  const bump = (id: string, s: number) => scored.set(id, Math.max(scored.get(id) ?? 0, s));

  if (input.hint) {
    const h = normaliseName(input.hint);
    for (const o of live) if (o.onedrive_folder && normaliseName(o.onedrive_folder) === h) bump(o.id, 1);
  }
  if (input.holderName) {
    const n = normaliseName(input.holderName);
    for (const al of aliases) if (byId.has(al.operative_id) && normaliseName(al.alias) === n) bump(al.operative_id, 1);
    for (const o of live) bump(o.id, scoreName(input.holderName, o.full_name));
  }
  const candidates = [...scored.entries()].map(([id, score]) => ({ id, name: byId.get(id)!.full_name, score }))
    .filter((c) => c.score >= 0.6).sort((a, b) => b.score - a.score);
  if (!candidates.length) return { decision: "none", candidates: [] };
  const top = candidates[0];
  const tied = candidates.filter((c) => c.score >= top.score - 0.05);
  if (tied.length > 1 && !(input.hint && top.score === 1 && tied.filter((c) => c.score === 1).length === 1))
    return { decision: "ambiguous", candidates: tied };
  return top.score >= 0.8 ? { decision: "match", candidates } : { decision: "ambiguous", candidates };
}
```

Note the ambiguity test: two "James Land" rows both score 1.0 on holder name with no hint → tied → ambiguous.
With hint "James Land (Agency)" only id 3 gets the folder bump… but folder normalisation strips
parentheses, so make the hint comparison exact on the raw folder string first, then normalised.

- [ ] **Step 3: The tool wrapper**

`supabase/functions/_shared/tools/find_operative.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { matchOperative, type MatchResult } from "../match";

export const findOperativeSchema = {
  name: "find_operative",
  description: "Find the operative a card belongs to. Returns match, ambiguous (with candidates) or none.",
  input_schema: { type: "object", properties: { holderName: { type: "string" }, hint: { type: "string" } } },
} as const;

export async function findOperative(db: SupabaseClient, input: { holderName?: string; hint?: string }): Promise<MatchResult> {
  const [{ data: ops }, { data: aliases }] = await Promise.all([
    db.from("tm_operatives").select("id, full_name, onedrive_folder, archived"),
    db.from("tm_operative_aliases").select("operative_id, alias"),
  ]);
  return matchOperative(input, ops ?? [], aliases ?? []);
}
```

- [ ] **Step 4: Pass and commit**

Run: `npm test -- match` → 5 passed.

```bash
git add -A && git commit -m "feat(s7): operative matching with aliases and ambiguity" && git push
```

---

## S8 — Reader contract: prompt, extraction schema, validation

**Files:**
- Create: `supabase/functions/_shared/reader/schema.ts`, `supabase/functions/_shared/reader/prompt.ts`,
  `supabase/functions/_shared/reader/validate.ts`, `supabase/functions/_shared/reader/decide.ts`,
  `tests/unit/reader.test.ts`, `tests/fixtures/extractions/*.json`

**Interfaces:**
- Produces: `Extraction` type; `EXTRACTION_JSON_SCHEMA` (given to Claude as the tool input schema);
  `buildReaderMessages(images: ImageInput[], hint?: string)`; `validateExtraction(x, ctx): Flag[]`;
  `decide(x, flags, threshold): Decision` where `Decision = { action: "enter" } | { action: "query"; kind: QueryKind; question: string }`.

- [ ] **Step 1: Schema**

```ts
export interface ExtractedCategory { code: string | null; description: string; expiry_date: string | null }
export interface Extraction {
  scheme: string;                 // one of SCHEMES codes or "unknown"
  card_type: string;              // one of that scheme's card type names or "unknown"
  holder_name: string | null;
  registration_no: string | null;
  issue_date: string | null;      // ISO
  expiry_date: string | null;     // ISO
  categories: ExtractedCategory[];
  sides_seen: ("front" | "back")[];
  confidence: number;             // 0..1
  reasons: string[];
}
export const EXTRACTION_JSON_SCHEMA = {
  type: "object",
  required: ["scheme","card_type","holder_name","registration_no","issue_date","expiry_date","categories","sides_seen","confidence","reasons"],
  properties: {
    scheme: { type: "string" }, card_type: { type: "string" },
    holder_name: { type: ["string","null"] }, registration_no: { type: ["string","null"] },
    issue_date: { type: ["string","null"], pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
    expiry_date: { type: ["string","null"], pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
    categories: { type: "array", items: { type: "object", required: ["code","description","expiry_date"],
      properties: { code: { type: ["string","null"] }, description: { type: "string" }, expiry_date: { type: ["string","null"] } } } },
    sides_seen: { type: "array", items: { enum: ["front","back"] } },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    reasons: { type: "array", items: { type: "string" } },
  },
} as const;
```

- [ ] **Step 2: Prompt**

```ts
import { knowledgeBlock } from "../knowledge";
export interface ImageInput { mediaType: "image/jpeg" | "image/png" | "image/webp"; base64: string; label: string }

export const READER_SYSTEM = [
  { type: "text", text:
`You read UK construction competency cards and certificates for a groundworks contractor's training register.
Return ONLY a call to record_extraction. Rules:
- scheme and card_type must be one of the known types below, or "unknown". Never invent a type.
- Dates are ISO yyyy-mm-dd. UK cards print dd/mm/yyyy; month names may appear. If a date is unreadable, null.
- Read the reverse for category codes and per-category expiries when the scheme has them.
- holder_name exactly as printed. registration_no exactly as printed.
- confidence is your honest estimate that every non-null field is correct. A blurred expiry, a partially hidden name or a card type you are guessing must drop it below 0.85.
- reasons: short bullet facts that justify the confidence (what was clear, what was not).
- If the image is not a card or certificate at all, scheme "unknown", confidence 0, reasons say what it is.`
  },
  { type: "text", text: `Known card types:\n\n${knowledgeBlock()}`, cache_control: { type: "ephemeral" } },
];

export function buildReaderMessages(images: ImageInput[], hint?: string) {
  const content: unknown[] = [];
  for (const im of images) {
    content.push({ type: "text", text: `Image: ${im.label}` });
    content.push({ type: "image", source: { type: "base64", media_type: im.mediaType, data: im.base64 } });
  }
  content.push({ type: "text", text: hint ? `The file came from the personnel folder of "${hint}". Use it only as a hint; report the name printed on the card.` : "No operative hint." });
  return [{ role: "user", content }];
}
```

- [ ] **Step 3: Validate and decide, with failing tests first**

`tests/unit/reader.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { validateExtraction } from "../../supabase/functions/_shared/reader/validate";
import { decide } from "../../supabase/functions/_shared/reader/decide";
import good from "../fixtures/extractions/cscs_blue_good.json";
import blurred from "../fixtures/extractions/blurred_expiry.json";
import unknown from "../fixtures/extractions/unknown_scheme.json";
import shortValidity from "../fixtures/extractions/cscs_blue_2yr.json";

const ctx = { today: "2026-09-25", match: { decision: "match", candidates: [{ id: "1", name: "Connor Whitfield", score: 1 }] } as const, previousExpiry: null };

describe("reader validate + decide", () => {
  it("clean card enters", () => {
    const flags = validateExtraction(good as any, ctx);
    expect(flags).toEqual([]);
    expect(decide(good as any, flags, 0.85)).toEqual({ action: "enter" });
  });
  it("blurred expiry queries unreadable_expiry", () => {
    const d = decide(blurred as any, validateExtraction(blurred as any, ctx), 0.85);
    expect(d.action).toBe("query"); expect((d as any).kind).toBe("unreadable_expiry");
  });
  it("unknown scheme queries unknown_card", () => {
    const d = decide(unknown as any, validateExtraction(unknown as any, ctx), 0.85);
    expect((d as any).kind).toBe("unknown_card");
  });
  it("validity that does not match the card type is a date_conflict", () => {
    const flags = validateExtraction(shortValidity as any, ctx);
    expect(flags.map((f) => f.kind)).toContain("date_conflict");
  });
  it("ambiguous match wins over everything else", () => {
    const amb = { ...ctx, match: { decision: "ambiguous", candidates: [{ id: "2", name: "James Land", score: 1 }, { id: "3", name: "James Land", score: 1 }] } as const };
    expect((decide(good as any, validateExtraction(good as any, amb), 0.85) as any).kind).toBe("ambiguous_operative");
  });
  it("name mismatch against the matched operative", () => {
    const flags = validateExtraction({ ...(good as any), holder_name: "Priya Anand" }, ctx);
    expect(flags.map((f) => f.kind)).toContain("name_mismatch");
  });
  it("renewal earlier than the current card is a date_conflict", () => {
    const flags = validateExtraction(good as any, { ...ctx, previousExpiry: "2031-01-01" });
    expect(flags.map((f) => f.kind)).toContain("date_conflict");
  });
});
```

Fixtures (`tests/fixtures/extractions/`), e.g. `cscs_blue_good.json`:

```json
{ "scheme": "CSCS", "card_type": "Blue Skilled Worker", "holder_name": "Connor Whitfield", "registration_no": "12345678",
  "issue_date": "2025-11-30", "expiry_date": "2030-11-30", "categories": [], "sides_seen": ["front","back"], "confidence": 0.96,
  "reasons": ["expiry printed clearly bottom right", "name matches hint"] }
```

`blurred_expiry.json`: same with `"expiry_date": null, "confidence": 0.55, "reasons": ["expiry area blurred"]`.
`unknown_scheme.json`: `"scheme": "unknown", "card_type": "unknown", "confidence": 0.2`.
`cscs_blue_2yr.json`: expiry `2027-11-30` (24 months, card type says 60).
Add `rotated.json` (Review Focus 1): `"confidence": 0.4, "reasons": ["image rotated, name partially cut"]` → must query.

`validate.ts`:

```ts
import { findCardType } from "../knowledge";
import { scoreName } from "../match";
import type { Extraction } from "./schema";
import type { MatchResult } from "../match";
import { daysUntilOn } from "../ladder";

export type FlagKind = "unknown_card" | "unreadable_expiry" | "date_conflict" | "name_mismatch" | "ambiguous_operative" | "unknown_operative";
export interface Flag { kind: FlagKind; detail: string }
export interface ValidateCtx { today: string; match: MatchResult; previousExpiry: string | null }

export function validateExtraction(x: Extraction, ctx: ValidateCtx): Flag[] {
  const flags: Flag[] = [];
  if (ctx.match.decision === "ambiguous") flags.push({ kind: "ambiguous_operative", detail: ctx.match.candidates.map((c) => c.name).join(" / ") });
  if (ctx.match.decision === "none") flags.push({ kind: "unknown_operative", detail: x.holder_name ?? "no name read" });

  const type = x.scheme === "unknown" || x.card_type === "unknown" ? undefined : findCardType(x.scheme, x.card_type);
  if (!type) { flags.push({ kind: "unknown_card", detail: `${x.scheme} / ${x.card_type}` }); return flags; }

  if (type.default_validity_months !== null && !x.expiry_date) flags.push({ kind: "unreadable_expiry", detail: "no expiry read for a dated card type" });

  if (x.issue_date && x.expiry_date) {
    const months = Math.round(daysUntilOn(x.expiry_date, x.issue_date) / 30.44);
    if (type.default_validity_months !== null && Math.abs(months - type.default_validity_months) > 2)
      flags.push({ kind: "date_conflict", detail: `validity ${months} months, ${type.name} is ${type.default_validity_months}` });
    if (months <= 0) flags.push({ kind: "date_conflict", detail: "expiry not after issue" });
  }
  if (ctx.previousExpiry && x.expiry_date && daysUntilOn(x.expiry_date, ctx.previousExpiry) < 0)
    flags.push({ kind: "date_conflict", detail: `new expiry ${x.expiry_date} is before current ${ctx.previousExpiry}` });

  if (ctx.match.decision === "match" && x.holder_name && scoreName(x.holder_name, ctx.match.candidates[0].name) < 0.6)
    flags.push({ kind: "name_mismatch", detail: `card says ${x.holder_name}, matched ${ctx.match.candidates[0].name}` });
  return flags;
}
```

`decide.ts`:

```ts
import type { Extraction } from "./schema";
import type { Flag } from "./validate";
export type QueryKind = "unknown_operative"|"ambiguous_operative"|"unknown_card"|"unreadable_expiry"|"date_conflict"|"name_mismatch"|"duplicate"|"other";
export type Decision = { action: "enter" } | { action: "query"; kind: QueryKind; question: string };

const PRIORITY: QueryKind[] = ["ambiguous_operative","unknown_operative","unknown_card","name_mismatch","date_conflict","unreadable_expiry"];

export function decide(x: Extraction, flags: Flag[], threshold: number): Decision {
  const byKind = new Map(flags.map((f) => [f.kind, f]));
  for (const k of PRIORITY) { const f = byKind.get(k as any); if (f) return { action: "query", kind: k, question: questionFor(k, x, f.detail) }; }
  if (x.confidence < threshold) return { action: "query", kind: x.expiry_date ? "other" : "unreadable_expiry", question: `I read this as ${x.scheme} ${x.card_type} for ${x.holder_name ?? "an unknown holder"} expiring ${x.expiry_date ?? "(unreadable)"} but I am only ${Math.round(x.confidence * 100)}% sure. ${x.reasons.join("; ")}` };
  return { action: "enter" };
}

function questionFor(k: QueryKind, x: Extraction, detail: string): string {
  switch (k) {
    case "ambiguous_operative": return `Which operative is this ${x.scheme} card for? Name on card: ${x.holder_name}. Candidates: ${detail}.`;
    case "unknown_operative": return `I cannot find an operative for "${detail}". Create one, or pick who this is?`;
    case "unknown_card": return `I do not recognise this card (${detail}). What is it, and which competency does it cover?`;
    case "name_mismatch": return `Name mismatch: ${detail}. Enter anyway, or reassign?`;
    case "date_conflict": return `Dates look wrong: ${detail}. Confirm the expiry?`;
    case "unreadable_expiry": return `I could not read the expiry on ${x.holder_name ?? "this"} ${x.scheme} ${x.card_type}. What is it?`;
    default: return detail;
  }
}
```

- [ ] **Step 4: Run, pass, commit**

Run: `npm test -- reader` → 7 passed (plus rotated).

```bash
git add -A && git commit -m "feat(s8): reader contract, validation flags and decision" && git push
```

---

## S9 — `read_card` tool: Claude vision, normalise, split

**Files:**
- Create: `supabase/functions/_shared/claude.ts` (client factory, typed call, token accounting),
  `supabase/functions/_shared/tools/read_card.ts`, `supabase/functions/_shared/images.ts`
  (PDF → PNG pages, HEIC guard, downscale to ≤ 2000px, sha256), `tests/unit/read_card.test.ts`
  (uses a fake Claude), `supabase/functions/_shared/db.ts` (two clients: `serviceDb()` and `agentDb()`)

**Interfaces:**
- Produces: `readCard(claude: ClaudeLike, files: FileInput[], hint?: string): Promise<{ extraction: Extraction; usage: { in: number; out: number } }>`;
  `ClaudeLike = { messages: { create(req): Promise<Msg> } }` so tests inject a fake;
  `normaliseFiles(files): Promise<ImageInput[]>`; `sha256(bytes): Promise<string>`.

- [ ] **Step 1: Failing test with a fake Claude**

```ts
import { describe, it, expect } from "vitest";
import { readCard } from "../../supabase/functions/_shared/tools/read_card";
import good from "../fixtures/extractions/cscs_blue_good.json";

const fake = { messages: { create: async (req: any) => {
  expect(req.model).toBe("claude-fable-5-1");
  expect(req.tools[0].name).toBe("record_extraction");
  expect(req.system[1].cache_control.type).toBe("ephemeral");
  return { content: [{ type: "tool_use", name: "record_extraction", input: good }], usage: { input_tokens: 1200, output_tokens: 180 } };
} } };

describe("read_card", () => {
  it("returns the tool_use input as the extraction and counts tokens", async () => {
    const r = await readCard(fake as any, [{ mediaType: "image/jpeg", base64: "AAA", label: "front.jpg" }], "Connor Whitfield");
    expect(r.extraction.card_type).toBe("Blue Skilled Worker");
    expect(r.usage).toEqual({ in: 1200, out: 180 });
  });
  it("throws a typed error when Claude does not call the tool", async () => {
    const bad = { messages: { create: async () => ({ content: [{ type: "text", text: "sorry" }], usage: { input_tokens: 1, output_tokens: 1 } }) } };
    await expect(readCard(bad as any, [], undefined)).rejects.toThrow(/no extraction/);
  });
});
```

- [ ] **Step 2: Implement**

`read_card.ts`:

```ts
import { READER_SYSTEM, buildReaderMessages, type ImageInput } from "../reader/prompt";
import { EXTRACTION_JSON_SCHEMA, type Extraction } from "../reader/schema";

export interface ClaudeLike { messages: { create(req: any): Promise<any> } }
export const MODEL = "claude-fable-5-1";

export async function readCard(claude: ClaudeLike, images: ImageInput[], hint?: string) {
  const res = await claude.messages.create({
    model: MODEL, max_tokens: 1500, system: READER_SYSTEM,
    tools: [{ name: "record_extraction", description: "Record what was read from the card images.", input_schema: EXTRACTION_JSON_SCHEMA }],
    tool_choice: { type: "tool", name: "record_extraction" },
    messages: buildReaderMessages(images, hint),
  });
  const call = res.content.find((c: any) => c.type === "tool_use" && c.name === "record_extraction");
  if (!call) throw new Error("read_card: no extraction returned");
  return { extraction: call.input as Extraction, usage: { in: res.usage.input_tokens, out: res.usage.output_tokens } };
}
```

`claude.ts` (Deno-side, imported only by entrypoints):

```ts
import Anthropic from "npm:@anthropic-ai/sdk@^0.60";
export function claudeClient() { return new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY")! }); }
```

`images.ts`: `normaliseFiles` accepts `{ name, mime, bytes }[]`; for `application/pdf` rasterise each
page at 150 dpi with `npm:pdfjs-dist` + `npm:canvas` (or `npm:pdf-to-img`), label `"<name> p<n>"`; for
images, decode with `npm:sharp` (Deno supports it) and resize longest side to 2000px, JPEG q85;
`image/heic` → convert via sharp. Multi-card photos: call `readCard` once with the whole image and, if the
extraction `reasons` contain "multiple cards", call Claude a second time asking for bounding boxes
(`record_regions` tool with `{ regions: [{ x, y, w, h, label }] }`), crop, and read each crop. Cover the
regions path with a unit test that feeds a fake returning two regions and asserts two extractions.

`db.ts`:

```ts
import { createClient } from "npm:@supabase/supabase-js@2";
export const serviceDb = () => createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
/** Reads through the tm_agent role: no grant on tm_operative_private by construction. */
export const agentDb = () => createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false }, global: { headers: { "x-tm-role": "tm_agent" } }, db: { schema: "public" } });
```

Add to the S5 migration's successor (`<ts>_s9_agent_role.sql`): a `set role tm_agent` wrapper is not
possible over PostgREST, so instead expose the reads the agent needs as security-definer views
(`tm_v_operatives_for_agent` selecting only non-private columns) and grant those to `tm_agent`; the agent's
read client selects from the views. Integration test: `agentDb().from("tm_operative_private").select()` returns
a permission error.

- [ ] **Step 3: Pass, commit**

Run: `npm test -- read_card` and `npm run test:integration`.

```bash
git add -A && git commit -m "feat(s9): read_card with Claude vision, image/PDF normalisation, agent read views" && git push
```

---

## S10 — `enter_card` tool: supersede chain, tickets, threshold gate

**Files:**
- Create: `supabase/functions/_shared/tools/enter_card.ts`, `tests/unit/enter_card.test.ts` (pure
  planning), `tests/integration/s10_enter_card.test.ts` (real DB)

**Interfaces:**
- Produces: `planEntry(x: Extraction, operativeId, cardType, competencies, existingCards): EntryPlan`
  (pure: which card rows to insert, which to supersede, which tickets to upsert);
  `enterCard(db, input: { ingestItemId; operativeId; extraction; confidence; readBy; threshold }): Promise<{ cardId }>`.
  Throws `GateError("below_threshold")` when `confidence < threshold && readBy === "agent"`.

- [ ] **Step 1: Failing gate test (unit, fake db)**

```ts
import { describe, it, expect } from "vitest";
import { enterCard, GateError } from "../../supabase/functions/_shared/tools/enter_card";
import good from "../fixtures/extractions/cscs_blue_good.json";

describe("enter_card gate", () => {
  it("refuses an agent read below threshold even if the caller insists", async () => {
    const db = { from: () => { throw new Error("db must not be touched"); } } as any;
    await expect(enterCard(db, { ingestItemId: "i", operativeId: "o", extraction: good as any, confidence: 0.7, readBy: "agent", threshold: 0.85 }))
      .rejects.toBeInstanceOf(GateError);
  });
  it("allows a person's confirmed read at any confidence", async () => {
    // person reads bypass the threshold; db is exercised in the integration test
    const calls: string[] = [];
    const db = fakeDb(calls);
    await enterCard(db, { ingestItemId: "i", operativeId: "o", extraction: good as any, confidence: 0.1, readBy: "person", threshold: 0.85 });
    expect(calls[0]).toBe("tm_cards.insert");
  });
});
```

`planEntry` tests: given an existing card for the same competency with expiry 2028, the plan supersedes it
and upserts the ticket to the new expiry; given a category-code card (NPORS N202, N204) the plan maps codes
to competencies via `tm_card_types.endorsement_pattern` + `tm_competencies.name` synonyms table (S3 seed
adds `code_synonyms` json on card types: `{ "N202": "360 Excavator ≥10t", "N204": "Fwd Tipping Dumper", "A59": "360 Excavator ≥10t", "A09": "Fwd Tipping Dumper", "N214": "Ride-on Roller", "N010": "Telehandler", "N402": "Slinger/Signaller", "A40": "Slinger/Signaller" }`).

- [ ] **Step 2: Implement**

```ts
export class GateError extends Error { constructor(public code: "below_threshold" | "no_operative") { super(code); } }

export async function enterCard(db, input) {
  if (input.readBy === "agent" && input.confidence < input.threshold) throw new GateError("below_threshold");
  if (!input.operativeId) throw new GateError("no_operative");
  // 1. resolve card type + competencies
  // 2. planEntry against existing non-superseded cards for the operative
  // 3. insert tm_cards (read_by, read_confidence, ingest_item_id, scheme_id, card_type_id, images moved from incoming/)
  // 4. insert tm_card_competencies
  // 5. update superseded cards: superseded=true, superseded_by=new id
  // 6. upsert tm_tickets (operative_id, competency_id) → expiry, source_card_competency_id, card_type
  // 7. update tm_ingest_items state='entered', entered_card_id
  // 8. audit 'card.entered'
}
```

Write the body in full following the existing `RenewModal` server action in `src/app/(app)/actions.ts`
for the supersede pattern (same columns).

- [ ] **Step 3: Integration test**

Insert an operative, run `enterCard` twice with expiries 2028 then 2030 for the same competency, assert:
one non-superseded card, the older has `superseded_by`, the ticket's `expiry_date` is 2030, the audit
log has two `card.entered` rows. Then run with expiry 2027 (earlier than current) and assert it throws
`GateError`? No: an earlier renewal is caught in S8 as `date_conflict` before entry. `enterCard` trusts its
input; the integration test asserts the pipeline (S13) routes it to a query. Keep `enterCard` single-purpose.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(s10): enter_card with supersede chain, tickets and threshold gate" && git push
```

---

## S11 — `raise_query` tool + `apply-answer` function

**Files:**
- Create: `supabase/functions/_shared/tools/raise_query.ts`, `supabase/functions/apply-answer/index.ts`,
  `supabase/functions/_shared/answers.ts` (pure: turn an answer into actions), `tests/unit/answers.test.ts`,
  `tests/integration/s11_queries.test.ts`

**Interfaces:**
- Produces: `raiseQuery(db, { ingestItemId, operativeId, kind, question, guess, options }): Promise<{ queryId }>`
  (also sets ingest state `queried`, audits `query.raised`);
  `applyAnswer(db, queryId, answer: Answer, userId)`; `Answer =
  | { type: "accept_guess" } | { type: "pick_operative"; operativeId; alias?: boolean }
  | { type: "create_operative"; fullName; folder? } | { type: "correct"; fields: Partial<Extraction> }
  | { type: "reject"; reason }`.

- [ ] **Step 1: Failing unit tests for the answer planner**

```ts
import { planAnswer } from "../../supabase/functions/_shared/answers";
it("pick_operative with alias writes an alias and re-enters", () => {
  const q = { kind: "ambiguous_operative", agent_guess: { holder_name: "Jimmy Mellor" } } as any;
  const p = planAnswer(q, { type: "pick_operative", operativeId: "1", alias: true });
  expect(p).toEqual([{ op: "alias", operativeId: "1", alias: "jimmy mellor" }, { op: "enter", operativeId: "1", overrides: {} }]);
});
it("correct merges fields then enters as person", () => {
  const p = planAnswer({ kind: "unreadable_expiry", operative_id: "1" } as any, { type: "correct", fields: { expiry_date: "2029-01-01" } });
  expect(p).toEqual([{ op: "enter", operativeId: "1", overrides: { expiry_date: "2029-01-01" } }]);
});
it("reject marks the item rejected", () => {
  expect(planAnswer({} as any, { type: "reject", reason: "not a card" })).toEqual([{ op: "reject", reason: "not a card" }]);
});
```

- [ ] **Step 2: Implement `planAnswer`, `raiseQuery`, and the Edge Function**

`apply-answer/index.ts` (Deno):

```ts
import { serviceDb } from "../_shared/db.ts";
import { planAnswer } from "../_shared/answers.ts";
import { enterCard } from "../_shared/tools/enter_card.ts";

Deno.serve(async (req) => {
  const auth = req.headers.get("authorization") ?? "";
  const db = serviceDb();
  const { data: { user } } = await db.auth.getUser(auth.replace("Bearer ", ""));
  if (!user) return new Response("unauthorised", { status: 401 });
  const { data: isAdmin } = await db.from("tm_admins").select("auth_user_id").eq("auth_user_id", user.id).maybeSingle();
  if (!isAdmin) return new Response("forbidden", { status: 403 });
  const { queryId, answer } = await req.json();
  const { data: q } = await db.from("tm_queries").select("*, tm_ingest_items(*)").eq("id", queryId).single();
  if (!q || q.status !== "open") return new Response("not open", { status: 409 });
  for (const step of planAnswer(q, answer)) {
    if (step.op === "alias") await db.from("tm_operative_aliases").upsert({ operative_id: step.operativeId, alias: step.alias, source: "query_answer" });
    if (step.op === "create") { /* insert tm_operatives, then enter */ }
    if (step.op === "enter") await enterCard(db, { ingestItemId: q.ingest_item_id, operativeId: step.operativeId, extraction: { ...q.tm_ingest_items.extraction, ...step.overrides }, confidence: 1, readBy: "person", threshold: 0 });
    if (step.op === "reject") await db.from("tm_ingest_items").update({ state: "rejected", error: step.reason }).eq("id", q.ingest_item_id);
  }
  await db.from("tm_queries").update({ status: "answered", answer, answered_by: user.id, answered_at: new Date().toISOString(), applied_at: new Date().toISOString() }).eq("id", queryId);
  await db.from("tm_audit_log").insert({ actor: user.id, action: "query.answered", entity_table: "tm_queries", entity_id: queryId, detail: answer });
  return Response.json({ ok: true });
});
```

- [ ] **Step 3: Integration test**

Raise a query for a fixture item, call the function locally (`supabase functions serve apply-answer`)
with an admin JWT and `pick_operative`, assert: card entered, alias written, query `answered`. Call again →
409. Call with an operative JWT → 403.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(s11): raise_query and apply-answer with alias learning" && git push
```

---

## S12 — `send_email` tool: Graph client + address gate

**Files:**
- Create: `supabase/functions/_shared/graph.ts` (token + `sendMail` + `listMessages` + `getAttachment`),
  `supabase/functions/_shared/tools/send_email.ts`, `supabase/functions/_shared/email/templates.ts`,
  `tests/unit/send_email.test.ts`, `tests/unit/templates.test.ts`

**Interfaces:**
- Produces: `GraphLike = { sendMail(msg): Promise<{ id: string }> }`;
  `sendEmail(db, graph: GraphLike, { to, subject, html, rung, operativeId?, ticketId? }): Promise<{ chaseId }>`
  throws `GateError("unknown_recipient")`; templates `chaseEmail(op, items, portalUrl)`, `adminAlert(...)`,
  `digestEmail(...)`, `inviteEmail(op, link)` each returning `{ subject, html, text }`.

- [ ] **Step 1: Failing gate test**

```ts
it("refuses an address that is not an operative or admin", async () => {
  const db = fakeDbWith({ tm_operatives: [{ email: "connor@example.com" }], tm_admins: [{ email: "kainesmith123@live.com" }] });
  const graph = { sendMail: async () => { throw new Error("must not send"); } };
  await expect(sendEmail(db, graph, { to: "evil@elsewhere.com", subject: "x", html: "y", rung: "d30" })).rejects.toThrow(/unknown_recipient/);
});
it("sends to an operative and records a chase with a body hash", async () => { /* assert tm_chases.insert called with sha256(html) */ });
```

Template tests assert the subject line format `"[Fortuna Civils] 2 items expiring — action needed"` and
that the html contains the portal upload link and never an image URL.

- [ ] **Step 2: Graph client**

```ts
export async function graphToken(): Promise<string> {
  const body = new URLSearchParams({ client_id: Deno.env.get("GRAPH_CLIENT_ID")!, client_secret: Deno.env.get("GRAPH_CLIENT_SECRET")!, scope: "https://graph.microsoft.com/.default", grant_type: "client_credentials" });
  const r = await fetch(`https://login.microsoftonline.com/${Deno.env.get("GRAPH_TENANT_ID")}/oauth2/v2.0/token`, { method: "POST", body });
  if (!r.ok) throw new Error(`graph token ${r.status}`);
  return (await r.json()).access_token;
}
export function graphClient(token: string, mailbox = Deno.env.get("GRAPH_MAILBOX")!) {
  const h = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  return {
    async sendMail(m: { to: string; subject: string; html: string; text: string }) {
      const r = await fetch(`https://graph.microsoft.com/v1.0/users/${mailbox}/sendMail`, { method: "POST", headers: h,
        body: JSON.stringify({ message: { subject: m.subject, body: { contentType: "HTML", content: m.html }, toRecipients: [{ emailAddress: { address: m.to } }], internetMessageHeaders: [{ name: "X-TM-Rung", value: "chase" }] }, saveToSentItems: true }) });
      if (!r.ok) throw new Error(`sendMail ${r.status}: ${await r.text()}`);
      return { id: r.headers.get("request-id") ?? "" };
    },
  };
}
```

- [ ] **Step 3: Implement `sendEmail` with the gate, pass, commit**

```bash
git add -A && git commit -m "feat(s12): Graph mail client, email templates, send_email with recipient gate" && git push
```

Owed: mailbox + Azure app. Until present, the function is exercised only with the fake.

---

## S13 — `read-card` queue worker + agent runs log

**Files:**
- Create: `supabase/functions/read-card/index.ts`, `supabase/functions/_shared/pipeline.ts`
  (pure orchestration given injected deps), `supabase/migrations/<ts>_s13_cron_read_card.sql`,
  `tests/unit/pipeline.test.ts`

**Interfaces:**
- Produces: `processItem(deps, item): Promise<"entered"|"queried"|"rejected"|"duplicate"|"error">` with
  `deps = { db, claude, readCard, findOperative, enterCard, raiseQuery, settings, today }`;
  `runBatch(deps, limit = 10): Promise<RunSummary>` that opens/closes a `tm_agent_runs` row.

- [ ] **Step 1: Failing pipeline tests (all deps faked)**

```ts
it("clean item → entered, run counters incremented", async () => { /* readCard→good fixture, findOperative→match */ });
it("ambiguous match → queried, enterCard never called", async () => {});
it("read_card throws (429) → item stays received, run.error set, other items still processed", async () => {});
it("file hash already entered → duplicate", async () => {});
it("non-card image (scheme unknown, confidence 0) in a non-Training folder → rejected, no query", async () => {});
```

- [ ] **Step 2: Implement `processItem`**

```ts
export async function processItem(d: Deps, item: IngestItem) {
  if (await d.db.duplicateOf(item)) { await d.db.setState(item.id, "duplicate"); return "duplicate"; }
  const images = await d.loadImages(item);
  const { extraction, usage } = await d.readCard(d.claude, images, item.operative_hint ?? undefined);
  d.run.tokens(usage);
  await d.db.setExtraction(item.id, extraction);
  if (extraction.scheme === "unknown" && extraction.confidence === 0 && !/training/i.test(item.operative_hint ?? "")) { await d.db.setState(item.id, "rejected", extraction.reasons.join("; ")); return "rejected"; }
  const match = await d.findOperative(d.db.raw, { holderName: extraction.holder_name ?? undefined, hint: item.operative_hint ?? undefined });
  const prev = match.decision === "match" ? await d.db.currentExpiryFor(match.candidates[0].id, extraction) : null;
  const flags = validateExtraction(extraction, { today: d.today, match, previousExpiry: prev });
  const decision = decide(extraction, flags, d.settings.threshold);
  if (decision.action === "enter") {
    await d.enterCard(d.db.raw, { ingestItemId: item.id, operativeId: match.candidates[0].id, extraction, confidence: extraction.confidence, readBy: "agent", threshold: d.settings.threshold });
    d.run.entered(); return "entered";
  }
  await d.raiseQuery(d.db.raw, { ingestItemId: item.id, operativeId: match.decision === "match" ? match.candidates[0].id : null, kind: decision.kind, question: decision.question, guess: extraction, options: match.candidates });
  d.run.queried(); return "queried";
}
```

`runBatch`: insert `tm_agent_runs` (`function='read-card', trigger`), select up to `limit` items in state
`received` ordered by `created_at`, for each `try processItem catch → record error, continue`, then update
the run row with counters and `finished_at`.

- [ ] **Step 3: Entrypoint + cron**

`read-card/index.ts` calls `runBatch` with real deps and returns the summary. Migration:

```sql
create extension if not exists pg_cron; create extension if not exists pg_net;
select cron.schedule('tm-read-card', '* * * * *', $$
  select net.http_post(url := current_setting('app.settings.functions_url') || '/read-card',
    headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.settings.service_key'), 'Content-Type', 'application/json'),
    body := '{"trigger":"cron"}'::jsonb) $$);
```

Set the two settings once via `alter database postgres set app.settings.functions_url = 'https://klftjnzbncabueycooct.supabase.co/functions/v1'`
and the service key the same way (documented in HANDOFF; never committed).

- [ ] **Step 4: Run, deploy locally, commit**

`npm test -- pipeline`; `supabase functions serve read-card` and POST once with a seeded `received` item
pointing at a fixture image in the local bucket; assert the item reaches `entered`/`queried`.

```bash
git add -A && git commit -m "feat(s13): read-card queue worker with agent runs and cron" && git push
```

---

## S14 — `sweep-expiry` cron + chases

**Files:**
- Create: `supabase/functions/sweep-expiry/index.ts`, `supabase/functions/_shared/sweep.ts` (pure),
  `supabase/migrations/<ts>_s14_cron_sweep.sql`, `tests/unit/sweep.test.ts`, `tests/integration/s14_sweep.test.ts`

**Interfaces:**
- Produces: `planSweep(today, rungs, tickets: TicketRow[], sent: ChaseRow[], operatives): SweepPlan`
  = `{ perOperative: { operativeId; email; items: { ticketId; competency; expiry; daysLeft; rung }[] }[]; adminLapsed: [...] }`.
  One email per operative per sweep containing all their items; one `tm_chases` row per item.

- [ ] **Step 1: Failing tests**

```ts
it("groups items per operative and picks each item's next rung", () => {});
it("skips archived operatives and tickets without expiry", () => {});
it("emits nothing for an operative whose items have all been chased at this rung", () => {});
it("puts lapsed items in the admin list too", () => {});
```

Integration: seed a ticket expiring in 30 days, run the function twice on the same day with a fake
Graph; assert one `tm_chases` row with rung `d30`, one email sent in total (the second run inserts
nothing because of the unique index and therefore sends nothing: the plan inserts the chase rows
inside a transaction before sending, and drops the email if zero rows inserted).

- [ ] **Step 2: Implement, entrypoint, cron `0 6 * * *` (Europe/London via `SET TIME ZONE` in the
job), commit**

```bash
git add -A && git commit -m "feat(s14): daily expiry sweep with chase ladder" && git push
```

---

## S15 — `digest-admin` cron + "Email this list"

**Files:**
- Create: `supabase/functions/digest-admin/index.ts`, `supabase/functions/_shared/digest.ts` (pure),
  `supabase/migrations/<ts>_s15_cron_digest.sql`, `tests/unit/digest.test.ts`
- Modify: `src/components/ExpiringView.tsx` ("Email this list" button → server action
  `emailExpiringList()` in `src/app/(app)/actions.ts` which calls the `digest-admin` function with
  `{ mode: "now", window }`)

**Interfaces:**
- Produces: `buildDigest(today, data): DigestModel` with sections: expiring by person (90 days), lapsed,
  open queries, entered last 7 days, failed reads, agent cost (tokens × price from `tm_settings.claude_price_per_mtok`).

- [ ] **Step 1: Tests** assert grouping, ordering (soonest first), and that an empty week yields a
  one-line "all clear" digest rather than no email.
- [ ] **Step 2: Implement**, cron `0 7 * * 1`, wire the button, commit:

```bash
git add -A && git commit -m "feat(s15): Monday admin digest and on-demand expiring list email" && git push
```

Phase B complete. Phase C (`C-intake.md`) starts at S16.
