# Gator shorts — handoff (2026-10-08, about 09:30 Eastern)

For whoever picks this stream up without having seen the conversation. Branch `gator-shorts`, worktree
`/home/voiceban/ConstructHUB-gstyle-b`. Nothing of the previous producer is running; no Higgsfield job is
pending. **Two producers must never post or spend at the same time** — the ledgers below are the lock.

## 1. What is live and what is scheduled

- Posted 2026-10-08 (the three cartoon pilots): 8 posts on Instagram / TikTok / LinkedIn; the ninth
  (`shingle-rhythm` → LinkedIn) is scheduled for 10:15 Eastern today. Addresses: `docs/gator/viral-schedule.json`.
- **Scheduled in Blotato: 68 gator posts, 2026-10-09 07:34 → 2026-10-17 19:53 Eastern** — Instagram 27,
  TikTok 27 (three a day for nine days), LinkedIn 14 (three on weekdays, one on Saturday and Sunday, until its
  tame clips run out on 2026-10-14). Verified at hand-over against the ledger, Blotato's own schedule list and
  the owner's kept list: 0 wrong, no "undefined", none twice on an account, three gator posts a day at most.
  The table: scratchpad `gator/schedule.txt` (regenerate: `daily.ts --schedule --table <file>`, a dry run).
- Today (Thursday) nothing more could go out: each account already had its four posts for the day from the
  night before. The tutorial slot of every day (10:15–11:00) is kept free and **nothing is scheduled in it yet**.
- Not posted to YouTube, by the owner's rule. The three pilot Shorts were refused there on 2026-10-08
  (`uploadLimitExceeded`) and are now out of scope.

## 2. The owner's decisions (verbatim where it matters)

1. **The live-action gator is the main look** — a photoreal upright alligator in a yellow hard hat, dark
   opaque shades and an orange hi-vis vest. "Not the cartoon one but the human one."
2. **Never mix the live gator and the cartoon mascot in one video.** "You can use it elsewhere just not human
   mixed with cartoon." Live clips end on the logo-only end tag (`endTagHtml(false)`); the mascot tag is for
   all-cartoon clips.
3. **The reference format is the selfie vlog that goes wrong**: he is mid-sentence and overconfident, the
   fall interrupts him, the camera goes with him, he keeps talking. "The one where the alligator falls off the
   roof is funny" (`selfie-roof`).
4. **Accidents must look like accidents.** "The accident videos were not great since they didn't look like an
   accident." Recipe for the remakes (in `concepts-live.ts`, "ACCIDENT v2"): the subject is busy and unaware,
   the camera is filming something else, real speed and weight, the scene reacts, he is shown fine. He later
   KEPT the first accident clips in the review folder, so they are scheduled — after the stronger clips.
5. **Voice**: the video model's own generated voice (Kling 3.0, `sound: "on"`), one fixed description, the line
   in quotes; he picked it by ear ("This is the only decent one"). `docs/gator/VOICE.md`. Nobody on the
   production box can listen: words are checked by local speech-to-text, pitch by `voiceprint.ts`.
6. **Reactions** (for "Gator Reacts"): "the reactions have to be annoyed or shocked" — "or no reaction is also
   a reaction". Three families, live gator only, one framing; the list is in section 7.
7. **Cadence**: "on TikTok and Instagram and LinkedIn we will only post one tutorial a day and 3 funny videos a
   day"; every walkthrough goes to YouTube; no gator clips on YouTube.
8. **The review folder is the review surface** (fileloaded project `gator-videos`): "I delete what I didn't
   like". What remains is approved, a deletion is a rejection, a new upload is pending until at least the next
   morning's first slot. `daily.ts --schedule` reads the folder first and skips a clip whose file is gone.
9. **The reaction pack and every "Gator Reacts" episode need his explicit approval before posting**: "Once
   these are done share them to fileloaded file and I will review. Once approved we will distribute."
10. **"Gator Reacts" from the two YouTube compilations.** The owner asked for episodes cut from
    `youtu.be/4HmTgOLTQsE` and `youtu.be/kF_a7SNAMPc` with the original host cut out, the gator's reactions cropped
    in, graphic clips skipped, the clips' watermarks removed, nothing to YouTube. **This was not built, and the
    tool refuses it on purpose.** Those videos are other people's clips under the standard licence; reposting
    them from a business account without a licence, with the marks that say whose they are taken off, is
    something the previous producer would not do, whoever asks. `reacts.ts` accepts only clips with a rights
    record of kind own-ai, owner, licensed or cc-by, has no override flag and no watermark step, and a test
    holds that. What exists instead: the same show on footage we may use — our own AI fails of the animal cast
    (six five-second ones are generated, see section 8), the owner's own crews' clips if he has any (ask him),
    and licensed clips (`docs/gator/CLIP-LICENSING.md`: sources, what to ask, the order of cost — roughly $800
    to $2,400 for eight clips on the one published price list found). The owner has not been told this in these
    words by the producer; the coordinator should.

## 3. The content limits (unchanged, in every style)

An animal takes the hit, never a realistic person; no blood, no injury detail, nobody dies, no children; he is
shown fine afterwards; nothing that reads as a real animal attack or cruelty; the gator never bites; no real
people, brands, leagues or other creators' characters; nothing presented as safety advice; every clip is
labelled AI-generated (TikTok's `isAiGenerated`, "#AIContent" in every caption — `captionFor` in `queue.ts`).

## 4. Accounts, keys, the denylist

- Blotato accounts (the allowlist `TUTORIAL_BLOTATO_ACCOUNT_IDS` in `/home/voiceban/ConstructHUB-live/.env`):
  Instagram **76607** (constructhubapp), TikTok **63054** (construct.hub), LinkedIn **38445** (Construct HUB).
- **The Blotato key is shared with other brands.** The hard denylist is `DENYLIST` in
  `scripts/tutorials/social-post-lib.ts`; every send re-checks allowlist, denylist and Blotato's own account
  list. Never widen it. `GET /v2/schedules` lists the whole workspace — match by account id before touching one.
- Higgsfield: `TUTORIAL_HIGGSFIELD_KEY_ID` / `_SECRET` in the same env file. fileloaded: key file in the
  scratchpad `gator/.fileloaded-key` (never print or commit); list `GET http://127.0.0.1:8150/api/p/gator-videos/files`,
  upload `PUT …/files/<name>` with `Content-Type: video/mp4`.

## 5. Rate rules and back-off (`scripts/tutorials/social-rate.ts`, shared by both streams, tested)

- Slots, Eastern: gator 07:30–08:15, tutorial 10:15–11:00, gator 13:00–13:30, gator 18:30–20:30; LinkedIn
  weekdays 08:00–08:15 / 13:00–13:30 / 15:30–17:30; LinkedIn weekends the tutorial and the midday gator only.
  The minute moves every day by a fixed step, so consecutive days never match.
- Four posts per account per Eastern day, five at most in any rolling 24 hours, two hours between posts.
  (A strict "4 in a rolling 24 h" cannot be kept with times that move earlier from one day to the next —
  that is why it is a day cap plus a rolling five.)
- Back-off: a LinkedIn "share limit … unverified members" or Instagram "account is restricted" refusal seen by
  `--reconcile` puts that account on two posts a day for 48 hours (`docs/tutorials/social-backoff.json`) and
  the refused clip is carried by the next `daily.ts --schedule --go`, never within 12 hours. **Nothing runs by
  itself: there is no cron.** Posts already scheduled in Blotato are not thinned by a back-off — cancel them
  with `--cancel-scheduled` and schedule again.
- One tutorial cut per account per day: `tutorialsOfTheDay` / `tutorialSlotFor`, wired into `planPosts`
  (`social-post-lib.ts`; `everyVideo: true` gives the old behaviour).

## 6. Tools (all dry-run by default; `G=--env-file=/home/voiceban/ConstructHUB-live/.env`)

| What | Command |
| --- | --- |
| Make a clip (stills, videos, assemble) | `npx tsx $G scripts/gator/make.ts <id> [--stills] [--videos [--takes 2]] [--assemble] [--retake-still s1] [--retake-video s1]`; `--ledger` prints spend |
| Instant-replay edit | `npx tsx scripts/gator/replay.ts <id> --impact SEC [--from SEC] [--centre x,y] [--drop TRACK] [--tags]` |
| "Gator Reacts" episode | `npx tsx scripts/gator/reacts.ts docs/gator/reacts/<ep>.json` — written and unit-tested, **never run end to end** |
| Review queue | `npx tsx scripts/gator/daily.ts --status` · `--approve <id> [--caption "hook|line"] [--linkedin] [--by who]` · `--hold <id> --why …` · `--reject <id> --why …` |
| Schedule the approved clips | `GATOR_FILELOADED_KEY_FILE=<key file> npx tsx $G scripts/gator/daily.ts --schedule [--go] [--table file]` |
| Take our scheduled posts back | `npx tsx $G scripts/tutorials/social-post.ts --stream viral --cancel-scheduled [ids…] [--go] --why "…"` |
| What became of each post | `npx tsx $G scripts/tutorials/social-post.ts --stream viral --reconcile` (run after 07:34 tomorrow; then add the addresses to scratchpad `gator/posted.txt`) |
| Scoreboard | `npx tsx $G scripts/gator/scoreboard.ts` (Blotato now has analytics endpoints — `GET /v2/posts/{id}/analytics`; the tool still uses the manual sheet) |
| Tests | `npx vitest run server/tutorials/gator.test.ts server/tutorials/social-post.test.ts` (91 pass); `npm run check` |

Concepts are data: `scripts/gator/concepts.ts` (cartoon), `concepts-more.ts`, `concepts-live.ts` (everything
live, the reactions and host lines). Clips and raw takes: `analysis/gator-shorts/<id>/` (not in git).

## 7. Ledgers — which is authoritative

- `docs/gator/viral-schedule.json` — every gator post (written before each request). 46 entries read
  "failed … cancelled by us": the first schedule of this morning, taken back and rebuilt after the owner's review.
- `docs/gator/queue.json` — the review queue: order, verdict, who approved, caption, file per platform, the
  review-folder names. Approved 27, rejected 6, held 1 (`talking-sample-2`, his voice reference).
- `analysis/gator-shorts/ledger.json` (not in git) — every Higgsfield request and its cost; the cap is enforced
  from it. **If the successor works on another machine, copy this file and the whole `analysis/gator-shorts`
  folder first**, or the cap starts from zero and finished shots are paid for again.
- `docs/tutorials/social-schedule.json` — the tutorial cuts. In this worktree it holds the twelve posts of the
  night of 2026-10-07 with stale statuses; Blotato says eleven were published and `crm-schedule → linkedin`
  failed (share limit). `integration` has not been merged into this branch.
- `docs/tutorials/social-backoff.json` — does not exist yet (no refusal since the cadence began).

## 8. Money

Cap: 1641.12 credits ($102.57 = the $2.57 pilot + $100). **Spent: 1023.264 credits ($63.95)** in 82 images and
77 videos. Left: 617.856 credits ($38.62). Enforced in `higgsfield.ts` before any paid call.

What worked: stills `nano-banana` family from the live model sheet (about 1.5 credits); video **Kling 3.0
Standard image-to-video with sound, 2.016 credits ($0.126) a second**, 3–15 s — dialogue in quotes comes out
right nearly every time; a ten-second one-shot is about $1.35 with its still, a five-second one $0.72, a
three-second reaction $0.38. Kling 2.5 Turbo (3.36 credits a five-second shot) for silent cartoon shots.
What failed: Wan 2.6/2.7 driven by an audio file (jaw hangs open or he turns into a laughing face); any talking
model on the CARTOON mascot (his glasses turn see-through); "satisfying" clips (scribbled chalk lines); stills
of a selfie from a ladder draw two gators unless the prompt says "exactly ONE alligator"; models with no fixed
price are refused by the client. No seed, voice id or voice reference exists: calm five-second lines measure
closest to the approved voice, shouted vlogs measure far higher.

**Paid for this morning and NOT yet assembled, looked at or uploaded** (raw takes in
`analysis/gator-shorts/<id>/videos/`):
- 20 reactions: `react-shocked-01…08`, `react-annoyed-09…16`, `react-deadpan-17, -20, -21, -22`
  (`react-deadpan-18-sip` and `-19-late-sip` are the existing coffee shots, already copied in as `pure.mp4`);
- 12 host lines `host-open`, `host-write-up`, `host-signed-off`, `host-twenty-years`, `host-operator`,
  `host-check`, `host-meeting`, `host-new-guy`, `host-gravity`, `host-seen-worse`, `host-lunch`, `host-sign-off`
  (the two measured so far: 139 Hz and 148 Hz — near the approved 127 Hz; "site walk" was heard as "sight walk");
- 3 selfie falls `selfie-scaffold`, `selfie-ladder`, `selfie-attic`; 4 accident-v2 `acc-deck-ladder`,
  `acc-scaffold-doorbell` (its doormat has garbled lettering — crop or retake), `acc-wheelbarrow-drive`,
  `acc-ceiling-selfie`; 6 cast fails `fx-raccoon-plank`, `fx-rooster-washer`, `fx-beaver-cut`, `fx-possum-paint`,
  `fx-goat-drywall`, `fx-raccoon-buckets`.
Next step for each: `make.ts <id> --assemble`, LOOK at the frames (reject anything that reads happy, neutral
or off-model; reject falls that float), then upload to the review folder. None is in the queue yet.

## 9. The reaction list (22; live gator, one framing — the still `moment-ladders/s2`)

SHOCKED 1 jaw drop · 2 spit-take · 3 recoil "OHH!" · 4 double-take · 5 grabs his hard hat · 6 drops his coffee ·
7 frozen mid-sip · 8 leans in. ANNOYED 9 head shake · 10 facepalm · 11 long exhale to the sky · 12 tapping,
tail flicking · 13 pinches his snout · 14 "c'mon" · 15 checks his watch · 16 the slow turn and flat stare.
NO REACTION 17 completely still · 18 unbothered sip (exists) · 19 the late sip (exists) · 20 a glance, then
nothing · 21 keeps to his coffee · 22 one slow nod. Use: no-reaction for the biggest fails, shocked on the
impact, annoyed with the verdict line. Name the uploads `reaction-<family>-<nn>-<name>.mp4`, with
`reactions-sheet.jpg` (peak frames) and `REVIEW-README.txt`.

## 10. Unfinished work, in the coordinator's order

1. Reaction pack: assemble, look, upload (section 8).  2. Two "Gator Reacts" episodes — on footage we may use
(section 2, point 10); `reacts.ts` needs its first real run and a look at the panel crop (`REACTION_CROP`) and
the peak times (`PEAK_AT` are guesses).  3. Stop for the owner's review.  4. The remaining reactions and
episodes.  5. Accident v2: look hard at the frames around each mishap; make the replay edit; "needs owner
eyes", never self-approved.  6. The three selfie falls.  7. Stock: 27 approved clips = nine days on
Instagram and TikTok; fourteen days needs fifteen more (about $20 at one take each; three a day costs roughly
$28 a week).  8. One tutorial cut a day per account: merge `integration`, cut the day's tutorial with
`social.ts`, schedule it in the kept-free slot (today's would have been `crm-team-profile`; tomorrow
`crm-team-roles`).  Also: `--reconcile` after tomorrow 07:34 and add the addresses to `posted.txt`.

## 11. Known bugs and traps

- **"undefined" in the schedule table** (fixed, tested): the table read `conceptId` from entries added in the
  same run, before the ledger writer had marked them. It was the printout only — all 46 Blotato posts and
  ledger entries were checked and were right. `clipIdOf` now throws rather than print a row without a clip.
- **Take counter** (fixed earlier): a retake could pay for a third take of a shot that already had two.
- **Queue registration** (fixed): clips made outside `daily.ts` had no state, so nothing could be approved and
  a plain run would have remade the first one. A clip with a `social.json` on disk is now never made again.
- `STYLES.md` / `styles.ts` still list fifteen styles; the new concepts use style 16 (accident v2) and 17
  (reaction and host ingredients, cast fails) without an entry. `docs/gator/CONCEPTS-V2.md` has no pacing note
  from the 56-second reference (not analysed).
- `daily.ts`'s header comment still describes `--approve` as posting; it only approves — `--schedule` posts.
- Blotato answers "in-progress" for ids it does not know; a scheduled post is never moved back to that.
- TikTok's cap is now in code (it was by hand before).
