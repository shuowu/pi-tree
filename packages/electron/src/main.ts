import { app as electronApp, BrowserWindow, shell } from "electron";
import { join } from "node:path";
import { serve } from "@hono/node-server";

// Data directory:
//   Dev:       reuse the dev server's data (~/.local/share/pi-tree-dev)
//   Packaged:  ~/.local/share/pi-tree on Linux (XDG data dir — shared with Docker)
//              ~/Library/Application Support/pi-tree on macOS
//              %APPDATA%/pi-tree on Windows
import os from "node:os";
const devDataPath = join(os.homedir(), ".local", "share", "pi-tree-dev");
const isPackaged = electronApp.isPackaged;

function resolveDataPath(): string {
  if (!isPackaged) return devDataPath;
  // On Linux, use XDG_DATA_HOME (~/.local/share/pi-tree) so the data directory
  // is compatible with Docker bind mounts (docker-compose.yml can mount the
  // same path). Electron's app.getPath("userData") would give ~/.config/Pi Tree
  // which is the wrong XDG category for data (config vs data) and uses a
  // space in the name.
  if (process.platform === "linux") {
    const xdgData = process.env.XDG_DATA_HOME ?? join(os.homedir(), ".local", "share");
    return join(xdgData, "pi-tree");
  }
  // macOS and Windows: use platform-standard app data directories
  return electronApp.getPath("userData");
}

process.env.DATA_PATH = resolveDataPath();
process.env.NODE_ENV = "production";

// In dev mode, load .env from monorepo root (same as the dev server's load-env.ts)
// so PI_MODEL, PI_API_KEY, PI_PROVIDER etc. are available.
// In packaged mode, users configure via Settings UI → saved to global-config.json.
if (!isPackaged) {
  const { config: loadEnv } = await import("dotenv");
  const monorepoRootForEnv = join(import.meta.dirname, "..", "..", "..");
  loadEnv({ path: join(monorepoRootForEnv, ".env") });
}

// Detect packaged vs dev mode for resource resolution.
// Packaged: extraResources live next to the app binary (process.resourcesPath)
// Dev:      resolve from the monorepo root (packages/electron/dist/main.js → ../../..)
const monorepoRoot = join(import.meta.dirname, "..", "..", "..");
const resourcesPath = isPackaged
  ? process.resourcesPath
  : monorepoRoot;

// Client build output
process.env.CLIENT_DIST_PATH = isPackaged
  ? join(resourcesPath, "client")
  : join(monorepoRoot, "packages", "client", "dist");

// Core agents directory (skills, extensions, profiles)
const coreDir = isPackaged
  ? resourcesPath
  : join(monorepoRoot, "packages", "server", "src");

let mainWindow: BrowserWindow | null = null;
let serverCleanup: (() => Promise<void>) | null = null;

async function createWindow(port: number) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 800,
    minHeight: 600,
    title: "Pi Tree",
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: join(import.meta.dirname, "preload.js"),
    },
  });

  // Open external links in the system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  await mainWindow.loadURL(`http://localhost:${port}`);

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

async function main() {
  await electronApp.whenReady();

  // Bootstrap the server (resolves core agents from extraResources in packaged builds)
  const { bootstrap } = await import("@pi-tree/server/bootstrap");
  const { app, cleanup } = await bootstrap({
    dataPath: process.env.DATA_PATH!,
    coreDir,
  });
  serverCleanup = cleanup;

  // Use a fixed port so localStorage persists across app restarts.
  // (Random ports = new origin each launch = localStorage wiped)
  const PORT = 19847;
  const server = serve({ fetch: app.fetch, port: PORT }, (info) => {
    console.log(`✅ Embedded server on http://localhost:${info.port}`);
    createWindow(info.port);
  });

  // macOS: re-create window when dock icon is clicked
  electronApp.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 3847;
      createWindow(port);
    }
  });
}

// Quit when all windows are closed (except macOS)
electronApp.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    electronApp.quit();
  }
});

// Graceful shutdown
electronApp.on("will-quit", async () => {
  if (serverCleanup) {
    await serverCleanup();
  }
});

main().catch((err) => {
  console.error("Failed to start:", err);
  electronApp.quit();
});
