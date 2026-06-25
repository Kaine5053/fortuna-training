"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { renewTicket, uploadCardImages } from "@/app/(app)/actions";

function plusYearsToday(years: number): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() + years);
  return d.toISOString().slice(0, 10);
}

export default function RenewModal({
  operativeId,
  operativeName,
  competencyId,
  competencyName,
  onClose,
}: {
  operativeId: string;
  operativeName: string;
  competencyId: string;
  competencyName: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [expiry, setExpiry] = useState(plusYearsToday(3));
  const [front, setFront] = useState<File | null>(null);
  const [back, setBack] = useState<File | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    start(async () => {
      let frontPath: string | null | undefined;
      let backPath: string | null | undefined;
      if (front || back) {
        const fd = new FormData();
        if (front) fd.set("front", front);
        if (back) fd.set("back", back);
        const up = await uploadCardImages(operativeId, competencyId, fd);
        if (up.error) return setErr(up.error);
        frontPath = up.frontPath;
        backPath = up.backPath;
      }
      const r = await renewTicket(operativeId, competencyId, {
        newExpiry: expiry,
        frontPath,
        backPath,
      });
      if (!r.ok) return setErr(r.error ?? "Renew failed");
      router.refresh();
      onClose();
    });
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/40 p-4"
      onClick={onClose}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="w-full max-w-md rounded-lg border border-rule bg-paper shadow-xl"
      >
        <div className="border-b border-rule px-5 py-3">
          <h3 className="font-serif text-lg text-ink">Renew — {competencyName}</h3>
          <p className="text-sm text-ink/60">{operativeName}</p>
        </div>
        <div className="space-y-3 px-5 py-4">
          <div>
            <label className="mb-1 block text-xs uppercase tracking-wide text-ink/50">
              New expiry (default +3 years)
            </label>
            <input
              type="date"
              value={expiry}
              onChange={(e) => setExpiry(e.target.value)}
              className="w-full rounded border border-rule bg-ivory px-3 py-2 text-sm outline-none focus:border-brass"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs uppercase tracking-wide text-ink/50">
                Replace front (optional)
              </label>
              <input type="file" accept="image/*" onChange={(e) => setFront(e.target.files?.[0] ?? null)} className="text-xs" />
            </div>
            <div>
              <label className="mb-1 block text-xs uppercase tracking-wide text-ink/50">
                Replace back (optional)
              </label>
              <input type="file" accept="image/*" onChange={(e) => setBack(e.target.files?.[0] ?? null)} className="text-xs" />
            </div>
          </div>
          <p className="text-xs text-ink/50">
            The current card is kept and flagged superseded — full history is preserved.
          </p>
          {err && <p className="text-sm text-red-700">{err}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-rule px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-rule px-4 py-2 text-sm text-ink/70 hover:bg-ivory"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={pending}
            className="rounded bg-ink px-4 py-2 text-sm font-medium text-ivory hover:bg-ink/90 disabled:opacity-50"
          >
            {pending ? "Renewing…" : "Renew"}
          </button>
        </div>
      </form>
    </div>
  );
}
