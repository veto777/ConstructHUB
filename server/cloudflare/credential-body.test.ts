import { it, expect, vi } from "vitest";
import { Readable } from "node:stream";
import { credentialBody } from "./credential-body";
it("consumes malformed Global Key JSON without forwarding its body to the error logger", async () => {
  const raw = '{"key":"fixture-secret-never-log", bad';
  const req: any = Readable.from([Buffer.from(raw)]);
  req.method = "POST";
  req.is = () => true;
  req.headers = {
    "content-type": "application/json",
    "content-length": String(Buffer.byteLength(raw)),
  };
  const next = vi.fn();
  let response: any;
  await new Promise<void>((resolve) => {
    const res: any = {
      status(code: number) {
        expect(code).toBe(400);
        return this;
      },
      json(body: any) {
        response = body;
        resolve();
      },
    };
    credentialBody(req, res, next);
  });
  expect(next).not.toHaveBeenCalled();
  expect(JSON.stringify(response)).not.toContain("fixture-secret");
  expect(req.body).toBeUndefined();
});
