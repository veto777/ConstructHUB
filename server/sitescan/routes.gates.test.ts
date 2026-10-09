import { readFileSync } from "node:fs";
import ts from "typescript";
import { beforeEach, expect, it, vi } from "vitest";
import { z } from "zod";

// Isolate the real registered callbacks from crawler/provider initialization.
const source = readFileSync(new URL("./routes.ts", import.meta.url), "utf8");
const ast = ts.createSourceFile("routes.ts", source, ts.ScriptTarget.Latest, true);
const snippets: string[] = [];
function visit(node: ts.Node) {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === "owner") {
    const [method, path] = node.arguments.map((arg) => ts.isStringLiteral(arg) ? arg.text : "");
    if ((method === "post" && path === "/api/sitescan/branding") || path === "/api/sitescan/jobs/:id/pdf") snippets.push(node.getText(ast) + ";");
  }
  ts.forEachChild(node, visit);
}
visit(ast);
const handlers = new Map<string, (...args: any[]) => Promise<any>>();
const query = vi.fn(), hasModule = vi.fn(), text = vi.fn(), image = vi.fn();
const denied = vi.fn((res, module) => res.status(402).json({ module }));
const doc: any = {};
for (const key of ["pipe", "moveDown", "fontSize", "text", "image", "addPage", "end"]) doc[key] = key === "text" ? text : key === "image" ? image : vi.fn(() => doc);
const js = ts.transpileModule(snippets.join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
new Function("owner", "pool", "hasModule", "sendModuleRequired", "z", "getJob", "PDFDocument", "Buffer", "checklist", "scoreLabel", "psiLines", js)(
  (_method: string, path: string, fn: any) => handlers.set(path, fn), { query }, hasModule, denied, z,
  async () => ({ url: "https://example.com", report: { scores: { overall: 80, categories: {} }, fixes: [], coverage: { notes: [] } } }), function () { return doc; }, Buffer, () => "Checklist", {}, () => [],
);
const response = () => { const res: any = {}; for (const key of ["status", "json", "type", "setHeader"]) res[key] = vi.fn(() => res); return res; };
beforeEach(() => {
  vi.clearAllMocks();
  hasModule.mockResolvedValue(false);
  query.mockResolvedValue({ rows: [{ name: "Saved brand", logo: "data:image/png;base64,AAAA" }] });
  text.mockReturnValue(doc);
  image.mockReturnValue(doc);
});
it("rejects branding saves before writing anything", async () => {
  const res = response();
  await handlers.get("/api/sitescan/branding")!({ body: { name: "New name" } }, res, 1);
  expect(hasModule).toHaveBeenCalledWith(1, "whiteLabel");
  expect(denied).toHaveBeenCalledWith(res, "whiteLabel");
  expect(query).not.toHaveBeenCalled();
});
it("Unlimited can save a name without replacing the stored logo", async () => {
  hasModule.mockResolvedValue(true);
  await handlers.get("/api/sitescan/branding")!({ body: { name: "New name" } }, response(), 1);
  expect(query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO sitescan_branding(user_id,name)"), [1, "New name"]);
});
it.each([false, true])("PDF branding requires whiteLabel=%s; downgrade keeps saved data", async (allowed) => {
  hasModule.mockResolvedValue(allowed);
  await handlers.get("/api/sitescan/jobs/:id/pdf")!({}, response(), 1);
  expect(text).toHaveBeenCalledWith((allowed ? "Saved brand" : "ConstructHUB") + " Site Scan");
  expect(image).toHaveBeenCalledTimes(allowed ? 1 : 0);
  expect(query).toHaveBeenCalledTimes(allowed ? 1 : 0);
  expect(query.mock.calls.some(([sql]) => /DELETE|UPDATE/.test(sql))).toBe(false);
});
