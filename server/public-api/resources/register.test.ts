/**
 * The assembled resource set: one router per name (writes before reads), the
 * final prefix (/api/v1/<name>, no /growth), and one OpenAPI document where a
 * path shared by a read and a write carries both methods. No DB needed.
 */
import { describe, expect, it } from "vitest";
import { composeResources, registerAllResources } from "./register";
import { READ_RESOURCES } from "./index";
import { writeResources } from "./index-write";
import { buildOpenApiDocument, resourcePath } from "../openapi";
import { registerResource, listResources } from "../registry";
import { API_ERROR_CODES, API_EXTRA_ERROR_CODES } from "../errors";

describe("resource assembly", () => {
  it("composes every read resource and every write route under ONE name each, in read order", () => {
    const entries = composeResources();
    expect(entries.map((e) => e.name)).toEqual(READ_RESOURCES.map((r) => r.name));
    for (const w of writeResources()) expect(entries.map((e) => e.name)).toContain(w.name);
    expect(new Set(entries.map((e) => e.name)).size).toBe(entries.length);
    const seen: string[] = [];
    registerAllResources((name) => { seen.push(name); });
    expect(seen).toEqual(entries.map((e) => e.name));
  });

  it("merges a write route into the read resource's fragment: the same path, both methods, no /growth prefix", () => {
    const byName = Object.fromEntries(composeResources().map((e) => [e.name, e.openapi]));
    expect(Object.keys(byName.locations.paths)).toContain("/{id}/posts");
    expect(Object.keys(byName.reviews.paths)).toContain("/{id}/reply");
    expect(Object.keys(byName["site-scans"].paths)).toContain("/");
    expect(Object.keys(byName["social-posts"].paths)).toContain("/");
    for (const frag of Object.values(byName)) for (const p of Object.keys(frag.paths)) expect(p).not.toMatch(/growth/);
    // Fragment paths may be relative ("/", "/{id}") or already absolute ("/locations/{id}"): both land at /<name>…
    expect(resourcePath("locations", "/")).toBe("/locations");
    expect(resourcePath("locations", "/{id}/posts")).toBe("/locations/{id}/posts");
    expect(resourcePath("locations", "/locations/{id}/posts")).toBe("/locations/{id}/posts");
    expect(resourcePath("site-scans", "")).toBe("/site-scans");
  });

  it("publishes one error vocabulary and one document", () => {
    if (!listResources().some((r) => r.name === "locations")) registerAllResources(registerResource);
    const doc = buildOpenApiDocument() as any;
    const posts = doc.paths["/locations/{id}/posts"];
    expect(Object.keys(posts).sort()).toEqual(["get", "post"]);
    expect(doc.paths["/locations/{locationId}/posts"]).toBeUndefined();
    expect(Object.keys(doc.paths["/reviews/{id}/reply"])).toEqual(["post"]);
    expect(Object.keys(doc.paths["/site-scans"]).sort()).toEqual(["get", "post"]);
    expect(Object.keys(doc.paths["/social-posts"]).sort()).toEqual(["get", "post"]);
    expect(Object.keys(doc.paths).every((p) => !p.includes("/growth/"))).toBe(true);
    const codes = doc.components.schemas.Error.properties.error.properties.code.enum;
    expect(codes).toEqual([...API_ERROR_CODES, ...API_EXTRA_ERROR_CODES]);
    expect(codes).toEqual(expect.arrayContaining(["unauthorized", "invalid_api_key", "insufficient_scope", "validation_error", "not_found", "rate_limited", "quota_exceeded", "plan_required", "internal_error"]));
    expect(doc.components.schemas.ApiError ?? doc.components.schemas.Error).toEqual(doc.components.schemas.Error);
    // Every operation says its scope and its cost, so the Developers page can show both on every row:
    // reads (GET) are "read" and metered per rows, writes are "write" and a flat 5 units (quota.ts).
    for (const [p, item] of Object.entries(doc.paths as Record<string, Record<string, any>>)) {
      for (const [method, op] of Object.entries(item)) {
        const write = method !== "get" && method !== "head";
        expect(op["x-scope"], `${method} ${p}`).toBe(write ? "write" : "read");
        expect(op["x-units"], `${method} ${p}`).toBe(write ? 5 : "1 + 1 per 100 rows");
        expect(op.security, `${method} ${p}`).toEqual([{ apiKey: [write ? "write" : "read"] }]);
      }
    }
    expect(doc.paths["/me"].get["x-scope"]).toBe("read");
    expect(doc["x-limits"].units.read).toBe("1 + 1 per 100 rows");
    // Every response schema reference resolves to a schema the document carries.
    const refs = JSON.stringify(doc).match(/#\/components\/schemas\/[A-Za-z0-9_]+/g) ?? [];
    for (const ref of new Set(refs)) expect(doc.components.schemas[ref.split("/").pop()!], ref).toBeDefined();
  });
});
