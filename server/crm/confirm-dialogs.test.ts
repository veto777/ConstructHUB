/**
 * The CRM asks before destructive actions in the product's own dialog
 * (client/src/components/confirm-dialog.tsx), never a native browser one:
 * window.confirm can't explain itself and is suppressed inside some web views
 * (the iPhone app shell), where the action then silently never runs.
 *
 * Source guard — pure, no server or database.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const SRC = path.resolve(import.meta.dirname, "../../client/src");

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : /\.tsx?$/.test(e.name) ? [p] : [];
  });
}
const rel = (p: string) => path.relative(SRC, p).split(path.sep).join("/");
const isCrm = (r: string) =>
  /^pages\/crm-/.test(r) || /^components\/crm-/.test(r) || /^(pages|components)\/jobcam\//.test(r) ||
  r === "pages/client-portal.tsx" || r === "pages/public-estimate.tsx" || r === "pages/public-portal.tsx";
/** Comments talk about window.confirm; only code counts. */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const NATIVE = /\b(?:window\.)?(?:confirm|alert|prompt)\s*\(/;
const files = walk(SRC).map((p) => ({ rel: rel(p), text: fs.readFileSync(p, "utf8") }));
const crm = files.filter((f) => isCrm(f.rel));

describe("CRM confirmations use the in-product dialog", () => {
  it("finds the CRM sources", () => {
    expect(crm.length).toBeGreaterThan(30);
  });

  it("no native confirm/alert/prompt anywhere in the CRM", () => {
    const offenders = crm.filter((f) => NATIVE.test(code(f.text))).map((f) => f.rel);
    expect(offenders).toEqual([]);
  });

  it("the host is mounted once at the app root", () => {
    const app = files.find((f) => f.rel === "App.tsx")!.text;
    expect(app.match(/<ConfirmHost\s*\/>/g)?.length).toBe(1);
  });

  it("every confirmAction states what happens, names its button, and carries a test id", () => {
    const calls = crm.flatMap((f) => {
      const out: { where: string; body: string }[] = [];
      const re = /confirmAction\(/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(f.text))) out.push({ where: f.rel, body: f.text.slice(m.index, m.index + 1600) });
      return out;
    });
    expect(calls.length).toBeGreaterThanOrEqual(18);
    for (const c of calls) {
      const first = (key: string) => c.body.match(new RegExp(`\\b${key}:\\s*(.+)`))?.[1] ?? "";
      expect(first("id"), `${c.where}: id`).toMatch(/^"[a-z0-9-]+",/);
      expect(first("title"), `${c.where}: title`).not.toBe("");
      expect(first("confirmLabel"), `${c.where}: confirmLabel`).not.toMatch(/^"(OK|Ok|Yes|Confirm)"/);
      expect(first("confirmLabel"), `${c.where}: confirmLabel`).not.toBe("");
      // A real sentence, not a restated title.
      expect(first("description").length, `${c.where}: description`).toBeGreaterThan(40);
      expect(c.body, `${c.where}: onConfirm`).toMatch(/\bonConfirm:\s*\(\)\s*=>/);
    }
  });

  it("the dialog exposes confirm/cancel test ids and a destructive confirm button", () => {
    const host = files.find((f) => f.rel === "components/confirm-dialog.tsx")!.text;
    expect(host).toContain("data-testid={`dialog-confirm-${options.id}`}");
    expect(host).toContain("data-testid={`button-confirm-${options.id}`}");
    expect(host).toContain("data-testid={`button-cancel-${options.id}`}");
    expect(host).toContain('buttonVariants({ variant: "destructive" })');
    expect(host).toContain("AlertDialogCancel");
  });
});
