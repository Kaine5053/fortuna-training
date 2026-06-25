"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { MatrixData } from "@/lib/matrixData";
import type { TmCompetency, TmSection } from "@/lib/types";
import { reorderSections, saveCompetencyLayout } from "@/app/(app)/actions";

type Payload =
  | { kind: "section"; id: string }
  | { kind: "comp"; id: string; from: string };

export default function ArrangeModal({
  data,
  onClose,
}: {
  data: MatrixData;
  onClose: () => void;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  // Local ordered state, seeded once from props.
  const [sections, setSections] = useState<TmSection[]>(() =>
    [...data.sections].sort((a, b) => a.position - b.position)
  );
  const [compsBySection, setCompsBySection] = useState<Record<string, TmCompetency[]>>(
    () => {
      const m: Record<string, TmCompetency[]> = {};
      for (const s of data.sections) m[s.id] = [];
      for (const c of [...data.competencies].sort((a, b) => a.position - b.position)) {
        (m[c.section_id] ??= []).push(c);
      }
      return m;
    }
  );
  const [drag, setDrag] = useState<Payload | null>(null);

  const flatten = useMemo(
    () => (state: Record<string, TmCompetency[]>) => {
      const items: { id: string; section_id: string; position: number }[] = [];
      for (const s of sections) {
        (state[s.id] ?? []).forEach((c, i) =>
          items.push({ id: c.id, section_id: s.id, position: i })
        );
      }
      return items;
    },
    [sections]
  );

  async function persistSections(order: TmSection[]) {
    setSaving(true);
    await reorderSections(order.map((s) => s.id));
    router.refresh();
    setSaving(false);
  }

  async function persistComps(state: Record<string, TmCompetency[]>) {
    setSaving(true);
    await saveCompetencyLayout(flatten(state));
    router.refresh();
    setSaving(false);
  }

  // ---- Section reorder ----
  function dropOnSection(targetSectionId: string) {
    if (!drag) return;
    if (drag.kind === "section") {
      if (drag.id === targetSectionId) return;
      const order = [...sections];
      const from = order.findIndex((s) => s.id === drag.id);
      const to = order.findIndex((s) => s.id === targetSectionId);
      const [moved] = order.splice(from, 1);
      order.splice(to, 0, moved);
      setSections(order);
      persistSections(order);
    } else {
      // comp dropped onto a section card → append to that section
      moveComp(drag.id, drag.from, targetSectionId, Number.MAX_SAFE_INTEGER);
    }
    setDrag(null);
  }

  // ---- Competency move/reorder ----
  function moveComp(compId: string, fromSec: string, toSec: string, beforeIndex: number) {
    setCompsBySection((prev) => {
      const next: Record<string, TmCompetency[]> = {};
      for (const k of Object.keys(prev)) next[k] = [...prev[k]];
      const fromArr = next[fromSec];
      const idx = fromArr.findIndex((c) => c.id === compId);
      if (idx === -1) return prev;
      const [moved] = fromArr.splice(idx, 1);
      const movedComp = { ...moved, section_id: toSec };
      const toArr = next[toSec];
      let insertAt = beforeIndex;
      if (fromSec === toSec && idx < beforeIndex) insertAt = beforeIndex - 1;
      if (insertAt > toArr.length) insertAt = toArr.length;
      if (insertAt < 0) insertAt = 0;
      toArr.splice(insertAt, 0, movedComp);
      next[toSec] = toArr;
      persistComps(next);
      return next;
    });
  }

  function dropOnComp(targetComp: TmCompetency, targetSec: string) {
    if (!drag || drag.kind !== "comp") return;
    const targetArr = compsBySection[targetSec];
    const beforeIndex = targetArr.findIndex((c) => c.id === targetComp.id);
    moveComp(drag.id, drag.from, targetSec, beforeIndex);
    setDrag(null);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[88vh] w-full max-w-2xl flex-col rounded-lg border border-rule bg-paper shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-rule px-5 py-3">
          <div>
            <h3 className="font-serif text-lg text-ink">Arrange</h3>
            <p className="text-xs text-ink/50">
              Drag sections to reorder · drag competencies within or between sections
              {saving ? " · saving…" : ""}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded border border-rule px-2 py-1 text-xs text-ink/70 hover:bg-ivory"
          >
            Close
          </button>
        </div>

        <div className="ledger-scroll flex-1 space-y-3 overflow-y-auto px-5 py-4">
          {sections.map((s) => (
            <div
              key={s.id}
              draggable
              onDragStart={(e) => {
                setDrag({ kind: "section", id: s.id });
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => dropOnSection(s.id)}
              className="rounded-lg border border-rule bg-ivory/40"
            >
              <div className="flex items-center gap-2 border-b border-rule px-3 py-2">
                <span className="cursor-grab text-ink/40" title="Drag section">⠿</span>
                <span className="font-serif text-sm uppercase tracking-wide text-brass">
                  {s.name}
                </span>
              </div>
              <div
                className="flex min-h-[44px] flex-wrap gap-2 p-3"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.stopPropagation();
                  dropOnSection(s.id); // append into this section's area
                }}
              >
                {(compsBySection[s.id] ?? []).map((c) => (
                  <span
                    key={c.id}
                    draggable
                    onDragStart={(e) => {
                      e.stopPropagation();
                      setDrag({ kind: "comp", id: c.id, from: s.id });
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.stopPropagation();
                      dropOnComp(c, s.id);
                    }}
                    className="cursor-grab rounded-full border border-rule bg-paper px-3 py-1 text-xs text-ink hover:border-brass"
                  >
                    {c.name}
                    {c.no_expiry ? " ∞" : ""}
                  </span>
                ))}
                {(compsBySection[s.id] ?? []).length === 0 && (
                  <span className="text-xs text-ink/30">Drop competencies here</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
