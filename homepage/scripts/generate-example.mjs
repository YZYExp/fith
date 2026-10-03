import { chromium } from "playwright";
import { htmlToSvg } from "../../dist/index.js";
import { writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const directory = fileURLToPath(
  new URL("../public/examples/", import.meta.url),
);
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: process.env.CHROMIUM_PATH
    ? [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--single-process",
        "--disable-gpu",
      ]
    : undefined,
});

try {
  const page = await browser.newPage({ viewport: { width: 520, height: 360 } });
  await page.goto(pathToFileURL(`${directory}/card.html`).href);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${directory}/card.png` });
  const svg = await htmlToSvg(
    { page },
    { width: 520, height: 360, fontMode: "outline" },
  );
  await writeFile(`${directory}/card.svg`, svg);
  console.log(
    "Generated card.svg with fitting-html and captured card.png from the source HTML.",
  );
} finally {
  await browser.close();
}
