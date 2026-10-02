import path from "node:path";
import fs from "node:fs";

import type { GameShop, LibraryGame } from "@types";
import { registerEvent } from "../register-event";
import {
  downloadsSublevel,
  gamesArtworkSelectionSublevel,
  gamesShopAssetsSublevel,
  gamesShopCacheSublevel,
  gamesSublevel,
} from "@main/level";
import { composeAssetsWithArtwork } from "@shared";
import { HydraApi } from "@main/services/hydra-api";
import { WindowManager } from "@main/services";
import { belongsToLibraryCollection } from "@main/services/library-sync/game-visibility";
import {
  resolveAchievementCount,
  resolveUnlockedAchievementCount,
} from "@main/services/achievements/achievement-memory-store";
import { getGameAssets } from "../catalogue/get-game-assets";

const PREFETCH_CONCURRENCY = 5;
const LOCAL_CACHE_EXPIRATION = 1000 * 60 * 60 * 8;
const prefetchAttempted = new Set<string>();

export const lookupCachedPlatform = async (
  gameKey: string
): Promise<string | null> => {
  const prefix = `${gameKey}:`;
  try {
    const entries = await gamesShopCacheSublevel.iterator().all();
    for (const [key, value] of entries) {
      if (
        typeof key === "string" &&
        key.startsWith(prefix) &&
        value?.platform
      ) {
        return value.platform;
      }
    }
  } catch {
    return null;
  }
  return null;
};

/**
 * Fork: warm the local shop-asset cache for games whose artwork is missing or
 * stale, then tell the renderer to refresh. Keeps library covers/icons present
 * on a self-hosted backend, which does not pre-populate them.
 */
const batchPrefetchAssets = async (
  entries: { key: string; shop: GameShop; objectId: string }[]
) => {
  if (entries.length === 0) return;

  let index = 0;

  const worker = async () => {
    while (index < entries.length) {
      const entry = entries[index++];
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const assets = await getGameAssets(entry.objectId, entry.shop);
          if (assets) break;
          await new Promise((r) => setTimeout(r, 1000));
        } catch {
          if (attempt < 2) {
            await new Promise((r) => setTimeout(r, 2000));
          }
        }
      }
    }
  };

  await Promise.all(
    Array.from({ length: PREFETCH_CONCURRENCY }, () => worker())
  );

  WindowManager.sendToAppWindows("on-library-batch-complete");
};

const getLibrary = async (
  collection: "visible" | "hidden" | "all" = "visible"
): Promise<LibraryGame[]> => {
  const results = await gamesSublevel.iterator().all();
  const pendingFetch: { key: string; shop: GameShop; objectId: string }[] = [];

  const library = await Promise.all(
    results
      .filter(([_key, game]) => belongsToLibraryCollection(game, collection))
      .map(async ([key, game]) => {
        const download = await downloadsSublevel.get(key);
        const gameAssets = await gamesShopAssetsSublevel.get(key);
        const artworkSelection = await gamesArtworkSelectionSublevel.get(key);
        const composedAssets = composeAssetsWithArtwork(
          gameAssets ?? null,
          artworkSelection
        );
        const unlockedAchievementCount = resolveUnlockedAchievementCount(
          game.shop,
          game.objectId,
          game.unlockedAchievementCount
        );

        // Verify installer still exists, clear if deleted externally
        let installerSizeInBytes = game.installerSizeInBytes;
        if (installerSizeInBytes && download?.folderName) {
          const installerPath = path.join(
            download.downloadPath,
            download.folderName
          );

          if (!fs.existsSync(installerPath)) {
            installerSizeInBytes = null;
            gamesSublevel.put(key, { ...game, installerSizeInBytes: null });
          }
        }

        if (
          game.shop === "launchbox" &&
          (!game.platform || game.platform === null)
        ) {
          const cachedPlatform = await lookupCachedPlatform(key);
          if (cachedPlatform) {
            game.platform = cachedPlatform;
            gamesSublevel.put(key, game).catch(() => {});
          }
        }

        // Verify installed folder still exists, clear if deleted externally
        let installedSizeInBytes = game.installedSizeInBytes;
        if (installedSizeInBytes && game.executablePath) {
          const executableDir = path.dirname(game.executablePath);

          if (!fs.existsSync(executableDir)) {
            installedSizeInBytes = null;
            gamesSublevel.put(key, {
              ...game,
              installerSizeInBytes,
              installedSizeInBytes: null,
            });
          }
        }

        if (
          game.shop !== "custom" &&
          (gameAssets == null ||
            gameAssets.updatedAt + LOCAL_CACHE_EXPIRATION < Date.now() ||
            (!gameAssets.iconUrl && !prefetchAttempted.has(key)))
        ) {
          prefetchAttempted.add(key);
          pendingFetch.push({
            key,
            shop: game.shop,
            objectId: game.objectId,
          });
        }

        return {
          id: key,
          ...game,
          installerSizeInBytes,
          installedSizeInBytes,
          download: download ?? null,
          unlockedAchievementCount,
          achievementCount: resolveAchievementCount(
            game.shop,
            game.objectId,
            game.achievementCount
          ),
          // Spread composed assets last to ensure all image URLs are properly set
          ...composedAssets,
          title: composedAssets?.title || game.title,
          platform: game.platform ?? null,
          // Preserve custom image URLs from game if they exist
          customIconUrl: game.customIconUrl,
          customLogoImageUrl: game.customLogoImageUrl,
          customHeroImageUrl: game.customHeroImageUrl,
          customCoverImageUrl: game.customCoverImageUrl,
        };
      })
  );

  void batchPrefetchAssets(pendingFetch);

  return library;
};

registerEvent("getLibrary", (_event, includeConcealed = false) =>
  getLibrary(includeConcealed ? "all" : "visible")
);
registerEvent("getHiddenLibrary", () =>
  HydraApi.isLoggedIn() ? getLibrary("hidden") : Promise.resolve([])
);
