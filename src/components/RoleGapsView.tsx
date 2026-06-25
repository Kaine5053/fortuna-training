"use client";

import { useState } from "react";
import type { MatrixData } from "@/lib/matrixData";
import { computeRoleGaps } from "@/lib/roleGaps";
import { STATUS_COLOUR, type TmOperative } from "@/lib/types";
import OperativeEditPanel from "@/components/OperativeEditPanel";
import RoleRequirementsModal from "@/components/RoleRequirementsModal";

export default function RoleGapsView({ data }: { data: MatrixData }) {
  const { gaps, gapCount } = computeRoleGaps(data);
  const [editOperative, setEditOperative] = useState<TmOperative | null>(null);
  const [reqOpen, setReqOpen] = useState(false);
  const opById = new Map(data.operatives.map((o) => [o.id, o]));

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-sm text-ink/60">
          {gapCount === 0
            ? "All operatives meet their role requirements."
            : `${gapCount} operative${gapCount === 1 ? "" : "s"} with gaps.`}
        </p>
        <button
          onClick={() => setReqOpen(true)}
          className="rounded border border-rule px-3 py-2 text-sm text-ink/70 hover:bg-ivory"
        >
          Edit role requirements
        </button>
      </div>

      <div className="overflow-hidden rounded-lg border border-rule bg-paper">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-rule bg-ivory text-left text-xs uppercase tracking-wide text-ink/50">
              <th className="px-4 py-2">Operative</th>
              <th className="px-4 py-2">Role</th>
              <th className="px-4 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {gaps.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-8 text-center text-ink/50">
                  No active operatives.
                </td>
              </tr>
            )}
            {gaps.map((g) => (
              <tr
                key={g.operativeId}
                className="cursor-pointer border-b border-rule/60 hover:bg-ivory/60"
                onClick={() => {
                  const op = opById.get(g.operativeId);
                  if (op) setEditOperative(op);
                }}
              >
                <td className="px-4 py-2 font-serif text-ink">{g.operativeName}</td>
                <td className="px-4 py-2 text-ink/70">
                  {g.hasRole ? g.roleName : <span className="text-ink/40">No role</span>}
                </td>
                <td className="px-4 py-2">
                  <div className="flex flex-wrap gap-1.5">
                    {!g.hasRole && (
                      <Pill bg="#efe9dd" fg="#7a6a48" border="#d8cdb6">
                        No role assigned
                      </Pill>
                    )}
                    {g.hasRole && g.meets && (
                      <Pill
                        bg={STATUS_COLOUR.in_date.bg}
                        fg={STATUS_COLOUR.in_date.fg}
                        border={STATUS_COLOUR.in_date.border}
                      >
                        ✓ Meets role
                      </Pill>
                    )}
                    {g.missing.length > 0 && (
                      <Pill
                        bg={STATUS_COLOUR.not_held.bg}
                        fg="#8a5a2a"
                        border={STATUS_COLOUR.expiring.border}
                        title={g.missing.join(", ")}
                      >
                        Missing — {g.missing.length}
                      </Pill>
                    )}
                    {g.lapsed.length > 0 && (
                      <Pill
                        bg={STATUS_COLOUR.lapsed.bg}
                        fg={STATUS_COLOUR.lapsed.fg}
                        border={STATUS_COLOUR.lapsed.border}
                        title={g.lapsed.join(", ")}
                      >
                        Lapsed — {g.lapsed.length}
                      </Pill>
                    )}
                  </div>
                </td>
              </tr>
            ))}
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
      {reqOpen && (
        <RoleRequirementsModal data={data} onClose={() => setReqOpen(false)} />
      )}
    </div>
  );
}

function Pill({
  children,
  bg,
  fg,
  border,
  title,
}: {
  children: React.ReactNode;
  bg: string;
  fg: string;
  border: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className="inline-block rounded-full px-2 py-0.5 text-xs font-medium"
      style={{ background: bg, color: fg, border: `1px solid ${border}` }}
    >
      {children}
    </span>
  );
}
