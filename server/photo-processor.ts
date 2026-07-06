import sharp from "sharp";
import path from "path";
import fs from "fs";
import piexif from "piexifjs";

interface WatermarkOptions {
  text: string;
  enabled: boolean;
  imagePath?: string;
  opacity?: number;
  type?: "text" | "image";
}

interface FilterOptions {
  brightness: number;
  contrast: number;
  saturation: number;
}

interface ExifOptions {
  artist?: string;
  copyright?: string;
  description?: string;
  comment?: string;
  title?: string;
  subject?: string;
  keywords?: string[];
  tags?: string;
  rating?: number;
  lat?: number;
  lon?: number;
}

interface ProcessOptions {
  inputPath: string;
  outputPath: string;
  watermark?: WatermarkOptions;
  filters?: FilterOptions;
  exif?: ExifOptions;
  mirror?: boolean;
}

function degreesToDMS(degrees: number): [number, number, number] {
  const d = Math.floor(Math.abs(degrees));
  const minFloat = (Math.abs(degrees) - d) * 60;
  const m = Math.floor(minFloat);
  const s = Math.round((minFloat - m) * 60 * 100) / 100;
  return [d, m, s];
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms);
    promise.then(val => { clearTimeout(timer); resolve(val); }).catch(err => { clearTimeout(timer); reject(err); });
  });
}

export async function processPhoto(options: ProcessOptions): Promise<void> {
  const { inputPath, outputPath, watermark, filters, exif, mirror } = options;

  const normalizedBuf = await withTimeout(
    (mirror ? sharp(inputPath).rotate().flop() : sharp(inputPath).rotate()).toBuffer(),
    20000,
    "Normalizing image orientation"
  );

  const metadata = await withTimeout(sharp(normalizedBuf).metadata(), 15000, "Reading image metadata");
  const origWidth = metadata.width || 1024;
  const origHeight = metadata.height || 768;

  const maxDim = 4096;
  let resizeOpts: { width?: number; height?: number } | undefined;
  if (origWidth > maxDim || origHeight > maxDim) {
    resizeOpts = origWidth > origHeight ? { width: maxDim } : { height: maxDim };
  }

  let pipeline = sharp(normalizedBuf);
  if (resizeOpts) {
    pipeline = pipeline.resize({ ...resizeOpts, fit: "inside", withoutEnlargement: true });
  }

  if (filters) {
    if (filters.brightness !== 1.0 || filters.contrast !== 1.0) {
      const a = filters.contrast;
      const b = (filters.brightness - 1) * 128;
      pipeline = pipeline.linear(a, b);
    }
    if (filters.saturation !== 1.0) {
      pipeline = pipeline.modulate({ saturation: filters.saturation });
    }
  }

  const imgBuf = await withTimeout(pipeline.jpeg({ quality: 92 }).toBuffer(), 30000, "Applying filters");
  const imgMeta = await sharp(imgBuf).metadata();
  const width = imgMeta.width || origWidth;
  const height = imgMeta.height || origHeight;

  let finalPipeline = sharp(imgBuf);

  if (watermark?.enabled) {
    const opacity = Math.min(1, Math.max(0, watermark.opacity ?? 0.85));

    try {
      if (watermark.type === "image" && watermark.imagePath && fs.existsSync(watermark.imagePath)) {
        const maxWmWidth = Math.floor(width * 0.25);
        const maxWmHeight = Math.floor(height * 0.15);

        let wmResized = await withTimeout(
          sharp(watermark.imagePath)
            .resize({ width: maxWmWidth, height: maxWmHeight, fit: "inside", withoutEnlargement: true })
            .ensureAlpha()
            .png()
            .toBuffer(),
          15000,
          "Processing watermark image"
        );

        if (opacity < 1) {
          const wmMeta = await sharp(wmResized).metadata();
          const wmW = wmMeta.width || maxWmWidth;
          const wmH = wmMeta.height || maxWmHeight;
          const opacitySvg = Buffer.from(
            `<svg width="${wmW}" height="${wmH}"><rect width="${wmW}" height="${wmH}" fill="white" opacity="${opacity}"/></svg>`
          );
          wmResized = await sharp(wmResized).composite([{ input: opacitySvg, blend: "dest-in" as const }]).png().toBuffer();
        }

        const wmBuffer = wmResized;
        const wmFinalMeta = await sharp(wmBuffer).metadata();
        const wmFinalW = wmFinalMeta.width || maxWmWidth;
        const wmFinalH = wmFinalMeta.height || maxWmHeight;

        finalPipeline = finalPipeline.composite([{
          input: wmBuffer,
          top: Math.max(0, height - wmFinalH - 20),
          left: Math.max(0, width - wmFinalW - 20),
        }]);
      } else if (watermark.text) {
        const fontSize = Math.max(16, Math.floor(width / 40));
        const padding = Math.floor(fontSize * 0.8);
        const textWidth = watermark.text.length * fontSize * 0.6;
        const bgWidth = Math.floor(textWidth + padding * 2);
        const bgHeight = Math.floor(fontSize * 1.8);
        const bgOpacity = Math.max(0.2, opacity * 0.6);

        const svgOverlay = Buffer.from(`
          <svg width="${width}" height="${height}">
            <rect x="${width - bgWidth - 10}" y="${height - bgHeight - 10}"
                  width="${bgWidth}" height="${bgHeight}"
                  rx="4" ry="4"
                  fill="rgba(0,0,0,${bgOpacity})"/>
            <text x="${width - bgWidth / 2 - 10}" y="${height - bgHeight / 2 - 10 + fontSize * 0.35}"
                  font-family="Arial, sans-serif" font-size="${fontSize}"
                  fill="rgba(255,255,255,${opacity})"
                  text-anchor="middle">${escapeXml(watermark.text)}</text>
          </svg>
        `);

        finalPipeline = finalPipeline.composite([{ input: svgOverlay, top: 0, left: 0 }]);
      }
    } catch (wmErr) {
      console.error("Watermark processing error, continuing without watermark:", wmErr);
    }
  }

  const tempPath = outputPath + ".tmp.jpg";
  await withTimeout(finalPipeline.jpeg({ quality: 92 }).toFile(tempPath), 30000, "Writing output file");

  if (exif) {
    try {
      const jpegData = fs.readFileSync(tempPath);
      const jpegB64 = jpegData.toString("binary");

      const exifObj: any = { "0th": {}, "Exif": {}, "GPS": {}, "1st": {}, "thumbnail": null };

      if (exif.artist) {
        exifObj["0th"][piexif.ImageIFD.Artist] = exif.artist;
      }
      if (exif.copyright) {
        exifObj["0th"][piexif.ImageIFD.Copyright] = exif.copyright;
      }
      if (exif.description) {
        exifObj["0th"][piexif.ImageIFD.ImageDescription] = exif.description;
      }

      const xpString = (s: string) => [...Buffer.from(s + "\0", "utf-16le")];

      if (exif.comment) {
        exifObj["0th"][piexif.ImageIFD.XPComment] = xpString(exif.comment);
        const asciiSafe = exif.comment.replace(/[^\x20-\x7E]/g, "?");
        exifObj["Exif"][piexif.ExifIFD.UserComment] = "ASCII\0\0\0" + asciiSafe;
      }
      if (exif.tags) {
        exifObj["0th"][piexif.ImageIFD.XPKeywords] = xpString(exif.tags);
      }
      if (exif.title) {
        exifObj["0th"][piexif.ImageIFD.XPTitle] = xpString(exif.title);
      }
      if (exif.subject) {
        exifObj["0th"][piexif.ImageIFD.XPSubject] = xpString(exif.subject);
      }
      if (exif.rating != null) {
        exifObj["0th"][piexif.ImageIFD.Rating] = Math.min(5, Math.max(0, exif.rating));
      }

      if (exif.lat != null && exif.lon != null) {
        const latDMS = degreesToDMS(Math.abs(exif.lat));
        const lonDMS = degreesToDMS(Math.abs(exif.lon));
        exifObj["GPS"][piexif.GPSIFD.GPSLatitude] = [[latDMS[0], 1], [latDMS[1], 1], [Math.round(latDMS[2] * 100), 100]];
        exifObj["GPS"][piexif.GPSIFD.GPSLatitudeRef] = exif.lat >= 0 ? "N" : "S";
        exifObj["GPS"][piexif.GPSIFD.GPSLongitude] = [[lonDMS[0], 1], [lonDMS[1], 1], [Math.round(lonDMS[2] * 100), 100]];
        exifObj["GPS"][piexif.GPSIFD.GPSLongitudeRef] = exif.lon >= 0 ? "E" : "W";
      }

      const exifBytes = piexif.dump(exifObj);
      const newJpeg = piexif.insert(exifBytes, jpegB64);
      const newBuffer = Buffer.from(newJpeg, "binary");
      fs.writeFileSync(outputPath, newBuffer);
      fs.unlinkSync(tempPath);
    } catch (exifErr) {
      console.error("EXIF embedding error, falling back:", exifErr);
      fs.renameSync(tempPath, outputPath);
    }
  } else {
    fs.renameSync(tempPath, outputPath);
  }
}

export async function analyzePhoto(inputPath: string): Promise<{ brightness: number; contrast: number; saturation: number }> {
  const { channels } = await withTimeout(sharp(inputPath).resize({ width: 1024, fit: "inside", withoutEnlargement: true }).stats(), 15000, "Analyzing photo");

  const rMean = channels[0]?.mean ?? 128;
  const gMean = channels[1]?.mean ?? 128;
  const bMean = channels[2]?.mean ?? 128;
  const overallMean = (rMean + gMean + bMean) / 3;

  const rStd = channels[0]?.stdev ?? 50;
  const gStd = channels[1]?.stdev ?? 50;
  const bStd = channels[2]?.stdev ?? 50;
  const overallStd = (rStd + gStd + bStd) / 3;

  const rMin = channels[0]?.min ?? 0;
  const gMin = channels[1]?.min ?? 0;
  const bMin = channels[2]?.min ?? 0;
  const rMax = channels[0]?.max ?? 255;
  const gMax = channels[1]?.max ?? 255;
  const bMax = channels[2]?.max ?? 255;

  const dynamicRange = ((rMax - rMin) + (gMax - gMin) + (bMax - bMin)) / 3;

  let brightness = 1.0;
  const targetMean = 130;
  if (overallMean < 90) {
    brightness = Math.min(1.6, targetMean / Math.max(overallMean, 20));
  } else if (overallMean > 180) {
    brightness = Math.max(0.7, targetMean / overallMean);
  } else if (overallMean < 110) {
    brightness = Math.min(1.25, targetMean / overallMean);
  } else if (overallMean > 155) {
    brightness = Math.max(0.85, targetMean / overallMean);
  }

  let contrast = 1.0;
  if (dynamicRange < 120) {
    contrast = Math.min(1.4, 200 / Math.max(dynamicRange, 50));
  } else if (overallStd < 40) {
    contrast = Math.min(1.3, 55 / Math.max(overallStd, 20));
  } else if (overallStd > 80) {
    contrast = Math.max(0.85, 65 / overallStd);
  }

  let saturation = 1.0;
  const colorSpread = Math.abs(rMean - gMean) + Math.abs(gMean - bMean) + Math.abs(rMean - bMean);
  if (colorSpread < 15) {
    saturation = Math.min(1.35, 1.0 + (15 - colorSpread) / 40);
  } else if (colorSpread > 80) {
    saturation = Math.max(0.85, 1.0 - (colorSpread - 80) / 200);
  }

  brightness = Math.round(brightness * 20) / 20;
  contrast = Math.round(contrast * 20) / 20;
  saturation = Math.round(saturation * 20) / 20;

  brightness = Math.max(0.5, Math.min(2.0, brightness));
  contrast = Math.max(0.5, Math.min(2.0, contrast));
  saturation = Math.max(0.5, Math.min(2.0, saturation));

  return { brightness, contrast, saturation };
}

export function generateFileName(
  companyName: string,
  service: string,
  location: string,
  keyword: string,
  index: number
): string {
  const clean = (s: string) =>
    s.replace(/[^a-zA-Z0-9\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .substring(0, 40);

  const parts = [
    clean(companyName),
    clean(service),
    clean(location),
    clean(keyword),
    String(index + 1),
  ].filter(Boolean);

  return parts.join("-") + ".jpg";
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
