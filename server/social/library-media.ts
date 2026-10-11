import { publicMediaUrl } from "../../shared/social";

/** Inline library photos must use the normal provider upload before publishing.
 * Only raster image bytes are accepted; SVG/HTML and arbitrary data URLs are excluded.
 */
export function libraryMedia<T extends { url: string }>(rows: T[]): (T & { requiresUpload?: boolean })[] {
  return rows.flatMap(row => {
    if (publicMediaUrl.safeParse(row.url).success) return [row];
    if (row.url?.length <= 14 * 1024 * 1024 && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(row.url))
      return [{ ...row, requiresUpload: true }];
    return [];
  });
}
