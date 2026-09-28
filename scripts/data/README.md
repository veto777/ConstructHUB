# Government link audit replay (lane a4, round 2)

Large raw evidence stays in the ignored `analysis/` directory. The gzip files here
are the minimal replay inputs used by `scripts/apply-gov-round2.ts`:

- `gov-round2-input.json.gz`: original round-1 `gov-data-audit.json`, NETR source
  refresh, jurisdiction/browser/replacement/manual checks, manual candidates, and
  the exact round-1 published data (the before snapshot).
- `gov-round2-browser.json.gz`: one real-browser retry per distinct candidate URL.
- `gov-round2-replacements.json.gz`: fresh listing/official-page searches for dead candidates.
- `gov-round2-statewide.json`: official Tennessee replacement link and its browser check.
- `gov-round2-manual.json`: small, explicitly sourced independent content checks.
- `gov-round2-output-hashes.json`: protects application from overwriting unrelated edits.

From the repository root, with Node 20:

```sh
npx tsx scripts/restore-gov-audit-evidence.ts
npx tsx scripts/apply-gov-round2.ts --preview
npx tsx scripts/apply-gov-round2.ts
npx tsx scripts/validate-gov-round2.ts
```

Replay is offline. To resume the bounded external checks instead, run
`recheck-gov-round2.ts` and `search-gov-round2-replacements.ts` separately, with
only one instance of each. They checkpoint locally and skip completed URLs/rows.
After new checks, rerun the preview; run replacement research again if new dead
rows appear, then apply and validate. Explicitly recompress reviewed evidence to
update this replay snapshot; never add the raw evidence JSON to git.

Only the lane DB proof scripts load `.env`. They guard `constructhub_dev_a4`.
`lastVerifiedAt` is the existing database column name; for an unconfirmed link it
means **last checked**, and the UI labels it that way. `none` means no source URL;
`dead` retains a non-public candidate in JSON but exposes a null URL. Legacy
`live` DB rows remain readable as verified for backward compatibility.

The round-1 strict-null apply/validation scripts are historical. Use the round-2
commands above for the current owner-approved policy.
