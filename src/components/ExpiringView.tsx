"use client";

import { useMemo, useState } from "react";
import type { MatrixData } from "@/lib/matrixData";
import {
  daysUntil,
  statusFromExpiry,
  STATUS_COLOUR,
  type TmOperative,
} from "@/lib/types";
import OperativeEditPanel from "@/components/OperativeEditPanel";
import RenewModal from "@/components/RenewModal";

type Window = 30 | 60 | 90 | "lapsed";

interface Row {
  operativeId: string;
  operativeName: string;
  roleName: string;
  competencyId: string;
  competencyName: string;
  sectionName: string;
  expiry: string;
  days: number; // negative = lapsed
  lapsed: boolean;
}

export default function ExpiringView({ data }: { data: MatrixData }) {
  const { sections, competencies, operatives, roles, tickets } = data;
  const [win, setWin] = useState<Window>(90);
  const [editOperative, setEditOperative] = useState<TmOperative | null>(null);
  const [renewRow, setRenewRow] = useState<Row | null>(null);

  const roleName = useMemo(() => new Map(roles.map((r) => [r.id, r.name])), [roles]);
  const sectionName = useMemo(() => new Map(sections.map((s) => [s.id, s.name])), [sections]);
  const compById = useMemo(() => new Map(competencies.map((c) => [c.id, c])), [competencies]);
  const opById = useMemo(() => new Map(operatives.map((o) => [o.id, o])), [operatives]);
  const activeIds = useMemo(
    () => new Set(operatives.filter((o) => !o.archived).map((o) => o.id)),
    [operatives]
  );

  // All dated tickets for active operatives that are lapsed or expiring.
  const allRows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    for (const t of tickets) {
      if (!activeIds.has(t.operative_id)) continue;
      const comp = compById.get(t.competency_id);
      if (!comp || comp.no_expiry || !t.expiry_date) continue;
      const status = statusFromExpiry(t.expiry_date, false);
      if (status !== "lapsed" && status !== "expiring") continue;
      const op = opById.get(t.operative_id);
      out.push({
        operativeId: t.operative_id,
        operativeName: op?.full_name ?? "—",
        roleName: op?.role_id ? roleName.get(op.role_id) ?? "—" : "—",
        competencyId: t.competency_id,
        competencyName: comp.name,
        sectionName: sectionName.get(comp.section_id) ?? "—",
        expiry: t.expiry_date,
        days: daysUntil(t.expiry_date),
        lapsed: status === "lapsed",
      });
    }
    return out.sort((a, b) => a.days - b.days); // soonest/most-overdue first
  }, [tickets, activeIds, compById, opById, roleName, sectionName]);

  const lapsedCount = allRows.filter((r) => r.lapsed).length;
  const within30 = allRows.filter((r) => !r.lapsed && r.days <= 30).length;

  const rows = useMemo(() => {
    if (win === "lapsed") return allRows.filter((r) => r.lapsed);
    return allRows.filter((r) => r.lapsed || r.days <= win);
  }, [allRows, win]);

  function emailStub() {
    alert(
      "Email reminder is a later backend job (scheduled reminders). This button is a stub for now."
    );
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex overflow-hidden rounded border border-rule">
          {([30, 60, 90, "lapsed"] as Window[]).map((w) => (
            <button
              key={String(w)}
              onClick={() => setWin(w)}
              className={`px-3 py-2 text-sm ${
                win === w ? "bg-ink text-ivory" : "bg-paper text-ink/70"
              }`}
            >
              {w === "lapsed" ? "Lapsed only" : `${w} days`}
            </button>
          ))}
        </div>
        <button
          onClick={emailStub}
          className="rounded border border-rule px-3 py-2 text-sm text-ink/70 hover:bg-ivory"
        >
          Email this list
        </button>
      </div>

      {/* Summary cards */}
      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <SummaryCard label="Lapsed" value={lapsedCount} tone="lapsed" />
        <SummaryCard label="Due ≤ 30 days" value={within30} tone="expiring" />
        <SummaryCard
          label={win === "lapsed" ? "Lapsed (window)" : `In window (≤ ${win}d + lapsed)`}
          value={rows.length}
          tone="neutral"
        />
      </div>

      {/* List */}
      <div className="overflow-hidden rounded-lg border border-rule bg-paper">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-rule bg-ivory text-left text-xs uppercase tracking-wide text-ink/50">
              <th className="px-4 py-2">Operative</th>
              <th className="px-4 py-2">Role</th>
              <th className="px-4 py-2">Competency</th>
              <th className="px-4 py-2">Section</th>
              <th className="px-4 py-2">Expiry</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-ink/50">
                  Nothing {win === "lapsed" ? "lapsed" : `due within ${win} days`}.
                </td>
              </tr>
            )}
            {rows.map((r) => {
              const key = `${r.operativeId}:${r.competencyId}`;
              const st = STATUS_COLOUR[r.lapsed ? "lapsed" : "expiring"];
              return (
                <tr
                  key={key}
                  className="cursor-pointer border-b border-rule/60 hover:bg-ivory/60"
                  onClick={() => {
                    const op = opById.get(r.operativeId);
                    if (op) setEditOperative(op);
                  }}
                >
                  <td className="px-4 py-2 font-serif text-ink">{r.operativeName}</td>
                  <td className="px-4 py-2 text-ink/70">{r.roleName}</td>
                  <td className="px-4 py-2 text-ink">{r.competencyName}</td>
                  <td className="px-4 py-2 text-ink/60">{r.sectionName}</td>
                  <td className="px-4 py-2 text-ink/80">{r.expiry}</td>
                  <td className="px-4 py-2">
                    <span
                      className="inline-block rounded-full px-2 py-0.5 text-xs font-medium"
                      style={{ background: st.bg, color: st.fg, border: `1px solid ${st.border}` }}
                    >
                      {r.lapsed
                        ? `Lapsed ${Math.abs(r.days)}d ago`
                        : `${r.days}d left`}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => setRenewRow(r)}
                      className="rounded bg-ink px-3 py-1 text-xs font-medium text-ivory hover:bg-ink/90"
                    >
                      Renew
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {editOperative && (
        <OperativeEditPanel
          operative={editOperative}
          data={data}
          onClose={() => setEditOperative(null)}
        />
      )}
      {renewRow && (
        <RenewModal
          operativeId={renewRow.operativeId}
          operativeName={renewRow.operativeName}
          competencyId={renewRow.competencyId}
          competencyName={renewRow.competencyName}
          onClose={() => setRenewRow(null)}
        />
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "lapsed" | "expiring" | "neutral";
}) {
  const st =
    tone === "lapsed"
      ? STATUS_COLOUR.lapsed
      : tone === "expiring"
        ? STATUS_COLOUR.expiring
        : STATUS_COLOUR.no_expiry;
  return (
    <div
      className="rounded-lg border p-4"
      style={{ background: st.bg, borderColor: st.border }}
    >
      <div className="text-xs uppercase tracking-wide" style={{ color: st.fg }}>
        {label}
      </div>
      <div className="mt-1 font-serif text-3xl" style={{ color: st.fg }}>
        {value}
      </div>
    </div>
  );
}
