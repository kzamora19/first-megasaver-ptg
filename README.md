# First Megasaver PTG

Replacement platform for the First Megasaver Price Tag Generator.

> The current Apps Script PTG remains the production system until the replacement passes acceptance testing. This GitHub Pages deployment is a development Preview and is not connected to production records.

## Hosting and deployment

- Frontend Preview: [https://kzamora19.github.io/first-megasaver-ptg/](https://kzamora19.github.io/first-megasaver-ptg/)
- Static frontend hosting: GitHub Pages, deployed by `.github/workflows/deploy-pages.yml` when `migration/github-pages` is updated.
- Backend: Supabase project `agknxlowackphvwyvxge`, through the PTG Edge Functions.
- The build uses only the browser-safe Supabase project URL and publishable key. Service-role and mail credentials stay in Supabase Edge Function secrets.

## Local development

1. Install Node.js 20.9 or newer.
2. Copy `.env.example` to `.env.local`.
3. Add the Supabase project URL and publishable key from Supabase project settings.
4. Install dependencies with `npm install`.
5. Run `npm run dev`.

## Migration guardrails

- Do not modify the production Apps Script while this replacement is being tested.
- No production data, user accounts, passwords, sessions, or logos have been migrated.
- Keep universal product and memo visibility, with no branch restriction on shared imports.
- See [docs/MIGRATION_INVENTORY.md](docs/MIGRATION_INVENTORY.md) for the source inventory and migration notes.
