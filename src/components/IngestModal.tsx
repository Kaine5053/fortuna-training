"use client";

export default function IngestModal({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg overflow-hidden rounded-lg border border-rule bg-paper shadow-xl"
        style={{ borderTop: "3px solid #9a7b3f" }}
      >
        <div className="flex items-start justify-between border-b border-rule px-5 py-3">
          <div>
            <h3 className="font-serif text-lg text-ink">Ingest training files</h3>
            <p className="text-xs text-ink/60">Upload, read, review, then enter to the register</p>
          </div>
          <button
            onClick={onClose}
            className="rounded border border-rule px-2 py-1 text-xs text-ink/70 hover:bg-ivory"
          >
            ✕
          </button>
        </div>

        <div className="border-b border-rule px-5 py-4">
          <h4 className="mb-2 font-serif text-sm text-ink">1 — Place the files</h4>
          <div className="rounded border border-dashed border-rule bg-ivory px-4 py-7 text-center text-sm text-ink/50">
            Drag PDFs &amp; JPEGs here. Photographs holding several cards are separated
            into front &amp; reverse.
          </div>
        </div>

        <div className="border-b border-rule px-5 py-4">
          <h4 className="mb-2 font-serif text-sm text-ink">2 — Review before entry</h4>
          <p className="text-sm text-ink/60">
            Extracted cards appear here for you to confirm the operative, competency and
            expiry before anything is written.
          </p>
          <p className="mt-2 text-xs text-ink/50">
            Anything below confidence is held back for you to assign — never entered
            automatically.
          </p>
        </div>

        <div className="flex items-center justify-between px-5 py-3">
          <span className="rounded bg-brass/10 px-2 py-1 text-xs text-brass">
            Preview — ingest pipeline is a later backend phase
          </span>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="rounded border border-rule px-4 py-2 text-sm text-ink/70 hover:bg-ivory"
            >
              Cancel
            </button>
            <button
              disabled
              title="Wired up in the ingest backend phase"
              className="rounded bg-ink px-4 py-2 text-sm font-medium text-ivory opacity-50"
            >
              Enter to register
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
