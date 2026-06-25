"use server";

import { createSupabaseServerClient } from "@/lib/supabaseServer";
import { statusFromExpiry, type TmCard } from "@/lib/types";

const BUCKET = "tm-cards";
const SIGNED_TTL = 60 * 10; // 10 minutes

export interface CellCardResult {
  found: boolean;
  cardType: string | null;
  expiry: string | null;
  scheme: string | null;
  registrationNo: string | null;
  frontUrl: string | null;
  backUrl: string | null;
}

async function audit(
  action: string,
  entity_table: string,
  entity_id: string,
  detail: Record<string, unknown>
) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  await supabase.from("tm_audit_log").insert({
    actor: user?.id ?? null,
    action,
    entity_table,
    entity_id,
    detail,
  });
}

async function signed(path: string | null): Promise<string | null> {
  if (!path) return null;
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, SIGNED_TTL);
  return data?.signedUrl ?? null;
}

/** Look up the governing card for a cell (operative + competency) and sign its images. */
export async function getCellCard(
  operativeId: string,
  competencyId: string
): Promise<CellCardResult> {
  const supabase = await createSupabaseServerClient();

  const { data: ticket } = await supabase
    .from("tm_tickets")
    .select("id, expiry_date, card_type, source_card_competency_id")
    .eq("operative_id", operativeId)
    .eq("competency_id", competencyId)
    .maybeSingle();

  if (!ticket) {
    return {
      found: false,
      cardType: null,
      expiry: null,
      scheme: null,
      registrationNo: null,
      frontUrl: null,
      backUrl: null,
    };
  }

  let card: TmCard | null = null;
  if (ticket.source_card_competency_id) {
    const { data: cc } = await supabase
      .from("tm_card_competencies")
      .select("card_id")
      .eq("id", ticket.source_card_competency_id)
      .maybeSingle();
    if (cc?.card_id) {
      const { data: c } = await supabase
        .from("tm_cards")
        .select("*")
        .eq("id", cc.card_id)
        .maybeSingle();
      card = (c as TmCard) ?? null;
    }
  }

  const [frontUrl, backUrl] = await Promise.all([
    signed(card?.front_image_path ?? null),
    signed(card?.back_image_path ?? null),
  ]);

  return {
    found: true,
    cardType: card?.card_type ?? ticket.card_type ?? null,
    expiry: ticket.expiry_date ?? card?.expiry_date ?? null,
    scheme: card?.scheme ?? null,
    registrationNo: card?.registration_no ?? null,
    frontUrl,
    backUrl,
  };
}

/** Update an operative's role. */
export async function updateOperativeRole(
  operativeId: string,
  roleId: string | null
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("tm_operatives")
    .update({ role_id: roleId, updated_at: new Date().toISOString() })
    .eq("id", operativeId);
  if (error) return { ok: false, error: error.message };
  await audit("update_role", "tm_operatives", operativeId, { role_id: roleId });
  return { ok: true };
}

export interface UpsertTicketInput {
  operativeId: string;
  competencyId: string;
  noExpiry: boolean;
  expiryDate: string | null; // ISO yyyy-mm-dd, ignored when noExpiry
  cardType: string | null;
}

/** Create a manual evidence card (+ card_competency) with null images. Returns cc id. */
async function createEvidence(
  operativeId: string,
  competencyId: string,
  cardType: string | null,
  expiry: string | null
): Promise<{ ccId?: string; error?: string }> {
  const supabase = await createSupabaseServerClient();
  const { data: card, error: cardErr } = await supabase
    .from("tm_cards")
    .insert({
      operative_id: operativeId,
      card_type: cardType,
      expiry_date: expiry,
      front_image_path: null,
      back_image_path: null,
      source_filename: null,
    })
    .select("id")
    .single();
  if (cardErr || !card) return { error: cardErr?.message ?? "card insert failed" };

  const { data: cc, error: ccErr } = await supabase
    .from("tm_card_competencies")
    .insert({ card_id: card.id, competency_id: competencyId, expiry_date: expiry })
    .select("id")
    .single();
  if (ccErr || !cc) return { error: ccErr?.message ?? "card_competency insert failed" };
  return { ccId: cc.id };
}

/**
 * Add or update a ticket for an operative+competency.
 * - New ticket: create evidence card + card_competency (null images), link, insert ticket.
 * - Existing ticket with linked evidence: update that card + card_competency in place
 *   (full supersede history is Phase 8).
 * Status is always derived. Writes an audit row.
 */
export async function upsertTicket(
  input: UpsertTicketInput
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createSupabaseServerClient();
  const { operativeId, competencyId, noExpiry } = input;
  const expiry = noExpiry ? null : input.expiryDate || null;
  const status = statusFromExpiry(expiry, noExpiry);
  const now = new Date().toISOString();

  const { data: existing } = await supabase
    .from("tm_tickets")
    .select("id, source_card_competency_id")
    .eq("operative_id", operativeId)
    .eq("competency_id", competencyId)
    .maybeSingle();

  if (existing) {
    let ccId = existing.source_card_competency_id;

    if (ccId) {
      // Update the linked evidence in place.
      const { data: cc } = await supabase
        .from("tm_card_competencies")
        .select("card_id")
        .eq("id", ccId)
        .maybeSingle();
      await supabase
        .from("tm_card_competencies")
        .update({ expiry_date: expiry })
        .eq("id", ccId);
      if (cc?.card_id) {
        await supabase
          .from("tm_cards")
          .update({ card_type: input.cardType, expiry_date: expiry, updated_at: now })
          .eq("id", cc.card_id);
      }
    } else {
      const ev = await createEvidence(operativeId, competencyId, input.cardType, expiry);
      if (ev.error) return { ok: false, error: ev.error };
      ccId = ev.ccId!;
    }

    const { error } = await supabase
      .from("tm_tickets")
      .update({
        expiry_date: expiry,
        status,
        card_type: input.cardType,
        source_card_competency_id: ccId,
        updated_at: now,
      })
      .eq("id", existing.id);
    if (error) return { ok: false, error: error.message };
    await audit("update_ticket", "tm_tickets", existing.id, {
      competency_id: competencyId,
      expiry,
      status,
    });
    return { ok: true };
  }

  // New ticket
  const ev = await createEvidence(operativeId, competencyId, input.cardType, expiry);
  if (ev.error) return { ok: false, error: ev.error };

  const { data: inserted, error } = await supabase
    .from("tm_tickets")
    .insert({
      operative_id: operativeId,
      competency_id: competencyId,
      expiry_date: expiry,
      status,
      card_type: input.cardType,
      source_card_competency_id: ev.ccId,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };
  await audit("add_ticket", "tm_tickets", inserted?.id ?? "", {
    competency_id: competencyId,
    expiry,
    status,
  });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Phase 4 — add operative / section / competency / role + role requirements.
// ---------------------------------------------------------------------------

export async function addOperative(
  fullName: string,
  roleId: string | null
): Promise<{ ok: boolean; error?: string; id?: string }> {
  const name = fullName.trim();
  if (!name) return { ok: false, error: "Name is required" };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("tm_operatives")
    .insert({ full_name: name, role_id: roleId, archived: false })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };
  await audit("add_operative", "tm_operatives", data.id, { full_name: name, role_id: roleId });
  return { ok: true, id: data.id };
}

export async function addSection(
  name: string
): Promise<{ ok: boolean; error?: string; id?: string }> {
  const n = name.trim();
  if (!n) return { ok: false, error: "Section name is required" };
  const supabase = await createSupabaseServerClient();
  const { data: top } = await supabase
    .from("tm_sections")
    .select("position")
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const position = (top?.position ?? -1) + 1;
  const { data, error } = await supabase
    .from("tm_sections")
    .insert({ name: n, position })
    .select("id")
    .single();
  if (error)
    return {
      ok: false,
      error: error.code === "23505" ? "A section with that name already exists" : error.message,
    };
  await audit("add_section", "tm_sections", data.id, { name: n, position });
  return { ok: true, id: data.id };
}

export async function addCompetency(
  name: string,
  sectionId: string,
  noExpiry: boolean
): Promise<{ ok: boolean; error?: string; id?: string }> {
  const n = name.trim();
  if (!n) return { ok: false, error: "Competency name is required" };
  if (!sectionId) return { ok: false, error: "Pick a section" };
  const supabase = await createSupabaseServerClient();
  const { data: top } = await supabase
    .from("tm_competencies")
    .select("position")
    .eq("section_id", sectionId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const position = (top?.position ?? -1) + 1;
  const { data, error } = await supabase
    .from("tm_competencies")
    .insert({ name: n, section_id: sectionId, no_expiry: noExpiry, position })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };
  await audit("add_competency", "tm_competencies", data.id, {
    name: n,
    section_id: sectionId,
    no_expiry: noExpiry,
    position,
  });
  return { ok: true, id: data.id };
}

export async function addRole(
  name: string
): Promise<{ ok: boolean; error?: string; id?: string }> {
  const n = name.trim();
  if (!n) return { ok: false, error: "Role name is required" };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("tm_roles")
    .insert({ name: n })
    .select("id")
    .single();
  if (error)
    return {
      ok: false,
      error: error.code === "23505" ? "A role with that name already exists" : error.message,
    };
  await audit("add_role", "tm_roles", data.id, { name: n });
  return { ok: true, id: data.id };
}

/** Toggle a role requirement (composite PK role_id+competency_id). */
export async function setRoleRequirement(
  roleId: string,
  competencyId: string,
  required: boolean
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createSupabaseServerClient();
  if (required) {
    const { error } = await supabase
      .from("tm_role_requirements")
      .upsert({ role_id: roleId, competency_id: competencyId }, { onConflict: "role_id,competency_id" });
    if (error) return { ok: false, error: error.message };
  } else {
    const { error } = await supabase
      .from("tm_role_requirements")
      .delete()
      .eq("role_id", roleId)
      .eq("competency_id", competencyId);
    if (error) return { ok: false, error: error.message };
  }
  await audit("set_role_requirement", "tm_role_requirements", `${roleId}:${competencyId}`, {
    role_id: roleId,
    competency_id: competencyId,
    required,
  });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Phase 5 — archive / reactivate operatives (bulk, audit-logged).
// ---------------------------------------------------------------------------

export async function setArchived(
  operativeIds: string[],
  archived: boolean
): Promise<{ ok: boolean; error?: string; count: number }> {
  const ids = operativeIds.filter(Boolean);
  if (ids.length === 0) return { ok: true, count: 0 };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("tm_operatives")
    .update({ archived, updated_at: new Date().toISOString() })
    .in("id", ids);
  if (error) return { ok: false, error: error.message, count: 0 };
  await audit(archived ? "archive" : "reactivate", "tm_operatives", ids.join(","), {
    operative_ids: ids,
    archived,
  });
  return { ok: true, count: ids.length };
}

// ---------------------------------------------------------------------------
// Phase 8 — Renew with full supersede history (single + bulk) + image upload.
// ---------------------------------------------------------------------------

function addYearsISO(base: string | null, years: number): string {
  const d = base ? new Date(base + "T00:00:00Z") : new Date();
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d.toISOString().slice(0, 10);
}

/**
 * Core renew: create a NEW card (carrying old metadata + images unless replaced),
 * a new card_competency, repoint the ticket, and flag the OLD card superseded.
 * The old card + old card_competency are preserved (history).
 */
async function supersedeAndRenew(
  operativeId: string,
  competencyId: string,
  newExpiry: string,
  frontPath?: string | null,
  backPath?: string | null
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createSupabaseServerClient();

  const { data: ticket } = await supabase
    .from("tm_tickets")
    .select("id, card_type, source_card_competency_id")
    .eq("operative_id", operativeId)
    .eq("competency_id", competencyId)
    .maybeSingle();
  if (!ticket) return { ok: false, error: "No ticket to renew" };

  // Resolve the old card (if any) to carry metadata/images forward.
  let oldCard: TmCard | null = null;
  if (ticket.source_card_competency_id) {
    const { data: cc } = await supabase
      .from("tm_card_competencies")
      .select("card_id")
      .eq("id", ticket.source_card_competency_id)
      .maybeSingle();
    if (cc?.card_id) {
      const { data: c } = await supabase.from("tm_cards").select("*").eq("id", cc.card_id).maybeSingle();
      oldCard = (c as TmCard) ?? null;
    }
  }

  const status = statusFromExpiry(newExpiry, false);
  const now = new Date().toISOString();

  // New card carries forward metadata + images unless explicitly replaced.
  const { data: newCard, error: cardErr } = await supabase
    .from("tm_cards")
    .insert({
      operative_id: operativeId,
      scheme: oldCard?.scheme ?? null,
      card_type: ticket.card_type ?? oldCard?.card_type ?? null,
      registration_no: oldCard?.registration_no ?? null,
      holder_name: oldCard?.holder_name ?? null,
      issue_date: now.slice(0, 10),
      expiry_date: newExpiry,
      front_image_path: frontPath ?? oldCard?.front_image_path ?? null,
      back_image_path: backPath ?? oldCard?.back_image_path ?? null,
      superseded: false,
      source_filename: oldCard?.source_filename ?? null,
    })
    .select("id")
    .single();
  if (cardErr || !newCard) return { ok: false, error: cardErr?.message ?? "card insert failed" };

  const { data: newCc, error: ccErr } = await supabase
    .from("tm_card_competencies")
    .insert({ card_id: newCard.id, competency_id: competencyId, expiry_date: newExpiry })
    .select("id")
    .single();
  if (ccErr || !newCc) return { ok: false, error: ccErr?.message ?? "card_competency insert failed" };

  const { error: tErr } = await supabase
    .from("tm_tickets")
    .update({ expiry_date: newExpiry, status, source_card_competency_id: newCc.id, updated_at: now })
    .eq("id", ticket.id);
  if (tErr) return { ok: false, error: tErr.message };

  // Flag the old card as superseded by the new one (preserve history).
  if (oldCard) {
    await supabase
      .from("tm_cards")
      .update({ superseded: true, superseded_by: newCard.id, updated_at: now })
      .eq("id", oldCard.id);
  }

  await audit("renew_ticket", "tm_tickets", ticket.id, {
    competency_id: competencyId,
    new_expiry: newExpiry,
    status,
    superseded_card: oldCard?.id ?? null,
    new_card: newCard.id,
  });
  return { ok: true };
}

/** Single renew. Default new expiry = today + 3 years. */
export async function renewTicket(
  operativeId: string,
  competencyId: string,
  opts?: { newExpiry?: string; years?: number; frontPath?: string | null; backPath?: string | null }
): Promise<{ ok: boolean; error?: string; expiry?: string }> {
  const newExpiry = opts?.newExpiry ?? addYearsISO(null, opts?.years ?? 3);
  const r = await supersedeAndRenew(
    operativeId,
    competencyId,
    newExpiry,
    opts?.frontPath ?? null,
    opts?.backPath ?? null
  );
  return r.ok ? { ok: true, expiry: newExpiry } : r;
}

/**
 * Bulk renew: for each operative, renew all dated tickets that are lapsed or
 * expiring within 90 days to one new expiry date (default today + 3 years).
 */
export async function bulkRenew(
  operativeIds: string[],
  newExpiry?: string
): Promise<{ ok: boolean; error?: string; renewed: number }> {
  const ids = operativeIds.filter(Boolean);
  if (ids.length === 0) return { ok: true, renewed: 0 };
  const expiry = newExpiry ?? addYearsISO(null, 3);
  const supabase = await createSupabaseServerClient();

  // Pull candidate tickets (dated, non-no_expiry competencies) for these operatives.
  const { data: rows } = await supabase
    .from("tm_tickets")
    .select("operative_id, competency_id, expiry_date, tm_competencies!inner(no_expiry)")
    .in("operative_id", ids);

  let renewed = 0;
  for (const r of rows ?? []) {
    const comp = (r as unknown as { tm_competencies: { no_expiry: boolean } }).tm_competencies;
    if (comp?.no_expiry || !r.expiry_date) continue;
    const status = statusFromExpiry(r.expiry_date, false);
    if (status !== "lapsed" && status !== "expiring") continue;
    const res = await supersedeAndRenew(r.operative_id, r.competency_id, expiry);
    if (res.ok) renewed++;
  }
  return { ok: true, renewed };
}

/** Upload replacement card images to the private tm-cards bucket. */
export async function uploadCardImages(
  operativeId: string,
  competencyId: string,
  formData: FormData
): Promise<{ frontPath?: string | null; backPath?: string | null; error?: string }> {
  const supabase = await createSupabaseServerClient();
  const result: { frontPath?: string | null; backPath?: string | null; error?: string } = {};

  for (const side of ["front", "back"] as const) {
    const file = formData.get(side) as File | null;
    if (!file || file.size === 0) continue;
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
    const path = `${operativeId}/${competencyId}/${Date.now()}-${side}.${ext}`;
    const buf = Buffer.from(await file.arrayBuffer());
    const { error } = await supabase.storage
      .from("tm-cards")
      .upload(path, buf, { contentType: file.type || "image/jpeg", upsert: true });
    if (error) return { error: error.message };
    if (side === "front") result.frontPath = path;
    else result.backPath = path;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Phase 9 — PDF export data (held tickets grouped by section + signed images).
// ---------------------------------------------------------------------------

export interface ExportTicket {
  competency: string;
  section: string;
  sectionPos: number;
  compPos: number;
  expiry: string | null; // null => "No expiry"
  noExpiry: boolean;
  status: string;
  cardType: string | null;
  frontUrl: string | null;
  backUrl: string | null;
}

export interface ExportOperative {
  id: string;
  name: string;
  role: string;
  tickets: ExportTicket[];
}

/** Gather per-operative export data. Only HELD tickets (in_date/expiring/no_expiry). */
export async function getExportData(
  operativeIds: string[]
): Promise<ExportOperative[]> {
  const ids = operativeIds.filter(Boolean);
  if (ids.length === 0) return [];
  const supabase = await createSupabaseServerClient();

  const [{ data: ops }, { data: roles }, { data: comps }, { data: secs }, { data: tickets }] =
    await Promise.all([
      supabase.from("tm_operatives").select("*").in("id", ids),
      supabase.from("tm_roles").select("*"),
      supabase.from("tm_competencies").select("*"),
      supabase.from("tm_sections").select("*"),
      supabase.from("tm_tickets").select("*").in("operative_id", ids),
    ]);

  const roleName = new Map((roles ?? []).map((r) => [r.id, r.name]));
  const compById = new Map((comps ?? []).map((c) => [c.id, c]));
  const secById = new Map((secs ?? []).map((s) => [s.id, s]));

  const out: ExportOperative[] = [];
  for (const o of ops ?? []) {
    const myTickets = (tickets ?? []).filter((t) => t.operative_id === o.id);
    const rows: ExportTicket[] = [];
    for (const t of myTickets) {
      const comp = compById.get(t.competency_id);
      if (!comp) continue;
      const status = statusFromExpiry(t.expiry_date, comp.no_expiry);
      if (status === "not_held" || status === "lapsed") continue; // held only
      const sec = secById.get(comp.section_id);

      // Resolve card images via source_card_competency_id -> card.
      let frontUrl: string | null = null;
      let backUrl: string | null = null;
      if (t.source_card_competency_id) {
        const { data: cc } = await supabase
          .from("tm_card_competencies")
          .select("card_id")
          .eq("id", t.source_card_competency_id)
          .maybeSingle();
        if (cc?.card_id) {
          const { data: card } = await supabase
            .from("tm_cards")
            .select("front_image_path, back_image_path")
            .eq("id", cc.card_id)
            .maybeSingle();
          [frontUrl, backUrl] = await Promise.all([
            signed(card?.front_image_path ?? null),
            signed(card?.back_image_path ?? null),
          ]);
        }
      }

      rows.push({
        competency: comp.name,
        section: sec?.name ?? "—",
        sectionPos: sec?.position ?? 0,
        compPos: comp.position ?? 0,
        expiry: comp.no_expiry ? null : t.expiry_date,
        noExpiry: comp.no_expiry,
        status,
        cardType: t.card_type ?? null,
        frontUrl,
        backUrl,
      });
    }
    rows.sort((a, b) => a.sectionPos - b.sectionPos || a.compPos - b.compPos);
    out.push({
      id: o.id,
      name: o.full_name,
      role: o.role_id ? roleName.get(o.role_id) ?? "—" : "—",
      tickets: rows,
    });
  }
  // Preserve the order the user selected.
  out.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
  await audit("export_pdf", "tm_operatives", ids.join(","), { count: ids.length });
  return out;
}

// ---------------------------------------------------------------------------
// Phase 10 — drag-arrange: persist section + competency ordering.
// ---------------------------------------------------------------------------

export async function reorderSections(
  orderedIds: string[]
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createSupabaseServerClient();
  const now = new Date().toISOString();
  for (let i = 0; i < orderedIds.length; i++) {
    const { error } = await supabase
      .from("tm_sections")
      .update({ position: i, updated_at: now })
      .eq("id", orderedIds[i]);
    if (error) return { ok: false, error: error.message };
  }
  await audit("reorder_sections", "tm_sections", orderedIds.join(","), { order: orderedIds });
  return { ok: true };
}

/** Persist the full competency layout: each item's section_id + position. */
export async function saveCompetencyLayout(
  items: { id: string; section_id: string; position: number }[]
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createSupabaseServerClient();
  const now = new Date().toISOString();
  for (const it of items) {
    const { error } = await supabase
      .from("tm_competencies")
      .update({ section_id: it.section_id, position: it.position, updated_at: now })
      .eq("id", it.id);
    if (error) return { ok: false, error: error.message };
  }
  await audit("reorder_competencies", "tm_competencies", `${items.length} items`, {
    items: items.map((i) => ({ id: i.id, section_id: i.section_id, position: i.position })),
  });
  return { ok: true };
}
