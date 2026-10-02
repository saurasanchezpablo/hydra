import {
  app,
  BrowserWindow,
  crashReporter,
  net,
  powerMonitor,
  protocol,
} from "electron";
import updater from "electron-updater";
import i18n from "i18next";
import path from "node:path";
import url from "node:url";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { electronApp, optimizer } from "@electron-toolkit/utils";
import {
  logger,
  clearGamesPlaytime,
  WindowManager,
  Lock,
  PowerSaveBlockerManager,
  DownloadOrchestrator,
  SSEClient,
  emulators,
} from "@main/services";
import resources from "@locales";
import { TorrentService } from "./services/torrent-service";
import { db, gamesSublevel, levelKeys } from "./level";
import { GameShop, UserPreferences } from "@types";
import { launchGame, openClassicsGame } from "./helpers";
import { refreshPortableShortcutLauncher } from "./helpers/shortcut-launch";
import { lookupCachedPlatform } from "./events/library/get-library";
import { loadState } from "./main";
import {
  closeSteamOpenIdWindow,
  notifySteamConnectError,
  notifySteamConnected,
} from "./services/steam-integration/steam-store-session";
import {
  completeSteamOpenIdConnection,
  parseSteamOpenIdReturn,
} from "./services/steam-integration/steam-openid-return";
import { steamSyncOrchestrator } from "./services/steam-integration/steam-sync-orchestrator";

crashReporter.start({
  uploadToServer: false,
});

const { autoUpdater } = updater;

autoUpdater.setFeedURL({
  provider: "github",
  owner: "hydralauncher",
  repo: "hydra",
});

autoUpdater.logger = logger;

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) app.quit();

if (process.platform !== "linux") {
  app.commandLine.appendSwitch("--no-sandbox");
} else {
  app.commandLine.appendSwitch("ozone-platform-hint", "auto");
}

i18n.init({
  resources,
  lng: "en",
  fallbackLng: "en",
  interpolation: {
    escapeValue: false,
  },
});

const PROTOCOL = "hydralauncher";
const SELF_HOSTED_PROTOCOL = "hydra-self-hosted";

// Register the custom schemes as privileged so the renderer can fetch them
// (supportFetchAPI) and use the results on a canvas without tainting it
// (corsEnabled). Must run before the app is ready.
protocol.registerSchemesAsPrivileged([
  {
    scheme: "local",
    privileges: { supportFetchAPI: true, corsEnabled: true, stream: true },
  },
  {
    scheme: "gradient",
    privileges: { supportFetchAPI: true, corsEnabled: true },
  },
]);

if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [
      path.resolve(process.argv[1]),
    ]);
    app.setAsDefaultProtocolClient(SELF_HOSTED_PROTOCOL, process.execPath, [
      path.resolve(process.argv[1]),
    ]);
  }
} else {
  app.setAsDefaultProtocolClient(PROTOCOL);
  app.setAsDefaultProtocolClient(SELF_HOSTED_PROTOCOL);
}

// Linux: ensure both protocols are in the desktop file (Electron's second call
// often overwrites the first's MimeType on Linux)
if (process.platform === "linux") {
  try {
    const desktopDir = path.join(
      app.getPath("home"),
      ".local/share/applications"
    );
    const desktopName = `${app.getName().toLowerCase()}.desktop`;
    const desktopPath = path.join(desktopDir, desktopName);
    // Also check for Electron-generated files with hash suffix
    const candidates = [desktopPath];
    try {
      for (const f of require("node:fs").readdirSync(desktopDir)) {
        if (
          f.endsWith(".desktop") &&
          f !== desktopName &&
          f.startsWith(app.getName().toLowerCase())
        ) {
          candidates.push(path.join(desktopDir, f));
        }
      }
    } catch {
      // non-fatal
    }
    for (const dp of candidates) {
      if (!existsSync(dp)) continue;
      let content = readFileSync(dp, "utf-8");
      let changed = false;
      const mimeMatch = content.match(/^MimeType=.*$/m);
      if (mimeMatch && !mimeMatch[0].includes(SELF_HOSTED_PROTOCOL)) {
        content = content.replace(
          /^(MimeType=.*?)(;?)$/m,
          `$1;x-scheme-handler/${SELF_HOSTED_PROTOCOL};`
        );
        changed = true;
      }
      if (!/^Exec=.*%u/m.test(content)) {
        content = content.replace(/^(Exec=\S+)/m, "$1 %u");
        changed = true;
      }
      if (changed) {
        writeFileSync(dp, content);
      }
    }
    const { execSync } = require("child_process");
    execSync(
      `xdg-mime default ${desktopName} x-scheme-handler/${SELF_HOSTED_PROTOCOL}`,
      { stdio: "ignore" }
    );
  } catch {
    // non-fatal
  }
}

const initializeApp = async () => {
  refreshPortableShortcutLauncher();
  electronApp.setAppUserModelId("gg.hydralauncher.hydra");

  logger.info("Crash dumps directory", app.getPath("crashDumps"));

  protocol.handle("local", (request) => {
    const filePath = request.url.slice("local:".length);
    return net.fetch(url.pathToFileURL(decodeURI(filePath)).toString());
  });

  protocol.handle("gradient", (request) => {
    const gradientCss = decodeURIComponent(
      request.url.slice("gradient:".length)
    );

    // Parse gradient CSS safely without regex to prevent ReDoS
    let direction = "45deg";
    let color1 = "#4a90e2";
    let color2 = "#7b68ee";

    // Simple string parsing approach - more secure than regex
    if (
      gradientCss.startsWith("linear-gradient(") &&
      gradientCss.endsWith(")")
    ) {
      const content = gradientCss.slice(16, -1); // Remove "linear-gradient(" and ")"
      const parts = content.split(",").map((part) => part.trim());

      if (parts.length >= 3) {
        direction = parts[0];
        color1 = parts[1];
        color2 = parts[2];
      }
    }

    let x1 = "0%",
      y1 = "0%",
      x2 = "100%",
      y2 = "100%";

    if (direction === "to right") {
      y2 = "0%";
    } else if (direction === "to bottom") {
      x2 = "0%";
    } else if (direction === "45deg") {
      y1 = "100%";
      y2 = "0%";
    } else if (direction === "225deg") {
      x1 = "100%";
      x2 = "0%";
    } else if (direction === "315deg") {
      x1 = "100%";
      y1 = "100%";
      x2 = "0%";
      y2 = "0%";
    }
    // Note: "135deg" case removed as it uses all default values

    const svgContent = `
      <svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300">
        <defs>
          <linearGradient id="grad" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">
            <stop offset="0%" style="stop-color:${color1};stop-opacity:1" />
            <stop offset="100%" style="stop-color:${color2};stop-opacity:1" />
          </linearGradient>
        </defs>
        <rect width="100%" height="100%" fill="url(#grad)" />
      </svg>
    `;

    return new Response(svgContent, {
      headers: { "Content-Type": "image/svg+xml" },
    });
  });

  try {
    await loadState();
  } catch (error) {
    logger.error("Failed to load app state during startup", error);
  }

  // Suspend can outlive the 60s stall watchdog; reconnect right away instead
  powerMonitor.on("resume", () => {
    SSEClient.reconnectNow();
    DownloadOrchestrator.onNetworkStatusChanged({
      online: true,
      switched: true,
    });
  });

  const language = await db
    .get<string, string>(levelKeys.language, {
      valueEncoding: "utf8",
    })
    .catch(() => "en");

  if (language) i18n.changeLanguage(language);

  // Check if starting from a "run" deep link - don't show main window in that case
  const deepLinkArg = process.argv.find((arg) =>
    arg.startsWith("hydralauncher://")
  );
  const forceBigPicture = process.argv.includes("--big-picture");
  const isRunDeepLink = deepLinkArg?.startsWith("hydralauncher://run");

  if (!process.argv.includes("--hidden") && !isRunDeepLink) {
    WindowManager.createMainWindow({ forceBigPicture });
  }

  WindowManager.createNotificationWindow();
  WindowManager.createSystemTray(language || "en");

  if (deepLinkArg) {
    handleDeepLinkPath(deepLinkArg);
  }
};

app.on("browser-window-created", (_, window) => {
  optimizer.watchWindowShortcuts(window);
});

app.on("child-process-gone", (_event, details) => {
  logger.error("Child process gone", {
    type: details.type,
    reason: details.reason,
    exitCode: details.exitCode,
    serviceName: details.serviceName,
    name: details.name,
  });
});

app.on("render-process-gone", (_event, _webContents, details) => {
  logger.error("Render process gone", {
    reason: details.reason,
    exitCode: details.exitCode,
  });
});

const handleRunGame = async (shop: GameShop, objectId: string) => {
  const gameKey = levelKeys.game(shop, objectId);
  const game = await gamesSublevel.get(gameKey);

  if (!game) {
    logger.error("Game not found", { shop, objectId });
    return;
  }

  const userPreferences = await db.get<string, UserPreferences | null>(
    levelKeys.userPreferences,
    { valueEncoding: "json" }
  );

  // Only open main window if setting is disabled
  if (!userPreferences?.hideToTrayOnGameStart) {
    WindowManager.createMainWindow();
  }

  if (shop === "launchbox") {
    if (!game.platform) {
      const cachedPlatform = await lookupCachedPlatform(gameKey);
      if (cachedPlatform) {
        game.platform = cachedPlatform;
        await gamesSublevel.put(gameKey, game).catch(() => {});
      }
    }
    await openClassicsGame(shop, objectId);
    return;
  }

  if (!game.executablePath) {
    logger.error("Game has no executable path", { shop, objectId });
    return;
  }

  await launchGame({
    shop,
    objectId,
    executablePath: game.executablePath,
    launchOptions: game.launchOptions,
  });
};

const handleDeepLinkPath = (uri?: string) => {
  if (!uri) return;

  try {
    // Handle hydra-self-hosted://token/<accessToken> from passkey browser login
    if (uri.startsWith("hydra-self-hosted://token/")) {
      const token = uri.replace("hydra-self-hosted://token/", "");
      if (token) {
        import("@main/events/auth/self-hosted-sign-in")
          .then((m) => m.selfHostedSignIn(null, token))
          .catch(() => {});
      }
      WindowManager.closeAuthWindow();
      return;
    }

    const url = new URL(uri);

    if (url.host === "run") {
      const shop = url.searchParams.get("shop") as GameShop | null;
      const objectId = url.searchParams.get("objectId");

      if (shop && objectId) {
        void handleRunGame(shop, objectId).catch((error) => {
          logger.error("Failed to launch game from deep link", error);
          WindowManager.createMainWindow();
        });
      }

      return;
    }

    if (url.host === "install-source") {
      WindowManager.redirect(`settings${url.search}`);
      return;
    }

    if (url.host === "profile") {
      const userId = url.searchParams.get("userId");

      if (userId) {
        WindowManager.redirect(`profile/${userId}`);
      }

      return;
    }

    if (url.host === "install-theme") {
      const themeName = url.searchParams.get("theme");
      const authorId = url.searchParams.get("authorId");
      const authorName = url.searchParams.get("authorName");

      if (themeName && authorId && authorName) {
        WindowManager.redirect(
          `settings?theme=${themeName}&authorId=${authorId}&authorName=${authorName}`
        );
      }

      return;
    }

    if (url.host === "steam-connected") {
      closeSteamOpenIdWindow();
      const result = parseSteamOpenIdReturn(uri);
      if (result?.kind === "error") {
        notifySteamConnectError(result.code);
        return;
      }
      completeSteamOpenIdConnection({
        clearReconnectRequired: () =>
          steamSyncOrchestrator.clearReconnectRequired(),
        notifyConnected: notifySteamConnected,
      });
    }
  } catch (error) {
    logger.error("Error handling deep link", uri, error);
  }
};

app.on("second-instance", (_event, commandLine) => {
  const deepLink = commandLine.find(
    (arg) =>
      arg.startsWith("hydralauncher://") ||
      arg.startsWith("hydra-self-hosted://")
  );
  const forceBigPicture = commandLine.includes("--big-picture");

  // Check if this is a "run" deep link - don't show main window in that case
  const isRunDeepLink = deepLink?.startsWith("hydralauncher://run");
  // Passkey token deep link - handle silently
  const isPasskeyLink = deepLink?.startsWith("hydra-self-hosted://token/");

  if (isPasskeyLink) {
    handleDeepLinkPath(deepLink);
    return;
  }

  if (!isRunDeepLink) {
    if (WindowManager.mainWindow) {
      if (WindowManager.mainWindow.isMinimized())
        WindowManager.mainWindow.restore();

      WindowManager.mainWindow.focus();
      if (forceBigPicture) {
        void WindowManager.openBigPictureWindow();
      }
    } else {
      WindowManager.createMainWindow({ forceBigPicture });
    }
  }

  handleDeepLinkPath(deepLink);
});

app.on("open-url", (_event, url) => {
  handleDeepLinkPath(url);
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on("window-all-closed", () => {
  WindowManager.clearMainWindow();
});

let canAppBeClosed = false;
let isAppClosing = false;

app.on("before-quit", async (e) => {
  if (!canAppBeClosed) {
    e.preventDefault();
    if (isAppClosing) return;
    isAppClosing = true;
    PowerSaveBlockerManager.reset();
    const results = await Promise.allSettled([
      Lock.releaseLock(),
      TorrentService.shutdown(),
      clearGamesPlaytime(),
      emulators.stopAllEmulatorSouvenirCaptureSessions(),
    ]);

    // Sign out if configured
    const prefs = await db
      .get<
        string,
        UserPreferences
      >(levelKeys.userPreferences, { valueEncoding: "json" })
      .catch(() => null);
    if (prefs?.signOutOnExit) {
      const { HydraApi } = await import("./services/hydra-api");
      HydraApi.handleSignOut();
      await db
        .batch([
          { type: "del", key: levelKeys.auth },
          { type: "del", key: levelKeys.user },
        ])
        .catch(() => {});
    }
    if (prefs?.selfHostedSignOutOnExit && prefs.selfHostedApiUrl) {
      await db
        .put<
          string,
          UserPreferences
        >(levelKeys.userPreferences, { ...prefs, selfHostedUserToken: null, selfHostedTokenIssuedAt: undefined }, { valueEncoding: "json" })
        .catch(() => {});
    }

    for (const result of results) {
      if (result.status === "rejected") {
        logger.error("Application shutdown cleanup failed", result.reason);
      }
    }
    canAppBeClosed = true;
    app.quit();
  }
});

app.on("will-quit", () => {
  logger.info("Application will quit");
});

app.on("activate", () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    WindowManager.createMainWindow();
  }
});

// Some Electron APIs can only be used after initialization finishes.
// Top-level await blocks Electron startup when running through electron-vite.
app.once("ready", initializeApp);

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
