# Batch A — producer notes (slot 1, 2026-10-07/08)

- Recorder race: a `click` step schedules "remove the ring" 450 ms after the click (`record.ts`, `setTimeout(() => this.ring(null), 450)`). When the click step's line is short, the next step has already put its ring on the new target and the timer removes it — the next highlight/type plays with no ring. Worked around in the scripts with `"holdMs": 700` on short click steps; the fix is to cancel that timer when the next `ring(target)` is called.
- A `click` that opens another page, followed directly by `back`: the new page is on screen for under half a second. Put a `highlight` on the new page between them.
- Thumbnail: a headline that wraps to three lines (accent word in the middle of 3+ words) runs over the screenshot's ringed element. Use two words, or put the accent on the first or last word.
- A6 `crm-client-import` duplicates D13; recorded instead as `crm-client-export` (Export CSV on Clients).
- A9 `crm-client-portal-preview` not recorded: in a slot, "See what the client sees" opens `/?client=1` and stays blank — `GET /api/client/documents` answers 401 "Sign in required" after `/api/client/auth/preview` redirected (app log, slot 1).
- A14: no follow-up is due in the seed (every client was created within the last week), so the "Due for follow-up" row and its Done button cannot be shown; the video sets the rhythm and says what Done does.
- A7: no client has a declined estimate in the seed; the Declined tab is shown empty.
- server/help-registry.test.ts fails any script that types into a selector containing 'email' unless the value is a redacted {{PLACEHOLDER}}; a demo example.com address in a client form trips it. crm-client-new reaches the field as '#c-company >> xpath=following::input[1]'.
