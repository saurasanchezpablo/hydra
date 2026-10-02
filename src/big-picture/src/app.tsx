import { Fragment, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  BIG_PICTURE_APP_LAYER_ID,
  BIG_PICTURE_CONTENT_REGION_ID,
  BIG_PICTURE_SHELL_REGION_ID,
  getBigPictureContentEntryRegionIdFromPathname,
  BIG_PICTURE_SIDEBAR_ITEM_IDS,
  getBigPictureGameRouteMatch,
  getBigPictureSidebarLibraryGameFocusId,
  getBigPictureSidebarItemIdFromPathname,
  Header,
  Sidebar,
} from "./layout";
import { IS_DESKTOP } from "./constants";
import { useBigPictureToast, useNavigation, useUserPreferences } from "./hooks";
import { ConfirmationModal } from "./components/modals";
import { ForkUpdateModal } from "./components/fork-update-modal";
import { getGameExecutableFilters } from "@shared";
import {
  HorizontalFocusGroup,
  InputModeProvider,
  NavigationHistoryBridge,
  NavigationLayer,
  NavigationAutoScrollBridge,
  NavigationInputProvider,
  NavigationStateBridge,
  NavigationDiagnostics,
  VerticalFocusGroup,
  BigPictureToastHost,
  CloudGiftNotificationModal,
  VirtualKeyboardProvider,
} from "./components";
import { getItemFocusTarget } from "./helpers";
import {
  initializeBigPictureRunningGamesStore,
  useInputModeStore,
} from "./stores";
import { NavigationAudioService, type FocusOverrides } from "./services";
import { BigPictureI18nBridge, ensureBigPictureI18nResources } from "./i18n";

import "./styles/globals.scss";

export default function App() {
  ensureBigPictureI18nResources();

  const { t } = useTranslation();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { showErrorToast } = useBigPictureToast();
  const { nodes, regions, setFocusRegion } = useNavigation();
  const userPreferences = useUserPreferences();
  const inputMode = useInputModeStore((state) => state.mode);
  const [pendingRouteFocusPathname, setPendingRouteFocusPathname] = useState<
    string | null
  >(pathname);
  const [installerFoundInfo, setInstallerFoundInfo] = useState<{
    shop: string;
    objectId: string;
    exePath: string;
    folderPath: string;
  } | null>(null);
  const [postInstallerInfo, setPostInstallerInfo] = useState<{
    shop: string;
    objectId: string;
    folderPath: string;
  } | null>(null);
  const [postInstallerStep, setPostInstallerStep] = useState<
    "select-exe" | "delete-folder"
  >("select-exe");
  const activeSidebarItemId = getBigPictureSidebarItemIdFromPathname(pathname);
  const activeGameRoute = getBigPictureGameRouteMatch(pathname);
  const leftSidebarTargetId = activeGameRoute
    ? getBigPictureSidebarLibraryGameFocusId(activeGameRoute)
    : (activeSidebarItemId ?? BIG_PICTURE_SIDEBAR_ITEM_IDS.library);
  const contentNavigationOverrides: FocusOverrides = {
    left: getItemFocusTarget(leftSidebarTargetId),
  };

  useEffect(() => {
    if (!IS_DESKTOP) {
      document.documentElement.style.colorScheme = "dark";
      return;
    }

    initializeBigPictureRunningGamesStore();
  }, []);

  useEffect(() => {
    const unsubInstaller = window.electron.onInstallerFound((info) => {
      setInstallerFoundInfo(info);
    });
    const unsubPost = window.electron.onInstallerClosed((info) => {
      setInstallerFoundInfo(null);
      setPostInstallerInfo(info);
      setPostInstallerStep("select-exe");
    });

    let unsubNavigate: (() => void) | undefined;
    if (IS_DESKTOP) {
      unsubNavigate = globalThis.window.electron.onNavigate((path) => {
        if (path.startsWith("/big-picture")) {
          navigate(path);
        }
      });
    }

    return () => {
      unsubInstaller();
      unsubPost();
      unsubNavigate?.();
    };
  }, [navigate]);

  useEffect(() => {
    if (!IS_DESKTOP) return;

    const unsubscribeExtractionFailed =
      globalThis.window.electron.onExtractionFailed(
        (_shop, _objectId, failure) => {
          if (failure?.reason === "unsupported-format") {
            showErrorToast(
              t("extraction_unsupported_format_title", { ns: "downloads" }),
              {
                message: t("extraction_unsupported_format_description", {
                  ns: "downloads",
                  format: failure.format,
                }),
              }
            );
            return;
          }

          if (failure?.reason === "file-not-found") {
            showErrorToast(
              t("extraction_file_not_found_title", { ns: "downloads" }),
              {
                message: t("extraction_file_not_found_description", {
                  ns: "downloads",
                }),
              }
            );
            return;
          }

          showErrorToast(t("extraction_failed_title", { ns: "downloads" }), {
            message: t("extraction_failed_description", { ns: "downloads" }),
          });
        }
      );

    const unsubscribeExecutableNotFound =
      globalThis.window.electron.onGameExecutableNotFound(() => {
        showErrorToast(
          t("executable_not_found_title", { ns: "game_details" }),
          {
            message: t("executable_not_found_big_picture_description", {
              ns: "game_details",
            }),
          }
        );
      });

    return () => {
      unsubscribeExtractionFailed();
      unsubscribeExecutableNotFound();
    };
  }, [showErrorToast, t]);

  useEffect(() => {
    setPendingRouteFocusPathname(pathname);
  }, [pathname]);

  useEffect(() => {
    if (pendingRouteFocusPathname !== pathname) return;

    const entryRegionId =
      getBigPictureContentEntryRegionIdFromPathname(pathname);
    if (!entryRegionId) return;

    const hasRegion = regions.some((region) => region.id === entryRegionId);
    if (!hasRegion) return;

    const focusedId = setFocusRegion(entryRegionId, "right", {
      preferRememberedFocus: false,
    });

    if (focusedId) {
      setPendingRouteFocusPathname(null);
    }
  }, [
    leftSidebarTargetId,
    nodes,
    pathname,
    pendingRouteFocusPathname,
    regions,
    setFocusRegion,
  ]);

  useEffect(() => {
    NavigationAudioService.getInstance().setEnabled(
      (userPreferences?.bigPictureSoundsEnabled ?? true) &&
        inputMode === "gamepad"
    );
  }, [userPreferences?.bigPictureSoundsEnabled, inputMode]);

  const installerFileName =
    installerFoundInfo?.exePath.split(/[/\\]/).pop() ?? "";

  return (
    <Fragment>
      <ConfirmationModal
        visible={installerFoundInfo !== null}
        title={t("installer_found_title", { ns: "downloads" })}
        description={t("installer_found_description", {
          ns: "downloads",
          fileName: installerFileName,
        })}
        confirmLabel={t("installer_found_launch", { ns: "downloads" })}
        onConfirm={() => {
          if (!installerFoundInfo) return;
          void window.electron.launchInstallerAndWatch(
            installerFoundInfo.shop,
            installerFoundInfo.objectId,
            installerFoundInfo.exePath,
            installerFoundInfo.folderPath
          );
          setInstallerFoundInfo(null);
        }}
        onClose={() => setInstallerFoundInfo(null)}
      />

      <ConfirmationModal
        visible={
          postInstallerInfo !== null && postInstallerStep === "select-exe"
        }
        title={t("installer_closed_title")}
        description={t("installer_closed_description")}
        confirmLabel={t("installer_select_executable")}
        onConfirm={async () => {
          if (!postInstallerInfo) return;
          const filters = getGameExecutableFilters(window.electron.platform, {
            executable: t("installer_select_executable"),
            allFiles: t("all_files", { ns: "game_details" }),
          });
          const { filePaths } = await window.electron.showOpenDialog({
            properties: ["openFile"],
            filters,
          });
          if (filePaths?.[0]) {
            await window.electron.updateExecutablePath(
              postInstallerInfo.shop as never,
              postInstallerInfo.objectId,
              filePaths[0]
            );
          }
          setPostInstallerStep("delete-folder");
        }}
        onClose={() => setPostInstallerInfo(null)}
      />

      <ConfirmationModal
        visible={
          postInstallerInfo !== null && postInstallerStep === "delete-folder"
        }
        title={t("installer_delete_folder_title")}
        description={t("installer_delete_folder_description", {
          folderPath: postInstallerInfo?.folderPath ?? "",
        })}
        confirmLabel={t("yes")}
        onConfirm={async () => {
          if (postInstallerInfo?.folderPath) {
            await window.electron.deleteInstallerFolder(
              postInstallerInfo.folderPath
            );
          }
          setPostInstallerInfo(null);
          setPostInstallerStep("select-exe");
        }}
        onClose={() => {
          setPostInstallerInfo(null);
          setPostInstallerStep("select-exe");
        }}
      />

      <NavigationStateBridge />
      <NavigationAutoScrollBridge />
      <NavigationHistoryBridge />

      <NavigationInputProvider>
        <div id="big-picture">
          <BigPictureI18nBridge />

          <NavigationLayer
            layerId={BIG_PICTURE_APP_LAYER_ID}
            rootRegionId={BIG_PICTURE_SHELL_REGION_ID}
            initialFocusRegionId={BIG_PICTURE_CONTENT_REGION_ID}
          >
            <HorizontalFocusGroup
              regionId={BIG_PICTURE_SHELL_REGION_ID}
              autoScrollMode="auto"
              asChild
            >
              <div className="big-picture__app">
                <Sidebar />

                <VerticalFocusGroup
                  regionId={BIG_PICTURE_CONTENT_REGION_ID}
                  navigationOverrides={contentNavigationOverrides}
                  autoScrollMode="auto"
                  asChild
                >
                  <div className="big-picture__layout">
                    <Header />

                    <article className="big-picture__content">
                      <Outlet />
                    </article>

                    <VirtualKeyboardProvider />
                  </div>
                </VerticalFocusGroup>
              </div>
            </HorizontalFocusGroup>
          </NavigationLayer>

          <InputModeProvider />
          <NavigationDiagnostics />
          <BigPictureToastHost />
          <ForkUpdateModal />
          <CloudGiftNotificationModal />
        </div>
      </NavigationInputProvider>
    </Fragment>
  );
}
