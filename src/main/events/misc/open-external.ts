import { shell } from "electron";
import { logger } from "@main/services/logger";
import { registerEvent } from "../register-event";

const openExternal = async (
  _event: Electron.IpcMainInvokeEvent,
  src: string
) => {
  try {
    return await shell.openExternal(src);
  } catch (error) {
    logger.error("Failed to open external URL", src, error);
    throw error;
  }
};

registerEvent("openExternal", openExternal);
