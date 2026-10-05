import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { SETTINGS_GROUPS, SETTINGS_SECTIONS, sectionVisible } from "./sections";
import type { SettingsSectionId } from "./types";

/**
 * The settings navigation: a grouped left rail ("Me" / "Workspace") from lg
 * up, and below that a single menu button that opens the same groups in a
 * sheet, so a phone or a tablet shows the section content instead of a wall
 * of tabs. The app's own sidebar (14.5rem) is open at md, which leaves a
 * 768–1023px screen under 300px for the section if this rail is open too.
 */
export function SettingsNav({ active, onSelect }: { active: SettingsSectionId; onSelect: (id: SettingsSectionId) => void }) {
  const current = SETTINGS_SECTIONS.find((s) => s.id === active) ?? SETTINGS_SECTIONS[0];
  const [open, setOpen] = useState(false);

  const groups = SETTINGS_GROUPS.map((g) => ({ ...g, sections: SETTINGS_SECTIONS.filter((s) => s.group === g.id && sectionVisible(s.id)) })).filter((g) => g.sections.length);

  return (
    <>
      <nav aria-label="Settings sections" className="hidden lg:block w-56 shrink-0" data-testid="nav-settings">
        {groups.map((g) => (
          <div key={g.id} className="mb-5" data-testid={`nav-settings-group-${g.id}`}>
            <h3 className="px-3 mb-1.5 text-[11px] font-semibold  text-muted-foreground">{g.label}</h3>
            <ul className="space-y-0.5">
              {g.sections.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(s.id)}
                    aria-current={active === s.id ? "page" : undefined}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-left transition-colors ${
                      active === s.id
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    }`}
                    data-testid={`button-settings-tab-${s.id}`}
                  >
                    <s.icon className="h-4 w-4 shrink-0" />
                    {s.label}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className="lg:hidden">
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button variant="outline" className="w-full justify-between h-11" aria-label={`Settings section: ${current.label}. Open menu`} data-testid="button-settings-menu">
              <span className="flex items-center gap-2 min-w-0">
                <current.icon className="h-4 w-4 shrink-0 text-primary" />
                <span className="truncate">{current.label}</span>
              </span>
              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-80 max-w-[85vw] overflow-y-auto" data-testid="sheet-settings-menu">
            <SheetHeader className="text-left">
              <SheetTitle>Account settings</SheetTitle>
              <SheetDescription>Choose a section.</SheetDescription>
            </SheetHeader>
            <nav aria-label="Settings sections" className="mt-4">
              {groups.map((g) => (
                <div key={g.id} className="mb-5">
                  <h3 className="px-3 mb-1.5 text-[11px] font-semibold  text-muted-foreground">{g.label}</h3>
                  <ul className="space-y-0.5">
                    {g.sections.map((s) => (
                      <li key={s.id}>
                        <button
                          type="button"
                          onClick={() => { onSelect(s.id); setOpen(false); }}
                          aria-current={active === s.id ? "page" : undefined}
                          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-left transition-colors ${
                            active === s.id ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                          }`}
                          data-testid={`button-settings-menu-${s.id}`}
                        >
                          <s.icon className="h-4 w-4 shrink-0" />
                          {s.label}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </nav>
          </SheetContent>
        </Sheet>
      </div>
    </>
  );
}
