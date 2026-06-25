"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { MatrixData } from "@/lib/matrixData";
import { setRoleRequirement } from "@/app/(app)/actions";

const inputCls =
  "w-full rounded border border-rule bg-ivory px-3 py-2 text-sm outline-none focus:border-brass";

export default function RoleRequirementsModal({
  data,
  initialRoleId,
  onClose,
}: {
  data: MatrixData;
  initialRoleId?: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [, start] = useTransition();
  const { roles, sections, competencies, roleRequirements } = data;
  const [roleId, setRoleId] = useState(initialRoleId ?? roles[0]?.id ?? "");

  const initial = useMemo(() => {
    const s = new Set<string>();
    for (const rr of roleRequirements) if (rr.role_id === roleId) s.add(rr.competency_id);
    return s;
  }, [roleRequirements, roleId]);
  const [required, setRequired] = useState<Set<string>>(initial);
  useEffect(() => setRequired(initial), [initial]);

  const grouped = useMemo(() => {
    const by = new Map<string, typeof competencies>();
    for (const c of competencies) {
      const arr = by.get(c.section_id) ?? [];
      arr.push(c);
      by.set(c.section_id, arr);
    }
    return sections.map((s) => ({
      section: s,
      comps: (by.get(s.id) ?? []).sort((a, b) => a.position - b.position),
    }));
  }, [sections, competencies]);

  function toggle(compId: string, on: boolean) {
    setRequired((prev) => {
      const next = new Set(prev);
      if (on) next.add(compId);
      else next.delete(compId);
      return next;
    });
    start(async () => {
      await setRoleRequirement(roleId, compId, on);
      router.refresh();
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[88vh] w-full max-w-lg flex-col rounded-lg border border-rule bg-paper shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-rule px-5 py-3">
          <h3 className="font-serif text-lg text-ink">Edit role requirements</h3>
          <button
            onClick={onClose}
            className="rounded border border-rule px-2 py-1 text-xs text-ink/70 hover:bg-ivory"
          >
            Close
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">
          <div className="mb-4">
            <label className="mb-1 block text-xs uppercase tracking-wide text-ink/50">Role</label>
            <select className={inputCls} value={roleId} onChange={(e) => setRoleId(e.target.value)}>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
          {grouped.map((g) => (
            <div key={g.section.id} className="mb-4">
              <h4 className="mb-1 font-serif text-sm uppercase tracking-wide text-brass">
                {g.section.name}
              </h4>
              <div className="space-y-1">
                {g.comps.map((c) => (
                  <label key={c.id} className="flex items-center gap-2 text-sm text-ink">
                    <input
                      type="checkbox"
                      checked={required.has(c.id)}
                      onChange={(e) => toggle(c.id, e.target.checked)}
                    />
                    {c.name}
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
