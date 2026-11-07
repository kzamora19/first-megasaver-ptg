# First Megasaver PTG

New platform for the First Megasaver Price Tag Generator.

> This repository is the isolated replacement project. The existing Apps Script PTG remains the production system until the replacement has passed acceptance testing.

## Current status

- Initial Next.js scaffold is on the `migration/scaffold` branch.
- Supabase browser/server client helpers are prepared.
- No production data, user accounts, passwords, sessions, or logos have been migrated.
- No Vercel deployment has been performed yet.

## Local development

1. Install Node.js 20.9 or newer.
2. Copy `.env.example` to `.env.local`.
3. Add the Supabase project URL and publishable key from the Supabase project settings.
4. Install dependencies with `npm install`.
5. Run `npm run dev`.

## Vercel setup

Import this repository into Vercel using the Next.js framework preset. Add the two public Supabase variables from `.env.example` before the first deployment. Never add a Supabase secret/service key to a `NEXT_PUBLIC_*` variable.

## Migration plan

See [docs/MIGRATION_INVENTORY.md](docs/MIGRATION_INVENTORY.md) for the source inventory, observed behavior, and migration guardrails.
