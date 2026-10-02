import { useTranslation } from "react-i18next";
import { SettingsDebrid } from "./settings-debrid";
import { SettingsSelfHosted } from "./settings-self-hosted";
import { SettingsSteamGridDb } from "./settings-steamgriddb";
import { SettingsRetroAchievements } from "./settings-retroachievements";
import { SettingsCloudSaves } from "./settings-cloud-saves";
import { SettingsSteam } from "./settings-steam";

export function SettingsContextIntegrations() {
  const { t } = useTranslation("settings");

  return (
    <div className="settings-context-panel">
      <div className="settings-context-panel__group">
        <SettingsSteam />
        <SettingsRetroAchievements />
      </div>

      <hr className="settings-context-panel__divider" />

      <div className="settings-context-panel__group">
        <h3>{t("debrid_services")}</h3>
        <SettingsDebrid />
      </div>

      <div className="settings-context-panel__group">
        <h3>{t("self_hosted_api")}</h3>
        <SettingsSelfHosted />
      </div>

      <SettingsCloudSaves />

      <div className="settings-context-panel__group">
        <h3>SteamGridDB</h3>
        <SettingsSteamGridDb />
      </div>
    </div>
  );
}
