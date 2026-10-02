/**
 * The ConstructHUB mascots (owner's artwork, client/public/mascot/):
 *
 *   - StandingGator — the full-length gator in a hard hat, hi-vis vest and
 *     work boots, arms crossed. The brand mascot: he stands to the right of
 *     the logo on every sidebar. Decorative, so hidden from screen readers.
 *   - GabeAvatar — "Gabe", the headset-wearing gator who fronts the Hub
 *     assistant widget (client/src/components/hub). Square, transparent, so
 *     it crops cleanly in a circle.
 *
 * Each ships at three pixel sizes; the browser picks by DPR via srcSet.
 *
 * File names carry a version (.v1) — Cloudflare caches image URLs by
 * extension for hours, and it once cached the SPA's HTML fallback for these
 * paths from before they existed. A changed image gets a new version, never
 * the same name.
 */

const STANDING = { 128: "/mascot/gator-standing-128.v1.webp", 256: "/mascot/gator-standing-256.v1.webp", 512: "/mascot/gator-standing-512.v1.webp" } as const;
const GABE = { 160: "/mascot/gabe-160.v1.webp", 320: "/mascot/gabe-320.v1.webp", 640: "/mascot/gabe-640.v1.webp" } as const;

/** The standing gator at a given CSS height (width follows the art's 0.655 ratio). */
export function StandingGator({ height = 64, className = "" }: { height?: number; className?: string }) {
  return (
    <img
      src={STANDING[256]}
      srcSet={`${STANDING[128]} 128w, ${STANDING[256]} 256w, ${STANDING[512]} 512w`}
      sizes={`${Math.round(height * 0.655)}px`}
      alt=""
      aria-hidden="true"
      draggable={false}
      decoding="async"
      width={Math.round(height * 0.655)}
      height={height}
      style={{ height, width: "auto" }}
      className={`select-none pointer-events-none ${className}`}
      data-testid="img-mascot-standing"
    />
  );
}

/** Gabe's head at a given CSS size (square). `alt` names him for assistive tech when the image is meaningful. */
export function GabeAvatar({ size = 48, className = "", alt = "" }: { size?: number; className?: string; alt?: string }) {
  return (
    <img
      src={GABE[320]}
      srcSet={`${GABE[160]} 160w, ${GABE[320]} 320w, ${GABE[640]} 640w`}
      sizes={`${size}px`}
      alt={alt}
      aria-hidden={alt ? undefined : "true"}
      draggable={false}
      decoding="async"
      width={size}
      height={size}
      style={{ width: size, height: size }}
      className={`select-none ${className}`}
      data-testid="img-mascot-gabe"
    />
  );
}
