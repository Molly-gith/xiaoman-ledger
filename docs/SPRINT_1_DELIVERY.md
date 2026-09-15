# Sprint 1 — implementation and acceptance

## What changed

Starting from `factory/dev-ready-v0.1`, the existing local ledger now implements salary-cycle planning → manual bookkeeping → deterministic safe-to-spend → budget/nature/recent-transaction feedback. Home answers “还能安心花多少” first. Navigation is 首页 / 账单 / + / 复盘 / 我的.

Audit: [SPRINT_1_AUDIT.md](SPRINT_1_AUDIT.md). Approved rules and engineering choices: [DECISIONS.md](DECISIONS.md#d-013--alpha-salary-and-spending-semantics).

## Architecture

`app/` presents forms and state. `lib/domain/` owns financial types, calendar rules and integer-fen calculations. `lib/data/repository.ts` validates commands and defines durable persistence boundaries. `local-adapter.ts` retains the original IndexedDB identity, migrates v1 backups, and isolates the fallback. Supabase and Drizzle remain disconnected from the Alpha flow.

UI success means the storage transaction completed. Failures preserve inputs; read errors never trigger a default-state overwrite. Revision checks protect against concurrent tabs. JSON export includes cycles, budgets and final subjective values; CSV remains available. Imported unknown expense allocations require confirmation before an affected safe-to-spend headline appears.

The vinext build no longer requires absent `.openai/hosting.json`; the Sites plugin is enabled only when hosting metadata exists. The GitHub Pages build is preserved. The Pages service worker caches the static shell and fingerprinted assets so the ledger can reopen offline after initial online loading; it does not cache API responses or financial records.

## Product Owner acceptance — about 3 minutes

1. Set payday 20, income ¥10,000, savings ¥2,000 and reserve ¥3,000. The initial safe-to-spend is **¥5,000**.
2. Add a ¥100 variable expense, choose category and 消费 / 浪费 / 投资: **¥4,900**. Edit to ¥200: **¥4,800**. Delete: **¥5,000**.
3. Record salary income ¥10,000: the headline stays **¥5,000**. Record ¥3,000 rent using necessary reserve: still **¥5,000**, remaining reserve **¥0**.
4. Change confirmed income to ¥11,000 in the budget: **¥6,000**. Refresh and verify values/nature survive.
5. Export a JSON backup; restore it through data settings or the first-run form. Verify cycles and records are retained.

Negative results remain visible; zero-income and zero-savings plans are supported. A cycle ending does not invent a salary deposit or silently carry a budget forward.

## Validation

- `npm test`: vinext build, 28 domain/repository/classification/AI tests, and 2 server-render/integration assertions.
- `npm run typecheck` and `npm run lint`.
- `npm run build:github`.
- `npm run test:browser`: Chromium/Chrome acceptance tests for CRUD, nature, exact money, income deduplication, reserves, budget edits, portable backup/restore, offline reload, legacy confirmation, stale tabs, zero/negative values, rollover and failed durable writes. Local Windows uses `PLAYWRIGHT_CHANNEL=chrome`; CI installs Chromium.
- `npm run eval`: disabled provider yields 0 evaluated / 3 skipped. `npm run eval -- --fixture-provider`: 3 smoke fixtures; validates harness plumbing only.
- PR CI runs both builds, tests, typecheck, lint and browser acceptance; screenshots and traces are uploaded as artifacts.

## Known gaps / next decisions

1. **Before Beta:** Supabase Auth + PostgreSQL + verified RLS, cloud migration, account export/delete, and a dependency upgrade/retest pass. Alpha does not call the existing cloud client.
2. **AI:** real Dify provider, model/cost/privacy decision, full ~290 labeled cases, real baseline and human review rubric remain. See [AI_EVAL_NOTES.md](AI_EVAL_NOTES.md).
3. **Product rules still open:** refunds, credit/committed spending, automatic treatment of temporary income, reserve-overflow splitting, feedback thresholds, health-score weights, daily briefs and personalized nature references. The sprint implements no invented financial health scores, investment recommendations or strong L3 threshold.
4. **History:** old cycles/records are retained and bill filters can find them; rich historical-cycle review and arbitrary backdated cycle creation are future work. Legacy records outside established cycles remain visible/exportable but need a cycle before fully assigning them.
5. **Local durability:** browser clearing/device loss still requires a prior backup. Corrupt persisted data is retained and read errors block writes; there is not yet a dedicated corrupt-file repair UI. Fallback localStorage mode requires Web Locks to avoid unsafe cross-tab writes.
6. **Dependency baseline:** `npm audit` reports 23 advisories (16 high / 6 moderate / 1 low), unchanged from initial install. Direct affected packages include Vite, vinext, react-server-dom-webpack, Cloudflare tooling and drizzle-kit. The server-function advisory matters before any server deployment. No forced or broad dependency upgrades were mixed into this sprint.

## Screenshots

Synthetic test values only.

![First cycle](screenshots/onboarding.png)
![Home](screenshots/home.png)
