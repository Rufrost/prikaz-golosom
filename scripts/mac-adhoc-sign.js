const { execFileSync } = require("node:child_process");
const path = require("node:path");

// Сертификата Apple нет, поэтому в package.json стоит mac.identity: null и electron-builder
// подпись пропускает. Но он правит Info.plist (имя, NSMicrophoneUsageDescription), и
// исходная ad-hoc подпись Electron от этого ломается: на Apple Silicon неподписанный
// arm64-бинарь не запускается вовсе («приложение повреждено»), а TCC не даёт доступ
// к микрофону. Переподписываем ad-hoc ("-") уже собранный .app — до упаковки в dmg.
exports.default = async function adHocSign(context) {
  if (context.electronPlatformName !== "darwin") return;
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", appPath], { stdio: "inherit" });
};
