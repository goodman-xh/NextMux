import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, readdir, rm } from "node:fs/promises";
import { homedir, platform as hostPlatform } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(scriptDirectory, "..");
const electronRoot = join(workspaceRoot, "apps", "desktop", "node_modules", "electron");
const packageMetadata = JSON.parse(await readFile(join(electronRoot, "package.json"), "utf8"));
const checksums = JSON.parse(await readFile(join(electronRoot, "checksums.json"), "utf8"));

const platform = process.env.ELECTRON_INSTALL_PLATFORM || process.env.npm_config_platform || process.platform;
const arch = process.env.ELECTRON_INSTALL_ARCH || process.env.npm_config_arch || process.arch;
const executable = platform === "darwin"
  ? join("Electron.app", "Contents", "MacOS", "Electron")
  : platform === "win32"
    ? "electron.exe"
    : "electron";
const installedVersionFile = join(electronRoot, "dist", "version");
const installedExecutable = join(electronRoot, "dist", executable);

if (existsSync(installedVersionFile) && existsSync(installedExecutable)) {
  const installedVersion = (await readFile(installedVersionFile, "utf8")).trim().replace(/^v/, "");
  if (installedVersion === packageMetadata.version && installedExecutableMatchesTarget()) {
    console.log(`Electron ${installedVersion} (${platform}-${arch}) is already installed.`);
    process.exit(0);
  }

  // Electron's installer normally changes a Rosetta x64 request back to
  // arm64. Remove a mismatched cached extraction before reinstalling with an
  // explicit target so cross-architecture release qualification is real.
  await rm(join(electronRoot, "dist"), { recursive: true, force: true });
}

const archiveName = `electron-v${packageMetadata.version}-${platform}-${arch}.zip`;
const expectedChecksum = checksums[archiveName];
if (!expectedChecksum) {
  throw new Error(`Electron checksum metadata is missing for ${archiveName}.`);
}

const cacheRoot = process.env.electron_config_cache || defaultElectronCacheRoot();
const releaseDirectoryUrl = `https://github.com/electron/electron/releases/download/v${packageMetadata.version}`;
const officialCacheDirectory = createHash("sha256").update(releaseDirectoryUrl).digest("hex");
const officialCachedArchive = join(cacheRoot, officialCacheDirectory, archiveName);

if (!existsSync(officialCachedArchive)) {
  const cachedArchive = await findVerifiedArchive(cacheRoot, archiveName, expectedChecksum);
  if (cachedArchive) {
    await mkdir(dirname(officialCachedArchive), { recursive: true });
    await copyFile(cachedArchive, officialCachedArchive);
    console.log(`Reused verified Electron cache: ${cachedArchive}`);
  }
}

const installResult = spawnSync(process.execPath, [join(electronRoot, "install.js")], {
  env: {
    ...process.env,
    ELECTRON_INSTALL_PLATFORM: platform,
    ELECTRON_INSTALL_ARCH: arch,
    // Electron's macOS installer only skips its Rosetta host rewrite when the
    // npm target is explicit, even if ELECTRON_INSTALL_ARCH is already set.
    npm_config_platform: platform,
    npm_config_arch: arch,
  },
  stdio: "inherit",
});

if (installResult.status !== 0) {
  throw new Error(`Electron ${packageMetadata.version} could not be installed.`);
}

console.log(`Electron ${packageMetadata.version} (${platform}-${arch}) is ready.`);

function installedExecutableMatchesTarget() {
  if (platform !== "darwin") return true;
  const result = spawnSync("/usr/bin/lipo", ["-archs", installedExecutable], { encoding: "utf8" });
  if (result.status !== 0) return false;
  const expected = arch === "x64" ? "x86_64" : arch;
  return result.stdout.trim().split(/\s+/).includes(expected);
}

function defaultElectronCacheRoot() {
  switch (hostPlatform()) {
    case "win32":
      return join(process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "electron", "Cache");
    case "darwin":
      return join(homedir(), "Library", "Caches", "electron");
    default:
      return join(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "electron");
  }
}

async function findVerifiedArchive(root, fileName, checksum) {
  if (!existsSync(root)) return undefined;

  for (const entry of await readdir(root, { withFileTypes: true })) {
    const candidate = join(root, entry.name);
    if (entry.isDirectory()) {
      const nested = await findVerifiedArchive(candidate, fileName, checksum);
      if (nested) return nested;
      continue;
    }

    if (entry.isFile() && entry.name === fileName && await sha256(candidate) === checksum.toLowerCase()) {
      return candidate;
    }
  }

  return undefined;
}

async function sha256(filePath) {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}
