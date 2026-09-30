export function CHLogo({ height = 36, className = "" }: { height?: number; className?: string }) {
  // The white wordmark crosses the white gaps between the orange CHUB letters;
  // on a light page it vanished there ("onstruc HUB"). A navy outline keeps
  // every letter legible on white, orange and the dark nav alike.
  const o = Math.max(1, Math.round(height / 40));
  const outline = "#1e2a4a";
  const textShadow = [
    `${-o}px ${-o}px 0 ${outline}`, `${o}px ${-o}px 0 ${outline}`,
    `${-o}px ${o}px 0 ${outline}`, `${o}px ${o}px 0 ${outline}`,
    `0 0 ${o * 2}px rgba(0,0,0,0.45)`,
  ].join(", ");
  return (
    <div className={`relative inline-flex items-center justify-center ${className}`}>
      <img
        src="/chub-logo-trimmed.png"
        alt="CHUB"
        className="object-contain shrink-0"
        style={{ height }}
      />
      <span
        className="absolute inset-0 flex items-center justify-center font-extrabold tracking-tight text-white whitespace-nowrap"
        style={{ fontSize: height * 0.35, lineHeight: 1, textShadow }}
      >
        ConstructHUB
      </span>
    </div>
  );
}
