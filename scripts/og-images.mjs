// The link-preview cards (lot acquisition, R10): public/og/{programme,home}-{fr,en}.png, 1200 × 630.
// Typographic only, like a boarding pass: the vault black, ivory, Gravesend Sans, hairlines. No map, no photo, no AI
// image, no orbit mark. Drawn once by the local Chrome (headless); the files are served next to the app (not inlined
// in dist/index.html, which stays one file). Run from the repo:  node scripts/og-images.mjs
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = new URL("../", import.meta.url);
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const font = readFileSync(new URL("src/assets/gravesend-sans-500.woff2", ROOT)).toString("base64");

const CARDS = {
  "programme-fr": { lbl: "Programme partagé", h: "Jour par jour,<br>lieu par lieu.", cells: [["Le programme", "Chaque journée"], ["Les lieux", "Horaires vérifiés"], ["Avec vos dates", "Copiez-le"]] },
  "programme-en": { lbl: "Shared programme", h: "Day by day,<br>place by place.", cells: [["The programme", "Every day"], ["The places", "Hours checked"], ["With your dates", "Copy it"]] },
  "home-fr": { lbl: "Carnet de voyage · préparé par IA", h: "Vos voyages,<br>préparés au détail près.", cells: [["Où et quand", "Une ville, des dates"], ["Chaque journée", "Prête"], ["Chaque lieu", "Vérifié"]] },
  "home-en": { lbl: "Travel notebook · prepared by AI", h: "Your trips,<br>planned to the detail.", cells: [["Where and when", "A city, your dates"], ["Every day", "Ready"], ["Every place", "Checked"]] },
};

const page = (c) => `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family: "Gravesend Sans"; src: url(data:font/woff2;base64,${font}) format("woff2"); font-weight: 500; }
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: 1200px; height: 630px; background: #0a0a0a; color: #f6f2ea; overflow: hidden; }
body { font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; padding: 64px 72px 60px; display: flex; flex-direction: column; }
.top { display: flex; justify-content: space-between; align-items: center; height: 40px; border-bottom: 1px solid rgba(246,242,234,.14); font: 500 17px/1 "Gravesend Sans"; letter-spacing: .22em; text-transform: uppercase; padding-bottom: 18px; }
.top span:last-child { font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; font-size: 15px; letter-spacing: .16em; color: #a7a29a; }
.lbl { margin-top: 56px; font-size: 16px; letter-spacing: .16em; text-transform: uppercase; color: #a7a29a; }
h1 { margin-top: 18px; font: 500 82px/0.95 "Gravesend Sans"; text-transform: uppercase; letter-spacing: 0; }
.row { margin-top: auto; display: grid; grid-template-columns: repeat(3, 1fr); border-top: 1px solid rgba(246,242,234,.26); border-bottom: 1px solid rgba(246,242,234,.26); }
.row div { padding: 16px 0 16px 20px; border-left: 1px solid rgba(246,242,234,.14); }
.row div:first-child { padding-left: 0; border-left: 0; }
.row small { display: block; font-size: 13px; letter-spacing: .16em; text-transform: uppercase; color: #6f6b65; }
.row b { display: block; margin-top: 8px; font-weight: 500; font-size: 22px; }
</style></head><body>
<div class="top"><span>ORBES Trips</span><span>orbesmap.vercel.app</span></div>
<p class="lbl">${c.lbl}</p>
<h1>${c.h}</h1>
<div class="row">${c.cells.map(([a, b]) => `<div><small>${a}</small><b>${b}</b></div>`).join("")}</div>
</body></html>`;

if (!existsSync(CHROME)) {
  console.error(`Chrome not found (${CHROME}); set CHROME=/path/to/chrome`);
  process.exit(1);
}
const out = new URL("public/og/", ROOT);
mkdirSync(out, { recursive: true });
const tmp = mkdtempSync(join(tmpdir(), "orbes-og-"));
for (const [name, c] of Object.entries(CARDS)) {
  const html = join(tmp, `${name}.html`);
  writeFileSync(html, page(c));
  const png = new URL(`${name}.png`, out).pathname;
  execFileSync(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1", "--window-size=1200,630", "--default-background-color=0a0a0aff", `--screenshot=${png}`, `file://${html}`], { stdio: "ignore" });
  console.log(`${name}.png  ${Math.round(statSync(png).size / 1024)} KB`);
}
