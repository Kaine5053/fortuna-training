"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { bulkRenew } from "@/app/(app)/actions";

function plusYearsToday(years: number): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() + years);
  return d.toISOString().slice(0, 10);
}

export default function BulkRenewModal({
  operativeIds,
  count,
  onClose,
}: {
  operativeIds: string[];
  count: number;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [expiry, setExpiry] = useState(plusYearsToday(3));
  const [done, setDone] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    start(async () => {
      const r = await bulkRenew(operativeIds, expiry);
      if (!r.ok) return setErr(r.error ?? "Bulk renew failed");
      setDone(r.renewed);
      router.refresh();
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
          <h3 className="font-serif text-lg text-ink">Bulk renew</h3>
          <p className="text-sm text-ink/60">
            {count} operative{count === 1 ? "" : "s"} — all lapsed / ≤90-day tickets
          </p>
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
          {done !== null && (
            <p className="text-sm text-green-700">Renewed {done} ticket{done === 1 ? "" : "s"}.</p>
          )}
          {err && <p className="text-sm text-red-700">{err}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-rule px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-rule px-4 py-2 text-sm text-ink/70 hover:bg-ivory"
          >
            {done !== null ? "Close" : "Cancel"}
          </button>
          {done === null && (
            <button
              type="submit"
              disabled={pending}
              className="rounded bg-ink px-4 py-2 text-sm font-medium text-ivory hover:bg-ink/90 disabled:opacity-50"
            >
              {pending ? "Renewing…" : "Renew tickets"}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
