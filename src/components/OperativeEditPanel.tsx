"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { MatrixData } from "@/lib/matrixData";
import {
  STATUS_COLOUR,
  statusFromExpiry,
  type TmOperative,
  type TmTicket,
} from "@/lib/types";
import { updateOperativeRole, upsertTicket, addRole } from "@/app/(app)/actions";

export default function OperativeEditPanel({
  operative,
  data,
  onClose,
}: {
  operative: TmOperative;
  data: MatrixData;
  onClose: () => void;
}) {
  const { sections, competencies, roles, tickets } = data;
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [roleId, setRoleId] = useState<string | null>(operative.role_id);
  const [savingRow, setSavingRow] = useState<string | null>(null);

  const ticketByComp = useMemo(() => {
    const m = new Map<string, TmTicket>();
    for (const t of tickets) {
      if (t.operative_id === operative.id) m.set(t.competency_id, t);
    }
    return m;
  }, [tickets, operative.id]);

  const grouped = useMemo(() => {
    const bySection = new Map<string, typeof competencies>();
    for (const c of competencies) {
      const arr = bySection.get(c.section_id) ?? [];
      arr.push(c);
      bySection.set(c.section_id, arr);
    }
    return sections.map((s) => ({
      section: s,
      comps: (bySection.get(s.id) ?? []).sort((a, b) => a.position - b.position),
    }));
  }, [sections, competencies]);

  function saveRole(next: string | null) {
    if (next === "__add") {
      const name = window.prompt("New role name:");
      if (!name || !name.trim()) return;
      startTransition(async () => {
        const r = await addRole(name);
        if (r.ok && r.id) {
          setRoleId(r.id);
          await updateOperativeRole(operative.id, r.id);
        }
        router.refresh();
      });
      return;
    }
    setRoleId(next);
    startTransition(async () => {
      await updateOperativeRole(operative.id, next);
      router.refresh();
    });
  }

  return (
    <Overlay onClose={onClose}>
      <div className="flex max-h-[88vh] w-full max-w-3xl flex-col rounded-lg border border-rule bg-paper shadow-xl">
        <div className="flex items-start justify-between border-b border-rule px-5 py-4">
          <div>
            <h3 className="font-serif text-lg text-ink">{operative.full_name}</h3>
            <p className="text-sm text-ink/60">Edit role &amp; tickets</p>
          </div>
          <button
            onClick={onClose}
            className="rounded border border-rule px-3 py-1.5 text-sm text-ink/70 hover:bg-ivory"
          >
            Close
          </button>
        </div>

        <div className="border-b border-rule px-5 py-4">
          <label className="mb-1 block text-xs uppercase tracking-wide text-ink/50">
            Role
          </label>
          <select
            value={roleId ?? ""}
            onChange={(e) => saveRole(e.target.value || null)}
            disabled={isPending}
            className="rounded border border-rule bg-ivory px-3 py-2 text-sm outline-none focus:border-brass"
          >
            <option value="">— No role —</option>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
            <option value="__add">＋ Add new role…</option>
          </select>
        </div>

        <div className="ledger-scroll flex-1 overflow-y-auto px-5 py-4">
          {grouped.map((g) => (
            <div key={g.section.id} className="mb-6">
              <h4 className="mb-2 font-serif text-sm uppercase tracking-wide text-brass">
                {g.section.name}
              </h4>
              <div className="space-y-2">
                {g.comps.map((c) => {
                  const t = ticketByComp.get(c.id);
                  return (
                    <TicketRow
                      key={c.id}
                      operativeId={operative.id}
                      competencyId={c.id}
                      competencyName={c.name}
                      noExpiry={c.no_expiry}
                      ticket={t}
                      busy={savingRow === c.id}
                      onSave={(payload) => {
                        setSavingRow(c.id);
                        startTransition(async () => {
                          await upsertTicket(payload);
                          router.refresh();
                          setSavingRow(null);
                        });
                      }}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Overlay>
  );
}

function TicketRow({
  operativeId,
  competencyId,
  competencyName,
  noExpiry,
  ticket,
  busy,
  onSave,
}: {
  operativeId: string;
  competencyId: string;
  competencyName: string;
  noExpiry: boolean;
  ticket?: TmTicket;
  busy: boolean;
  onSave: (p: {
    operativeId: string;
    competencyId: string;
    noExpiry: boolean;
    expiryDate: string | null;
    cardType: string | null;
  }) => void;
}) {
  const [expiry, setExpiry] = useState(ticket?.expiry_date ?? "");
  const [cardType, setCardType] = useState(ticket?.card_type ?? "");

  const status = noExpiry
    ? "no_expiry"
    : statusFromExpiry(ticket?.expiry_date ?? null, false);
  const st = STATUS_COLOUR[ticket ? status : "not_held"];

  return (
    <div className="flex flex-wrap items-center gap-2 rounded border border-rule bg-ivory/40 px-3 py-2">
      <span
        className="inline-flex h-5 w-5 items-center justify-center rounded-sm text-[11px]"
        style={{ background: st.bg, color: st.fg, border: `1px solid ${st.border}` }}
        title={st.label}
      >
        {st.glyph || "·"}
      </span>
      <span className="min-w-[150px] flex-1 text-sm text-ink">{competencyName}</span>

      {noExpiry ? (
        <span className="text-xs text-ink/50">No expiry</span>
      ) : (
        <input
          type="date"
          value={expiry}
          onChange={(e) => setExpiry(e.target.value)}
          className="rounded border border-rule bg-paper px-2 py-1 text-sm outline-none focus:border-brass"
        />
      )}

      <input
        type="text"
        value={cardType}
        onChange={(e) => setCardType(e.target.value)}
        placeholder="Card type (optional)"
        className="w-40 rounded border border-rule bg-paper px-2 py-1 text-sm outline-none focus:border-brass"
      />

      <button
        disabled={busy || (!noExpiry && !expiry)}
        onClick={() =>
          onSave({
            operativeId,
            competencyId,
            noExpiry,
            expiryDate: noExpiry ? null : expiry || null,
            cardType: cardType.trim() || null,
          })
        }
        className="rounded bg-ink px-3 py-1 text-xs font-medium text-ivory hover:bg-ink/90 disabled:opacity-40"
      >
        {busy ? "Saving…" : ticket ? "Update" : "Add"}
      </button>
    </div>
  );
}

function Overlay({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4"
      onClick={onClose}
    >
      <div onClick={(e) => e.stopPropagation()}>{children}</div>
    </div>
  );
}
