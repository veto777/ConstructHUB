import { useId } from "react";

/**
 * "Hub", the ConstructHUB assistant: a friendly cartoon construction worker
 * drawn as one inline SVG (no images, no extra packages). Built to read at
 * 56px (launcher button) and ~96px (chat header).
 *
 *   <HubMascot />                              56px, idle (smiles and waves)
 *   <HubMascot size={96} state="talking" />    chat header while a reply streams
 *   <HubMascot state="thinking" />             waiting on the model
 *   <button aria-label="Ask Hub"><HubMascot decorative /></button>
 *
 * Motion (gentle bob, wave, blink, talking mouth, thinking dots) is pure CSS
 * scoped to `hubm-` class names and switches off under prefers-reduced-motion.
 */

export type HubMascotState = "idle" | "talking" | "thinking";

export type HubMascotProps = {
  /** Rendered width/height in px (or any CSS length). Default 56. */
  size?: number | string;
  /** idle = smile + wave, talking = mouth moves, thinking = eyes up, hand to chin, dots. */
  state?: HubMascotState;
  className?: string;
  /** Bob/wave/blink/talk animation. Always off under prefers-reduced-motion. */
  animated?: boolean;
  /** Round cream badge behind the character. Turn off to place him on your own surface. */
  background?: boolean;
  /** Hide from assistive tech when the parent (e.g. the launcher button) already has a label. */
  decorative?: boolean;
  label?: string;
};

const ORANGE = "#F1592F";
const ORANGE_DARK = "#D2441E";
const SLATE = "#3F4650";
const SLATE_DARK = "#2E343C";
const SKIN = "#F7C9A0";
const SKIN_SHADE = "#E9AE82";
const VEST = "#D7EE3A";
const CREAM = "#FFF1E6";
const BLUSH = "#FF8B73";

const CSS = `
.hubm-bob{animation:hubm-bob 3.2s ease-in-out infinite}
.hubm-wave{transform-box:fill-box;transform-origin:50% 100%;animation:hubm-wave 4.8s ease-in-out infinite}
.hubm-blink{transform-box:fill-box;transform-origin:50% 50%;animation:hubm-blink 5.5s infinite}
.hubm-talk{transform-box:fill-box;transform-origin:50% 0%;animation:hubm-talk .32s ease-in-out infinite alternate}
.hubm-dot{animation:hubm-dot 1.2s ease-in-out infinite}
.hubm-dot2{animation-delay:.3s}
@keyframes hubm-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-1.6px)}}
@keyframes hubm-wave{0%,40%,100%{transform:rotate(0)}48%{transform:rotate(9deg)}56%{transform:rotate(-11deg)}64%{transform:rotate(8deg)}72%{transform:rotate(-6deg)}80%{transform:rotate(0)}}
@keyframes hubm-blink{0%,92%,100%{transform:scaleY(1)}95%{transform:scaleY(.1)}}
@keyframes hubm-talk{from{transform:scaleY(1)}to{transform:scaleY(.45)}}
@keyframes hubm-dot{0%,100%{opacity:.35}50%{opacity:1}}
@media (prefers-reduced-motion: reduce){.hubm-bob,.hubm-wave,.hubm-blink,.hubm-talk,.hubm-dot{animation:none!important}}
`;

export default function HubMascot({
  size = 56,
  state = "idle",
  className,
  animated = true,
  background = true,
  decorative = false,
  label = "Hub, the ConstructHUB assistant",
}: HubMascotProps) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const clipId = `hubm-clip-${uid}`;
  const a = (cls: string) => (animated ? cls : undefined);

  const thinking = state === "thinking";
  const talking = state === "talking";

  return (
    <svg
      viewBox="0 0 120 120"
      width={size}
      height={size}
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      {...(decorative ? { "aria-hidden": true, focusable: "false" } : { role: "img", "aria-label": label })}
      data-state={state}
    >
      {animated && <style>{CSS}</style>}
      <defs>
        <clipPath id={clipId}>
          <circle cx="60" cy="60" r={background ? 57 : 60} />
        </clipPath>
      </defs>

      {background && <circle cx="60" cy="60" r="58" fill={CREAM} stroke={ORANGE} strokeWidth="4" />}

      <g clipPath={`url(#${clipId})`}>
        {/* character drawn on a 120 grid, scaled up so the face carries at 56px */}
        <g transform="translate(60 74) scale(1.13) translate(-60 -74)">
          <g className={a("hubm-bob")}>
            {/* torso: slate shirt, hi-vis vest with reflective bands */}
            <path d="M16 132c0-22 17-35 44-35s44 13 44 35z" fill={SLATE} />
            <path d="M17 132c0-20 13-31.5 34-34.5L58 132z" fill={VEST} />
            <path d="M103 132c0-20-13-31.5-34-34.5L62 132z" fill={VEST} />
            <path d="M21 104h31.3l1 4.6H19.4z" fill="#F4F6F8" />
            <path d="M99 104H67.7l-1 4.6h33.9z" fill="#F4F6F8" />
            {/* neck + collar */}
            <rect x="53" y="84" width="14" height="14" rx="5" fill={SKIN_SHADE} />
            <path d="M51 97l9 7.5 9-7.5" fill="none" stroke={SLATE_DARK} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />

            {/* ears */}
            <circle cx="34.5" cy="67" r="5" fill={SKIN_SHADE} />
            <circle cx="85.5" cy="67" r="5" fill={SKIN_SHADE} />
            {/* face */}
            <ellipse cx="60" cy="65.5" rx="26.5" ry="25.5" fill={SKIN} />
            {/* sideburns */}
            <path d="M34.6 56h6.2v5.2c-2.4 0-4.6-1-6-2.6z" fill={SLATE} />
            <path d="M85.4 56h-6.2v5.2c2.4 0 4.6-1 6-2.6z" fill={SLATE} />

            {/* brows */}
            {thinking && (
              <>
                <path d="M46.8 59.8q3.6-2.6 7.2-.6" fill="none" stroke={SLATE} strokeWidth="2" strokeLinecap="round" />
                <path d="M66.8 58.4q3.6-3 7.2-.8" fill="none" stroke={SLATE} strokeWidth="2" strokeLinecap="round" />
              </>
            )}

            {/* eyes */}
            <g className={thinking ? undefined : a("hubm-blink")}>
              <ellipse cx={thinking ? 51.2 : 50} cy={thinking ? 65 : 67} rx="3.7" ry="4.7" fill={SLATE_DARK} />
              <ellipse cx={thinking ? 71.2 : 70} cy={thinking ? 65 : 67} rx="3.7" ry="4.7" fill={SLATE_DARK} />
              <circle cx={thinking ? 52.6 : 51.3} cy={thinking ? 62.6 : 65.2} r="1.5" fill="#fff" />
              <circle cx={thinking ? 72.6 : 71.3} cy={thinking ? 62.6 : 65.2} r="1.5" fill="#fff" />
            </g>

            {/* nose + cheeks */}
            <ellipse cx="60" cy="72.3" rx="2.4" ry="1.7" fill={SKIN_SHADE} />
            <ellipse cx="42" cy="75.5" rx="4.6" ry="3" fill={BLUSH} opacity=".45" />
            <ellipse cx="78" cy="75.5" rx="4.6" ry="3" fill={BLUSH} opacity=".45" />

            {/* mouth */}
            {state === "idle" && (
              <path d="M53.5 77q6.5 6 13 0" fill="none" stroke={SLATE_DARK} strokeWidth="2.6" strokeLinecap="round" />
            )}
            {talking && (
              <g className={a("hubm-talk")}>
                <path d="M53 76.2h14q0 9-7 9t-7-9z" fill={SLATE_DARK} />
                <ellipse cx="60" cy="82.4" rx="3.6" ry="2" fill={BLUSH} />
              </g>
            )}
            {thinking && (
              <ellipse cx="58.6" cy="79.6" rx="2.3" ry="2.7" fill={SLATE_DARK} />
            )}

            {/* hard hat */}
            <path d="M33 53c0-17.5 11.5-30 27-30s27 12.5 27 30z" fill={ORANGE} />
            <path d="M56 23.5c1.4-.3 6.6-.3 8 0L65.8 53H54.2z" fill={ORANGE_DARK} />
            <path d="M39.5 45.5c0-8.5 4-14.5 9.5-18" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" opacity=".5" />
            <rect x="26" y="50" width="68" height="8.5" rx="4.25" fill={ORANGE} />
            <rect x="26" y="55" width="68" height="3.5" rx="1.75" fill={ORANGE_DARK} />

            {/* waving hand */}
            {state === "idle" && (
              <g className={a("hubm-wave")}>
                <path d="M89 112l3-16" stroke={SLATE} strokeWidth="9.5" strokeLinecap="round" />
                <g stroke={SKIN} strokeWidth="4.2" strokeLinecap="round">
                  <path d="M88.6 83.5l-1.4-6.6" />
                  <path d="M92.6 82.5V75" />
                  <path d="M96.4 83.5l1.8-6.2" />
                  <path d="M87.6 88.5l-4.2-3" />
                </g>
                <circle cx="92.4" cy="87.4" r="6.4" fill={SKIN} />
                <path d="M89.6 90.6q2.8 1.6 5.6 0" fill="none" stroke={SKIN_SHADE} strokeWidth="1.4" strokeLinecap="round" />
              </g>
            )}

            {/* thinking: knuckles to the chin */}
            {thinking && (
              <g>
                <path d="M92 128L76.5 97" stroke={SLATE} strokeWidth="9.5" strokeLinecap="round" />
                <circle cx="73" cy="91" r="6.3" fill={SKIN} />
                <path d="M68.6 88.8q2-1.2 4 0M68.8 92.2q2-1.2 4 0" fill="none" stroke={SKIN_SHADE} strokeWidth="1.3" strokeLinecap="round" />
              </g>
            )}
          </g>
        </g>

        {thinking && (
          <g fill={SLATE}>
            <circle className={a("hubm-dot")} cx="93" cy="39" r="2" />
            <circle className={a("hubm-dot hubm-dot2")} cx="98.5" cy="31.5" r="2.8" />
          </g>
        )}
      </g>
    </svg>
  );
}
