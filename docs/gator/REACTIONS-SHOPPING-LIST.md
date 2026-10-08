# The viewer reaction pack — shopping list (for when Higgsfield credit is back)

The owner, 2026-10-08: mined clips are "not reactions". **A reaction is ONLY the live gator as a VIEWER**: upright,
head-and-shoulders to waist-up, facing the lens as if watching a screen just off-lens, ONE consistent setting, clean and dry,
hard hat + dark shades + hi-vis vest, at most a prop in one claw; nothing happening TO him; no phone, no selfie arm, no water,
sand, dust or debris, not falling, no other character. The emotion is the only thing going on.

**Reference still (the single source of every shot):** `analysis/gator-shorts/_reactions/REFERENCE-doorbell-clipboard.png`
(1080x1920) = the first frame of `reaction-deadpan-55-doorbell-stare.mp4`, the shot the owner approved ("This is a good one
for reaction - gator with clipboard"). Same gator, same doorway, same framing and light in every reaction, so they all intercut.
(The coordinator's brief said a coffee still; the owner's own words named this one, so this is it.) Honest caveats: it is a
crop of a doorbell-cam frame upscaled to 1080x1920, so it is a little soft, and there is a small fleck of debris under the hat
brim. If the takes come out soft, a one-off clean-up of the still first (nano-banana edit, ~1.5 credits ≈ $0.09: "same
image, sharper, remove the fleck under the hat brim, change nothing else") — then point `VIEWER_STILL` at the cleaned file.

**Model:** Kling 3.0 Standard image-to-video with sound (`kling-video/v3.0/std/image-to-video`, `sound: "on"`, `cfg_scale 0.5`),
the still as `image_url` (uploaded free). Price by `/estimate` on 2026-10-08: **3 s = 6.048 credits = $0.378; 4 s = 8.064
credits = $0.504.** No paid still is needed.

**Ready to run** — the 18 shots are concepts `rv-*` in `scripts/gator/concepts-live.ts` (`viewer(...)`), each animating the
reference still through `stillFile` (new in `make.ts`, the upload is free). The prompt of every one is:
> ONE continuous steady phone take, photorealistic; the camera does not move and the framing does not change. The alligator
> stands upright exactly where he is in front of the doorway, close to the lens, facing it, holding his clipboard in one claw.
> He is watching a screen just below the lens. **‹ACTION›** He does not speak any words. He is the only character; nobody else
> appears; nothing happens to him and nothing else in the scene changes. His yellow hard hat, dark opaque sunglasses and orange
> vest stay on; his eyes are never visible. Never a smile, never a grin, never laughing. No text appears. No music. Sound: **‹SOUND›**

| Family | id (`rv-…`) | ‹ACTION› in short | s | takes | $ |
|---|---|---|---|---|---|
| SHOCKED | shocked-60-jaw-drop | head jerks BACK, jaw drops in an O of alarm (no teeth, no smile), freezes | 3 | 2 | 0.76 |
| | shocked-61-spit-take | raises a coffee cup from below frame, sips, sprays it, recoils, stares | 3 | 2 | 0.76 |
| | shocked-62-flinch | jolts at a bang, clipboard jerks to his chest, "oh!" (no words) | 3 | 2 | 0.76 |
| | shocked-63-double-take | glances, looks away, whips back and freezes | 3 | 2 | 0.76 |
| | shocked-64-hard-hat | claps a claw on top of his hard hat, mouth falls open | 3 | 2 | 0.76 |
| | shocked-65-frozen-sip | cup to his mouth — freezes solid, staring | 3 | 2 | 0.76 |
| | shocked-66-lean-in | leans slowly toward the lens, mouth slightly open, holds | 3 | 2 | 0.76 |
| | shocked-67-drops-clipboard | goes rigid, the clipboard slips out of frame, he never looks down | 3 | 2 | 0.76 |
| ANNOYED | annoyed-70-facepalm | claw flat over snout and shades, head sinks | 3 | 1 | 0.38 |
| | annoyed-71-exhale | head back to the sky, one long breath out | 4 | 1 | 0.50 |
| | annoyed-72-arms-crossed | arms folded over the clipboard, one claw taps | 3 | 1 | 0.38 |
| | annoyed-73-pinch | pinches the bridge of his snout, head bowed | 3 | 1 | 0.38 |
| | annoyed-74-claw-up | throws a claw up, lets it drop | 3 | 1 | 0.38 |
| | annoyed-75-write-up | writes one firm line on the clipboard, looks back up | 3 | 1 | 0.38 |
| | annoyed-76-clipboard-face | raises the clipboard to cover his face, holds | 3 | 1 | 0.38 |
| DEADPAN | deadpan-80-flat-stare | completely still through a crash; tail tip flicks once | 3 | 1 | 0.38 |
| | deadpan-81-slow-nod | one slow nod, "called it" | 3 | 1 | 0.38 |
| | deadpan-82-sandwich | keeps chewing a sandwich (from below frame), unbothered | 4 | 1 | 0.50 |

**Total: 18 reactions, 26 takes = $10.08** (shocked gets two takes each because earlier shocked takes came out reading as
laughing — keep the one that does not). **Budget $12.60 with ~25% retakes.** Under the cap there is $38.62 left; the account
itself must be topped up first (it is at $0). Props that are not in the still (coffee cup: 61, 65; sandwich: 82; pen: 75) are
asked to come "from below the frame" — the likeliest to need a retake.

**Run (when credit is back), then LOOK at every take before using it:**
```
G="npx tsx --env-file=.env.gator scripts/gator/make.ts"
for id in $(grep -o 'viewer("[a-z0-9-]*' scripts/gator/concepts-live.ts | cut -d'"' -f2); do
  case $id in shocked-*) t=2;; *) t=1;; esac; $G rv-$id --videos --takes $t; done
```
Then cut each kept take to 1.5–3 s with its peak at the start (as the `_deliver/reaction-*` files), register it in
`analysis/gator-shorts/_reactions/pack.json`, and re-cut the episodes so every cutaway comes from this one set (the coffee-
by-the-ladder survivors are a second setting; the doorbell set replaces them once it exists).
