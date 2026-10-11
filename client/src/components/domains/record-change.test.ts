import { describe, expect, it } from "vitest";
import { buildRecordChange, scopedRecordId } from "./record-change";

const form = {
  kind: "update",
  type: "TXT",
  name: "@",
  content: "v=spf1 include:_spf.example.test ~all",
  ttl: 300,
  priority: 0,
};

describe("scopedRecordId", () => {
  it("keeps the picked record id while replacement values are edited", () => {
    expect(
      scopedRecordId({
        recordId: "412",
        recordDomainId: 7,
        selected: [7],
        kind: "update",
      }),
    ).toBe("412");
  });
  it("keeps the id when only the operation changes between update and delete", () => {
    expect(
      scopedRecordId({
        recordId: "412",
        recordDomainId: 7,
        selected: [7],
        kind: "delete",
      }),
    ).toBe("412");
  });
  it("never sends an id for creates", () => {
    expect(
      scopedRecordId({
        recordId: "412",
        recordDomainId: 7,
        selected: [7],
        kind: "create",
      }),
    ).toBe("");
  });
  it("drops the id in bulk mode so it cannot scope other domains", () => {
    expect(
      scopedRecordId({
        recordId: "412",
        recordDomainId: 7,
        selected: [7, 8],
        kind: "update",
      }),
    ).toBe("");
  });
  it("drops the id when the selection moved to another domain", () => {
    expect(
      scopedRecordId({
        recordId: "412",
        recordDomainId: 7,
        selected: [9],
        kind: "update",
      }),
    ).toBe("");
  });
  it("drops the id without a picked domain", () => {
    expect(
      scopedRecordId({
        recordId: "412",
        recordDomainId: null,
        selected: [7],
        kind: "update",
      }),
    ).toBe("");
  });
});

describe("buildRecordChange", () => {
  it("sends the edited values together with the stable record id", () => {
    expect(buildRecordChange(form, "412")).toEqual({
      kind: "update",
      record: {
        id: "412",
        type: "TXT",
        name: "@",
        content: "v=spf1 include:_spf.example.test ~all",
        ttl: 300,
        priority: 0,
      },
    });
  });
  it("sends no id when the identity does not apply", () => {
    expect(buildRecordChange({ ...form, kind: "create" }, "").record).toEqual({
      type: "TXT",
      name: "@",
      content: "v=spf1 include:_spf.example.test ~all",
      ttl: 300,
      priority: 0,
    });
  });
});
