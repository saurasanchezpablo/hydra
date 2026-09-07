import type { UserAchievement } from "@types";
import { registerEvent } from "../register-event";
import { gameAchievementsSublevel } from "@main/level";
import { WindowManager } from "@main/services";
import {
  cancelPendingSouvenirsForShop,
  deleteLocalSouvenirAssetsForShop,
} from "@main/services/achievements/grouped-souvenir-worker";

const LAUNCHBOX_KEY_PREFIX = "launchbox:";

const resetRetroAchievementsAchievements = async (
  _event: Electron.IpcMainInvokeEvent,
  pendingSouvenirsOnly = false
) => {
  await cancelPendingSouvenirsForShop("launchbox");
  if (pendingSouvenirsOnly) return;
  await deleteLocalSouvenirAssetsForShop("launchbox");

  const entries = await gameAchievementsSublevel.iterator().all();

  for (const [key, gameAchievement] of entries) {
    if (!key.startsWith(LAUNCHBOX_KEY_PREFIX)) continue;

    await gameAchievementsSublevel.put(key, {
      ...gameAchievement,
      unlockedAchievements: [],
    });

    const objectId = key.slice(LAUNCHBOX_KEY_PREFIX.length);
    const lockedAchievements: UserAchievement[] = (
      gameAchievement.achievements ?? []
    ).map((achievement) => ({
      ...achievement,
      unlocked: false,
      unlockTime: null,
    }));

    WindowManager.mainWindow?.webContents.send(
      `on-update-achievements-${objectId}-launchbox`,
      lockedAchievements
    );
  }
};

registerEvent(
  "resetRetroAchievementsAchievements",
  resetRetroAchievementsAchievements
);
