// The photos an owner attaches to a review request by upload or from the Media Library. Each is shown on the
// customer's public review page as an image and a download link, so only this platform's own stored files are
// accepted: never a data:, javascript: or outside address.
const FILE_URL = /^\/api\/files\/[A-Za-z0-9._\/-]+$/;

export type ReviewRequestPhoto = { url: string; originalName: string };

/** The attached photos as stored, or null when any entry is not one of the platform's stored files. */
export function cleanReviewPhotos(input: unknown): ReviewRequestPhoto[] | null {
  if (input == null) return [];
  if (!Array.isArray(input)) return null;
  const out: ReviewRequestPhoto[] = [];
  for (const p of input) {
    const url = p && typeof p === "object" ? (p as any).url : null;
    if (typeof url !== "string" || url.length > 500 || !FILE_URL.test(url) || url.includes("..") || url.includes("//")) return null;
    const name = (p as any).originalName;
    out.push({ url, originalName: typeof name === "string" ? name.slice(0, 200) : "photo" });
  }
  return out;
}
