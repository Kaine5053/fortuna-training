export default function NotAuthorisedPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-ivory px-4">
      <div className="w-full max-w-sm rounded-lg border border-rule bg-paper p-8 text-center shadow-sm">
        <h1 className="font-serif text-2xl text-ink">Fortuna Civils</h1>
        <div className="mx-auto my-4 h-px w-16 bg-brass" />
        <p className="text-sm text-ink/70">
          This account doesn&apos;t have access to the Training Matrix.
        </p>
        <p className="mt-2 text-xs text-ink/50">
          If you think this is a mistake, contact the administrator.
        </p>
        <form action="/auth/signout" method="post" className="mt-6">
          <button
            type="submit"
            className="rounded bg-ink px-4 py-2 text-sm font-medium text-ivory hover:bg-ink/90"
          >
            Sign out
          </button>
        </form>
      </div>
    </main>
  );
}
