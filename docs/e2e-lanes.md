# E2E lanes — parallel verification for swarm agents

Each agent verifies in its own **lane**: an isolated git worktree + an
isolated database + its own dev-server port. No more serialising behind the
single shared server on `127.0.0.1:8119` / `constructhub_dev`.

## Lane anatomy

| piece    | env var       | default            | lane aN                     |
| -------- | ------------- | ------------------ | --------------------------- |
| port     | `E2E_PORT`    | `8119`             | `8119 + N*10` (a1 → 8129, …) |
| database | `E2E_DB`      | `constructhub_dev` | `constructhub_dev_aN`       |
| workers  | `E2E_WORKERS` | `4`                | same                        |
| worktree | —             | main checkout      | `../ConstructHUB-aN`        |

`playwright.config.ts` reads all three. Its `webServer` block boots the dev
server itself (with `DEV_AUTH_BYPASS_USER1=true`, `VITE_FORCE_PORTAL=true`,
`DATABASE_URL` pointing at `E2E_DB`) and tears it down after; it reuses an
already-running server only outside CI. `e2e/db.ts` connects to `E2E_DB` for
setup/teardown SQL, so tests and server always land on the same database.

## Spinning a lane up

```bash
npm run e2e:worktree -- a1          # worktree + branch lane/a1 + DB clone + port
cd ../ConstructHUB-a1
E2E_PORT=8129 E2E_DB=constructhub_dev_a1 npm run test:e2e
```

Pieces are also usable on their own:

```bash
npm run e2e:lane -- create   constructhub_dev_a1   # clone constructhub_dev (+ idempotent schema bootstrap)
npm run e2e:lane -- recreate constructhub_dev_a1   # drop + fresh clone (between runs, to reset state)
npm run e2e:lane -- drop     constructhub_dev_a1
npm run e2e:worktree -- a1 --teardown              # drop DB + remove worktree (branch lane/a1 is kept)
```

Hard safety rule, enforced in `e2e-lane.ts`, `e2e/db.ts` and
`playwright.config.ts`: a lane DB name must match `constructhub_dev_<lane>`.
The scripts refuse anything else — they can never create/drop the shared
`constructhub_dev` and can never point at the live `constructhub` database.
Lane DBs are pg_dump clones of `constructhub_dev` (34 MB, seconds), **not**
empty databases: the specs depend on the seeded Aspire/Alpine demo orgs, and
an empty DB would trigger the full US-counties seed on server boot.

Housekeeping: lane DBs and worktrees are throwaway, but they cost disk
(~520 MB source + 34 MB DB each) — tear lanes down when the agent finishes.

## Unit tests on a lane

`npm test` (vitest) splits in two: pure unit tests, and `server/crm/*.test.ts`
suites that talk to a running dev server over HTTP **and** run their own SQL.
Point both knobs at the lane or the test-side writes land in the wrong DB:

```bash
DATABASE_URL=postgres://constructhub_dev:crmdev_local_only@127.0.0.1:5432/constructhub_dev_a1 \
CRM_TEST_DATABASE_URL=postgres://constructhub_dev:crmdev_local_only@127.0.0.1:5432/constructhub_dev_a1 \
CRM_TEST_BASE_URL=http://127.0.0.1:8129 \
npm test
```

`DATABASE_URL` covers the test files that run their own SQL;
`CRM_TEST_DATABASE_URL` covers `engagement.test.ts`, which poisons
`DATABASE_URL` as an import shim and so reads the override instead.

(The lane server for this is any dev server booted with the lane's
`DATABASE_URL`/`PORT` — e.g. the one `npm run test:e2e`'s webServer starts,
or a manual `PORT=8129 DATABASE_URL=… npx tsx --env-file=.env server/index.ts`.)

Known re-run hazard, not lane-specific: `/api/client/auth/request-link` is
rate-limited to 30 requests/IP per 15 minutes in-memory per server. Hammering
repeated full suite runs at the same server exhausts it and client-auth /
link-gating tests fail with 429/401 until the window slides. Separate lanes
(separate server processes) sidestep this entirely.


## Why `workers` is 4 but four spec files are `@serial`

The old `workers: 1` comment said "every spec shares the same throwaway dev
DB". Per-agent lanes remove the *cross-agent* sharing, but specs inside one
run still share the lane DB. Auditing the specs showed most are
self-contained (they create throwaway customers/estimates and clean up), so
the parallel default is safe — **except** four files that mutate or assert
cross-suite shared state:

- `18-divisions.spec.ts` / `24-pm-role.spec.ts` — temporarily re-role the
  dev-bypass user's membership; every other suite assumes that owner seat.
- `19-admin-beta.spec.ts` — temporarily repoints user 1's email (admin status
  is email-derived).
- `25-documents.spec.ts` — asserts live document counts in the Aspire org;
  concurrent specs creating estimates/invoices would shift the totals.

`npm run test:e2e` therefore runs two phases: everything `--grep-invert
@serial` at `E2E_WORKERS` (default 4), then the four `@serial` files at
`E2E_WORKERS=1`. If you add a spec that touches user 1's role/email or
asserts absolute counts of shared rows, tag its describe `{ tag: "@serial" }`.
A green run does not prove a new spec is parallel-safe — check what shared
rows it reads/writes.

Evidence (2026-08-01): the parallel phase passed 76/76 at 4 workers four
times — twice on lane a1 and twice on lane a2, with the two lanes running
full suites **simultaneously** (own ports, own DBs, own vite dev servers).
After the vite-crash fix below, both full suites (76 parallel + 14 serial,
90 tests each) finished green in the same overlapping window.

## Dev-server crash found by the lanes (fixed)

The first simultaneous two-lane run killed both lane servers mid-sweep with
no stack trace: `server/vite.ts`'s custom vite logger called
`process.exit(1)` on any dev-time vite error (e.g. an outdated-optimize-dep
reload), and `process.exit` discarded the pending pipe write, so the message
never surfaced. The logger now logs and keeps serving. Dev-only code path;
production builds don't run vite. If a lane server ever dies silently again,
suspect the same pattern — reproduce with the suite's own `webServer`, not
a hand-started one, and grep the runner log for the last `[WebServer]` line.

## Swarm briefs that fit the 30-minute cap

Split work so one brief ≈ 15 minutes. A brief that dies at 29 minutes resumes
cold and re-pays the whole context cost; two 15-minute briefs don't.

Rules:

- One brief = one lane. Assign `aN` in the brief; the agent runs
  `npm run e2e:worktree -- aN` first and works inside `../ConstructHUB-aN`.
- Verification in a brief is scoped: `npx playwright test e2e/NN-foo.spec.ts`
  for the spec it touched, not the whole suite. Full-suite verification is
  its own brief.
- Never ask one brief to both implement and full-verify.

Template:

```
Lane: aN (run `npm run e2e:worktree -- aN` in /home/veto/ConstructHUB, then
work in /home/veto/ConstructHUB-aN with E2E_PORT=$((8119+N*10))
E2E_DB=constructhub_dev_aN — the worktree script prints the exact values).

Task: <one feature or fix, smallest viable slice>.
Verify: npm run check && npx playwright test e2e/<relevant spec>.spec.ts
Done when: <observable criterion>. Stop and report if <boundary> is hit.
Teardown: leave the lane up; report lane id so it can be reused or torn down.
```

Example split of one feature over two briefs:

1. **Brief 1 (~15 min):** implement `<feature>` in server + client, add/extend
   unit tests, `npm run check` at 0 errors, `npm test` green. Commit to
   `lane/a1`.
2. **Brief 2 (~15 min):** add the e2e spec for `<feature>`, run it plus the
   full `npm run test:e2e` on the same lane, report pass/fail. Then
   `npm run e2e:worktree -- a1 --teardown`.
