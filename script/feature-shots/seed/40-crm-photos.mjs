// Drawn (flat-illustration) roofing job-site pictures for the 40-crm.sql JobCam rows. Sample art, no real photos.
// Writes the lane server's local JobCam store: tmp/jobcam/jobcam/<org>/<media id>/{original,display,thumb}.jpg
//   node script/feature-shots/seed/40-crm-photos.mjs
import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";

const ORG = "40000000-0000-4000-8000-000000000001";
const W = 1600, H = 1200;
const sky = (c1 = "#bcdcf2", c2 = "#e8f3fb") => `<defs><linearGradient id="sk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs><rect width="${W}" height="${H}" fill="url(#sk)"/>`;
const mountains = `<polygon points="0,560 220,400 380,500 560,360 780,520 980,380 1200,520 1400,420 1600,540 1600,640 0,640" fill="#9fb4c6"/><polygon points="520,380 560,360 600,385 575,392" fill="#fff"/><polygon points="950,395 980,380 1010,398" fill="#fff"/>`;
// shingle rows clipped to a polygon
function shingles(clipId, poly, { y0, y1, rowH = 34, tab = 60, colors = ["#5b5f66", "#4c5057", "#646971", "#55595f"], missing = [], hail = [] }) {
  let s = `<clipPath id="${clipId}"><polygon points="${poly}"/></clipPath><g clip-path="url(#${clipId})">`;
  let r = 0;
  for (let y = y0; y < y1; y += rowH, r++) {
    for (let x = -tab + ((r % 2) * tab) / 2; x < W; x += tab) {
      const c = colors[(Math.abs(Math.sin(x * 12.9898 + y * 78.233)) * 43758.5453 | 0) % colors.length];
      s += `<rect x="${x}" y="${y}" width="${tab - 3}" height="${rowH - 3}" fill="${c}"/>`;
    }
  }
  for (const [x, y, w, h] of missing) s += `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#c9a77a"/><line x1="${x}" y1="${y + h / 2}" x2="${x + w}" y2="${y + h / 2}" stroke="#a9875c" stroke-width="3"/>`;
  for (const [x, y, rr] of hail) s += `<circle cx="${x}" cy="${y}" r="${rr}" fill="#2f3237" opacity="0.85"/><circle cx="${x - rr / 3}" cy="${y - rr / 3}" r="${rr / 3}" fill="#7d828a" opacity="0.6"/>`;
  return s + `</g>`;
}
const house = (roof) => `${sky()}${mountains}<rect y="980" width="${W}" height="220" fill="#8fb37a"/><rect x="300" y="620" width="1000" height="420" fill="#e9e1d3"/>
  <rect x="420" y="740" width="170" height="150" fill="#9cc3dc" stroke="#fff" stroke-width="12"/><rect x="1010" y="740" width="170" height="150" fill="#9cc3dc" stroke="#fff" stroke-width="12"/><rect x="730" y="780" width="140" height="260" fill="#7a4e2d"/>
  ${roof}<rect x="230" y="626" width="1140" height="18" fill="#f4f4f2"/>`;
const ROOF = "230,630 800,300 1370,630";
const scenes = {
  // 1 Before: worn roof, a few shingles gone
  "before": house(shingles("r1", ROOF, { y0: 290, y1: 640, colors: ["#7b6f63", "#6f645a", "#857a6d", "#746a5f"], missing: [[640, 470, 110, 32], [930, 540, 90, 32], [1080, 580, 70, 30]] })),
  // 2 Hail damage close-up with chalk circle
  "hail": `<rect width="${W}" height="${H}" fill="#555"/>` + shingles("r2", `0,0 ${W},0 ${W},${H} 0,${H}`, { y0: -20, y1: H, rowH: 90, tab: 170, colors: ["#5d6168", "#565a61", "#62666d"], hail: [[420, 330, 16], [520, 410, 12], [700, 300, 14], [880, 520, 18], [1010, 450, 11], [760, 640, 15], [1180, 700, 13], [520, 820, 17], [980, 860, 12], [300, 640, 14], [1300, 380, 15]] })
    + `<circle cx="760" cy="520" r="260" fill="none" stroke="#f3f3f0" stroke-width="10" stroke-dasharray="40 18"/><text x="1050" y="250" font-family="Arial" font-size="90" font-weight="bold" fill="#f3f3f0">H</text>`,
  // 3 Tear-off: half decking, half old shingles
  "tearoff": house(`<clipPath id="r3"><polygon points="${ROOF}"/></clipPath><g clip-path="url(#r3)"><rect x="0" y="290" width="${W}" height="360" fill="#d2ad7c"/>${Array.from({ length: 12 }, (_, i) => `<line x1="${230 + i * 100}" y1="290" x2="${230 + i * 100}" y2="650" stroke="#b48f5f" stroke-width="4"/>`).join("")}<line x1="0" y1="470" x2="${W}" y2="470" stroke="#b48f5f" stroke-width="4"/></g>`
    + shingles("r3b", "230,630 800,300 800,630", { y0: 290, y1: 640, colors: ["#7b6f63", "#6f645a", "#857a6d"] })),
  // 4 Underlayment going down
  "underlayment": house(`<clipPath id="r4"><polygon points="${ROOF}"/></clipPath><g clip-path="url(#r4)"><rect x="0" y="290" width="${W}" height="360" fill="#d2ad7c"/>${[0, 1, 2, 3].map((i) => `<rect x="0" y="${560 - i * 85}" width="${W}" height="${i === 3 ? 0 : 90}" fill="${i % 2 ? "#3f6f9e" : "#46799f"}"/><line x1="0" y1="${560 - i * 85}" x2="${W}" y2="${560 - i * 85}" stroke="#d9e6f2" stroke-width="4" stroke-dasharray="14 10"/>`).join("")}</g>`),
  // 5 After: new charcoal architectural shingles + ridge cap
  "after": house(shingles("r5", ROOF, { y0: 290, y1: 640, rowH: 30, tab: 52, colors: ["#2f3238", "#3a3e45", "#26292e", "#43474e"] }) + `<polyline points="230,630 800,300 1370,630" fill="none" stroke="#1f2125" stroke-width="16"/>`),
  // 6 New seamless gutter + downspout on a finished roof
  "gutter": house(shingles("r6", ROOF, { y0: 290, y1: 640, rowH: 30, tab: 52, colors: ["#2f3238", "#3a3e45", "#26292e", "#43474e"] }))
    + `<path d="M220,640 L1380,640 L1380,676 Q1376,690 1362,690 L238,690 Q224,690 220,676 Z" fill="#fafaf8" stroke="#cfcfca" stroke-width="5"/>
    <rect x="1290" y="686" width="44" height="354" fill="#fafaf8" stroke="#cfcfca" stroke-width="5"/><rect x="1270" y="1030" width="90" height="30" fill="#fafaf8" stroke="#cfcfca" stroke-width="5"/>`,
  // 7 Materials delivered: shingle bundles on a pallet in the driveway
  "delivery": `${sky()}${mountains}<rect y="640" width="${W}" height="560" fill="#b9b6b0"/><rect x="420" y="980" width="760" height="60" fill="#a37b4f"/>${Array.from({ length: 6 }, (_, r) => Array.from({ length: 4 }, (_, c) => `<rect x="${440 + c * 182}" y="${900 - r * 70}" width="174" height="64" rx="6" fill="${r % 2 ? "#3a3e45" : "#43474e"}" stroke="#2a2d32" stroke-width="4"/><rect x="${440 + c * 182}" y="${920 - r * 70}" width="174" height="14" fill="#c2412d"/>`).join("")).join("")}
    <rect x="1250" y="700" width="300" height="340" fill="#2b5d8a"/><rect x="1250" y="700" width="300" height="40" fill="#24527a"/>`,
  // 8 Chimney step flashing
  "chimney": `${sky()}<clipPath id="ch"><rect x="620" y="140" width="360" height="620"/></clipPath>` + shingles("r8", `0,1200 0,700 ${W},300 ${W},1200`, { y0: 280, y1: H, rowH: 44, tab: 80, colors: ["#2f3238", "#3a3e45", "#43474e"] })
    + `<rect x="620" y="140" width="360" height="620" fill="#9b4a35"/><g clip-path="url(#ch)">${Array.from({ length: 14 }, (_, r) => Array.from({ length: 4 }, (_, c) => `<rect x="${620 + c * 90 + (r % 2) * 45 - 45}" y="${140 + r * 44}" width="86" height="40" fill="${(r + c) % 2 ? "#a7543d" : "#8f4330"}"/>`).join("")).join("")}</g>
    <rect x="600" y="110" width="400" height="40" fill="#7e7f80"/><polygon points="600,640 1000,540 1000,600 600,700" fill="#b9bdc1"/><polygon points="600,700 620,700 620,760 600,780" fill="#b9bdc1"/>`,
};
const media = [
  ["40000000-000d-4000-8000-000000000001", "before"], ["40000000-000d-4000-8000-000000000002", "hail"],
  ["40000000-000d-4000-8000-000000000003", "delivery"], ["40000000-000d-4000-8000-000000000004", "tearoff"],
  ["40000000-000d-4000-8000-000000000005", "underlayment"], ["40000000-000d-4000-8000-000000000006", "after"],
  ["40000000-000d-4000-8000-000000000007", "gutter"], ["40000000-000d-4000-8000-000000000008", "chimney"],
  ["40000000-000d-4000-8000-000000000009", "after"], ["40000000-000d-4000-8000-000000000010", "hail"],
  ["40000000-000d-4000-8000-000000000011", "before"], ["40000000-000d-4000-8000-000000000012", "gutter"],
];
const svg = (inner) => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${inner}</svg>`;
for (const [id, scene] of media) {
  const dir = path.resolve("tmp/jobcam/jobcam", ORG, id);
  fs.mkdirSync(dir, { recursive: true });
  const img = sharp(Buffer.from(svg(scenes[scene])));
  await img.clone().jpeg({ quality: 85 }).toFile(path.join(dir, "original.jpg"));
  await img.clone().resize(1280).jpeg({ quality: 82 }).toFile(path.join(dir, "display.jpg"));
  await img.clone().resize(480).jpeg({ quality: 80 }).toFile(path.join(dir, "thumb.jpg"));
}
console.log(`wrote ${media.length} JobCam pictures under tmp/jobcam/jobcam/${ORG}`);
