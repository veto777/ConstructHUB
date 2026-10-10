# Code API

Short-lived access to the ConstructHUB source code (backend + frontend) for AI agents and developers.
Owner, 2026-10-10: "an API that has access to all backend and frontend code that can add or change
certain things or add scripts or code … the Account admin with Google access and verification … can
create this in the admin portal." Changes go to a branch; the owner approves every deploy.

- **URL:** `https://constructhub.us/api/dev/v1`. `GET` it with no token for the endpoint list.
- **Tokens:** `chdev_…`, issued at **/admin/code-api** (sidebar → Admin → Code API). They last 24 or 48 hours,
  have read or read + write access, and are shown once. Up to 10 can be live at a time. Revoking one stops it at once.
- **Who can issue:** platform admins (`server/admin.ts`). The account must sign in with Google, and the admin must
  click **Continue with Google** in the 15 minutes before issuing, **and** type the current 6-digit code from
  their authenticator app (two-step sign-in must be on in Settings → Security; a code works once). That has to be the admin's own sign-in;
  an agency member acting for an admin's account can't issue.
- **What a token can do:** read the repo (tree, files, search), commit to **its own branch `devapi/<id>`**
  (pushed to GitHub at once), see its diff and log, and `POST /submit` to tell the admin the branch is
  ready. It can't run anything, restart the app, push `main` or deploy.
- **Off-limits:** `.env*`, `secrets/`, `private/`, `keys/`, `analysis/` and key files can't be read or written.
  `.github/`, `.husky/`, `.gitignore`, `.gitattributes` and `.gitmodules` can't be written.
- **Review closely:** the admin page and `/diff` flag files that run on your machines (`package.json`,
  lockfile, `script(s)/`, `ops/`, `*.sh`, `server/index.ts`, auth files, this API itself).
- **Audit:** every request is in `dev_api_audit`. Commits carry `Code-API-Token:` and `Issued-By:` trailers.
  Issuing, revoking and submitting notify and email the admin.

## Switching it on (production, vb11)

1. Make a deploy key on vb11: `ssh-keygen -t ed25519 -N "" -f ~/.ssh/constructhub_code_api`
2. On GitHub, open veto777/ConstructHUB → Settings → Deploy keys → Add, paste the `.pub` and tick **Allow write access**.
3. Recommended: add a branch ruleset on `main` (Settings → Rules) that blocks pushes and deletes from anyone
   but you, so the deploy key can never move `main` even though the code only pushes `devapi/*`.
4. Add to `~/ConstructHUB-live/.env`:
   ```
   DEV_API_REPO_URL=git@github.com:veto777/ConstructHUB.git
   DEV_API_SSH_KEY=/home/voiceban/.ssh/constructhub_code_api
   DEV_API_GITHUB_REPO=veto777/ConstructHUB
   # optional: DEV_API_REPO_DIR (default ~/.constructhub-dev-api/repo.git), DEV_API_BASE_BRANCH (default main)
   ```
5. Restart `constructhub.service`. The first token issued clones the repo (about 1 minute).

Code: `server/dev-api/` (paths.ts policy, repo.ts git layer, tokens.ts, routes.ts, guard.ts) and
`client/src/pages/admin-code-api.tsx`. Tests: `server/dev-api/*.test.ts` (the routes test needs a dev-lane DB).
