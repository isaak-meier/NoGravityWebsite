/**
 * Merge GOOGLE_DRIVE_FOLDER_ID + GOOGLE_API_KEY into src/config/app-config.local.json
 * (same shape as the GitHub Pages deploy workflow).
 *
 * Reads from process.env or .env.local at repo root.
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const configPath = path.join(root, "src/config/app-config.local.json");
const examplePath = path.join(root, "src/config/app-config.local.json.example");
const envLocalPath = path.join(root, ".env.local");

function loadEnvLocal() {
  if (!fs.existsSync(envLocalPath)) return;
  const text = fs.readFileSync(envLocalPath, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] == null || process.env[key] === "") {
      process.env[key] = val;
    }
  }
}

function readConfig() {
  if (fs.existsSync(configPath)) {
    return JSON.parse(fs.readFileSync(configPath, "utf8"));
  }
  if (fs.existsSync(examplePath)) {
    return JSON.parse(fs.readFileSync(examplePath, "utf8"));
  }
  return { googleDrive: { folderId: null, apiKey: null } };
}

loadEnvLocal();

const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID || "";
const apiKey = process.env.GOOGLE_API_KEY || "";

if (!folderId || !apiKey) {
  console.error("[setup:drive] Missing GOOGLE_DRIVE_FOLDER_ID or GOOGLE_API_KEY.");
  console.error("  1. Copy .env.local.example → .env.local");
  console.error("  2. Paste values from GitHub → Settings → Secrets and variables → Actions");
  console.error("  3. Run: npm run setup:drive");
  process.exit(1);
}

const config = readConfig();
config.googleDrive = { folderId, apiKey };
fs.mkdirSync(path.dirname(configPath), { recursive: true });
fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
console.log("[setup:drive] Wrote src/config/app-config.local.json (googleDrive.folderId + apiKey).");
