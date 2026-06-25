"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { MatrixData } from "@/lib/matrixData";
import {
  STATUS_COLOUR,
  statusFromExpiry,
  type TicketStatus,
  type TmOperative,
} from "@/lib/types";
import CellLightbox from "@/components/CellLightbox";
import OperativeEditPanel from "@/components/OperativeEditPanel";
import AddMenu from "@/components/AddMenu";
import { setArchived } from "@/app/(app)/actions";
import BulkRenewModal from "@/components/BulkRenewModal";
import ExportButton from "@/components/ExportButton";
import ArrangeModal from "@/components/ArrangeModal";
import IngestModal from "@/components/IngestModal";

type Sheet = "active" | "archive";

interface LightboxState {
  operativeId: string;
  operativeName: string;
  competencyId: string;
  competencyName: string;
  status: TicketStatus;
}

export default function MatrixGrid({ data }: { data: MatrixData }) {
  const { sections, competencies, operatives, roles, tickets } = data;
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [sheet, setSheet] = useState<Sheet>("active");
  const [search, setSearch] = useState("");
  const [hiddenSections, setHiddenSections] = useState<Set<string>>(new Set());
  const [lightbox, setLightbox] = useState<LightboxState | null>(null);
  const [editOperative, setEditOperative] = useState<TmOperative | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkRenewOpen, setBulkRenewOpen] = useState(false);
  const [arrangeOpen, setArrangeOpen] = useState(false);
  const [ingestOpen, setIngestOpen] = useState(false);

  // Clear selection whenever the sheet changes.
  useEffect(() => setSelected(new Set()), [sheet]);

  const roleNameById = useMemo(
    () => new Map(roles.map((r) => [r.id, r.name])),
    [roles]
  );
  const noExpiryById = useMemo(
    () => new Map(competencies.map((c) => [c.id, c.no_expiry])),
    [competencies]
  );

  const ticketMap = useMemo(() => {
    const m = new Map<string, (typeof tickets)[number]>();
    for (const t of tickets) m.set(`${t.operative_id}:${t.competency_id}`, t);
    return m;
  }, [tickets]);

  const orderedSections = useMemo(() => {
    const bySection = new Map<string, typeof competencies>();
    for (const c of competencies) {
      const arr = bySection.get(c.section_id) ?? [];
      arr.push(c);
      bySection.set(c.section_id, arr);
    }
    return sections
      .filter((s) => !hiddenSections.has(s.id))
      .map((s) => ({
        section: s,
        comps: (bySection.get(s.id) ?? []).sort((a, b) => a.position - b.position),
      }))
      .filter((g) => g.comps.length > 0);
  }, [sections, competencies, hiddenSections]);

  const visibleComps = useMemo(
    () => orderedSections.flatMap((g) => g.comps),
    [orderedSections]
  );

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return operatives
      .filter((o) => (sheet === "active" ? !o.archived : o.archived))
      .filter((o) => (q ? o.full_name.toLowerCase().includes(q) : true));
  }, [operatives, sheet, search]);

  // Select-all checkbox state over currently visible rows.
  const allSelected = rows.length > 0 && rows.every((o) => selected.has(o.id));
  const someSelected = rows.some((o) => selected.has(o.id));
  const selectAllRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (selectAllRef.current)
      selectAllRef.current.indeterminate = someSelected && !allSelected;
  }, [someSelected, allSelected]);

  function toggleSection(id: string) {
    setHiddenSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleRow(id: string, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function toggleAll(on: boolean) {
    setSelected(on ? new Set(rows.map((o) => o.id)) : new Set());
  }

  function applyArchive(archived: boolean, ids?: string[]) {
    const target = ids ?? Array.from(selected);
    if (target.length === 0) return;
    startTransition(async () => {
      await setArchived(target, archived);
      setSelected(new Set());
      router.refresh();
    });
  }

  function cellInfo(operativeId: string, competencyId: string): {
    status: TicketStatus;
    expiry: string | null;
    hasTicket: boolean;
  } {
    const t = ticketMap.get(`${operativeId}:${competencyId}`);
    if (!t) return { status: "not_held", expiry: null, hasTicket: false };
    const status = statusFromExpiry(
      t.expiry_date,
      noExpiryById.get(competencyId) ?? false
    );
    return { status, expiry: t.expiry_date, hasTicket: true };
  }

  const selCount = Array.from(selected).filter((id) =>
    rows.some((o) => o.id === id)
  ).length;

  return (
    <div>
      {/* Controls */}
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <input
          type="search"
          placeholder="Search operatives…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="rounded border border-rule bg-paper px-3 py-2 text-sm outline-none focus:border-brass"
        />
        <div className="inline-flex overflow-hidden rounded border border-rule">
          <button
            onClick={() => setSheet("active")}
            className={`px-3 py-2 text-sm ${
              sheet === "active" ? "bg-ink text-ivory" : "bg-paper text-ink/70"
            }`}
          >
            Active
          </button>
          <button
            onClick={() => setSheet("archive")}
            className={`px-3 py-2 text-sm ${
              sheet === "archive" ? "bg-ink text-ivory" : "bg-paper text-ink/70"
            }`}
          >
            Archive
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {sections.map((s) => {
            const on = !hiddenSections.has(s.id);
            return (
              <button
                key={s.id}
                onClick={() => toggleSection(s.id)}
                className={`rounded-full border px-2.5 py-1 text-xs transition ${
                  on
                    ? "border-brass bg-brass/10 text-ink"
                    : "border-rule bg-paper text-ink/40 line-through"
                }`}
              >
                {s.name}
              </button>
            );
          })}
        </div>
        <AddMenu data={data} />
        <button
          onClick={() => setArrangeOpen(true)}
          className="rounded border border-rule px-3 py-2 text-sm text-ink/70 hover:bg-ivory"
        >
          Arrange
        </button>
        <button
          onClick={() => setIngestOpen(true)}
          className="rounded border border-rule px-3 py-2 text-sm text-ink/70 hover:bg-ivory"
        >
          Ingest training files
        </button>
        <Legend />
      </div>

      {/* Selection action bar */}
      <div className="mb-3 flex min-h-[36px] items-center gap-3">
        {selCount > 0 ? (
          <>
            <span className="text-sm text-ink/70">{selCount} selected</span>
            {sheet === "active" ? (
              <>
                <button
                  disabled={pending}
                  onClick={() => applyArchive(true)}
                  className="rounded bg-ink px-3 py-1.5 text-sm font-medium text-ivory hover:bg-ink/90 disabled:opacity-50"
                >
                  Archive selected
                </button>
                <button
                  onClick={() => setBulkRenewOpen(true)}
                  className="rounded bg-brass px-3 py-1.5 text-sm font-medium text-ink hover:brightness-105"
                >
                  Renew selected
                </button>
              </>
            ) : (
              <button
                disabled={pending}
                onClick={() => applyArchive(false)}
                className="rounded bg-brass px-3 py-1.5 text-sm font-medium text-ink hover:brightness-105 disabled:opacity-50"
              >
                Reactivate selected
              </button>
            )}
            <ExportButton
              operativeIds={Array.from(selected).filter((id) =>
                rows.some((o) => o.id === id)
              )}
              count={selCount}
            />
            <button
              onClick={() => setSelected(new Set())}
              className="text-sm text-ink/50 hover:text-ink"
            >
              Clear
            </button>
          </>
        ) : (
          <span className="text-sm text-ink/40">
            Select operatives to {sheet === "active" ? "archive" : "reactivate"}.
          </span>
        )}
      </div>

      {/* Grid */}
      <div className="ledger-scroll overflow-auto rounded-lg border border-rule bg-paper">
        <table className="border-collapse text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 top-0 z-30 min-w-[250px] border-b border-r border-rule bg-ink px-3 py-2 text-left font-serif text-ivory">
                <span className="inline-flex items-center gap-2">
                  <input
                    ref={selectAllRef}
                    type="checkbox"
                    checked={allSelected}
                    onChange={(e) => toggleAll(e.target.checked)}
                    aria-label="Select all"
                  />
                  Operative
                </span>
              </th>
              {orderedSections.map((g) => (
                <th
                  key={g.section.id}
                  colSpan={g.comps.length}
                  className="sticky top-0 z-20 border-b border-l border-rule bg-ink/95 px-2 py-2 text-center font-serif text-xs uppercase tracking-wide text-ivory"
                >
                  {g.section.name}
                </th>
              ))}
            </tr>
            <tr>
              <th className="sticky left-0 z-20 border-b border-r border-rule bg-ivory px-3 py-2 text-left text-xs font-medium text-ink/50">
                Role
              </th>
              {visibleComps.map((c) => (
                <th
                  key={c.id}
                  className="h-32 w-9 border-b border-l border-rule bg-ivory align-bottom"
                >
                  <div className="mx-auto flex h-full items-end justify-center pb-2">
                    <span className="whitespace-nowrap text-xs text-ink/70 [writing-mode:vertical-rl] rotate-180">
                      {c.name}
                      {c.no_expiry ? " ∞" : ""}
                    </span>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={visibleComps.length + 1}
                  className="px-4 py-8 text-center text-sm text-ink/50"
                >
                  No {sheet === "active" ? "active" : "archived"} operatives
                  {search ? " match your search." : "."}
                </td>
              </tr>
            )}
            {rows.map((o) => (
              <tr key={o.id} className="group">
                <th className="sticky left-0 z-10 min-w-[250px] border-b border-r border-rule bg-paper px-3 py-2 text-left font-normal group-hover:bg-ivory">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={selected.has(o.id)}
                      onChange={(e) => toggleRow(o.id, e.target.checked)}
                      aria-label={`Select ${o.full_name}`}
                    />
                    <button
                      onClick={() => setEditOperative(o)}
                      className="text-left"
                      title="Edit role & tickets"
                    >
                      <div className="font-serif text-ink underline-offset-2 hover:underline">
                        {o.full_name}
                      </div>
                      <div className="text-xs text-ink/50">
                        {o.role_id ? roleNameById.get(o.role_id) ?? "—" : "—"}
                      </div>
                    </button>
                    {sheet === "archive" && (
                      <button
                        disabled={pending}
                        onClick={() => applyArchive(false, [o.id])}
                        className="ml-auto rounded border border-brass px-2 py-1 text-xs text-brass hover:bg-brass/10 disabled:opacity-50"
                      >
                        Reactivate
                      </button>
                    )}
                  </div>
                </th>
                {visibleComps.map((c) => {
                  const { status, expiry, hasTicket } = cellInfo(o.id, c.id);
                  const st = STATUS_COLOUR[status];
                  return (
                    <td
                      key={c.id}
                      title={`${o.full_name} — ${c.name}: ${st.label}${
                        expiry ? ` (exp ${expiry})` : ""
                      }`}
                      onClick={() => {
                        if (hasTicket) {
                          setLightbox({
                            operativeId: o.id,
                            operativeName: o.full_name,
                            competencyId: c.id,
                            competencyName: c.name,
                            status,
                          });
                        } else {
                          setEditOperative(o);
                        }
                      }}
                      className="cursor-pointer border-b border-l border-rule text-center align-middle hover:brightness-95"
                      style={{ background: st.bg }}
                    >
                      <span
                        className="inline-block h-full w-9 py-2 text-base leading-none"
                        style={{ color: st.fg }}
                      >
                        {st.glyph}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {lightbox && (
        <CellLightbox
          operativeId={lightbox.operativeId}
          operativeName={lightbox.operativeName}
          competencyId={lightbox.competencyId}
          competencyName={lightbox.competencyName}
          status={lightbox.status}
          onClose={() => setLightbox(null)}
        />
      )}

      {editOperative && (
        <OperativeEditPanel
          operative={editOperative}
          data={data}
          onClose={() => setEditOperative(null)}
        />
      )}
      {bulkRenewOpen && (
        <BulkRenewModal
          operativeIds={Array.from(selected)}
          count={selCount}
          onClose={() => setBulkRenewOpen(false)}
        />
      )}
      {arrangeOpen && (
        <ArrangeModal data={data} onClose={() => setArrangeOpen(false)} />
      )}
      {ingestOpen && <IngestModal onClose={() => setIngestOpen(false)} />}
    </div>
  );
}

function Legend() {
  const items: TicketStatus[] = [
    "in_date",
    "expiring",
    "lapsed",
    "no_expiry",
    "not_held",
  ];
  return (
    <div className="ml-auto flex flex-wrap items-center gap-3 text-xs text-ink/60">
      {items.map((s) => {
        const st = STATUS_COLOUR[s];
        return (
          <span key={s} className="inline-flex items-center gap-1.5">
            <span
              className="inline-flex h-4 w-4 items-center justify-center rounded-sm text-[11px] leading-none"
              style={{ background: st.bg, color: st.fg, border: `1px solid ${st.border}` }}
            >
              {st.glyph || "·"}
            </span>
            {st.label}
          </span>
        );
      })}
    </div>
  );
}
