# Real fail clips for "Gator Reacts" — how to get footage we may use

"Gator Reacts" (`scripts/gator/reacts.ts`) puts the gator's reactions over fail clips. The tool takes a clip
only with a rights record of one of four kinds — **own-ai**, **owner**, **licensed**, **cc-by** — and refuses
everything else. It has no way to take somebody else's video without a licence, and no step that removes,
crops out or covers another creator's watermark. Two reasons, both practical:

- A compilation on YouTube is its uploader's edit of **other people's** clips. Reposting those clips on a
  business account is the use their owners license for money (below); stripping a watermark from one removes
  the mark that says whose it is, which is its own legal problem on top of the copying.
- Our accounts are days old and already rate-limited once. The agencies below run automated matching and file
  takedowns for a living; a strike on a new TikTok or Instagram account costs reach for everything else we post.

**Update 2026-10-08 (afternoon), the owner's order.** The owner ordered episodes from two YouTube compilations
(`youtu.be/4HmTgOLTQsE`, `youtu.be/kF_a7SNAMPc`) after the risks above were explained to him three times ("Do what I
am asking you to do!"). `reacts.ts` now has a fifth rights kind, **third-party**, accepted ONLY with the CLI flag
`--owner-accepted-risk` AND an `ownerAcceptedRisk` record (who, date, his words) in the episode file — never by
default. It still has **no step that removes, crops out or covers a watermark or handle**: the coordinator declined
that part (it hides whose clip it is, which is a separate wrong from the copying), so the panel is placed away from
the marks and every caption credits the channel. Episodes ep01–ep05 are built this way and wait for the owner's
review; ep06 uses our own AI clips only. None goes to YouTube. Everything below still holds as the safe route.

Read on 2026-10-08. **Prices marked "quote" are not published — ask before budgeting.** Where a figure comes
from a press article rather than the vendor's own price list, it says so.

## 1. Our own AI-generated fails — free to use, available today

The animal cast in found-footage one-shots (`fx-*`, `acc-*` in `scripts/gator/concepts-live.ts`): about
**$0.72 per five-second fail** (still + video at today's Higgsfield prices), ours outright, AI-labelled.
An eight-fail, 50-second episode costs about **$6** in generation. Episode 1 is built from these.

## 2. The owner's and his crews' own clips — the best real footage there is

Phone clips from his own jobs (a load that got away, a tarp in the wind, the new guy and the nail gun). He owns
them; anyone identifiable in them should have said yes. Rights kind `owner`, the record says who filmed it and
that they agreed. **Question for the owner: does he, or do his crews, have any?**

## 3. Viral-video licensing agencies — the clips in those compilations, properly

These companies represent the people who filmed the viral clips and license them to brands and publishers.

| Agency | What it is | Brand use on social | Price |
| --- | --- | --- | --- |
| Jukin Media / TMB (Trusted Media Brands) | The largest library of user-generated "fail" clips (FailArmy is theirs) | Yes, under a commercial licence | A self-service tier was announced in 2020 at **$49** (watermarked, one channel, not monetised), **$99** (clean, one channel) and **$299** (clean, all channels) per clip — figures from the trade press at the time ([Tubefilter, 2020](https://tubefilter.com/2020/08/11/jukin-launches-self-service-platform-allowing-anyone-to-license-its-viral-videos-starting-at-50/)); check whether those tiers still exist and whether "brand advertising" is inside them. Otherwise quote. |
| ViralHog | Viral clips licensed to media and brands; pays the filmer half | Yes, by licence | Quote |
| Newsflare | UK-based marketplace of user video; brand licences offered | Yes, by licence | Quote (press reports put typical licence fees in the tens to low hundreds of pounds per clip) |
| Storyful | News-and-brand licensing of verified social video | Yes, by licence | Quote (enterprise) |
| Caters | UK news agency with viral video | Editorial first; brand use by negotiation | Quote |

**What eight licensed clips for one 60-second episode would cost:** on the 2020 Jukin tiers, 8 × $99 = **about
$790** for one channel or 8 × $299 = **about $2,400** for all channels — per episode. Treat that as the order
of magnitude until an agency quotes; a monthly or bundle deal is the thing to ask for. A licence from the
agency is also what makes it legitimate to receive the clip **clean, without the watermark**.

## 4. Stock libraries — cheap, but mostly staged

| Library | Model | Brand use on social | Price |
| --- | --- | --- | --- |
| Storyblocks | Unlimited-download subscription | Yes (commercial use is in the standard licence) | Subscription; see their plans page |
| Envato Elements | Unlimited-download subscription | Yes | About **$16.50 a month** on the annual plan as reported by a 2026 review — check the plans page |
| Pond5 | Pay per clip, royalty-free | Yes for "commercial" clips; many real-accident clips are **editorial only** — not for a brand | Per clip; from a few dollars to a few hundred |

Honest note: real, funny, "they walk away" job-site fails are rare on stock sites; what is there is mostly
staged. Clips marked *editorial use only* cannot be used by a business to promote itself.

## 5. YouTube videos under Creative Commons (CC BY)

YouTube lets an uploader mark a video "Creative Commons Attribution"; such a video may be reused, also
commercially, **with credit** ([YouTube Help](https://support.google.com/youtube/answer/2797468)).

- Find them: YouTube search → Filters → Features → *Creative Commons*.
- Verify **per video**: the description's "Licence" line must read "Creative Commons Attribution licence
  (reuse allowed)". "Standard YouTube Licence" means no.
- Beware: an uploader can only license what is theirs. A compilation channel marking other people's clips CC BY
  gives us nothing. Use single clips from the person who filmed them.
- Credit in the caption: title, author, link, "licensed under CC BY". Rights kind `cc-by`; the tool prints the
  attribution into the episode's credits file.

Both videos the owner sent (the 11½-minute compilation and the 56-second Short) are under the Standard YouTube
Licence and are made of other accounts' clips: neither can be used.

## 6. Asking the creator

Most small accounts say yes for a credit. Rights kind `licensed`, the record is the message thread.

> Hi — we run ConstructHUB (construction software). We'd like to use your clip [link] in a short "reacts"
> video on our TikTok and Instagram, with credit to @you in the caption. May we? If yes, could you send the
> original file? Happy to pay $__ for it. Thanks — [name]

## What we recommend

1. Run "Gator Reacts" on our own AI fails now (free, safe, already funny with the animal cast).
2. Ask the owner's crews for their own clips.
3. Get one quote from Jukin/TMB and one from ViralHog for a small monthly bundle; decide on real footage with a
   real number in hand.
