import { it, expect, describe } from "vitest";
import {
  changeImplications,
  diffNameservers,
  diffRecords,
} from "./dns-diff";

describe("diffRecords", () => {
  const before = [
    { id: "1", type: "A", name: "@", content: "192.0.2.1", ttl: 600, priority: 0 },
    { id: "2", type: "MX", name: "@", content: "mail.example.test", ttl: 600, priority: 10 },
    { id: "3", type: "TXT", name: "@", content: "v=spf1 -all", ttl: 600, priority: 0 },
  ];
  it("labels added, removed, changed and unchanged rows", () => {
    const after = [
      { id: "1", type: "A", name: "@", content: "192.0.2.2", ttl: 600, priority: 0 },
      { id: "3", type: "TXT", name: "@", content: "v=spf1 -all", ttl: 600, priority: 0 },
      { id: "4", type: "CNAME", name: "www", content: "example.test", ttl: 300, priority: 0 },
    ];
    const rows = diffRecords(before, after);
    const by = (key: string) => rows.find((r) => (r.before ?? r.after)?.id === key);
    expect(by("1")?.status).toBe("changed");
    expect(by("2")?.status).toBe("removed");
    expect(by("3")?.status).toBe("unchanged");
    expect(by("4")?.status).toBe("added");
  });
  it("matches identical before/after as all unchanged", () => {
    expect(
      diffRecords(before, before.map((r) => ({ ...r }))).every(
        (r) => r.status === "unchanged",
      ),
    ).toBe(true);
  });
  it("treats an empty after as all removed", () => {
    const rows = diffRecords(before, []);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.status === "removed")).toBe(true);
  });
  it("matches records without provider ids by type/name/content", () => {
    const rows = diffRecords(
      [{ type: "A", name: "@", content: "192.0.2.1" }],
      [{ type: "A", name: "@", content: "192.0.2.1" }],
    );
    expect(rows[0].status).toBe("unchanged");
  });
  it("a ttl-only edit is a change, not add+remove", () => {
    const rows = diffRecords(
      [{ id: "9", type: "A", name: "@", content: "192.0.2.1", ttl: 600 }],
      [{ id: "9", type: "A", name: "@", content: "192.0.2.1", ttl: 300 }],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("changed");
  });
});

describe("diffNameservers", () => {
  it("is case- and dot-insensitive and reports both directions", () => {
    const d = diffNameservers(
      ["NS1.Example.TEST.", "ns2.example.test"],
      ["ns1.example.test", "ns3.example.test."],
    );
    expect(d.added).toEqual(["ns3.example.test."]);
    expect(d.removed).toEqual(["ns2.example.test"]);
  });
  it("reports no changes for the same set", () => {
    expect(
      diffNameservers(["a.example.test"], ["A.example.test."]),
    ).toEqual({ added: [], removed: [] });
  });
});

describe("changeImplications", () => {
  it("warns for MX, TXT, CNAME and nameserver changes", () => {
    const mx = changeImplications(
      [{ status: "changed", before: { type: "MX", name: "@", content: "a" }, after: { type: "MX", name: "@", content: "b" } }],
      { added: [], removed: [] },
    );
    expect(mx.join(" ")).toContain("MX");
    const ns = changeImplications([], { added: ["ns1.example.test"], removed: [] });
    expect(ns.join(" ")).toContain("Nameserver");
    const txt = changeImplications(
      [{ status: "added", after: { type: "TXT", name: "@", content: "x" } }],
      { added: [], removed: [] },
    );
    expect(txt.join(" ")).toContain("TXT");
  });
  it("stays silent for A-only changes", () => {
    expect(
      changeImplications(
        [{ status: "added", after: { type: "A", name: "@", content: "192.0.2.1" } }],
        { added: [], removed: [] },
      ),
    ).toEqual([]);
  });
});
