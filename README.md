# Tubenails (CTR Sniper)

Tubenails is a YouTube A/B testing tool that rotates titles/thumbnails and compares CTR performance over time.

## Architecture

- `src/`: Node.js + Express + TypeScript backend.
- `frontend/`: Next.js app (App Router, React, Tailwind).
- `PostgreSQL`: stores users, tests, daily metrics, and OAuth state nonces.
- `Supabase Auth`: verifies user JWTs for protected API routes.
- `YouTube APIs`: channel metadata, video metadata, and analytics metrics.

## Prerequisites

- Node.js 20+
- npm 10+
- PostgreSQL database (or Supabase Postgres)

## Environment Variables

Copy `.env.example` to `.env` and configure:

- `DATABASE_URL`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `OAUTH_STATE_SECRET`
- `GOOGLE_REDIRECT_URI`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `FRONTEND_URL`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

## Local Development

Install backend dependencies:

```bash
npm install
```

Install frontend dependencies:

```bash
npm --prefix frontend install
```

Run backend + frontend:

```bash
npm run dev:all
```

- Backend: `http://localhost:3000`
- Frontend: `http://localhost:3001`

## Scripts

Backend (`package.json`):

- `npm run dev`
- `npm run build`
- `npm run start`
- `npm run lint`
- `npm run test`

Frontend (`frontend/package.json`):

- `npm --prefix frontend run dev`
- `npm --prefix frontend run lint`
- `npm --prefix frontend run build`

## API Notes

- Protected endpoints require `Authorization: Bearer <supabase_access_token>`.
- YouTube OAuth now uses signed/expiring `state` + one-time nonce in DB.
- Test status is unified as `active | finished`.
- Dashboard metrics are computed from real `daily_results` rows.

## CI

GitHub Actions workflow: `.github/workflows/ci.yml`

- Backend: lint + tests + build
- Frontend: lint + build
