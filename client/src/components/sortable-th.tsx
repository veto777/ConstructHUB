import { useCallback, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { crmTable } from "@/components/crm-ui";
import { cn } from "@/lib/utils";

/**
 * Sortable column headers for every CRM list (owner's rule of thumb: the top
 * buttons on every feature let you go ascending ↔ descending, or alphabetical).
 *
 *   const { sort, onSort, sorted } = useTableSort<"name" | "date">("date", "desc", "crm-things");
 *   <SortableTh sortKey="name" label="Name" sort={sort} onSort={onSort} />
 *   …
 *   sorted(rows, { name: (r) => r.name, date: (r) => r.createdAt })
 *
 * Strings sort alphabetically (case/accents ignored), numbers numerically,
 * dates chronologically; empty values always sit at the bottom. The last
 * choice per table is remembered in localStorage (`storageKey`).
 *
 * Server-paged lists use the same hook for the state and headers but hand
 * `sort.key` + `sort.dir` to the API instead of calling `sorted`.
 */

export type SortDir = "asc" | "desc";
export interface SortState<K extends string> { key: K; dir: SortDir }
export type SortValue = string | number | boolean | Date | null | undefined;
export type SortAccessors<T, K extends string> = Partial<Record<K, (row: T) => SortValue>>;

/** Column descriptions for the phone <SortSelect>. `kind` picks the wording of each direction. */
export interface SortColumn<K extends string> {
  key: K;
  label: string;
  kind?: "text" | "number" | "date";
}

const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

const isEmpty = (v: SortValue) =>
  v === null || v === undefined || v === "" || (typeof v === "number" && Number.isNaN(v))
  || (v instanceof Date && Number.isNaN(v.getTime()));

/** Compares two cell values in ascending order. Empty values are "greater" than anything, so they stay last. */
export function compareSortValues(a: SortValue, b: SortValue): number {
  const ea = isEmpty(a);
  const eb = isEmpty(b);
  if (ea && eb) return 0;
  if (ea) return 1;
  if (eb) return -1;
  if (a instanceof Date || b instanceof Date) {
    return (a instanceof Date ? a.getTime() : new Date(String(a)).getTime())
      - (b instanceof Date ? b.getTime() : new Date(String(b)).getTime());
  }
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
  return collator.compare(String(a), String(b));
}

/** A sorted copy of `rows` (stable; the original order is kept among equals; empties last either way). */
export function sortRows<T, K extends string>(rows: readonly T[], accessors: SortAccessors<T, K>, sort: SortState<K>): T[] {
  const get = accessors[sort.key];
  if (!get) return [...rows];
  const sign = sort.dir === "desc" ? -1 : 1;
  return rows
    .map((row, i) => ({ row, i, v: get(row) }))
    .sort((x, y) => {
      const ex = isEmpty(x.v);
      const ey = isEmpty(y.v);
      // Empties sit at the bottom in both directions.
      if (ex || ey) return ex && ey ? x.i - y.i : ex ? 1 : -1;
      const c = compareSortValues(x.v, y.v) * sign;
      return c !== 0 ? c : x.i - y.i;
    })
    .map((x) => x.row);
}

const STORAGE_PREFIX = "crm-sort:";

function readStored<K extends string>(storageKey: string | undefined): SortState<K> | null {
  if (!storageKey) return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + storageKey);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (p && typeof p.key === "string" && (p.dir === "asc" || p.dir === "desc")) return { key: p.key as K, dir: p.dir };
  } catch { /* private mode / blocked storage — fall back to the default */ }
  return null;
}

function writeStored<K extends string>(storageKey: string | undefined, s: SortState<K>) {
  if (!storageKey) return;
  try { window.localStorage.setItem(STORAGE_PREFIX + storageKey, JSON.stringify(s)); } catch { /* ignore */ }
}

/**
 * Sort state for one table. Clicking a header the first time sorts ascending
 * (A→Z, oldest, smallest — or `firstDir` when the column says otherwise);
 * clicking the same header again flips the direction.
 */
export function useTableSort<K extends string>(defaultKey: K, defaultDir: SortDir = "asc", storageKey?: string, opts: {
  /** The keys a stored choice may name (a renamed column never leaves the table unsorted). */
  keys?: readonly K[];
  /** An explicit starting choice (from the URL, say) that beats the stored one. */
  initial?: SortState<K> | null;
} = {}) {
  const [sort, setSortState] = useState<SortState<K>>(() => {
    if (opts.initial) return opts.initial;
    const stored = readStored<K>(storageKey);
    if (stored && (!opts.keys || opts.keys.includes(stored.key))) return stored;
    return { key: defaultKey, dir: defaultDir };
  });
  const setSort = useCallback((next: SortState<K>) => {
    setSortState(next);
    writeStored(storageKey, next);
  }, [storageKey]);
  const onSort = useCallback((key: K, firstDir: SortDir = "asc") => {
    setSortState((prev) => {
      const next: SortState<K> = prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: firstDir };
      writeStored(storageKey, next);
      return next;
    });
  }, [storageKey]);
  const sorted = useCallback(<T,>(rows: readonly T[], accessors: SortAccessors<T, K>) => sortRows(rows, accessors, sort), [sort]);
  return useMemo(() => ({ sort, setSort, onSort, sorted }), [sort, setSort, onSort, sorted]);
}

const ariaSort = (active: boolean, dir: SortDir): "ascending" | "descending" | "none" =>
  active ? (dir === "asc" ? "ascending" : "descending") : "none";

/** A `<th>` in the crmTable style whose label is a button that sorts the column. */
export function SortableTh<K extends string>({
  sortKey, label, sort, onSort, align = "left", firstDir, className, testId, children,
}: {
  sortKey: K;
  label: React.ReactNode;
  sort: SortState<K>;
  onSort: (key: K, firstDir?: SortDir) => void;
  align?: "left" | "right";
  /** Direction of the FIRST click on this column (dates and amounts often want newest/largest first). */
  firstDir?: SortDir;
  className?: string;
  testId?: string;
  /** Extra content beside the button (a hint icon, say). */
  children?: React.ReactNode;
}) {
  const active = sort.key === sortKey;
  const Icon = !active ? ChevronsUpDown : sort.dir === "asc" ? ChevronUp : ChevronDown;
  const text = typeof label === "string" ? label : undefined;
  return (
    <th
      className={cn(align === "right" ? crmTable.thRight : crmTable.th, className)}
      aria-sort={ariaSort(active, sort.dir)}
      scope="col"
    >
      <button
        type="button"
        onClick={() => onSort(sortKey, firstDir)}
        className={cn(
          "group -mx-1 inline-flex items-center gap-0.5 whitespace-nowrap rounded px-1 py-0.5 text-left font-medium",
          "hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          active ? "text-foreground" : "text-muted-foreground",
          align === "right" && "flex-row-reverse",
        )}
        aria-label={text ? `Sort by ${text}${active ? `, ${sort.dir === "asc" ? "ascending" : "descending"}` : ""}` : undefined}
        aria-pressed={active}
        data-testid={testId ?? `sort-${sortKey}`}
        data-sort-dir={active ? sort.dir : undefined}
      >
        <span>{label}</span>
        <Icon className={cn("h-3.5 w-3.5 shrink-0", active ? "opacity-100" : "opacity-40 group-hover:opacity-80")} aria-hidden="true" />
      </button>
      {children}
    </th>
  );
}

const DIR_WORDS: Record<NonNullable<SortColumn<string>["kind"]>, [string, string]> = {
  text: ["A → Z", "Z → A"],
  number: ["low → high", "high → low"],
  date: ["oldest first", "newest first"],
};

/** The <SortSelect> options: every column in both directions. */
export function sortOptions<K extends string>(columns: readonly SortColumn<K>[]): { value: string; label: string; state: SortState<K> }[] {
  return columns.flatMap((c) => {
    const [up, down] = DIR_WORDS[c.kind ?? "text"];
    return [
      { value: `${c.key}:asc`, label: `${c.label} · ${up}`, state: { key: c.key, dir: "asc" as const } },
      { value: `${c.key}:desc`, label: `${c.label} · ${down}`, state: { key: c.key, dir: "desc" as const } },
    ];
  });
}

/**
 * A compact "Sort" dropdown for the card layouts (headers are hidden below
 * `sm`) and for lists that are not tables. Pass `className="sm:hidden"` to
 * show it only where the column headers are not.
 */
export function SortSelect<K extends string>({ columns, sort, onChange, className, testId = "select-sort", label = "Sort" }: {
  columns: readonly SortColumn<K>[];
  sort: SortState<K>;
  onChange: (s: SortState<K>) => void;
  className?: string;
  testId?: string;
  label?: string;
}) {
  const options = useMemo(() => sortOptions(columns), [columns]);
  const value = `${sort.key}:${sort.dir}`;
  const known = options.some((o) => o.value === value);
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</span>
      <Select value={known ? value : undefined} onValueChange={(v) => { const o = options.find((x) => x.value === v); if (o) onChange(o.state); }}>
        <SelectTrigger className="h-9 w-auto min-w-[11rem] max-w-full bg-card" aria-label={label} data-testid={testId}>
          <SelectValue placeholder="Choose…" />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

/**
 * Sort buttons for lists that are not tables (card stacks): one toggle per
 * column, the active one shows its direction. Below `sm` it becomes the
 * <SortSelect> so five buttons never wrap into a wall on a phone.
 */
export function SortButtons<K extends string>({ columns, sort, onSort, onChange, className, testId = "sort-buttons", label = "Sort" }: {
  columns: readonly SortColumn<K>[];
  sort: SortState<K>;
  onSort: (key: K, firstDir?: SortDir) => void;
  onChange: (s: SortState<K>) => void;
  className?: string;
  testId?: string;
  label?: string;
}) {
  return (
    <>
      <SortSelect columns={columns} sort={sort} onChange={onChange} className={cn("sm:hidden", className)} testId={`${testId}-select`} label={label} />
      <div className={cn("hidden flex-wrap items-center gap-1 sm:flex", className)} role="group" aria-label={label} data-testid={testId}>
        <span className="mr-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</span>
        {columns.map((c) => {
          const active = sort.key === c.key;
          const Icon = !active ? ChevronsUpDown : sort.dir === "asc" ? ChevronUp : ChevronDown;
          return (
            <button
              key={c.key}
              type="button"
              onClick={() => onSort(c.key)}
              aria-pressed={active}
              aria-label={`Sort by ${c.label}${active ? `, ${sort.dir === "asc" ? "ascending" : "descending"}` : ""}`}
              data-testid={`${testId}-${c.key}`}
              data-sort-dir={active ? sort.dir : undefined}
              className={cn(
                "inline-flex h-8 items-center gap-0.5 rounded-md border px-2.5 text-xs font-medium transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active ? "border-primary/40 bg-primary/10 text-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground",
              )}
            >
              {c.label}
              <Icon className={cn("h-3.5 w-3.5", active ? "opacity-100" : "opacity-50")} aria-hidden="true" />
            </button>
          );
        })}
      </div>
    </>
  );
}
