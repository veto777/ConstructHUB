/**
 * What the Social Media service needs from whoever publishes for it. Two providers implement it:
 *   NativeClient    (./native.ts)   ConstructHUB Direct: our own Meta / LinkedIn / TikTok / YouTube apps (2026-10-12)
 *   OutstandClient  (./outstand.ts) ConstructHUB's own Outstand account: the customer connects their social accounts
 *                                    through us (OAuth), tagged with their tenant id, and we post on their behalf
 * The queue, schedule, AI writing, approvals and calendar sit above this and do not know which one is in use.
 * Owner, 2026-10-11: "lets add a platform that can be used on the behalf of customers … per post … until we get
 * some users".
 */
export type SocialAccount = { id: string; platform: string; name: string; pages?: { id: string; name: string }[]; boards?: { id: string; name: string }[] };
/** The stored post payload (shared/social.ts postPayload). */
export type PostPayload = {
  post: {
    accountId: string;
    content: { text: string; mediaUrls: string[]; platform: string; additionalPosts?: unknown[] };
    target: Record<string, any>;
  };
  scheduledTime?: string;
};
export type SubmitResult = { submissionId: string };
export type StatusResult = { state: "submitted" | "published" | "failed"; publicUrl: string | null; error: string | null };
export type UploadStart = { presignedUrl: string; contentType?: string; /** Known now (ConstructHUB Direct), or after confirmUpload (Outstand). */ publicUrl: string | null; uploadId?: string };

export interface SocialClient {
  /** Which provider: shown in errors and stored nowhere. */
  readonly provider: "outstand" | "native";
  /** Identifies the connection; a post queued under one connection is never sent through another. */
  readonly hash: string;
  accounts(): Promise<SocialAccount[]>;
  /** Pages (Facebook/LinkedIn/YouTube) or boards (Pinterest) under one account; [] when the network has none. */
  targets(account: SocialAccount): Promise<{ kind: "pages" | "boards"; items: { id: string; name: string }[] } | null>;
  submit(payload: PostPayload, idempotencyKey: string): Promise<SubmitResult>;
  status(submissionId: string): Promise<StatusResult>;
  /** `userId`: the signed-in user (ConstructHUB Direct binds the upload link to them). */
  startUpload(filename: string, userId?: number): Promise<UploadStart>;
  confirmUpload?(uploadId: string): Promise<string>;
}
