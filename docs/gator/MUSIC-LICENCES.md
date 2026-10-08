# Music in the gator clips — sources and licences

Every bed is **CC0 1.0** (the author's public-domain dedication: commercial use allowed, no attribution
required, no Content ID registration expected). Each licence was read on the track's own page on
**2026-10-08**; the files are fetched by `scripts/gator/music.ts` from the addresses below and kept out of git
(`analysis/gator-shorts/_music/`), and the script refuses a file whose SHA-256 is not the one recorded in
`docs/gator/music-checksums.json`. If a page's licence ever changes, the checksum pins what was licensed when
it was taken.

Never: chart music, a meme song, audio lifted from another creator's clip, or a platform's trending sound baked
into our file (the owner adds those in the app, on the `-nomusic` export).

| Id | Title | Author (as listed) | Page | File | Licence | Used for |
| --- | --- | --- | --- | --- | --- | --- |
| `sneaking-around` | Sneaking Around | Umplix | https://opengameart.org/content/sneaking-around | `sneaking_around_.wav` | CC0 1.0 | the set-up bed (default) |
| `robot-factory` | Sneaky Music Pack — Sneaking into the Robot Factory | Umplix | https://opengameart.org/content/sneaky-music-pack | `sneaking_into_the_robot_factory.wav` | CC0 1.0 | set-up |
| `dodging-lights` | Sneaky Music Pack — Dodging Lights | Umplix | https://opengameart.org/content/sneaky-music-pack | `dodging_lights.wav` | CC0 1.0 | set-up |
| `the-drop` | The Drop Soundtrack | Vivis | https://opengameart.org/content/the-drop-soundtrack | `TheDropSong.wav` | CC0 1.0 | the drop |
| `ring-master` | ring master (battle — ring master black) | Bobjt | https://opengameart.org/content/ring-master | `battle - ring master black.mp3` | CC0 1.0 | the drop (default) |
| `rolling-circus` | Rolling Circus | cinameng | https://opengameart.org/content/rolling-circus | `rollingcircus.wav` | CC0 1.0 | goofy replays |
| `childrens-march` | Children's March Theme | CleytonKauffman | https://opengameart.org/content/childrens-march-theme | `Children's March Theme.mp3` | CC0 1.0 | goofy replays |
| `not-clumsy` | 8-bit — I am not clumsy! | HydroGene | https://opengameart.org/content/8-bit-i-am-not-clumsy | `14._i_am_not_clumsy_0.mp3` | CC0 1.0 | goofy replays |

Notes, honestly:

- The author names are the ones the pages' "Author" field showed to an automated read; CC0 needs no credit, so
  a wrong name costs nothing, but check the page before crediting anyone.
- Nobody on the production box can listen. The tracks were chosen by title, licence and length, and the "drop"
  is placed at each track's loudest passage after its first two seconds — **the owner's ear decides whether a
  bed fits a joke**; swapping one is `replay.ts <id> --setup <id> --drop <id>`.
- Not used, and why: FreePD (the service has gone offline), Pixabay Music and the YouTube Audio Library (both
  need a logged-in browser; their licences are fine — tracks from them can be added to `music.ts` by hand with
  their page and checksum), CC-BY tracks (allowed, but every caption would have to carry the credit).
- The Higgsfield catalogue has no music model (checked 2026-10-08: image and video entries only).
- Effects (the impact hit, the rewind scrub, the bass drop, whooshes, bells) are synthesised in
  `scripts/gator/sound.ts` — nothing recorded or sampled.
