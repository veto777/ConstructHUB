// piexifjs ships no type declarations. Minimal ambient module declaration so
// the EXIF read/insert calls in photo-processor.ts type-check.
declare module "piexifjs" {
  export const version: string;
  export function load(jpegData: string): any;
  export function dump(exifObj: any): string;
  export function insert(exifBytes: string, jpegData: string): string;
  export function remove(jpegData: string): string;
  export const ImageIFD: Record<string, number>;
  export const ExifIFD: Record<string, number>;
  export const GPSIFD: Record<string, number>;
  const piexif: {
    version: string;
    load: typeof load;
    dump: typeof dump;
    insert: typeof insert;
    remove: typeof remove;
    ImageIFD: Record<string, number>;
    ExifIFD: Record<string, number>;
    GPSIFD: Record<string, number>;
  };
  export default piexif;
}
