"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { MatrixData } from "@/lib/matrixData";
import RoleRequirementsModal from "@/components/RoleRequirementsModal";
import {
  addOperative,
  addSection,
  addCompetency,
  addRole,
} from "@/app/(app)/actions";

type Dialog = "operative" | "section" | "competency" | "role" | "requirements" | null;

export default function AddMenu({ data }: { data: MatrixData }) {
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);

  const items: { key: Exclude<Dialog, null>; label: string }[] = [
    { key: "operative", label: "Add operative" },
    { key: "competency", label: "Add competency" },
    { key: "section", label: "Add section" },
    { key: "role", label: "Add role" },
    { key: "requirements", label: "Edit role requirements" },
  ];

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="rounded bg-brass px-3 py-2 text-sm font-medium text-ink hover:brightness-105"
      >
        + Add
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-1 w-52 rounded border border-rule bg-paper py-1 shadow-lg">
            {items.map((it) => (
              <button
                key={it.key}
                onClick={() => {
                  setDialog(it.key);
                  setOpen(false);
                }}
                className="block w-full px-3 py-2 text-left text-sm text-ink hover:bg-ivory"
              >
                {it.label}
              </button>
            ))}
          </div>
        </>
      )}

      {dialog === "operative" && (
        <AddOperativeModal data={data} onClose={() => setDialog(null)} />
      )}
      {dialog === "competency" && (
        <AddCompetencyModal data={data} onClose={() => setDialog(null)} />
      )}
      {dialog === "section" && <AddSectionModal onClose={() => setDialog(null)} />}
      {dialog === "role" && <AddRoleModal onClose={() => setDialog(null)} />}
      {dialog === "requirements" && (
        <RoleRequirementsModal data={data} onClose={() => setDialog(null)} />
      )}
    </div>
  );
}

function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
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
          <h3 className="font-serif text-lg text-ink">{title}</h3>
          <button
            onClick={onClose}
            className="rounded border border-rule px-2 py-1 text-xs text-ink/70 hover:bg-ivory"
          >
            Close
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

function Err({ msg }: { msg: string | null }) {
  if (!msg) return null;
  return <p className="mt-2 text-sm text-red-700">{msg}</p>;
}

function SubmitBtn({ pending, label }: { pending: boolean; label: string }) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded bg-ink px-4 py-2 text-sm font-medium text-ivory hover:bg-ink/90 disabled:opacity-50"
    >
      {pending ? "Saving…" : label}
    </button>
  );
}

const inputCls =
  "w-full rounded border border-rule bg-ivory px-3 py-2 text-sm outline-none focus:border-brass";

function AddOperativeModal({ data, onClose }: { data: MatrixData; onClose: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [name, setName] = useState("");
  const [roleId, setRoleId] = useState("");
  const [err, setErr] = useState<string | null>(null);

  return (
    <Modal title="Add operative" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setErr(null);
          start(async () => {
            const r = await addOperative(name, roleId || null);
            if (!r.ok) return setErr(r.error ?? "Failed");
            router.refresh();
            onClose();
          });
        }}
        className="space-y-3"
      >
        <div>
          <label className="mb-1 block text-xs uppercase tracking-wide text-ink/50">Full name</label>
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </div>
        <div>
          <label className="mb-1 block text-xs uppercase tracking-wide text-ink/50">Role</label>
          <select
            className={inputCls}
            value={roleId}
            onChange={(e) => {
              if (e.target.value === "__add") {
                const name = window.prompt("New role name:");
                if (!name || !name.trim()) return;
                start(async () => {
                  const r = await addRole(name);
                  if (r.ok && r.id) setRoleId(r.id);
                  router.refresh();
                });
                return;
              }
              setRoleId(e.target.value);
            }}
          >
            <option value="">— No role —</option>
            {data.roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
            <option value="__add">＋ Add new role…</option>
          </select>
        </div>
        <Err msg={err} />
        <div className="pt-1">
          <SubmitBtn pending={pending} label="Add operative" />
        </div>
      </form>
    </Modal>
  );
}

function AddSectionModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  return (
    <Modal title="Add section" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setErr(null);
          start(async () => {
            const r = await addSection(name);
            if (!r.ok) return setErr(r.error ?? "Failed");
            router.refresh();
            onClose();
          });
        }}
        className="space-y-3"
      >
        <div>
          <label className="mb-1 block text-xs uppercase tracking-wide text-ink/50">Section name</label>
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </div>
        <Err msg={err} />
        <div className="pt-1">
          <SubmitBtn pending={pending} label="Add section" />
        </div>
      </form>
    </Modal>
  );
}

function AddCompetencyModal({ data, onClose }: { data: MatrixData; onClose: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [name, setName] = useState("");
  const [sectionId, setSectionId] = useState(data.sections[0]?.id ?? "");
  const [noExpiry, setNoExpiry] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <Modal title="Add competency" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setErr(null);
          start(async () => {
            const r = await addCompetency(name, sectionId, noExpiry);
            if (!r.ok) return setErr(r.error ?? "Failed");
            router.refresh();
            onClose();
          });
        }}
        className="space-y-3"
      >
        <div>
          <label className="mb-1 block text-xs uppercase tracking-wide text-ink/50">Competency name</label>
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </div>
        <div>
          <label className="mb-1 block text-xs uppercase tracking-wide text-ink/50">Section</label>
          <select className={inputCls} value={sectionId} onChange={(e) => setSectionId(e.target.value)}>
            {data.sections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" checked={noExpiry} onChange={(e) => setNoExpiry(e.target.checked)} />
          No expiry (competency never lapses)
        </label>
        <Err msg={err} />
        <div className="pt-1">
          <SubmitBtn pending={pending} label="Add competency" />
        </div>
      </form>
    </Modal>
  );
}

function AddRoleModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  return (
    <Modal title="Add role" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setErr(null);
          start(async () => {
            const r = await addRole(name);
            if (!r.ok) return setErr(r.error ?? "Failed");
            router.refresh();
            onClose();
          });
        }}
        className="space-y-3"
      >
        <div>
          <label className="mb-1 block text-xs uppercase tracking-wide text-ink/50">Role name</label>
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </div>
        <Err msg={err} />
        <div className="pt-1">
          <SubmitBtn pending={pending} label="Add role" />
        </div>
      </form>
    </Modal>
  );
}
