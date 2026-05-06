/**
 * One-time local dev bootstrap: copy example files to gitignored paths if missing.
 * Safe to run repeatedly — skips copies when the destination already exists.
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");

function copyIfMissing(relSrc, relDest) {
  const src = path.join(root, relSrc);
  const dest = path.join(root, relDest);
  if (!fs.existsSync(src)) {
    console.warn(`[setup:local] skip — missing source: ${relSrc}`);
    return;
  }
  if (fs.existsSync(dest)) {
    console.log(`[setup:local] exists — skip ${relDest}`);
    return;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  console.log(`[setup:local] created ${relDest}`);
}

copyIfMissing("src/config/app-config.local.json.example", "src/config/app-config.local.json");
copyIfMissing("server/.env.example", "server/.env");
console.log("[setup:local] done. Next: npm install (repo root + server), then npm run dev:all");
