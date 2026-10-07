/**
 * The uploader's entry point: the library functions bound to the real
 * database and network. A script imports from here:
 *
 *   import { uploadVideo, setThumbnail } from "../server/youtube";
 *   const { videoId } = await uploadVideo({ filePath, title, description });
 *
 * Tests import ./client directly and pass their own store and fetch.
 */
import * as yt from "./client";
import { youtubeDeps } from "./store";

export { YoutubeError, type UploadVideoInput, type VideoAnalyticsRow } from "./client";
export { youtubeStatus } from "./store";

export const getYoutubeAccessToken = () => yt.getYoutubeAccessToken(youtubeDeps());
/**
 * The company channel's upload. It is counted in the project's daily upload
 * tally (youtube_upload_daily, user 0) that customers' uploads share, so the
 * customer cap leaves room for it — and it is never refused by that tally.
 */
export const uploadVideo = async (input: yt.UploadVideoInput) => {
  const done = await yt.uploadVideo(input, youtubeDeps());
  await import("./customer-store").then((m) => m.noteCompanyUpload()).catch(() => undefined);
  return done;
};
export const setThumbnail = (videoId: string, jpgPath: string) => yt.setThumbnail(videoId, jpgPath, youtubeDeps());
export const uploadCaption = (videoId: string, srtPath: string, language: string) => yt.uploadCaption(videoId, srtPath, language, youtubeDeps());
export const addToPlaylist = (videoId: string, playlistTitle: string, opts?: { privacyStatus?: "private" | "unlisted" | "public" }) =>
  yt.addToPlaylist(videoId, playlistTitle, youtubeDeps(), opts);
export const getChannelAnalytics = (input: { startDate: string; endDate: string }) => yt.getChannelAnalytics(input, youtubeDeps());
