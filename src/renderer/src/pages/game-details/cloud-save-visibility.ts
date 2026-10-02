import type { GameShop } from "@types";
import { getCloudSaveEmulatorProvider } from "../../../../shared/cloud-save-emulator-provider.js";

export type CloudSaveUiMode = "legacy" | "v2";
export type LegacyCloudSavePurpose = "active" | "archive";
export type CloudSavesVersion = "v1" | "v2";

export interface CloudSaveSettingsVisibility {
  showV2: boolean;
  showLegacy: boolean;
  legacyPurpose: LegacyCloudSavePurpose;
}

export interface CloudSaveVisibility {
  hero: CloudSaveUiMode | null;
  settings: CloudSaveSettingsVisibility;
}

export const isLegacyCloudSaveSettingsAvailable = (
  settings: CloudSaveSettingsVisibility,
  hasActiveSubscription: boolean,
  artifactCount: number
): boolean =>
  settings.showLegacy &&
  (settings.legacyPurpose === "active" ||
    (hasActiveSubscription && artifactCount > 0));

/**
 * Fork additions are passed as options so the positional signature stays
 * compatible with upstream's callers and tests.
 */
export interface CloudSaveVisibilityOptions {
  /** Per-game or account-wide Cloud Saves version. */
  cloudSavesVersion?: CloudSavesVersion;
  /** Self-hosted backends have no Hydra Cloud legacy archive to show. */
  selfHosted?: boolean;
}

export const getCloudSaveVisibility = (
  shop: GameShop,
  platform?: string | null,
  options: CloudSaveVisibilityOptions = {}
): CloudSaveVisibility => {
  const { cloudSavesVersion = "v2", selfHosted = false } = options;

  if (shop === "steam") {
    if (cloudSavesVersion === "v1") {
      return {
        hero: "legacy",
        settings: {
          showV2: false,
          showLegacy: true,
          legacyPurpose: "active",
        },
      };
    }

    return {
      hero: "v2",
      settings: {
        showV2: true,
        showLegacy: !selfHosted,
        legacyPurpose: "archive",
      },
    };
  }

  if (shop === "launchbox") {
    if (getCloudSaveEmulatorProvider(shop, platform)) {
      return {
        hero: "v2",
        settings: {
          showV2: true,
          showLegacy: true,
          legacyPurpose: "archive",
        },
      };
    }
    return {
      hero: "legacy",
      settings: {
        showV2: false,
        showLegacy: true,
        legacyPurpose: "active",
      },
    };
  }

  return {
    hero: null,
    settings: {
      showV2: false,
      showLegacy: true,
      legacyPurpose: "active",
    },
  };
};
