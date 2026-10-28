# MicroCity — AGENTS.md

## Project
**MicroCity** — AI-Assisted Campus Infrastructure Planning & Management.
A modern web app for colleges to assess campus infrastructure, identify room-capacity issues, analyse electricity/water consumption, track assets & maintenance complaints, and report nearby public infrastructure issues.

## Tech Stack (preserve — do not change)
- React + TypeScript + Vite
- Tailwind CSS v4 (`@tailwindcss/vite` plugin)
- Commands: `npm run dev` | `npm run build`
- Root folder: `C:\Users\falak\OneDrive\Desktop\MicroCity`

## Design Palette (updated 2026-10-24 — user-directed Visual Direction 2)
- Midnight black: `#030303` (main dark identity / page ground)
- Obsidian: `#15131F` (layered dark surfaces)
- Electric violet: `#5245F8` (primary actions, active navigation, emphasis; `#8B84F4` small-text-on-dark variant, `#4235A8` on-light variant)
- Sun yellow: `#F9B318` (secondary highlights, warnings, chart series)
- Warm ivory: `#E8E4D3` (light text on dark + light editorial bands), ivory deep `#DED5BC`
- Restrained accessible status green/red: `#58B07C` / `#E07A6B` on dark, `#3D6B35` / `#8C2F25` on light (amber uses sun yellow on dark, `#8A5A16` on light). Status is always colour + label + icon.
- Identity: urban infrastructure intelligence, bold editorial composition on dark, light warm-ivory bands for rhythm. Prior palette (charcoal #090907, earth #6C5636, sand #B99D73) retired; no faint ghosted line-art backgrounds — visuals must be strong, purposeful plates.
- Photography (2026-10-24, user-directed): four bundled CC0 photographs (`public/images/` — hero-skyline, campus-roeterseiland, urban-street, aerial-city-grid) with full provenance in `public/images/CREDITS.md`. Photos are atmosphere only; dark ink overlays on photos are for text readability and must not obscure the photo. No ghosted line-art motifs; in-house SVG is limited to purposeful diagrams (capacity, consumption, asset register). Sources must stay CC/public-domain with licence verified; record every bundled image in CREDITS.md.

## Scope
- Campus infrastructure + nearby urban/public infrastructure
- Room capacity, electricity & water consumption, assets & maintenance complaints
- Multi-college data isolation (each college's data must remain separate)

## Current State (2026-10-25)
- Server-backed local demonstration: Node 24 + built-in `node:sqlite`, API in `server/`, SQLite store at `server/data/microcity.sqlite`.
- Real authentication and sessions: scrypt hashes, HTTP-only SameSite=Lax cookie, hashed tokens, login rate limiting, server-side capability checks.
- Five modules plus overview, Data Centre and Support are implemented: Inventory, Needs & Gaps, Resources, Issues & Maintenance, Plan & Report, Overview, Data Centre, Support.
- CSV/Excel imports use server validation, per-sheet mapping, preview before apply, append/replace safeguards, import history and audit trail.
- Deterministic analyses live in `src/domain/analysis/`; AI is an optional explanation proxy in `server/ai.ts` and never calculates or authorises anything.

## Data Rules
- Any data used must be clearly synthetic and include provenance (source/owner, generated vs real).
- Do not invent project data without explicit instruction.
- Approved synthetic demo dataset: `server/seed.ts`, provenance name `microcity-demo-2026-10`, fictional institutions and measurements. It must be labelled SYNTHETIC whenever displayed and seeded only under that provenance name.
- `smartcampus_test_data.xlsx` stays UNAVAILABLE in `src/data/registry.ts` and must never be impersonated. Exact expected path: `C:\Users\falak\OneDrive\Desktop\MicroCity\smartcampus_test_data.xlsx`.
- Imported records are user-supplied and must remain distinguishable from the seed via import history and audit entries.
- Campus records are isolated by `college_id` and re-checked server-side against the session's memberships; public urban records are shared and have `college_id NULL`.

## Development Approach
- Calculation-before-AI: deterministic calculations are implemented first; AI only explains or suggests from supplied computed facts.
- Every AI output is labelled **"AI-generated — please verify"**. Rule-based fallbacks are labelled as not AI.
- AI cannot create, approve, assign, delete or authorise anything.

## Security
- No secrets or API keys in client code. AI credentials live only in server environment variables (`AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL`, optional `AI_API_URL`).
- Server authorises every request against the role capability matrix in `src/domain/permissions.ts`; UI hiding is not the control.
- Only administrators may change roles, approve/reject/defer decisions, manage public assets, import public records or delete records.
- This is a local HTTP demonstration. Production requires HTTPS, Secure cookies, managed secrets, backups and an independent security review.

## Still Requires Explicit Instructions
These are not decided and must be supplied before production work:
- Approved provider/model and data-handling policy for AI
- Real college data policy, retention and consent
- Production hosting, HTTPS, backup/restore and migration strategy
- Public-infrastructure authority submission workflow and target
- Email/notification, MFA, password reset and user lifecycle requirements
