const https = require("node:https");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");

const GITHUB_OWNER = "Rufrost";
const GITHUB_REPO = "prikaz-golosom";
const ASSET_NAME_RE = /^prikaz-golosom-portable-.+\.exe$/i;
const USER_AGENT = "prikaz-golosom-updater";
const MAX_REDIRECTS = 5;

function httpGetJson(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/vnd.github+json" } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects < MAX_REDIRECTS) {
          res.resume();
          resolve(httpGetJson(res.headers.location, redirects + 1));
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`GitHub API вернул код ${res.statusCode}`));
          res.resume();
          return;
        }
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            reject(new Error("Некорректный ответ GitHub API"));
          }
        });
      })
      .on("error", reject);
  });
}

function httpGetText(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { "User-Agent": USER_AGENT } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects < MAX_REDIRECTS) {
          res.resume();
          resolve(httpGetText(res.headers.location, redirects + 1));
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`Не удалось скачать файл, код ${res.statusCode}`));
          res.resume();
          return;
        }
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve(data));
      })
      .on("error", reject);
  });
}

function downloadToFile(url, destPath, onProgress, redirects = 0) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { "User-Agent": USER_AGENT } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects < MAX_REDIRECTS) {
          res.resume();
          resolve(downloadToFile(res.headers.location, destPath, onProgress, redirects + 1));
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`Не удалось скачать файл, код ${res.statusCode}`));
          res.resume();
          return;
        }
        const total = Number(res.headers["content-length"]) || 0;
        let received = 0;
        const file = fs.createWriteStream(destPath);
        res.on("data", (chunk) => {
          received += chunk.length;
          if (onProgress && total) onProgress(received / total);
        });
        res.on("error", (err) => {
          file.destroy();
          reject(err);
        });
        file.on("error", reject);
        file.on("finish", () => file.close(() => resolve()));
        res.pipe(file);
      })
      .on("error", reject);
  });
}

function parseVersion(v) {
  const m = String(v || "")
    .trim()
    .replace(/^v/i, "")
    .match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function isNewer(latestVersion, currentVersion) {
  const a = parseVersion(latestVersion);
  const b = parseVersion(currentVersion);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return true;
    if (a[i] < b[i]) return false;
  }
  return false;
}

async function checkForUpdate(currentVersion) {
  const release = await httpGetJson(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`);
  if (release.draft || release.prerelease) {
    return { hasUpdate: false };
  }
  const latestVersion = release.tag_name;
  if (!isNewer(latestVersion, currentVersion)) {
    return { hasUpdate: false, latestVersion };
  }
  const assets = release.assets || [];
  const exeAsset = assets.find((a) => ASSET_NAME_RE.test(a.name));
  if (!exeAsset) {
    throw new Error("В релизе не найден portable-файл (ожидалось имя вида PrikazGolosom-portable-*.exe)");
  }
  const shaAsset = assets.find((a) => a.name === `${exeAsset.name}.sha256`);
  return {
    hasUpdate: true,
    latestVersion,
    releaseUrl: release.html_url,
    releaseNotes: release.body || "",
    asset: {
      name: exeAsset.name,
      size: exeAsset.size,
      downloadUrl: exeAsset.browser_download_url,
      sha256Url: shaAsset ? shaAsset.browser_download_url : null,
    },
  };
}

async function downloadAndVerify(asset, onProgress) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "prikaz-golosom-update-"));
  const destPath = path.join(tmpDir, asset.name);
  try {
    await downloadToFile(asset.downloadUrl, destPath, onProgress);

    const stat = fs.statSync(destPath);
    if (asset.size && stat.size !== asset.size) {
      throw new Error(`Размер скачанного файла не совпадает (${stat.size} вместо ${asset.size})`);
    }

    const fd = fs.openSync(destPath, "r");
    const header = Buffer.alloc(2);
    fs.readSync(fd, header, 0, 2, 0);
    fs.closeSync(fd);
    if (header.toString("ascii") !== "MZ") {
      throw new Error("Скачанный файл не является исполняемым (нет сигнатуры MZ)");
    }

    if (asset.sha256Url) {
      const shaText = await httpGetText(asset.sha256Url);
      const expected = (shaText.match(/[a-fA-F0-9]{64}/) || [])[0];
      if (!expected) {
        throw new Error("Не удалось прочитать sha256 из сопроводительного файла");
      }
      const actual = await new Promise((resolve, reject) => {
        const hash = crypto.createHash("sha256");
        const stream = fs.createReadStream(destPath);
        stream.on("data", (chunk) => hash.update(chunk));
        stream.on("end", () => resolve(hash.digest("hex")));
        stream.on("error", reject);
      });
      if (actual.toLowerCase() !== expected.toLowerCase()) {
        throw new Error("Контрольная сумма sha256 не совпадает — файл повреждён или подменён");
      }
    }

    return destPath;
  } catch (e) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    throw e;
  }
}

function buildRelaunchScript(pid, sourcePath, targetPath, scriptPath) {
  const escape = (s) => String(s).replace(/'/g, "''");
  const content = `$ErrorActionPreference = 'SilentlyContinue'
try { Wait-Process -Id ${pid} -Timeout 30 } catch {}
Start-Sleep -Milliseconds 500
$target = '${escape(targetPath)}'
$source = '${escape(sourcePath)}'
$attempt = 0
$copied = $false
while ($attempt -lt 30 -and -not $copied) {
  try {
    Copy-Item -LiteralPath $source -Destination $target -Force -ErrorAction Stop
    $copied = $true
  } catch {
    Start-Sleep -Milliseconds 500
    $attempt++
  }
}
Start-Process -FilePath $target
Remove-Item -LiteralPath (Split-Path -Parent $source) -Force -Recurse -ErrorAction SilentlyContinue
Remove-Item -LiteralPath '${escape(scriptPath)}' -Force -ErrorAction SilentlyContinue
`;
  fs.writeFileSync(scriptPath, "﻿" + content, "utf8");
}

function scheduleSelfReplace(sourcePath, targetPath) {
  const scriptPath = path.join(os.tmpdir(), `prikaz-golosom-update-${Date.now()}.ps1`);
  buildRelaunchScript(process.pid, sourcePath, targetPath, scriptPath);

  // A plain detached+unref'd child can still get killed the moment this process exits, if this
  // process happens to be running inside a Windows job object without break-away permission
  // (sandboxes, some AV/EDR tooling, certain terminal/session managers). Launching the relaunch
  // script through WMI's Win32_Process.Create instead makes it a child of the WMI provider host
  // process, entirely outside our own process tree, so it survives regardless of that.
  //
  // We wait for this launcher to actually finish (rather than firing it and quitting right away)
  // because starting powershell.exe and running Invoke-CimMethod is not instant — if our own
  // process exits first, this short-lived launcher can be torn down before it ever gets to create
  // the target process. Waiting for its exit confirms the relaunch script genuinely exists.
  const targetCommandLine = `powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "${scriptPath}"`;
  const escapePs = (s) => String(s).replace(/'/g, "''");
  const wmiCommand =
    `Invoke-CimMethod -ClassName Win32_Process -MethodName Create ` +
    `-Arguments @{CommandLine='${escapePs(targetCommandLine)}'} | Out-Null`;

  return new Promise((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-Command", wmiCommand],
      { windowsHide: true, stdio: "ignore" }
    );
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Не удалось запланировать перезапуск (код ${code})`));
      }
    });
  });
}

module.exports = { checkForUpdate, downloadAndVerify, scheduleSelfReplace };
