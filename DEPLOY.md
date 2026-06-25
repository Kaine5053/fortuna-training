# Deploy — Fortuna Training Matrix → Netlify (`training-matrix` subdomain)

Run these from **your own machine** (the sandbox can't reach your GitHub/Netlify accounts).
Commands shown for Windows PowerShell, in the project folder.

---

## 0. One-time cleanup (do this first)

A stray, empty `.git` folder was created during setup and couldn't be removed from
the sandbox. Delete it so git starts clean:

```powershell
cd "C:\Users\kaine\Fortuna Managment App\Training Matrix\fortuna-training"
rmdir /s /q .git        # in PowerShell use:  Remove-Item -Recurse -Force .git
```

## 1. Sanity check the build locally (optional but recommended)

```powershell
npm install
npm run build      # should compile clean
npm run dev        # http://localhost:3000 — sign in and click around
```

`.env.local` already holds the project URL + anon key, so it runs immediately.

## 2. Push to GitHub

Create a new **empty** repo on GitHub (e.g. `fortuna-training`, private). Then:

```powershell
cd "C:\Users\kaine\Fortuna Managment App\Training Matrix\fortuna-training"
git init
git add -A
git commit -m "Fortuna Civils Training Matrix — production build"
git branch -M main
git remote add origin https://github.com/<your-username>/fortuna-training.git
git push -u origin main
```

`.gitignore` already excludes `node_modules`, `.next`, and `.env.local`, so **no keys are
committed.**

## 3. Import into Netlify

1. Netlify → **Add new site → Import an existing project → GitHub** → pick the repo.
2. Build settings auto-detect from the committed `netlify.toml`:
   - Build command: `next build`
   - Publish directory: `.next`
   - `@netlify/plugin-nextjs` is in devDependencies, so SSR/middleware/route handlers work.
   - **Do NOT** set a static `out/` export — this app is SSR (auth needs it).
3. Before the first deploy finishes, add the environment variables (next step), then trigger a redeploy if needed.

## 4. Environment variables (Netlify → Site settings → Environment variables)

Copy these two from your local `.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL = https://klftjnzbncabueycooct.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY = <the anon key in .env.local>
```

Redeploy so the build picks them up.

## 5. Subdomain `training-matrix` + DNS

1. Netlify → **Domain management → Add a domain you own** → enter
   `training-matrix.<yourdomain>`.
2. Netlify gives you a target (e.g. `your-site.netlify.app`).
3. At your DNS provider, add a **CNAME**: host `training-matrix`, value = that Netlify target.
4. SSL provisions automatically once DNS resolves (a few minutes to a couple of hours).

You do **not** need to move your whole domain to Netlify — a CNAME on the
`training-matrix` host is enough.

## 6. Login account

Five Supabase auth users already exist (e.g. `james@fortunacivilsltd.co.uk`). To add your
own: Supabase dashboard → **Authentication → Users → Add user** → your email + password.
There is no public sign-up by design.

## 7. Post-deploy smoke test

- Visit `https://training-matrix.<yourdomain>` → you should be redirected to `/login`.
- Sign in → the matrix loads with Nathan Annables (CSCS in-date ●, 360 + Dumper lapsed ✕).
- Edit a date → cell recolours and persists on refresh.
- Open Expiring and Role gaps → badges match.
- Select operatives → Export PDF downloads.

---

### Notes
- Supabase RLS already allows any authenticated user full read/write on the `tm_` tables, so
  no extra DB config is needed.
- The `tm-cards` storage bucket stays private; the app serves images via short-lived signed URLs.
- The "Ingest training files" button is a visual stub — the real pipeline is a future backend phase.
