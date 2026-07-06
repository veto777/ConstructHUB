export function CHLogo({ height = 36, className = "" }: { height?: number; className?: string }) {
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
        style={{ fontSize: height * 0.35, lineHeight: 1 }}
      >
        ConstructHUB
      </span>
    </div>
  );
}
