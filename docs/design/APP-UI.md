# Platform page design — "less is more"

Owner, 2026-10-03, on the signed-in pages: "All these pages are so clunky and not user friendly … Do all of them and
make them flow and look cleaner simpler and better! Less is more … Better design too."

Applies to every signed-in page of the platform (constructhub.us), not the CRM and not the marketing pages.
Theme: `.app-theme` in `client/src/index.css` (brand orange #F97316, Plus Jakarta Sans, warm off-white page, white
cards). Kit: `client/src/components/app-ui.tsx`. Reference page: `client/src/pages/crm-call-assistant/` (header,
tabs, overview).

## The ten rules

1. **One page, one job.** A page answers "what is this and what do I do next" in the first screen on a phone.
2. **One header.** Use `PageHeader`: a title, at most ONE short sentence, and the page's actions with the primary action
   first. No hero banners, no icon tiles beside titles, no repeated intro cards.
3. **One primary action per view.** Exactly one orange (default) button per screen. Everything else is `outline`,
   `ghost`, or tucked in a "More" dropdown (`DropdownMenu`).
4. **Numbers are compact.** Use `StatGrid` and `Stat`: 2 across on a phone, at most 4 on a row on desktop, without
   icons or ALL-CAPS labels. Show the 3–4 numbers that matter. A number that stands for a list links to it (`href`).
5. **Progressive disclosure.** Advanced settings, long explanations, rarely used actions and secondary lists go behind
   an `Accordion`, a "Show more" toggle, a `Sheet`, or a tab. Help text is one line. Use an ⓘ `InfoTip` for the rest.
6. **One card style.** Use `Section` (rounded-xl, hairline border, white). Don't nest cards in cards. Don't put coloured
   backgrounds on whole sections. Use `Notice` for the one message that matters (warning, blocked, needs setup). It is
   one line plus an action, never a paragraph.
7. **Phones first (390 px).** No horizontal page scroll, ever. 16 px side gutters (`AppPage` does it). Inputs and primary
   buttons are full width on phones. Tap targets are at least 40 px. Tables become cards below `sm` (`appTable` +
   `appTableCards`, with `hidden sm:table-cell` on columns that can wait). Tabs scroll sideways (`AppTabsList`), never
   wrap. Filters sit behind one "Filters" button on phones (`Toolbar`).
8. **Calm type.** Page title `text-2xl` (28 px on desktop), section titles `text-base font-semibold`, body `text-sm`.
   Muted text for secondary info. Never more than three type sizes in one card. Sentence case everywhere: no
   ALL-CAPS labels, and no Title Case Buttons ("Add location", not "Add Location(s)").
9. **Colour means something.** Orange means the action. Green, amber and red mean status, used sparingly (`StatusPill`).
   Everything else is ink and grey. No gradients, no rainbow icon tiles, no emoji in UI.
10. **Plain words.** Say what happens ("Connect Porkbun"), not how it works inside ("Connect with identity
    verification"). No jargon in titles. Empty states say what to do next, with one button (`EmptyState`).

## Kit

```tsx
<AppPage width="default">                       // narrow | default | wide
  <PageHeader title="Domains" description="DNS and nameservers for your sites."
              actions={<><Button>Add domain</Button><MoreMenu/></>} meta={<StatusPill tone="success">Synced</StatusPill>} />
  <Notice tone="warning" action={<Button size="sm" variant="outline">Fix</Button>}>Background processing is off.</Notice>
  <StatGrid cols={4}><Stat label="Domains" value={12} href="#list" /> …</StatGrid>
  <Section title="Your domains" actions={<Button variant="outline" size="sm">Sync</Button>} flush>
    <Toolbar search={{ value, onChange, placeholder: "Search domains" }} filters={<Select …/>} activeFilters={n} />
    <table className={appTable.table}>…</table>
  </Section>
</AppPage>
```

`AppTabsList` replaces `TabsList` for page-level tabs. `DetailList` is for key/value facts.

## Don't break

- Keep every `data-testid` that exists today, and keep behaviour, API calls and routes. This is a design pass. If an
  element is removed from view, keep it reachable (in a menu, sheet or accordion) with the same testid. Update an e2e
  spec only when its text expectation changes, and say so in your report.
- No new dependencies. Use the shadcn components in `client/src/components/ui/`.
- `npx tsc --noEmit` must be 0 errors.

## Checklist per page (screenshot at 390×844 and 1440×900, light and dark)

- [ ] The first phone screen shows the title, what to do, and the primary action.
- [ ] No horizontal scroll at 390 (`document.documentElement.scrollWidth <= innerWidth`).
- [ ] One orange button per view, everything else quiet.
- [ ] No ALL-CAPS labels, no paragraph intros, no card-in-card.
- [ ] Tables read as cards on a phone. Tabs don't wrap. Filters are behind "Filters" on a phone.
- [ ] Dark mode reads well.
