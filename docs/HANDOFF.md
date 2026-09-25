# How to run a section from the terminal

Open PowerShell in `C:\Users\kaine\Fortuna Training Matrix\fortuna-training` and run one line,
replacing `<ID>`:

```powershell
claude "Fortuna Training Matrix: run section <ID>. Read first: CLAUDE.md, the spec at docs/superpowers/specs/2026-09-25-live-training-matrix-design.md, the ledger at docs/Build-Sections.md, and the plan file for this section under docs/superpowers/plans/. Build only <ID> per the plan, TDD, tests green with pasted output. At close: commit + push, tick <ID> in the ledger, append a plain-English recap to docs/Session-Recaps.md, then stop."
```

Sections run in ledger order. Each is sized for about 30 minutes. If a section overruns, the session
marks it `🔶` in the ledger with a one-line note of what is left and stops; the next run of the same
`<ID>` resumes from the ledger note.

## First-time setup (once, before S1)

```powershell
npm install
npm install -g supabase
supabase login
supabase link --project-ref klftjnzbncabueycooct
```

Copy `.env.local.example` to `.env.local` and fill the Supabase URL and anon key from the dashboard.
Docker Desktop is needed for `supabase start` (local Postgres for migrations and RLS tests).

## Secrets (Supabase dashboard → Edge Functions → Secrets, or `supabase secrets set`)

```
ANTHROPIC_API_KEY
GRAPH_TENANT_ID
GRAPH_CLIENT_ID
GRAPH_CLIENT_SECRET
GRAPH_MAILBOX=support@fortunacivilsltd.co.uk
GRAPH_DRIVE_ID
GRAPH_WATCH_ROOT=FORTUNA CIVILS LTD/PERSONELL FILES
```

None of these are needed until the section that uses them; the ledger's owed list says which.

## Finding the OneDrive drive id (for S16)

With the Azure app registered and `Files.Read.All` consented, from any PowerShell:

```powershell
$body = @{ client_id=$env:GRAPH_CLIENT_ID; client_secret=$env:GRAPH_CLIENT_SECRET; scope="https://graph.microsoft.com/.default"; grant_type="client_credentials" }
$tok = (Invoke-RestMethod -Method Post -Uri "https://login.microsoftonline.com/$env:GRAPH_TENANT_ID/oauth2/v2.0/token" -Body $body).access_token
Invoke-RestMethod -Headers @{Authorization="Bearer $tok"} -Uri "https://graph.microsoft.com/v1.0/users/kaine@fortunacivilsltd.co.uk/drive" | Select-Object id, name
```

The `id` is `GRAPH_DRIVE_ID`.
