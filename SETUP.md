# Owner Dashboard — Server Setup Guide

## What changed

Data now persists to **Supabase** (cloud Postgres) instead of only living in the browser's localStorage.
localStorage is still used as an instant cache / offline fallback — nothing broke.

---

## Step 1 — Create a free Supabase project

1. Go to [supabase.com](https://supabase.com) and sign up (free).
2. Click **New project**, pick a name (e.g. `owner-dashboard`), set a database password, choose any region.
3. Wait ~60 seconds for the project to spin up.

---

## Step 2 — Run the database schema

1. In your Supabase project, go to **SQL Editor** → **New query**.
2. Open `schema.sql` from this repo, paste the entire contents, click **Run**.
3. You should see "Success" — all tables and policies are created.

---

## Step 3 — Add your Supabase keys

1. Go to **Settings → API** in your Supabase project.
2. Copy:
   - **Project URL** (looks like `https://abcdefgh.supabase.co`)
   - **anon public** key (long JWT string)
3. Open `supabase-client.js` in this repo and replace the placeholders at the top:

```js
const SUPABASE_URL  = 'https://abcdefgh.supabase.co';  // ← your URL
const SUPABASE_ANON = 'eyJhbGci...';                   // ← your anon key
```

> The anon key is safe to expose in client-side code — it only allows what your
> Row Level Security policies permit.

---

## Step 4 — Deploy / host

### Option A — GitHub Pages (already configured)
Push to `main`. GitHub Actions will deploy automatically.
Share the link `https://<your-github-username>.github.io/Owner-Dashboard---V10/` with league mates.

### Option B — Netlify (recommended for custom domain)
1. Go to [netlify.com](https://netlify.com) → **Add new site → Import from Git**.
2. Connect your GitHub repo, leave build command empty (static site).
3. Click **Deploy**. You get a free `*.netlify.app` URL.
4. Add a custom domain in Netlify settings if you want one.

### Option C — Vercel
1. Go to [vercel.com](https://vercel.com) → **New Project → Import Git Repository**.
2. No build settings needed. Click **Deploy**.

---

## Step 5 — Share with league mates

Each owner visits the URL and logs in with their **Sleeper username**.
Their calendar events, earnings, and FA targets are saved to the cloud under their username
and will persist across devices/browsers.

---

## What's stored per owner

| Feature | Table |
|---|---|
| Calendar events | `calendar_events` |
| Earnings tracker | `earnings` |
| Free agent targets | `fa_targets` |
| Owner profile / future theme | `users` |

---

## Roadmap (next steps)

- [ ] **DM feature** — Supabase Realtime channels (one channel per league)
- [ ] **Owner theme customisation** — save `theme` JSON to `users.theme` column
- [ ] **Real auth** — swap password-in-localStorage for Supabase Auth (email magic link or Google)
- [ ] **DraftKings integration** — add DK API calls alongside existing Sleeper calls
- [ ] **PWA** — add `manifest.json` + service worker so owners can install it like an app
- [ ] **App Store** — migrate to React Native once feature set is stable

---

## Debugging

Open the browser console and run:
```js
OD.status()
```
This prints whether Supabase is configured and who is logged in.
