import { it, expect, describe } from "vitest";
import {
  canConfirmJob,
  canRollbackJob,
  changeImplications,
  changeNeedsEmailWarning,
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
  it("pairs an id-less record with a new value as one changed row", () => {
    // Providers that don't expose record ids (and seeded before/after states)
    // used to diff an edited record as Added + Removed.
    const rows = diffRecords(
      [{ type: "A", name: "www", content: "192.0.2.1", ttl: 600 }],
      [{ type: "A", name: "www", content: "192.0.2.2", ttl: 600 }],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("changed");
    expect(rows[0].before?.content).toBe("192.0.2.1");
    expect(rows[0].after?.content).toBe("192.0.2.2");
  });
  it("keeps true adds and removes apart when names differ", () => {
    const rows = diffRecords(
      [{ type: "A", name: "www", content: "192.0.2.1" }],
      [{ type: "A", name: "mail", content: "192.0.2.2" }],
    );
    expect(rows.map((r) => r.status).sort()).toEqual(["added", "removed"]);
  });
  it("pairs only as many id-less rows as exist on both sides", () => {
    const rows = diffRecords(
      [
        { type: "TXT", name: "@", content: "a" },
        { type: "TXT", name: "@", content: "b" },
      ],
      [{ type: "TXT", name: "@", content: "c" }],
    );
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.status === "changed")).toHaveLength(1);
    expect(rows.filter((r) => r.status === "removed")).toHaveLength(1);
  });
  it("keeps unmatched id-bearing records as add/remove even with the same name and type", () => {
    // A replaced record (new provider id) is a delete + a create, not an edit.
    const rows = diffRecords(
      [{ id: "301", type: "A", name: "www", content: "192.0.2.1" }],
      [{ id: "302", type: "A", name: "www", content: "192.0.2.2" }],
    );
    expect(rows.map((r) => r.status).sort()).toEqual(["added", "removed"]);
  });
  it("a ttl-only edit is a change, not add+remove", () => {
    const rows = diffRecords(
      [{ id: "9", type: "A", name: "@", content: "192.0.2.1", ttl: 600 }],
      [{ id: "9", type: "A", name: "@", content: "192.0.2.1", ttl: 300 }],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("changed");
  });
  it("scopes same name/type records by provider id, not by name and type", () => {
    // Two TXT records on the same name are common (SPF, verification, DKIM).
    const multi = [
      { id: "101", type: "TXT", name: "@", content: "v=spf1 -all", ttl: 600, priority: 0 },
      { id: "102", type: "TXT", name: "@", content: "google-site-verification=abc", ttl: 600, priority: 0 },
    ];
    const after = [
      multi[0],
      { ...multi[1], content: "google-site-verification=xyz" },
    ];
    const rows = diffRecords(multi, after);
    expect(rows).toHaveLength(2);
    const changed = rows.find((r) => r.status === "changed");
    expect(changed?.before?.id).toBe("102");
    expect(changed?.after?.id).toBe("102");
    expect(rows.find((r) => r.status === "unchanged")?.before?.id).toBe("101");
  });
  it("keeps records distinct when an edit makes the content identical", () => {
    // After the edit, both records read "a". A name/type match could pair the
    // wrong rows (removed + added, or two unchanged); the ids cannot.
    const multi = [
      { id: "101", type: "TXT", name: "@", content: "a", ttl: 600, priority: 0 },
      { id: "102", type: "TXT", name: "@", content: "b", ttl: 600, priority: 0 },
    ];
    const rows = diffRecords(multi, [
      multi[0],
      { ...multi[1], content: "a" },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.status === "changed")?.before?.id).toBe("102");
    expect(rows.find((r) => r.status === "unchanged")?.before?.id).toBe("101");
  });
  it("reports a second same name/type record as added without touching the first", () => {
    const rows = diffRecords(
      [{ id: "201", type: "MX", name: "@", content: "mx1.example.test", ttl: 600, priority: 10 }],
      [
        { id: "201", type: "MX", name: "@", content: "mx1.example.test", ttl: 600, priority: 10 },
        { type: "MX", name: "@", content: "mx2.example.test", ttl: 600, priority: 20 },
      ],
    );
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.status === "unchanged")?.before?.id).toBe("201");
    const added = rows.find((r) => r.status === "added");
    expect(added?.after?.content).toBe("mx2.example.test");
  });
  it("sorts duplicate name/type rows deterministically", () => {
    const before = [
      { id: "3", type: "TXT", name: "@", content: "c" },
      { id: "1", type: "TXT", name: "@", content: "a" },
      { id: "2", type: "TXT", name: "@", content: "b" },
    ];
    const after = before.map((r) => ({ ...r }));
    const again = diffRecords(before, after.map((r) => ({ ...r })));
    expect(again.map((r) => (r.before ?? r.after)?.id)).toEqual(
      diffRecords(before, after).map((r) => (r.before ?? r.after)?.id),
    );
  });
});

describe("job eligibility helpers", () => {
  it("only ready, unexpired change jobs can be confirmed", () => {
    expect(
      canConfirmJob({ kind: "change", status: "ready", expires_at: null }),
    ).toBe(true);
    expect(
      canConfirmJob({
        kind: "change",
        status: "ready",
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      }),
    ).toBe(true);
    expect(
      canConfirmJob({
        kind: "change",
        status: "ready",
        expires_at: new Date(Date.now() - 60_000).toISOString(),
      }),
    ).toBe(false);
    expect(canConfirmJob({ kind: "change", status: "verifying" })).toBe(false);
    expect(canConfirmJob({ kind: "discover", status: "ready" })).toBe(false);
    expect(canConfirmJob({ kind: "monitor", status: "ready" })).toBe(false);
  });
  it("applied changes can be rolled back regardless of verification state", () => {
    for (const status of [
      "verified",
      "verifying",
      "verification_failed",
      "uncertain",
    ])
      expect(canRollbackJob({ kind: "change", status })).toBe(true);
    expect(canRollbackJob({ kind: "change", status: "ready" })).toBe(false);
    expect(canRollbackJob({ kind: "discover", status: "complete" })).toBe(
      false,
    );
  });
  it("requires the acknowledgement exactly when the server does", () => {
    expect(
      changeNeedsEmailWarning({
        status: "ready",
        payload: { change: { kind: "nameservers", nameservers: ["a.example.test", "b.example.test"] } },
      }),
    ).toBe(true);
    expect(
      changeNeedsEmailWarning({
        status: "ready",
        payload: { change: { kind: "update", record: { id: "9", type: "A", name: "@", content: "192.0.2.1" } } },
      }),
    ).toBe(false);
    // MX -> A still counts: the record being replaced is an MX record.
    expect(
      changeNeedsEmailWarning({
        status: "ready",
        payload: { change: { kind: "update", record: { id: "9", type: "A", name: "@", content: "192.0.2.1" } } },
        before_state: { records: [{ id: "9", type: "MX", name: "@", content: "mail.example.test" }] },
      }),
    ).toBe(true);
    expect(changeNeedsEmailWarning({ status: "ready", payload: {} })).toBe(false);
  });
  it("reads seed-shaped payloads that store the change directly", () => {
    // Seeded history rows keep the change as the payload itself, not payload.change.
    expect(
      changeNeedsEmailWarning({
        status: "ready",
        payload: { kind: "create", record: { type: "TXT", name: "@", content: "x" } },
      }),
    ).toBe(true);
    expect(
      changeNeedsEmailWarning({
        status: "ready",
        payload: { kind: "update", record: { type: "A", name: "@", content: "192.0.2.1" } },
      }),
    ).toBe(false);
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
