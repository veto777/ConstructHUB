# Manifests of walkthroughs that are recorded and in R2 but NOT in the app

A video is in the app only when its manifest is in `shared/help/videos/`. A file here is a cut that
must not be shown or posted as it is; the note says why and what releases it.

| Manifest | Why it is held | To release |
| --- | --- | --- |
| `crm-jobcam-share-link.json` | The cut shows a newly made share link readable for about a second before the step that blurs it, and the share dialog's "Prefilled from ." defect (being fixed on another branch). The entry is `youtube: { hold: true }`. | Re-record after the product fix (the script now blurs the link from page load: `redactSelectors` — check the selectors against the dialog in a dry run), upload, commit the new manifest in `shared/help/videos/`, remove the hold from the entry and delete this file. |
| `crm-deposit-link.json` | The first cut (batch E) showed a newly created deposit link readable for about a second. Superseded: see `shared/help/videos/crm-deposit-link.json` if the re-record of 2026-10-08 is there. | Nothing — kept only as the record of the withdrawn cut's R2 keys (the bucket is create-only; delete the objects by hand if wanted). |
