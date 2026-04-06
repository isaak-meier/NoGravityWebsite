/**
 * Serves the static site on 0.0.0.0 so other devices on the same Wi‑Fi can open it.
 * Prints IPv4 URLs for this machine (Windows / macOS / Linux).
 */
const { networkInterfaces } = require("node:os");
const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");

const port = Number(process.env.PORT) || 3000;
const root = path.join(__dirname, "..");

console.log("\n  No Gravity — phone / LAN preview\n");
const urls = [];
for (const addrs of Object.values(networkInterfaces())) {
  if (!addrs) continue;
  for (const net of addrs) {
    if (net.family === "IPv4" && !net.internal) {
      const u = `http://${net.address}:${port}`;
      urls.push(u);
      console.log(`  ${u}`);
    }
  }
}
if (urls.length === 0) {
  console.log("  (no LAN IPv4 found — check Wi‑Fi / adapter)");
}
console.log(
  "\n  Use the same Wi‑Fi as this computer. If the page does not load, allow Node.js\n  through Windows Firewall (Private networks) for port " +
    port +
    ".\n"
);
console.log(
  "  iOS Safari: device motion may require HTTPS; use Android Chrome for full tests,\n  or run `npx local-ssl-proxy` / tunnel if motion permission fails.\n"
);

const serveMain = path.join(root, "node_modules", "serve", "build", "main.js");
if (!fs.existsSync(serveMain)) {
  console.error("Install dependencies first: npm install\n");
  process.exit(1);
}

const child = spawn(
  process.execPath,
  [serveMain, "-s", ".", "-l", `tcp://0.0.0.0:${port}`, "--no-port-switching"],
  { stdio: "inherit", cwd: root }
);
child.on("exit", (code) => process.exit(code ?? 0));
