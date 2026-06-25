"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabaseClient";

export default function AccountPage() {
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  // Load current user email on mount.
  if (email === null) {
    createSupabaseBrowserClient()
      .auth.getUser()
      .then(({ data }) => setEmail(data.user?.email ?? "—"));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (pw.length < 8) {
      setMsg({ kind: "err", text: "Password must be at least 8 characters." });
      return;
    }
    if (pw !== confirm) {
      setMsg({ kind: "err", text: "Passwords do not match." });
      return;
    }
    setBusy(true);
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) {
      setMsg({ kind: "err", text: error.message });
      return;
    }
    setPw("");
    setConfirm("");
    setMsg({ kind: "ok", text: "Password updated. Use it next time you sign in." });
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-md">
      <h2 className="mb-1 font-serif text-2xl text-ink">Account</h2>
      <p className="mb-6 text-sm text-ink/60">
        Signed in as <span className="text-ink">{email ?? "…"}</span>
      </p>

      <div className="rounded-lg border border-rule bg-paper p-6">
        <h3 className="mb-4 font-serif text-lg text-ink">Change password</h3>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-ink/60">
              New password
            </label>
            <input
              type="password"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              autoComplete="new-password"
              className="w-full rounded border border-rule bg-ivory px-3 py-2 text-sm outline-none focus:border-brass"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-ink/60">
              Confirm new password
            </label>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              className="w-full rounded border border-rule bg-ivory px-3 py-2 text-sm outline-none focus:border-brass"
            />
          </div>
          {msg && (
            <p className={`text-sm ${msg.kind === "ok" ? "text-green-700" : "text-red-700"}`}>
              {msg.text}
            </p>
          )}
          <button
            type="submit"
            disabled={busy}
            className="rounded bg-ink px-4 py-2 text-sm font-medium text-ivory hover:bg-ink/90 disabled:opacity-50"
          >
            {busy ? "Updating…" : "Update password"}
          </button>
        </form>
      </div>
    </div>
  );
}
