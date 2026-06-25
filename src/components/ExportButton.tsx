"use client";

import { useState } from "react";
import { getExportData, type ExportOperative } from "@/app/(app)/actions";
import type { PdfOperative } from "@/lib/pdf";

async function urlToDataUrl(url: string | null): Promise<string | null> {
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise<string | null>((resolve) => {
      const fr = new FileReader();
      fr.onloadend = () => resolve(typeof fr.result === "string" ? fr.result : null);
      fr.onerror = () => resolve(null);
      fr.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

export default function ExportButton({
  operativeIds,
  count,
}: {
  operativeIds: string[];
  count: number;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    setErr(null);
    setBusy(true);
    try {
      const data: ExportOperative[] = await getExportData(operativeIds);
      const pdfOps: PdfOperative[] = [];
      for (const o of data) {
        const tickets = [];
        for (const t of o.tickets) {
          const [frontDataUrl, backDataUrl] = await Promise.all([
            urlToDataUrl(t.frontUrl),
            urlToDataUrl(t.backUrl),
          ]);
          tickets.push({
            competency: t.competency,
            section: t.section,
            expiry: t.expiry,
            status: t.status,
            cardType: t.cardType,
            frontDataUrl,
            backDataUrl,
          });
        }
        pdfOps.push({ name: o.name, role: o.role, tickets });
      }
      const { buildOperativePdf } = await import("@/lib/pdf");
      const doc = buildOperativePdf(pdfOps);
      const date = new Date().toISOString().slice(0, 10);
      doc.save(`fortuna-records-${date}.pdf`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Export failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        disabled={busy || count === 0}
        onClick={run}
        className="rounded border border-ink bg-paper px-3 py-1.5 text-sm font-medium text-ink hover:bg-ivory disabled:opacity-50"
      >
        {busy ? "Exporting…" : "Export PDF"}
      </button>
      {err && <span className="text-xs text-red-700">{err}</span>}
    </span>
  );
}
