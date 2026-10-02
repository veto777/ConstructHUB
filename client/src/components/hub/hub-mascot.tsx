import { GabeAvatar } from "@/components/mascot";

/**
 * Gabe, the ConstructHUB assistant: the headset-wearing gator (owner's artwork,
 * see GabeAvatar in components/mascot.tsx), circle-cropped on a cream disc
 * inside the widget's orange ring. Built to read at 56px (launcher button) and
 * 48px (chat header).
 *
 *   <HubMascot />                               56px, idle (still)
 *   <HubMascot size={48} state="talking" />     a small nod while a reply lands
 *   <HubMascot size={48} state="thinking" />    orange three-dot badge + a soft ring pulse
 *   <button aria-label="Ask Gabe"><HubMascot decorative /></button>
 *
 * Motion is a few lines of CSS scoped to `hubm-` class names and switches off
 * under prefers-reduced-motion (the thinking dots then sit still, but stay).
 */

export type HubMascotState = "idle" | "talking" | "thinking";

export type HubMascotProps = {
  /** Rendered width/height in px, ring included. Default 56. */
  size?: number;
  /** idle = still, talking = nod, thinking = dots badge + ring pulse. */
  state?: HubMascotState;
  className?: string;
  /** Hide from assistive tech when the parent (e.g. the launcher button) already has a label. */
  decorative?: boolean;
  label?: string;
};

const ORANGE = "#F1592F";
const CREAM = "#FFF1E6";

const CSS = `
.hubm{position:relative;display:inline-block;flex:none;line-height:0}
.hubm-disc{display:block;box-sizing:border-box;width:100%;height:100%;overflow:hidden;border-radius:9999px;background:${CREAM};border:var(--hubm-ring) solid ${ORANGE}}
.hubm-disc img{display:block}
.hubm[data-state=talking] .hubm-disc img{animation:hubm-nod 1.2s ease-in-out infinite}
.hubm[data-state=thinking] .hubm-disc{animation:hubm-pulse 1.4s ease-in-out infinite}
.hubm-dots{position:absolute;right:-3px;bottom:-2px;display:flex;gap:2px;padding:3px;border-radius:9999px;background:#fff;border:1.5px solid ${ORANGE}}
.hubm-dots i{display:block;width:3px;height:3px;border-radius:50%;background:${ORANGE};animation:hubm-dot 1.2s ease-in-out infinite}
.hubm-dots i:nth-child(2){animation-delay:.2s}
.hubm-dots i:nth-child(3){animation-delay:.4s}
@keyframes hubm-nod{0%,100%{transform:translateY(0) rotate(0)}50%{transform:translateY(1.5px) rotate(-2deg)}}
@keyframes hubm-pulse{0%,100%{box-shadow:0 0 0 0 rgba(241,89,47,.55)}60%{box-shadow:0 0 0 5px rgba(241,89,47,0)}}
@keyframes hubm-dot{0%,100%{opacity:.3}40%{opacity:1}}
@media (prefers-reduced-motion:reduce){.hubm .hubm-disc,.hubm img,.hubm-dots i{animation:none!important}}
`;

export default function HubMascot({
  size = 56,
  state = "idle",
  className,
  decorative = false,
  label = "Gabe, the ConstructHUB assistant",
}: HubMascotProps) {
  const ring = size >= 56 ? 3 : 2;
  return (
    <span
      className={className ? `hubm ${className}` : "hubm"}
      style={{ width: size, height: size, ["--hubm-ring" as string]: `${ring}px` }}
      {...(decorative ? { "aria-hidden": true } : { role: "img", "aria-label": label })}
      data-state={state}
    >
      <style>{CSS}</style>
      <span className="hubm-disc">
        <GabeAvatar size={size - ring * 2} />
      </span>
      {state === "thinking" && (
        <span className="hubm-dots" aria-hidden="true">
          <i /><i /><i />
        </span>
      )}
    </span>
  );
}
