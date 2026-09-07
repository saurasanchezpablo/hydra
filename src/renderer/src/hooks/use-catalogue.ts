import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { levelDBService } from "@renderer/services/leveldb.service";
import type { DownloadSource } from "@types";
import { useAppDispatch } from "./redux";
import { setGenres, setTags } from "@renderer/features";

const SUPPORTED_STEAM_METADATA_LANGUAGES = new Set([
  "en",
  "es",
  "pt",
  "ru",
  "fr",
]);

async function getLocalizedSteamMetadata<T>(
  endpoint: string,
  locale: string,
  isValid: (data: unknown) => data is T
) {
  const language = locale.split("-")[0] || "en";
  const requestLanguage = SUPPORTED_STEAM_METADATA_LANGUAGES.has(language)
    ? language
    : "en";
  const languages = requestLanguage === "en" ? ["en"] : ["en", requestLanguage];
  const entries = await Promise.all(
    languages.map(async (currentLanguage) => {
      const data = await window.electron.hydraApi
        .get<T>(endpoint, {
          params: { language: currentLanguage },
          needsAuth: false,
        })
        .catch(() => null);

      // A backend that doesn't implement this route (e.g. a self-hosted
      // instance) resolves with its error body instead of throwing, so drop
      // anything that isn't the shape the catalogue expects.
      return [currentLanguage, isValid(data) ? data : null] as const;
    })
  );
  const metadata = Object.fromEntries(
    entries.filter(([, data]) => data !== null)
  ) as Record<string, T>;

  if (metadata[requestLanguage])
    metadata[language] ??= metadata[requestLanguage];

  return metadata;
}

const isStringArray = (data: unknown): data is string[] =>
  Array.isArray(data) && data.every((entry) => typeof entry === "string");

const isTagRecord = (data: unknown): data is Record<string, number> =>
  typeof data === "object" &&
  data !== null &&
  !Array.isArray(data) &&
  Object.values(data).every((value) => typeof value === "number");

export function useCatalogue() {
  const dispatch = useAppDispatch();
  const { i18n } = useTranslation();

  const [steamPublishers, setSteamPublishers] = useState<string[]>([]);
  const [steamDevelopers, setSteamDevelopers] = useState<string[]>([]);
  const [downloadSources, setDownloadSources] = useState<DownloadSource[]>([]);

  const getSteamFilters = useCallback(async () => {
    const [tags, genres] = await Promise.all([
      getLocalizedSteamMetadata<Record<string, number>>(
        "/catalogue/steam/tags",
        i18n.language,
        isTagRecord
      ),
      getLocalizedSteamMetadata<string[]>(
        "/catalogue/steam/genres",
        i18n.language,
        isStringArray
      ),
    ]);

    dispatch(setTags(tags));
    dispatch(setGenres(genres));
  }, [dispatch, i18n.language]);

  const getSteamPublishers = useCallback(() => {
    window.electron.hydraApi
      .get<string[]>("/catalogue/steam/publishers", { needsAuth: false })
      .then((data) => setSteamPublishers(isStringArray(data) ? data : []))
      .catch(() => setSteamPublishers([]));
  }, []);

  const getSteamDevelopers = useCallback(() => {
    window.electron.hydraApi
      .get<string[]>("/catalogue/steam/developers", { needsAuth: false })
      .then((data) => setSteamDevelopers(isStringArray(data) ? data : []))
      .catch(() => setSteamDevelopers([]));
  }, []);

  const getDownloadSources = useCallback(() => {
    levelDBService.values("downloadSources").then((results) => {
      const sources = results as DownloadSource[];
      setDownloadSources(sources.filter((source) => !!source.fingerprint));
    });
  }, []);

  useEffect(() => {
    getSteamFilters();
    getSteamPublishers();
    getSteamDevelopers();
    getDownloadSources();
  }, [
    getSteamFilters,
    getSteamPublishers,
    getSteamDevelopers,
    getDownloadSources,
  ]);

  return { steamPublishers, downloadSources, steamDevelopers };
}
