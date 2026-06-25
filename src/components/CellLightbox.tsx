"use client";

import { useEffect, useState } from "react";
import RenewModal from "@/components/RenewModal";
import { getCellCard, type CellCardResult } from "@/app/(app)/actions";
import { STATUS_COLOUR, type TicketStatus } from "@/lib/types";

export default function CellLightbox({
  operativeId,
  operativeName,
  competencyId,
  competencyName,
  status,
  onClose,
}: {
  operativeId: string;
  operativeName: string;
  competencyId: string;
  competencyName: string;
  status: TicketStatus;
  onClose: () => void;
}) {
  const [data, setData] = useState<CellCardResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [showRenew, setShowRenew] = useState(false);

  useEffect(() => {
    let alive = true;
    getCellCard(operativeId, competencyId)
      .then((r) => alive && setData(r))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [operativeId, competencyId]);

  const st = STATUS_COLOUR[status];

  return (
    <Overlay onClose={onClose}>
      <div className="w-full max-w-2xl rounded-lg border border-rule bg-paper shadow-xl">
        <div className="flex items-start justify-between border-b border-rule px-5 py-4">
          <div>
            <h3 className="font-serif text-lg text-ink">{competencyName}</h3>
            <p className="text-sm text-ink/60">{operativeName}</p>
          </div>
          <span
            className="rounded-full px-3 py-1 text-xs font-medium"
            style={{ background: st.bg, color: st.fg, border: `1px solid ${st.border}` }}
          >
            {st.glyph} {st.label}
          </span>
        </div>

        <div className="px-5 py-4">
          <div className="mb-4 grid grid-cols-2 gap-4 text-sm">
            <Field label="Card type" value={data?.cardType} />
            <Field label="Expiry" value={data?.expiry} />
            <Field label="Scheme" value={data?.scheme} />
            <Field label="Registration" value={data?.registrationNo} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <CardImage label="Front" url={data?.frontUrl ?? null} loading={loading} />
            <CardImage label="Back" url={data?.backUrl ?? null} loading={loading} />
          </div>
        </div>

        <div className="flex justify-between border-t border-rule px-5 py-3">
          <button
            onClick={() => setShowRenew(true)}
            className="rounded bg-ink px-4 py-2 text-sm font-medium text-ivory hover:bg-ink/90"
          >
            Renew
          </button>
          <button
            onClick={onClose}
            className="rounded border border-rule px-4 py-2 text-sm text-ink/70 hover:bg-ivory"
          >
            Close
          </button>
        </div>
      </div>
      {showRenew && (
        <RenewModal
          operativeId={operativeId}
          operativeName={operativeName}
          competencyId={competencyId}
          competencyName={competencyName}
          onClose={() => {
            setShowRenew(false);
            onClose();
          }}
        />
      )}
    </Overlay>
  );
}

function Field({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-ink/40">{label}</div>
      <div className="text-ink">{value || "—"}</div>
    </div>
  );
}

function CardImage({
  label,
  url,
  loading,
}: {
  label: string;
  url: string | null;
  loading: boolean;
}) {
  return (
    <div>
      <div className="mb-1 text-xs uppercase tracking-wide text-ink/40">{label}</div>
      <div className="flex aspect-[1.6/1] items-center justify-center overflow-hidden rounded border border-rule bg-ivory">
        {loading ? (
          <span className="text-xs text-ink/40">Loading…</span>
        ) : url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={label} className="h-full w-full object-contain" />
        ) : (
          <span className="text-xs text-ink/40">No image on file</span>
        )}
      </div>
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
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4"
      onClick={onClose}
    >
      <div onClick={(e) => e.stopPropagation()}>{children}</div>
    </div>
  );
}
