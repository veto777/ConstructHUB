/**
 * Capture metadata from the file itself (the source of truth; device values
 * from the client are the fallback): EXIF GPS + DateTimeOriginal for photos
 * via sharp's raw EXIF buffer + piexifjs, and ffprobe for videos (duration,
 * dimensions, codec, rotation, creation_time, the QuickTime ISO 6709 location
 * iPhones write). Nothing here guesses — a missing value stays null.
 */
import { execFile } from "child_process";
import sharp from "sharp";
import piexif from "piexifjs";

export type ImageMeta = {
  width: number | null;
  height: number | null;
  orientation: number | null;
  format: string | null;
  capturedAt: Date | null;
  lat: number | null;
  lng: number | null;
  exif: Record<string, unknown> | null;
};

const num = (v: unknown): number | null => {
  if (Array.isArray(v) && v.length === 2 && Number(v[1]) !== 0) return Number(v[0]) / Number(v[1]);
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return null;
};

/** [[d,1],[m,1],[s,100]] + "N"/"S" → signed decimal degrees. */
export function dmsToDecimal(dms: unknown, ref: unknown): number | null {
  if (!Array.isArray(dms) || dms.length < 3) return null;
  const d = num(dms[0]), m = num(dms[1]), s = num(dms[2]);
  if (d === null || m === null || s === null) return null;
  const v = d + m / 60 + s / 3600;
  if (!Number.isFinite(v)) return null;
  const r = String(ref ?? "").toUpperCase();
  return r === "S" || r === "W" ? -v : v;
}

/** "YYYY:MM:DD HH:MM:SS" (+ optional "+05:00" EXIF 2.31 offset) → Date, or null. */
export function parseExifDate(raw: unknown, offset?: unknown): Date | null {
  if (typeof raw !== "string") return null;
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(raw.trim());
  if (!m) return null;
  const off = typeof offset === "string" && /^[+-]\d{2}:\d{2}$/.test(offset.trim()) ? offset.trim() : "";
  // Without an offset EXIF time is the camera's local wall clock; we keep it as
  // UTC wall time rather than invent a zone (the client's own timestamp wins
  // when it has one — see routes.ts resolveCapturedAt).
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${off || "Z"}`;
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d : null;
}

export async function readImageMeta(filePath: string): Promise<ImageMeta> {
  const meta = await sharp(filePath, { failOn: "none" }).metadata();
  const out: ImageMeta = {
    width: meta.width ?? null, height: meta.height ?? null,
    orientation: meta.orientation ?? null, format: meta.format ?? null,
    capturedAt: null, lat: null, lng: null, exif: null,
  };
  if (meta.exif && meta.exif.length > 8) {
    try {
      const raw = meta.exif.toString("binary");
      // sharp hands back the segment starting with "Exif\0\0"; piexif wants exactly that.
      const dict = piexif.load(raw.startsWith("Exif") ? raw : `Exif\0\0${raw}`);
      const g = dict?.GPS ?? {};
      const e = dict?.Exif ?? {};
      const z = dict?.["0th"] ?? {};
      out.lat = dmsToDecimal(g[piexif.GPSIFD.GPSLatitude], g[piexif.GPSIFD.GPSLatitudeRef]);
      out.lng = dmsToDecimal(g[piexif.GPSIFD.GPSLongitude], g[piexif.GPSIFD.GPSLongitudeRef]);
      out.capturedAt = parseExifDate(e[piexif.ExifIFD.DateTimeOriginal], e[36881]) // OffsetTimeOriginal
        ?? parseExifDate(e[piexif.ExifIFD.DateTimeDigitized]) ?? parseExifDate(z[piexif.ImageIFD.DateTime]);
      out.exif = {
        make: z[piexif.ImageIFD.Make] ?? null,
        model: z[piexif.ImageIFD.Model] ?? null,
        software: z[piexif.ImageIFD.Software] ?? null,
        dateTimeOriginal: e[piexif.ExifIFD.DateTimeOriginal] ?? null,
        offsetTimeOriginal: e[36881] ?? null,
        orientation: meta.orientation ?? null,
        gpsAltitude: num(g[piexif.GPSIFD.GPSAltitude]),
      };
    } catch {
      // Unparseable EXIF is not an error: the photo is still a photo.
    }
  }
  // Swap for EXIF orientations that rotate 90° — the displayed size.
  if (out.orientation && out.orientation >= 5 && out.width && out.height) {
    [out.width, out.height] = [out.height, out.width];
  }
  return out;
}

export type VideoMeta = {
  durationS: number | null;
  width: number | null;
  height: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  container: string | null;
  rotation: number;
  capturedAt: Date | null;
  lat: number | null;
  lng: number | null;
  /** Browser-playable as-is (H.264/VP8/VP9/AV1 in MP4/WebM with AAC/Opus/none). */
  playable: boolean;
};

/** "+37.1234-122.1234+010.000/" (ISO 6709, QuickTime) → lat/lng. */
export function parseIso6709(raw: unknown): { lat: number; lng: number } | null {
  if (typeof raw !== "string") return null;
  const m = /^([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)/.exec(raw.trim());
  if (!m) return null;
  const lat = Number(m[1]), lng = Number(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

export function ffprobeJson(filePath: string): Promise<any> {
  return new Promise((resolve, reject) => {
    execFile("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", filePath],
      { maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
        if (err) return reject(err);
        try { resolve(JSON.parse(stdout)); } catch (e) { reject(e); }
      });
  });
}

export function videoMetaFromProbe(probe: any): VideoMeta {
  const streams: any[] = Array.isArray(probe?.streams) ? probe.streams : [];
  const v = streams.find((s) => s.codec_type === "video");
  const a = streams.find((s) => s.codec_type === "audio");
  const fmt = probe?.format ?? {};
  const tags = { ...(fmt.tags ?? {}), ...(v?.tags ?? {}) };
  let rotation = 0;
  const sd = Array.isArray(v?.side_data_list) ? v.side_data_list.find((s: any) => typeof s.rotation === "number") : null;
  if (sd) rotation = Math.abs(Number(sd.rotation)) % 360;
  else if (tags.rotate) rotation = Math.abs(Number(tags.rotate)) % 360;
  let width = v?.width ?? null, height = v?.height ?? null;
  if (rotation === 90 || rotation === 270) [width, height] = [height, width];
  const duration = Number(fmt.duration ?? v?.duration);
  const formatName = String(fmt.format_name ?? "");
  const container = /mp4|mov|m4a|3gp|3g2|mj2/.test(formatName) ? (/quicktime|mov/.test(String(fmt.format_long_name ?? "").toLowerCase()) ? "mov" : "mp4")
    : /webm|matroska/.test(formatName) ? (formatName.includes("webm") ? "webm" : "mkv") : formatName || null;
  const videoCodec = v?.codec_name ?? null;
  const audioCodec = a?.codec_name ?? null;
  const loc = parseIso6709(tags["com.apple.quicktime.location.ISO6709"] ?? tags.location ?? tags["location-eng"]);
  const created = tags.creation_time ? new Date(tags.creation_time) : null;
  const playableVideo = ["h264", "vp8", "vp9", "av1"].includes(String(videoCodec));
  const playableAudio = !a || ["aac", "opus", "vorbis", "mp3"].includes(String(audioCodec));
  const playableContainer = container === "mp4" || container === "webm";
  return {
    durationS: Number.isFinite(duration) ? duration : null,
    width, height, videoCodec, audioCodec, container, rotation,
    capturedAt: created && Number.isFinite(created.getTime()) ? created : null,
    lat: loc?.lat ?? null, lng: loc?.lng ?? null,
    playable: playableVideo && playableAudio && playableContainer,
  };
}

export async function readVideoMeta(filePath: string): Promise<VideoMeta> {
  return videoMetaFromProbe(await ffprobeJson(filePath));
}
