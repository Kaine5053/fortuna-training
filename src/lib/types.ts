// ---------------------------------------------------------------------------
// Fortuna Civils Training Matrix — canonical types + status logic.
// Reconstructed from the live Supabase schema (project klftjnzbncabueycooct)
// and aligned to the approved ledger mock (option-3-ledger.html).
// Keep colour/status logic HERE only. Never hand-type a status; derive it.
// ---------------------------------------------------------------------------

export type TicketStatus =
  | "in_date"
  | "expiring"
  | "lapsed"
  | "not_held"
  | "no_expiry";

// Cell turns amber within this window of its expiry. The approved mock uses
// 6 months (legend: "Expires within 6 months"). The Expiring dashboard keeps
// its own independent 30/60/90-day windows, and the nav badge is a 90-day count.
export const EXPIRING_WINDOW_DAYS = 183; // ~6 months

export interface TmSection { id: string; name: string; position: number; created_at: string; updated_at: string; }
export interface TmCompetency { id: string; section_id: string; name: string; position: number; no_expiry: boolean; created_at: string; updated_at: string; }
export interface TmRole { id: string; name: string; created_at: string; updated_at: string; }
export interface TmRoleRequirement { role_id: string; competency_id: string; }
export interface TmOperative { id: string; profile_id: string | null; full_name: string; role_id: string | null; archived: boolean; notes: string | null; created_at: string; updated_at: string; }
export interface TmCard {
  id: string; operative_id: string; scheme: string | null; card_type: string | null;
  registration_no: string | null; holder_name: string | null; issue_date: string | null; expiry_date: string | null;
  superseded: boolean; superseded_by: string | null; front_image_path: string | null; back_image_path: string | null;
  source_filename: string | null; created_at: string; updated_at: string;
}
export interface TmCardCompetency { id: string; card_id: string; competency_id: string; endorsement_code: string | null; expiry_date: string | null; created_at: string; }
export interface TmTicket {
  id: string; operative_id: string; competency_id: string; source_card_competency_id: string | null;
  expiry_date: string | null; status: TicketStatus; card_type: string | null; created_at: string; updated_at: string;
}
export interface TmAuditLog { id: number; actor: string | null; action: string; entity_table: string; entity_id: string; detail: Record<string, unknown> | null; created_at: string; }

/** Days from today (UTC date-only) until the given ISO date. Negative = past. */
export function daysUntil(expiry: string): number {
  const today = new Date();
  const t = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const e = new Date(expiry + "T00:00:00Z").getTime();
  return Math.round((e - t) / 86_400_000);
}

/**
 * Derive status from expiry + the competency's no_expiry flag.
 * An actual expiry date always wins (owner decision): a no_expiry competency that
 * carries a dated card reads in_date/expiring/lapsed from the date. The no_expiry
 * flag only governs tickets with no date. "not_held" = a cell with no ticket.
 */
export function statusFromExpiry(expiry: string | null, noExpiry: boolean): TicketStatus {
  if (expiry) {
    const d = daysUntil(expiry);
    if (d < 0) return "lapsed";
    if (d <= EXPIRING_WINDOW_DAYS) return "expiring";
    return "in_date";
  }
  if (noExpiry) return "no_expiry";
  return "not_held";
}

export interface StatusStyle { label: string; glyph: string; bg: string; fg: string; border: string; }

// Palette + glyphs taken from the approved ledger mock:
//   in_date = white ● (dark glyph), expiring = solid amber ▲ (white glyph),
//   lapsed = solid red ✕ (white glyph), no_expiry = pale cream — , not_held = grey (blank).
export const STATUS_COLOUR: Record<TicketStatus, StatusStyle> = {
  in_date:  { label: "In date",   glyph: "●", bg: "#fffefb", fg: "#4a463f", border: "#e2ddd2" },
  expiring: { label: "Expiring",  glyph: "▲", bg: "#c98a35", fg: "#ffffff", border: "#b67f2f" },
  lapsed:   { label: "Lapsed",    glyph: "✕", bg: "#a83a2c", fg: "#ffffff", border: "#93291f" },
  no_expiry:{ label: "No expiry", glyph: "—", bg: "#fffefb", fg: "#6b6356", border: "#e2ddd2" },
  not_held: { label: "Not held",  glyph: "",  bg: "#d8d2c6", fg: "#b6ad9c", border: "#cfc8ba" },
};
