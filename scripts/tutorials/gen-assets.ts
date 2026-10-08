/**
 * The demo FILES a walkthrough uploads (the recorder's `upload` action) — all generated here, by
 * drawing: no stock photo, no real job site, no real company. Re-runnable; the outputs are small
 * and committed, so producing a video never needs this script.
 *
 *   npx tsx scripts/tutorials/gen-assets.ts
 *
 *   assets/photos/site-01.jpg … site-08.jpg   1600×1200 drawn job-site scenes (flat illustration)
 *   assets/clip-floor-walkthrough.mp4         4 s, 1280×720, a slow move across one of them
 *   assets/logo-aspire-interiors.png          the demo company's logo (made up for the demo)
 *   assets/care-guide.pdf                     a one-page brochure
 *   assets/clients-import.csv                 six fictional clients (FL, NY, TX; example.com; 555-01xx)
 *
 * "Clearly generic" is the point: flat shapes, no texture a viewer could take for somebody's house.
 */
import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import sharp from "sharp";
import { fixturePdf } from "../../server/tutorials/fixtures/pdf";

const OUT = path.join(import.meta.dirname, "assets");
const W = 1600, H = 1200;
fs.mkdirSync(path.join(OUT, "photos"), { recursive: true });

/** A floor in perspective: planks running away from the camera, in a few tones of one colour. */
function floor(y0: number, tones: string[], opts: { rows?: number; laidTo?: number; sub?: string } = {}): string {
  const rows = opts.rows ?? 9, vanishX = W * 0.5, parts: string[] = [];
  parts.push(`<rect x="0" y="${y0}" width="${W}" height="${H - y0}" fill="${opts.sub ?? tones[0]}"/>`);
  for (let r = 0; r < rows; r++) {
    // Rows get taller toward the camera.
    const t0 = (r / rows) ** 1.7, t1 = ((r + 1) / rows) ** 1.7;
    const ya = y0 + (H - y0) * t0, yb = y0 + (H - y0) * t1;
    if (opts.laidTo !== undefined && r >= Math.round(rows * opts.laidTo)) continue;
    const boards = 5 + r;
    for (let b = -2; b < boards + 2; b++) {
      const spread = (y: number) => 0.55 + 1.9 * ((y - y0) / (H - y0));
      const xa0 = vanishX + (b - boards / 2) * (W / boards) * spread(ya), xa1 = vanishX + (b + 1 - boards / 2) * (W / boards) * spread(ya);
      const xb0 = vanishX + (b - boards / 2) * (W / boards) * spread(yb), xb1 = vanishX + (b + 1 - boards / 2) * (W / boards) * spread(yb);
      parts.push(`<polygon points="${xa0},${ya} ${xa1},${ya} ${xb1},${yb} ${xb0},${yb}" fill="${tones[(r * 3 + b * 5 + 40) % tones.length]}" stroke="#00000022" stroke-width="2"/>`);
    }
  }
  return parts.join("");
}
const wall = (y0: number, colour: string) => `<rect width="${W}" height="${y0}" fill="${colour}"/><rect y="${y0 - 26}" width="${W}" height="26" fill="#f5f1ea"/><rect y="${y0 - 4}" width="${W}" height="4" fill="#0000001c"/>`;
const windowAt = (x: number, y: number, w: number, h: number) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#f5f1ea"/><rect x="${x + 16}" y="${y + 16}" width="${w - 32}" height="${h - 32}" fill="#cfe6f5"/>`
  + `<rect x="${x + w / 2 - 5}" y="${y + 16}" width="10" height="${h - 32}" fill="#f5f1ea"/><rect x="${x + 16}" y="${y + h / 2 - 5}" width="${w - 32}" height="10" fill="#f5f1ea"/>`;
const WOOD = ["#b98554", "#a9753f", "#c4925f", "#9c6b3a", "#b17f4d"], OAK = ["#d8b98c", "#cdab7a", "#e0c49a", "#c9a572"], PLY = ["#d9c39a", "#d2ba8e", "#dcc8a2"];
const VINYL = ["#8a8f96", "#7d838b", "#959aa1", "#888d94"];

const scenes: Record<string, string> = {
  // 1 — a bare room, plywood subfloor
  "site-01": wall(520, "#dfe5e8") + windowAt(980, 130, 380, 300) + floor(520, PLY, { rows: 5 })
    + `<rect x="180" y="640" width="150" height="240" rx="10" fill="#e9eef1" stroke="#b9c2c8" stroke-width="4"/><rect x="170" y="620" width="170" height="30" rx="8" fill="#c7d0d6"/>`,
  // 2 — hardwood going down: the near half laid, the far half still subfloor
  "site-02": wall(500, "#e4dfd6") + windowAt(240, 120, 340, 290) + floor(500, PLY, { rows: 5 }) + floor(500, WOOD, { laidTo: 0.6 })
    + `<rect x="1080" y="930" width="360" height="46" rx="6" fill="#a9753f"/><rect x="1110" y="884" width="360" height="46" rx="6" fill="#b98554"/><rect x="1060" y="976" width="360" height="46" rx="6" fill="#c4925f"/>`,
  // 3 — the finished floor
  "site-03": wall(500, "#e9e6df") + windowAt(620, 110, 420, 310) + floor(500, WOOD)
    + `<rect x="150" y="300" width="230" height="200" fill="#f5f1ea"/><rect x="150" y="300" width="230" height="200" fill="none" stroke="#d8d2c6" stroke-width="6"/>`,
  // 4 — subway tile backsplash over a counter
  "site-04": `<rect width="${W}" height="${H}" fill="#eef1f2"/>` + (() => {
    const t: string[] = [];
    for (let r = 0; r < 9; r++) for (let c = -1; c < 9; c++) t.push(`<rect x="${c * 200 + (r % 2 ? 100 : 0) + 6}" y="${r * 84 + 6}" width="188" height="72" rx="4" fill="${(r + c) % 5 === 0 ? "#f7f9fa" : "#ffffff"}" stroke="#cfd6da" stroke-width="3"/>`);
    return t.join("");
  })() + `<rect y="760" width="${W}" height="70" fill="#3d4650"/><rect y="830" width="${W}" height="370" fill="#8a6f55"/>`
    + `<rect x="120" y="880" width="420" height="320" fill="#7c634b"/><rect x="590" y="880" width="420" height="320" fill="#7c634b"/><rect x="1060" y="880" width="420" height="320" fill="#7c634b"/>`
    + `<circle cx="500" cy="1030" r="14" fill="#d9dde0"/><circle cx="970" cy="1030" r="14" fill="#d9dde0"/><circle cx="1440" cy="1030" r="14" fill="#d9dde0"/>`,
  // 5 — stair treads
  "site-05": `<rect width="${W}" height="${H}" fill="#e3e0d8"/>` + Array.from({ length: 7 }, (_x, i) => {
    const y = 1050 - i * 140, inset = i * 70;
    return `<rect x="${220 + inset}" y="${y}" width="${1160 - inset * 2}" height="52" fill="${WOOD[i % WOOD.length]}"/><rect x="${220 + inset}" y="${y + 52}" width="${1160 - inset * 2}" height="88" fill="#f5f1ea"/>`;
  }).join("") + `<rect x="150" y="60" width="26" height="1140" fill="#f5f1ea"/>`,
  // 6 — boxes of planks and underlayment, delivered
  "site-06": wall(560, "#d9dee2") + floor(560, VINYL, { rows: 6 })
    + Array.from({ length: 4 }, (_x, i) => `<rect x="${330 + i * 14}" y="${880 - i * 86}" width="560" height="80" rx="6" fill="#c9a36a" stroke="#a37f48" stroke-width="4"/><rect x="${560 + i * 14}" y="${880 - i * 86}" width="90" height="80" fill="#f1e3c6"/>`).join("")
    + `<rect x="1010" y="700" width="170" height="270" rx="85" fill="#4b6b88"/><ellipse cx="1095" cy="700" rx="85" ry="26" fill="#6f8fab"/>`,
  // 7 — light oak, a doorway
  "site-07": wall(520, "#e6ebe4") + `<rect x="640" y="90" width="320" height="430" fill="#f5f1ea"/><rect x="664" y="114" width="272" height="406" fill="#c3ccd1"/>` + floor(520, OAK),
  // 8 — a house front (for a measurement job)
  "site-08": `<rect width="${W}" height="${H}" fill="#cfe6f5"/><rect y="900" width="${W}" height="300" fill="#8fbf7f"/>`
    + `<rect x="330" y="470" width="940" height="460" fill="#e9e2d2"/><polygon points="270,480 800,170 1330,480" fill="#6b5b53"/>`
    + `<rect x="730" y="660" width="150" height="270" fill="#4b6b88"/>` + windowAt(420, 570, 220, 200) + windowAt(960, 570, 220, 200)
    + `<rect x="330" y="900" width="940" height="30" fill="#bdb6a6"/>`,
};

const svg = (inner: string, w = W, h = H) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${inner}</svg>`;

async function main() {
  for (const [name, inner] of Object.entries(scenes))
    await sharp(Buffer.from(svg(inner))).jpeg({ quality: 82, mozjpeg: true }).toFile(path.join(OUT, "photos", `${name}.jpg`));

  // The demo company's logo: a made-up mark (three planks) and its name.
  const logo = svg(`<rect width="640" height="640" rx="96" fill="#1f3a5f"/>
    <g transform="translate(150 150)"><rect x="0" y="40" width="340" height="62" rx="10" fill="#f59e0b"/><rect x="60" y="126" width="280" height="62" rx="10" fill="#fbbf24"/><rect x="0" y="212" width="340" height="62" rx="10" fill="#f59e0b"/></g>
    <text x="320" y="530" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif" font-weight="700" font-size="58" fill="#ffffff">Aspire Interiors</text>`, 640, 640);
  await sharp(Buffer.from(logo)).png({ compressionLevel: 9 }).toFile(path.join(OUT, "logo-aspire-interiors.png"));

  // A short clip: a slow push across the finished floor. Generated from our own drawing.
  const clip = spawnSync("nice", ["-n", "10", "ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-threads", "2", "-loop", "1", "-i", path.join(OUT, "photos", "site-03.jpg"),
    "-vf", "scale=1920:-2,zoompan=z='1.0+0.0012*on':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)+on*0.6':d=120:s=1280x720:fps=30", "-t", "4", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "28", "-an", "-movflags", "+faststart",
    path.join(OUT, "clip-floor-walkthrough.mp4")], { encoding: "utf8" });
  if (clip.status !== 0) throw new Error(`ffmpeg could not make the clip: ${clip.stderr}`);

  fs.writeFileSync(path.join(OUT, "care-guide.pdf"), fixturePdf([
    "Caring for your new floors", "Aspire Interiors - a guide for our clients", "",
    "First week: felt pads under furniture, no wet mopping.", "Every week: sweep or vacuum with a soft head.",
    "Spills: wipe up at once with a damp cloth.", "Sunlight: move rugs now and then so the colour ages evenly.", "",
    "Questions? office@aspireinteriors.example.com  (941) 555-0100",
  ]));

  fs.writeFileSync(path.join(OUT, "clients-import.csv"), [
    "Name,Email,Phone,Address,City,State,Zip,Notes",
    "Marisol Achterberg,marisol.achterberg@example.com,(941) 555-0141,22 Demo Sandpiper Ct,Sarasota,FL,34231,Kitchen floor quote",
    "Devon & Kirra Thistlewood,thistlewoods@example.com,(813) 555-0163,7 Demo Palmetto Loop,Tampa,FL,33606,Whole-house LVP",
    "Okonkwo Family Dental,frontdesk@okonkwodental.example.com,(585) 555-0127,400 Demo Granite Sq Suite 3,Rochester,NY,14607,Waiting room floor",
    "Beatrix Vandermolen,beatrix.vandermolen@example.com,(315) 555-0188,91 Demo Sumac Ter,Syracuse,NY,13210,Stair treads",
    "Joaquin Estrada-Lindholm,joaquin.el@example.com,(817) 555-0152,1508 Demo Mesquite Run,Fort Worth,TX,76107,Backsplash tile",
    "Pemberton Row Lofts,manager@pembertonrow.example.com,(915) 555-0174,60 Demo Cottonwood Pl Unit 2,El Paso,TX,79902,Six units of flooring",
  ].join("\n") + "\n");

  for (const f of fs.readdirSync(OUT, { recursive: true }) as string[]) { const p = path.join(OUT, f); if (fs.statSync(p).isFile()) console.log(`${String(fs.statSync(p).size).padStart(8)}  ${f}`); }
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
