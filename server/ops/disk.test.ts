/**
 * The free-disk watch (server/ops/disk.ts; reliability review C1): a reading under the warning line is said in the
 * log and recorded on the issue desk (critical under half the line); a healthy reading records nothing.
 */
import { describe, expect, it } from "vitest";
import { DISK_WARN_FREE_GB, describeDisk, diskStatus } from "./disk";

const GB = 1024 ** 3;
const volume = (freeGb: number, totalGb = 492) => async () => ({ bavail: BigInt(Math.round(freeGb * GB / 4096)), blocks: BigInt(Math.round(totalGb * GB / 4096)), bsize: 4096 });

describe("diskStatus", () => {
  it("reads free and total space in GB and flags the warning and critical lines", async () => {
    const fine = await diskStatus("/data", volume(120));
    expect(fine).toMatchObject({ ok: true, path: "/data", freeGb: 120, totalGb: 492, warn: false, critical: false, thresholdGb: DISK_WARN_FREE_GB });
    const low = await diskStatus("/data", volume(DISK_WARN_FREE_GB - 1));
    expect(low).toMatchObject({ ok: true, warn: true, critical: false });
    const crit = await diskStatus("/data", volume(DISK_WARN_FREE_GB / 2 - 0.5));
    expect(crit).toMatchObject({ ok: true, warn: true, critical: true });
    expect(describeDisk(low)).toBe(`${DISK_WARN_FREE_GB - 1} GB free of 492 GB on the volume holding /data — under the ${DISK_WARN_FREE_GB} GB warning line`);
    expect(describeDisk(fine)).not.toContain("warning line");
  });

  it("an unreadable volume is reported, never thrown, and never a warning", async () => {
    const s = await diskStatus("/nope", async () => { throw new Error("ENOENT"); });
    expect(s).toMatchObject({ ok: false, warn: false, critical: false, error: "ENOENT" });
    expect(describeDisk(s)).toContain("could not be read: ENOENT");
  });
});
