const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const distDir = path.join(__dirname, "..", "dist");
const files = fs.readdirSync(distDir).filter((f) => f.endsWith(".exe"));

if (files.length === 0) {
  console.log("В dist/ нет .exe файлов — сначала запустите npm run dist.");
  process.exit(0);
}

for (const file of files) {
  const filePath = path.join(distDir, file);
  const hash = crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
  const outPath = `${filePath}.sha256`;
  fs.writeFileSync(outPath, `${hash}  ${file}\n`);
  console.log(`${file}.sha256 -> ${hash}`);
}
