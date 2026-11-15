# MicroCity

**AI-assisted campus infrastructure planning and management for colleges.**

MicroCity connects a college's physical records to day-to-day decisions: inventory, room capacity and timetable pressure, electricity and water consumption, maintenance complaints, public infrastructure reports, and a traceable plan/report workflow.

The working loop is **Inventory → Needs & Gaps → Priority → Action → Report**. All figures are produced by deterministic code from recorded data. Missing values stay missing; they are never treated as zero. The optional AI assistant only explains computed facts and is always labelled **“AI-generated, please verify”**.

> **Demonstration status.** This repository is a local, server-backed demonstration using the synthetic dataset `microcity-demo-2026-10`. Every institution, person, room, meter, complaint and measurement in the base workspace is fictional. Do not put real college data into this demo until the production items in [Known limitations](#known-limitations) are addressed.

## Quick start

Requirements: **Node.js 24** (uses the built-in `node:sqlite` module and native TypeScript stripping) and npm.

```bash
npm install
npm run dev
```

Open the URL printed by Vite (normally `http://localhost:5173`). The Vite dev server mounts the same API under `/api`, so cookies and requests are same-origin. On first run the server creates `server/data/microcity.sqlite` and seeds the synthetic workspace.

Production-style local run:

```bash
npm run build
npm start
```

The production server defaults to `http://localhost:8787` and serves both `dist/` and the API. It refuses to serve the app until `npm run build` has run.

### Checks

```bash
npm run build   # TypeScript project build + Vite production bundle
npm run lint    # Oxlint (0 errors; one advisory React fast-refresh warning)
npm test        # Analysis, database, auth, formatting, complaint-rule and navigation suite (28 tests)
```

`npm test` uses `node --test --experimental-strip-types tests/*.test.ts`.

## Sample accounts

Sample accounts are never listed or pre-filled on the sign-in page. This table exists only for local testing. **Every seeded password is `<username>-pass`** (for example, `sample-student-pass`). They exist only in the synthetic workspace and must not be reused with real data.

| Username | College | Role | Password |
| --- | --- | --- | --- |
| `sample-admin` | Vidya Nagar College (fictional) | Administrator | `sample-admin-pass` |
| `sample-estates` | Vidya Nagar | Estates | `sample-estates-pass` |
| `sample-maintenance` | Vidya Nagar | Maintenance | `sample-maintenance-pass` |
| `sample-faculty` | Vidya Nagar | Faculty | `sample-faculty-pass` |
| `sample-student` | Vidya Nagar | Student | `sample-student-pass` |
| `sample-fd-admin` | Seva Nagar College (fictional) | Administrator | `sample-fd-admin-pass` |
| `sample-fd-estates` | Seva Nagar | Estates | `sample-fd-estates-pass` |
| `sample-fd-student` | Seva Nagar | Student | `sample-fd-student-pass` |

College codes are `VIDYA-NAGAR` and `SEVA-NAGAR`. Self-registration creates **student or faculty** accounts only and requires the college code; maintenance, estates and administrator accounts are created by an administrator from **Administration → Members and roles**. The server also refuses an administrator's attempt to remove their own administrator role.

Set `DEMO_MODE=true` on the server to show the optional **Demo mode** strip on the sign-in page. Its buttons fill the Vidya Nagar account for each role; nothing is submitted until the user presses Sign in. With `DEMO_MODE` unset, the strip is not rendered and `/api/auth/demo` returns no accounts.

## What is implemented

### Public site and access
- Landing page with four navigation items (Home, What is MicroCity, How to use, Sign in): a hero, three “What it does” cards, five role cards that preselect the role on the sign-in page, four student steps and a demonstration-data footer. Plain English only.
- Sign-in in two steps: choose one of five role tiles, then choose the college and enter username and password. The server compares the chosen role with the account's real role and refuses a mismatch with `This account is not a <role> account.`
- Real server-backed sign-in, registration, sign-out and session restoration. The logo returns to the landing page; signing out returns to the landing page.
- HTTP-only, SameSite=Lax session cookie; scrypt password hashing; hashed session tokens; login rate limiting.
- Capability matrix in `src/domain/permissions.ts` shared by the UI and re-checked by the API on every request.
- Role-aware navigation, route guards and an explicit “Not available for your role” page.
- College switching only for accounts with more than one membership. The selected college is sent as `X-College-Id` and re-validated server-side on every request; another college's ID receives `403 college-forbidden`.
- Students and faculty see only their own private campus reports. Maintenance sees only complaints assigned to them. Public issues are visible only to members of the reporting college.

### 01 Inventory
Buildings, rooms, assets, inspections, timetable bookings and shared public infrastructure assets with validated create/edit/delete. The server blocks deletion while other records still reference the item. Unit options for utility meters are managed in Resources.

### 02 Needs & Gaps
- Per-room capacity, peak demand, shortfall slots, timetable overlaps and a transparent Needs Score with threshold bands **Critical / Stressed / Adequate** and an **Unavailable** state when evidence is missing.
- Utilisation is only shown when both attendance/occupancy evidence and seat capacity are recorded.
- Score breakdowns, component values, bookings and capacity findings with a **How is this calculated?** dialog showing supporting records and limitations.
- Missing capacity or attendance lowers confidence; it does not become a zero score.
- Nearby area reuses the same table for five types. Conditions alone decide status under a labelled project assumption; daily users order ties only. Unknown conditions are excluded from the denominator. Nearby records belong to one college and only its administrator can add, edit or delete them. Reporting opens a shared public issue draft; it sends nothing to an authority.

### 03 Resources
- Electricity and water meters with interval and cumulative readings, explicit missing-reading gaps, register resets, tariff periods and estimated costs where a tariff is recorded.
- Trend charts, per-period changes, spike flags using a median-absolute-deviation rule, and a written method/limitations panel.
- Resources are visible to admin and estates; maintenance uses assigned jobs and inspections. Editing readings and tariffs follows the inventory permissions.

### 04 Issues & Maintenance
- Campus complaints and public urban infrastructure reports, with required category, building, room choice (a room or “not sure”) and a description of at least 15 characters. Vague entries such as “broken” are rejected by the server.
- **My reports** for students/faculty, **assigned work** for maintenance, and the full college queue for admin/estates.
- Assignment, status changes, resolution, inspection schedule and a deterministic priority score based on recorded severity, age, affected people, asset criticality and repeat history.
- Priority explanation, repeat-issue grouping, inspections and a per-complaint activity timeline. Every write is recorded in the workspace audit trail.
- Public issues, including descriptions, notes, photos and reporter details, are visible only within the college where they were reported. Only that college's staff can update them.

### 05 Plan & Report
- Plan options with capital cost, annual cost/savings, assumptions, risks, evidence, disruption, implementation time and seat effect.
- Net annual benefit is calculated only when both cost and savings are recorded. Simple payback is calculated only when capital cost and a positive net benefit exist. Missing inputs are shown as not recorded.
- Decision records with title, owner, follow-up, notes, status (proposed/approved/rejected/deferred), actor and timestamp. **Only an administrator can approve, reject or defer.**
- Unaddressed critical/high findings are surfaced against the option register.
- Deterministic Markdown preview/download, matching full-report CSV and print output. These include nearby rows, evidence tags, methods, limitations, provenance and missing-evidence notes.

### 06 Data Centre
- Upload CSV, TSV, XLSX or XLS; per-sheet column mapping with auto-suggestions; template downloads for all 12 record categories.
- Server-side validation preview with row-level errors, warnings, skips and rejects **before** anything is written.
- Append and replace modes. Replace is blocked unless every populated campus category is included in the file. Public records can only be appended by an administrator.
- Import history and audit trail record the source file, actor, time, mode and counts.
- The expected external workbook remains **UNAVAILABLE** in `src/data/registry.ts` and is never impersonated. The Data Centre no longer displays the local file path or an “unavailable workbook” card.

### 07 Help and Administration
- **Help** is a short page for every role: what the numbers mean, what the role can do and how AI is used. It contains no role matrix, sample credentials or AI environment details.
- **Administration** is visible to administrators only: members and role changes, admin-only creation of maintenance/estates/administrator accounts, role capability matrix, AI configuration status and security controls. Sample credentials are not shown anywhere in the app.
- Role changes are audited with actor and time.

### Appearance and time
- The workspace uses a light theme at a 16px base size with one sans-serif font and text intended to meet 4.5:1 contrast. The dark ground and serif display face are limited to the landing hero.
- Timestamps are displayed in **IST** (`Asia/Kolkata`, 24-hour clock, label `IST`). The database continues to store UTC values.
- Seed tariffs are blank placeholders with the note **“Placeholder — enter the rate from your bill. Not a real tariff.”** Cost estimates appear only after a rate is entered; no seed tariff is presented as a real price.

### Overview
- Critical gaps count distinct items, not duplicate findings. “No plan yet” is a property of each gap. Open issues count active campus and shared public reports; Decisions waiting counts undecided options and proposals. Critical nearby types can appear in Fix these first.
- Findings open in an explainer with computed evidence, limitations, methods and an optional AI narrative.

## Deterministic analyses

The analysis code lives in `src/domain/analysis/` and is covered by `tests/analysis.test.ts`.

- **Capacity** (`capacity.ts`): seat shortfalls from expected attendance vs recorded capacity, timetable overlaps, unaveraged utilisation only when both actual attendance and capacity exist, weighted needs scores with documented weights and thresholds, and unassessed rooms when evidence is missing.
- **Utilities** (`utilities.ts`): interval vs cumulative readings, missing readings preserved as null, register resets handled without inventing negative consumption, median-baseline spike detection, and cost estimates only against recorded tariffs.
- **Maintenance** (`maintenance.ts`): deterministic priority points and priority labels, repeat grouping, and inspection overdue/due-soon calculations.
- **Plan** (`plan.ts`): option facts, linked findings, decision traceability, net benefit/payback only with complete evidence, seat-effect partial flags, and unaddressed priority detection.

No analysis is produced by an AI model.

## AI configuration (optional)

The server exposes an optional explanation proxy. **No AI credentials are present in client code or browser storage.** Without configuration, the client shows rule-based explanations and reports that AI is not configured.

Set these environment variables in the server process. `AI_API_URL` is the full chat-completions endpoint and takes precedence over `AI_BASE_URL`, which has `/chat/completions` appended when needed. Both endpoint names are supported; the key and endpoint stay server-side.

Required names: `AI_API_KEY`, `AI_MODEL`, and either `AI_API_URL` or `AI_BASE_URL`. Start the server from the terminal where those variables are configured.

The provider must accept an OpenAI-compatible chat-completions request. AI tasks are authorised server-side: administrators and estates can use all tasks; maintenance can explain findings and categorise issues; students and faculty can categorise issues. The proxy returns `503` when unconfigured and `403` for a disallowed task. AI never creates, edits, approves, assigns or deletes records. Text typed in a report and the facts behind a finding are sent to the configured provider. Answers are number-checked against server-computed facts; unsupported answers are discarded.

### Set AI configuration in PowerShell

1. Open a terminal in the project folder. Enter your provider's full chat-completions endpoint in `AI_API_URL`, your key in `AI_API_KEY`, and the approved model name in `AI_MODEL`:

   ```powershell
   $env:AI_API_URL = '<full chat-completions endpoint>'
   $env:AI_API_KEY = '<set privately in your terminal>'
   $env:AI_MODEL = '<approved model name>'
   npm start
   ```

   `AI_API_URL` is used as-is. The alternative `AI_BASE_URL` appends `/chat/completions` when needed. These are server-process environment variables, not browser settings.
2. Never commit an API key, add it to this README or paste it into chat. Do not share screenshots or logs containing credentials.

### Test-only rejected-answer demo

This uses only the bundled fake provider and a fake credential; it does not call a real provider. Start the fake provider in one terminal:

```powershell
$env:MICROCITY_FAKE_AI_PORT = '8799'
node tests/fake-ai-provider.ts
```

In a second terminal, start MicroCity with the fake endpoint and a separate demo database:

```powershell
$env:PORT = '8797'
$env:MICROCITY_DB = '.tmp-phase-g2\fake.sqlite'
$env:AI_API_URL = 'http://127.0.0.1:8799/v1/chat/completions'
$env:AI_API_KEY = 'fake-only-test'
$env:AI_MODEL = 'fake-model'
npm start
```

Sign in as the sample administrator and explain the capacity finding `capacity-rm-bv-101`; the fake provider returns an unsupported number and the UI should show the labelled rule-based fallback. Stop both test processes afterward. Do not use the fake values with real data or a real provider.

## Data and provenance

- Base workspace: `microcity-demo-2026-10`, hand-authored fictional records seeded from `server/seed.ts`. It is labelled synthetic everywhere it appears. Generated 24 Oct 2026; no external source; not for redistribution.
- Imported records: supplied by the signed-in user. The app records the file, actor and time but cannot verify the source.
- Public infrastructure assets are shared; public issues are visible and editable only within the reporting college. Campus records are isolated by `college_id` and enforced in the API.
- The externally expected workbook (`smartcampus_test_data.xlsx`) was not supplied. `src/data/registry.ts` marks it `unavailable` with the audit note. No local path is published, no loader reads it, and no record is presented as coming from it.
- Bundled photographs are CC0/public-domain and logged in `public/images/CREDITS.md`.

## Project structure

```text
server/
  app.ts                 authenticated HTTP API, college/role enforcement, imports, AI proxy
  db.ts                  SQLite schema, seeding, sessions, audit and import logging
  seed.ts                synthetic microcity-demo-2026-10 dataset
  record-validation.ts   server-authoritative field validation and reference checks
  passwords.ts           scrypt hashing and token hashing
  index.ts               production HTTP server for dist/ + /api
src/
  domain/                types, permissions, deterministic analyses, entities
  auth/                  session context and workspace loading
  lib/                   API client, formatting, downloads, spreadsheet parsing, reports
  components/            layout, dashboard and UI primitives
  pages/                 landing, sign-in and seven dashboard modules
  data/registry.ts       expected external dataset status (missing workbook)
tests/                  analysis, database, auth, formatting, complaint-rule and navigation coverage
```

## Known limitations

The following are **not** production-complete:

- Local HTTP only. Before any real deployment add HTTPS, `Secure` cookies, managed secrets, database backup/restore and an independent security review.
- The SQLite store is single-node; there is no replication, migration tooling or backup automation in this repository.
- No password reset, email verification, MFA, invitation flow or user deactivation. Self-registration is open to student/faculty roles and requires a college code.
- Photos are stored inline with the complaint record as a data URL in this demonstration; there is no object storage or image processing pipeline.
- Import/report operations are synchronous. Very large workbooks should use a job queue in production.
- AI-assisted narratives were not live-tested because no provider credentials were supplied. The fallback path and provider-unconfigured behaviour are implemented and tested.
- Excel visual layout, screenshot-based visual regression and cross-browser testing were not part of this verification pass.
- "Ask your data" maps questions to a fixed list of server-computed lookups; without AI, the same lookups are available as buttons.
- Plan costs and savings are user-recorded figures, not estimates generated by the system.

## Verification summary

- `npm run build`: passes.
- `npm test`: 28/28 analysis, database, auth, formatting, complaint-rule and navigation tests pass. The auth suite covers the exact role-mismatch refusal with no session cookie, cross-college `403 college-forbidden`, registration college-code checks, staff self-registration refusal, admin-only staff creation and the `DEMO_MODE` gate.
- `npm run lint`: 0 errors; one advisory React fast-refresh warning in `src/auth/auth-context.tsx` (hook and provider exported from the same module).
- Fresh-database check: a new SQLite file (never the existing one) is created in a temporary directory; seeding, the college-code migration and the seed-tariff neutralisation complete without errors, and reopening does not duplicate records.
- End-to-end browser checks covered: landing → sign in; role-aware navigation; student/faculty/maintenance route restrictions; student private-report scope; maintenance assigned-only complaints; cross-college API denial; building create/edit/delete; import preview/apply with visible success state; replace-mode safeguard; sign-out to landing; mobile drawer open/close; logo to landing; rule-based explanation and query fallback.
- The missing `smartcampus_test_data.xlsx` was audited and remains unavailable.
