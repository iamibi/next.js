import fs from "node:fs";
import path from "node:path";

// A stand-in for a headless CMS: the published content version is a number in
// a JSON file, shared by `next build`, the ISR page and the API routes.
const DATA_DIR = path.join(process.cwd(), ".data");
const CMS_FILE = path.join(DATA_DIR, "cms.json");
// One line per getStaticProps run, so repro.mjs can tell which renders overlapped.
const RENDERS_FILE = path.join(DATA_DIR, "renders.jsonl");

// Simulated slow render (e.g. more data fetching after the CMS read).
export const RENDER_DELAY_MS = Number(process.env.RENDER_DELAY_MS ?? 3000);

export function readVersion(): number {
  try {
    return JSON.parse(fs.readFileSync(CMS_FILE, "utf8")).version;
  } catch {
    return 1;
  }
}

export function publish(): number {
  const version = readVersion() + 1;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(CMS_FILE, JSON.stringify({ version }));
  return version;
}

export function logRender(render: {
  version: number;
  readAt: number;
  renderedAt: number;
}) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.appendFileSync(RENDERS_FILE, JSON.stringify(render) + "\n");
}
