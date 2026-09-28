# Iron Pact 🏋️

A private fitness-accountability app for the crew. Train together, answer to each other.

Everyone in the group can see everyone's stats and progress — that visibility (plus a weekly
leaderboard with real stakes) is the whole point.

## What's inside

| Feature | Where | What it does |
|---|---|---|
| **Profiles & body stats** | Me / Stats | Weight, body-fat %, muscle mass — logged over time, visible to the whole crew, with trend charts and deltas. |
| **Day-wise schedule** | Schedule | A specific plan per weekday ("Bench 4×8 @60 kg…", "5k run @6:30 AM"), per person, viewable by everyone. |
| **Workout logging** | Log (+) | Type-specific logging: strength (exercise / weight / reps per set), cardio (km + time), sport & activities (intensity + duration) — plus **photo proof** (+5 pts). |
| **Feed** | Feed | Every logged session with its photo, metrics and points breakdown. |
| **Weekly leaderboard** | Board | Live standings all week. When a week ends anyone can *finalize* it: **top 2 earn the treat 🏆, last place draws a punishment 💀** from the shared pool. |
| **Punishment pool** | Board | Decided up front by everyone (e.g. "extra 20k steps within the week"). The draw is deterministic per week — reshuffled weekly, same result no matter who finalizes. |
| **Micro habits** | Habits / Home | Daily non-negotiables (8 h sleep, 10k steps, 3 L water, 120 g protein, ≤2 h screen time, 3 h study…), checked off daily, counted toward weekly points. |
| **Goals** | Goals | Weekly / short-term / long-term goals, resolved as achieved or missed when their timeframe ends. |
| **Monthly recap** | Recap | What each person tangibly achieved (workouts, hours, km, volume lifted, habit adherence, body change, goals) and 1–2 concrete things to improve next month. |

## How points work

One transparent rulebook (`src/lib/points.ts`), used identically for live standings,
week finalization and recaps:

| Rule | Points |
|---|---|
| Logging a workout | +20 |
| Duration | +1 per 5 min (max +12) |
| Cardio distance | +2 per km (max +20) |
| Strength exercises | +2 each (max +12) |
| Intensity (sport/activity) | light +2 · moderate +5 · hard +10 |
| Photo proof | +5 |
| Micro habit done | +3 each (max +15 / day) |
| Anti-spam | only the first 2 workouts per day score |

Ties are broken deterministically (workouts → habits → name), so there is always exactly
one last place.

## Stack

- **Frontend:** React 18 + TypeScript (strict) + Vite + Tailwind, mobile-first PWA
  (installable via *Add to Home Screen*), charts with Recharts on a validated
  colorblind-safe palette.
- **Backend:** Supabase — Postgres with row-level security, email/password auth, and a
  private storage bucket for workout photos (signed URLs).
- The schema lives in [`supabase/migrations/0001_create_gymapp_schema.sql`](supabase/migrations/0001_create_gymapp_schema.sql)
  and is **already applied** to the shared Supabase project. All gym tables are prefixed
  `gym_` because the project is shared with another app; identity (accounts + names)
  is reused, so everyone signs in with their existing account.

### Access model

**The pact is invite-only.** Signing up is not the same as getting in: a new account
sees nothing until it redeems the crew's invite code, which is what creates its
membership. Everything else keys off that.

- **Members read everything** — that mutual visibility is the point of the app.
- **Non-members read nothing.** Without a membership row, every `gym_*` table and
  every workout photo returns empty. This matters because Supabase signup is open to
  anyone who finds the URL, and the app holds weights, body-fat percentages and photos.
- Everyone can only **write their own** rows — enforced by RLS, except week
  finalization (`gym_week_results`), which any member may perform for the whole crew;
  the app makes finalization idempotent and the draw deterministic, so it's race-safe.
- Photos upload only into the uploader's own folder; the bucket is private and the app
  uses short-lived signed URLs.

The starting invite code is **`IRONPACT`** — share it with the crew, and change it
whenever you like:

```sql
-- add a new code (several can be valid at once), then retire the old one
insert into gym_pact_codes (code, label) values ('NEWCODE', 'spring intake');
delete from gym_pact_codes where code = 'IRONPACT';
```

Removing a code never removes anyone already in the pact.

## Develop

```bash
npm install
npm run dev        # local dev server
npm run build      # typecheck + production build
```

`.env` ships with the project's publishable Supabase credentials — these are safe in a
client bundle by design (all access is enforced server-side by RLS).

## Deploy

Any static host works. E.g. Vercel/Netlify: import the repo, framework *Vite*, build
`npm run build`, output `dist/`. Add a SPA fallback rewrite (`/* → /index.html`).
