# Sprint 1 repository audit

Baseline: `factory/dev-ready-v0.1` at `c209acc`. Audit performed before implementation.

- Runtime: React 19.2.6, vinext beta, Vite 8, Cloudflare worker build; separate GitHub Pages Vite entry imports the same Home. Keep both; no monorepo or framework migration needed.
- Data flow: one client page owns React state, IndexedDB I/O, localStorage fallback/legacy migration, JSON/CSV backups, CRUD, monthly summaries and speech recognition. Effect-based autosave reports success before durable commit and can overwrite unreadable data with defaults.
- Supabase: unused `lib/supabase.ts` client and historical migration for profiles/transactions/settings with RLS; no imports from active UI. The checked-in publishable key is not a secret. No live database changes in Alpha. Beta still needs a schema for cycles/budgets/nature, authenticated repository, migration and live RLS verification.
- Drizzle: unused D1 helper, empty schema and opt-in examples; not the app's persistence. PostgreSQL migration and D1 example are separate, not a single connected backend.
- Transaction: page-local id/type/category/note/amount/date/icon/source. Missing salary-cycle link, user nature and spend allocation. Legacy records must retain unknown nature/allocation rather than inventing user choices.
- Tests: two keyword-classification tests pass. HTML/source assertions cover branded loading and backups; no financial, persistence, CRUD or browser-flow coverage. GitHub Pages baseline builds. Default vinext build fails because `.openai/hosting.json` is absent from the repository. Existing CI only builds/deploys Pages on main/master.
- Reuse: mobile green visual system, navigation, transaction rows, category rules/icons, speech input, dialogs, data export/import and calendar-period bill views.
- Minimum change: extract domain + repository + local adapter, retain IndexedDB identity and import compatibility, add cycle setup and core cards to current app. Persist user actions before reporting success; refuse corrupt data and stale writes. Add pure rule, adapter and browser acceptance tests plus PR CI.
- Dependency baseline: npm ci reports 23 advisories (1 low, 6 moderate, 16 high). Do not apply an unreviewed force upgrade as part of this sprint; record exact audit separately.
