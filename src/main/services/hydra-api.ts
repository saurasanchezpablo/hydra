import axios, { AxiosError, AxiosInstance } from "axios";
import { WindowManager } from "./window-manager";
import url from "url";
import { uploadGamesBatch } from "./library-sync";
import { clearGamesRemoteIds } from "./library-sync/clear-games-remote-id";
import { networkLogger as logger } from "./logger";
import { UserNotLoggedInError, SubscriptionRequiredError } from "@shared";
import { appVersion } from "@main/constants";
import { getUserData } from "./user/get-user-data";
import { db } from "@main/level";
import { levelKeys } from "@main/level/sublevels";
import type { Auth, User } from "@types";
import { SSEClient } from "./sse";
import { sanitizeNetworkLogPayload } from "./network-log-payload";

export interface HydraApiOptions {
  needsAuth?: boolean;
  needsSubscription?: boolean;
  ifModifiedSince?: Date;
  ifNoneMatch?: string;
  validateStatus?: (status: number) => boolean;
  signal?: AbortSignal;
}

interface HydraApiUserAuth {
  authToken: string;
  refreshToken: string;
  expirationTimestamp: number;
  subscription: { expiresAt: Date | string | null } | null;
}

export class HydraApi {
  private static instance: AxiosInstance;
  private static officialInstance: AxiosInstance;

  private static readonly EXPIRATION_OFFSET_IN_MS = 1000 * 60 * 5; // 5 minutes
  private static readonly ADD_LOG_INTERCEPTOR = true;

  private static readonly OFFICIAL_ONLY_PREFIXES = [
    "/catalogue",
    "/games/",
    "/decky",
    "/auth/ws",
    "/download-sources",
  ];

  private static readonly OFFICIAL_ONLY_SUFFIXES = ["/reviews"];

  private static selfHostedConfig: {
    url: string;
    masterToken: string;
    userToken: string | null;
  } | null = null;

  public static useSelfHostedCatalogue = false;
  public static useSelfHostedReviews = false;
  public static useSelfHostedSocial = false;
  public static useSelfHostedDownloadSources = false;
  public static useSelfHostedHltb = false;
  public static useSelfHostedProtondb = false;

  public static setSelfHostedConfig(
    url: string,
    masterToken: string,
    userToken?: string | null,
    flags?: {
      useSelfHostedCatalogue?: boolean;
      useSelfHostedReviews?: boolean;
      useSelfHostedSocial?: boolean;
      useSelfHostedDownloadSources?: boolean;
    }
  ) {
    this.selfHostedConfig = { url, masterToken, userToken: userToken ?? null };
    if (this.instance) this.instance.defaults.baseURL = url;
    if (flags) {
      if (flags.useSelfHostedCatalogue !== undefined)
        this.useSelfHostedCatalogue = flags.useSelfHostedCatalogue;
      if (flags.useSelfHostedReviews !== undefined)
        this.useSelfHostedReviews = flags.useSelfHostedReviews;
      if (flags.useSelfHostedSocial !== undefined)
        this.useSelfHostedSocial = flags.useSelfHostedSocial;
      if (flags.useSelfHostedDownloadSources !== undefined)
        this.useSelfHostedDownloadSources = flags.useSelfHostedDownloadSources;
    }
  }

  public static setSelfHostedUserToken(userToken: string) {
    if (this.selfHostedConfig) this.selfHostedConfig.userToken = userToken;
  }

  public static clearSelfHostedConfig() {
    this.selfHostedConfig = null;
    if (this.instance)
      this.instance.defaults.baseURL = import.meta.env.MAIN_VITE_API_URL;
  }

  public static isSelfHosted() {
    return this.selfHostedConfig !== null;
  }

  public static getOfficialUserAuth() {
    if (!this.userAuth.authToken) return null;
    return this.userAuth;
  }

  public static async getOfficialProfile() {
    if (!this.userAuth.authToken) return null;
    return this.officialInstance
      .get("/profile/me", {
        headers: { Authorization: `Bearer ${this.userAuth.authToken}` },
      })
      .then((r) => r.data)
      .catch(() => null);
  }

  public static isSelfHostedAuthenticated() {
    return this.selfHostedConfig?.userToken != null;
  }

  private static officialAuthHeaders() {
    if (!this.userAuth.authToken) return {};
    return { Authorization: `Bearer ${this.userAuth.authToken}` };
  }

  public static async patchOfficial<T = unknown>(
    url: string,
    data?: unknown
  ): Promise<T> {
    return this.officialInstance
      .patch<T>(url, data, { headers: this.officialAuthHeaders() })
      .then((r) => r.data);
  }

  public static async postOfficial<T = unknown>(
    url: string,
    data?: unknown
  ): Promise<T> {
    return this.officialInstance
      .post<T>(url, data, { headers: this.officialAuthHeaders() })
      .then((r) => r.data);
  }

  // Routes catalogue requests to self-hosted if enabled, else official
  public static async cataloguePost<T = any>(
    url: string,
    data?: any
  ): Promise<T> {
    if (this.useSelfHostedCatalogue && this.selfHostedConfig) {
      const { default: axios } = await import("axios");
      return axios
        .post<T>(`${this.selfHostedConfig.url}${url}`, data, { timeout: 10000 })
        .then((r) => r.data);
    }
    return this.postOfficial<T>(url, data);
  }

  public static async catalogueGet<T = any>(
    url: string,
    params?: any
  ): Promise<T> {
    if (this.useSelfHostedCatalogue && this.selfHostedConfig) {
      const { default: axios } = await import("axios");
      return axios
        .get<T>(`${this.selfHostedConfig.url}${url}`, {
          params,
          timeout: 10000,
        })
        .then((r) => r.data);
    }
    return this.officialInstance
      .get<T>(url, { headers: this.officialAuthHeaders(), params })
      .then((r) => r.data);
  }

  private static selfHostedHeaders() {
    const token =
      this.selfHostedConfig!.userToken ?? this.selfHostedConfig!.masterToken;
    return { Authorization: `Bearer ${token}` };
  }

  public static async gameDataGet<T = any>(
    url: string,
    params?: any,
    flag = true
  ): Promise<T> {
    if (flag && this.selfHostedConfig) {
      const { default: axios } = await import("axios");
      return axios
        .get<T>(`${this.selfHostedConfig.url}${url}`, {
          params,
          timeout: 10000,
          headers: this.selfHostedHeaders(),
        })
        .then((r) => r.data);
    }
    return this.officialInstance
      .get<T>(url, { headers: this.officialAuthHeaders(), params })
      .then((r) => r.data);
  }

  public static async gameDataPost<T = any>(
    url: string,
    data?: any,
    flag = true
  ): Promise<T> {
    if (flag && this.selfHostedConfig) {
      const { default: axios } = await import("axios");
      return axios
        .post<T>(`${this.selfHostedConfig.url}${url}`, data, {
          timeout: 10000,
          headers: this.selfHostedHeaders(),
        })
        .then((r) => r.data);
    }
    return this.postOfficial<T>(url, data);
  }

  public static async gameDataPut<T = any>(
    url: string,
    data?: any,
    flag = true
  ): Promise<T> {
    if (flag && this.selfHostedConfig) {
      const { default: axios } = await import("axios");
      return axios
        .put<T>(`${this.selfHostedConfig.url}${url}`, data, {
          timeout: 10000,
          headers: this.selfHostedHeaders(),
        })
        .then((r) => r.data);
    }
    return this.officialInstance
      .put<T>(url, data, { headers: this.officialAuthHeaders() })
      .then((r) => r.data);
  }

  public static async gameDataDelete<T = any>(
    url: string,
    flag = true
  ): Promise<T> {
    if (flag && this.selfHostedConfig) {
      const { default: axios } = await import("axios");
      return axios
        .delete<T>(`${this.selfHostedConfig.url}${url}`, {
          timeout: 10000,
          headers: this.selfHostedHeaders(),
        })
        .then((r) => r.data);
    }
    return this.officialInstance
      .delete<T>(url, { headers: this.officialAuthHeaders() })
      .then((r) => r.data);
  }

  private static readonly UUID_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  private static isSocialUrl(url: string): boolean {
    return /^\/(profile\/blocks|features|badges|profile\/notifications)/.test(
      url
    );
  }

  private static isOfficialOnlyUrl(url: string) {
    // Download sources: route to self-hosted if toggle is on
    if (
      this.useSelfHostedDownloadSources &&
      url.startsWith("/download-sources")
    ) {
      return false;
    }
    if (this.OFFICIAL_ONLY_PREFIXES.some((prefix) => url.startsWith(prefix)))
      return true;
    if (this.OFFICIAL_ONLY_SUFFIXES.some((suffix) => url.includes(suffix)))
      return true;
    // /users/<id> — route to official if id is not a UUID (official uses short IDs)
    const usersMatch = url.match(/^\/users\/([^/?]+)/);
    if (usersMatch && !this.UUID_REGEX.test(usersMatch[1])) return true;
    return false;
  }

  private static getInstanceForUrl(url: string): AxiosInstance {
    if (this.selfHostedConfig && !this.isOfficialOnlyUrl(url)) {
      // Social URLs: route to official if toggle is off
      if (this.isSocialUrl(url) && !this.useSelfHostedSocial) {
        return this.officialInstance ?? this.instance;
      }
      return this.instance;
    }
    return this.officialInstance ?? this.instance;
  }

  private static secondsToMilliseconds(seconds: number) {
    return seconds * 1000;
  }

  private static userAuth: HydraApiUserAuth = {
    authToken: "",
    refreshToken: "",
    expirationTimestamp: 0,
    subscription: null,
  };

  public static isLoggedIn() {
    return this.userAuth.authToken !== "";
  }

  public static hasActiveSubscription() {
    if (this.selfHostedConfig) return true;
    const expiresAt = new Date(this.userAuth.subscription?.expiresAt ?? 0);
    return expiresAt > new Date();
  }

  public static updateUserSubscription(
    subscription?: { expiresAt: Date | string | null } | null
  ) {
    this.userAuth.subscription = subscription
      ? { expiresAt: subscription.expiresAt }
      : null;

    if (process.platform === "linux" && !this.hasActiveSubscription()) {
      void import("./linux-game-capture-session").then(
        ({ stopAllLinuxGameCaptureSessions }) => {
          if (!this.hasActiveSubscription()) {
            stopAllLinuxGameCaptureSessions();
          }
        }
      );
    }

    if (this.isLoggedIn() && this.hasActiveSubscription()) {
      void import("./achievements/grouped-souvenir-worker").then(
        ({ groupedSouvenirWorker }) => groupedSouvenirWorker.trigger()
      );
    }
  }

  static async handleExternalAuth(uri: string) {
    const { payload } = url.parse(uri, true).query;

    const decodedBase64 = atob(payload as string);
    const jsonData = JSON.parse(decodedBase64);

    const { accessToken, expiresIn, refreshToken, workwondersJwt } = jsonData;

    const now = new Date();

    const tokenExpirationTimestamp =
      now.getTime() +
      this.secondsToMilliseconds(expiresIn) -
      this.EXPIRATION_OFFSET_IN_MS;

    this.userAuth = {
      authToken: accessToken,
      refreshToken: refreshToken,
      expirationTimestamp: tokenExpirationTimestamp,
      subscription: null,
    };

    const { AchievementWatcherManager } = await import(
      "./achievements/achievement-watcher-manager"
    );
    AchievementWatcherManager.resetSessionState();

    logger.log(
      "Sign in received. Token expiration timestamp:",
      tokenExpirationTimestamp
    );

    db.put<string, Auth>(
      levelKeys.auth,
      {
        accessToken,
        refreshToken,
        tokenExpirationTimestamp,
        workwondersJwt,
      },
      { valueEncoding: "json" }
    );

    await getUserData().then((userDetails) => {
      if (userDetails?.subscription) {
        this.updateUserSubscription({
          expiresAt: userDetails.subscription.expiresAt
            ? new Date(userDetails.subscription.expiresAt)
            : null,
        });
      }
    });

    const { groupedSouvenirWorker } = await import(
      "./achievements/grouped-souvenir-worker"
    );
    void groupedSouvenirWorker.trigger();

    if (WindowManager.mainWindow) {
      if (this.selfHostedConfig) {
        // Official login while self-hosted is active — just notify UI, don't disturb self-hosted sync
        WindowManager.mainWindow.webContents.send("on-official-signin");
      } else {
        WindowManager.mainWindow.webContents.send("on-signin");
        await clearGamesRemoteIds();
        void uploadGamesBatch();

        SSEClient.close();
        SSEClient.connect();

        const { syncDownloadSourcesFromApi } = await import("./user");
        syncDownloadSourcesFromApi();
      }
    }
  }

  static async handleSignOut() {
    this.userAuth = {
      authToken: "",
      refreshToken: "",
      expirationTimestamp: 0,
      subscription: null,
    };

    const { AchievementWatcherManager } = await import(
      "./achievements/achievement-watcher-manager"
    );
    AchievementWatcherManager.resetSessionState();
    const { stopAllLinuxGameCaptureSessions } = await import(
      "./linux-game-capture-session"
    );
    stopAllLinuxGameCaptureSessions();
    const { groupedSouvenirWorker } = await import(
      "./achievements/grouped-souvenir-worker"
    );
    groupedSouvenirWorker.stop();

    this.sendSignOutEvent();
    this.post("/auth/logout", {}, { needsAuth: false }).catch(() => {});
  }

  static async setupApi() {
    this.instance = axios.create({
      baseURL: import.meta.env.MAIN_VITE_API_URL,
      headers: { "User-Agent": `Hydra Launcher v${appVersion}` },
    });

    this.officialInstance = axios.create({
      baseURL: import.meta.env.MAIN_VITE_API_URL,
      headers: { "User-Agent": `Hydra Launcher v${appVersion}` },
    });

    if (this.ADD_LOG_INTERCEPTOR) {
      this.instance.interceptors.request.use(
        (request) => {
          logger.log(" ---- REQUEST -----");
          logger.log(
            request.method,
            request.url,
            sanitizeNetworkLogPayload({
              params: request.params ?? null,
              data: request.data ?? null,
            })
          );
          return request;
        },
        (error) => {
          logger.error("request error", error);
          return Promise.reject(error);
        }
      );
      this.instance.interceptors.response.use(
        (response) => {
          logger.log(" ---- RESPONSE -----");
          logger.log(
            response.status,
            response.config.method,
            response.config.url,
            sanitizeNetworkLogPayload(response.data)
          );
          return response;
        },
        (error) => {
          logger.error(" ---- RESPONSE ERROR -----");
          const config = error.config ?? {};

          logger.error(
            config.method,
            config.baseURL,
            config.url,
            sanitizeNetworkLogPayload({
              headers: config.headers ?? null,
              data: config.data ?? null,
            })
          );
          if (error.response) {
            logger.error(
              "Response error:",
              error.response.status,
              sanitizeNetworkLogPayload(error.response.data)
            );

            return Promise.reject(error as Error);
          }

          if (error.request) {
            const errorData = error.toJSON();
            logger.error("Request error:", errorData.code, errorData.message);
            return Promise.reject(
              new Error(
                `Request failed with ${errorData.code} ${errorData.message}`
              )
            );
          }

          logger.error("Error", error.message);
          return Promise.reject(error as Error);
        }
      );
    }

    const result = await db.getMany<string>(
      [levelKeys.auth, levelKeys.user, levelKeys.userPreferences],
      { valueEncoding: "json" }
    );

    const userAuth = result.at(0) as Auth | undefined;
    const user = result.at(1) as User | undefined;
    const userPreferences = result.at(2) as
      | import("@types").UserPreferences
      | undefined;

    if (
      userPreferences?.selfHostedApiUrl &&
      userPreferences?.selfHostedApiToken
    ) {
      // Check if self-hosted session has expired
      const durationDays = userPreferences.selfHostedSessionDurationDays ?? 30;
      const issuedAt = userPreferences.selfHostedTokenIssuedAt ?? 0;
      const expired =
        durationDays > 0 &&
        issuedAt > 0 &&
        Date.now() - issuedAt > durationDays * 24 * 60 * 60 * 1000;

      this.setSelfHostedConfig(
        userPreferences.selfHostedApiUrl,
        userPreferences.selfHostedApiToken,
        expired ? null : userPreferences.selfHostedUserToken
      );
      this.useSelfHostedCatalogue =
        userPreferences.useSelfHostedCatalogue ?? false;
      this.useSelfHostedReviews = userPreferences.useSelfHostedReviews ?? false;
      this.useSelfHostedHltb = userPreferences.useSelfHostedHltb ?? false;
      this.useSelfHostedProtondb =
        userPreferences.useSelfHostedProtondb ?? false;
    }

    this.userAuth = {
      authToken: userAuth?.accessToken ?? "",
      refreshToken: userAuth?.refreshToken ?? "",
      expirationTimestamp: userAuth?.tokenExpirationTimestamp ?? 0,
      subscription: user?.subscription
        ? { expiresAt: user.subscription?.expiresAt }
        : null,
    };

    if (!this.selfHostedConfig) {
      const updatedUserData = await getUserData();

      this.userAuth.subscription = updatedUserData?.subscription
        ? {
            expiresAt: updatedUserData.subscription.expiresAt,
          }
        : null;
    } else if (this.selfHostedConfig.userToken) {
      // Self-hosted with userToken — sync library on startup
      const { uploadGamesBatch } = await import("./library-sync");
      await clearGamesRemoteIds();
      void uploadGamesBatch();
    }
  }

  private static sendSignOutEvent() {
    WindowManager.sendToAppWindows("on-signout");
  }

  public static async refreshToken() {
    const response = await this.instance.post(`/auth/refresh`, {
      refreshToken: this.userAuth.refreshToken,
    });

    const { accessToken, expiresIn } = response.data;

    const tokenExpirationTimestamp =
      Date.now() +
      this.secondsToMilliseconds(expiresIn) -
      this.EXPIRATION_OFFSET_IN_MS;

    this.userAuth.authToken = accessToken;
    this.userAuth.expirationTimestamp = tokenExpirationTimestamp;

    logger.log(
      "Token refreshed. New expiration:",
      this.userAuth.expirationTimestamp
    );

    await db
      .get<string, Auth>(levelKeys.auth, { valueEncoding: "json" })
      .then((auth) => {
        return db.put<string, Auth>(
          levelKeys.auth,
          {
            ...auth,
            accessToken,
            tokenExpirationTimestamp,
          },
          { valueEncoding: "json" }
        );
      });

    return { accessToken, expiresIn };
  }

  private static async revalidateAccessTokenIfExpired() {
    if (this.userAuth.expirationTimestamp < Date.now()) {
      try {
        await this.refreshToken();
      } catch (err) {
        await this.handleUnauthorizedError(err);
      }
    }
  }

  private static getAxiosConfig(url?: string) {
    const isSocialOverride =
      url && this.isSocialUrl(url) && !this.useSelfHostedSocial;
    const useSelfHosted =
      this.selfHostedConfig &&
      url &&
      !this.isOfficialOnlyUrl(url) &&
      !isSocialOverride;
    if (useSelfHosted) {
      const token =
        this.selfHostedConfig!.userToken ?? this.selfHostedConfig!.masterToken;
      return { headers: { Authorization: `Bearer ${token}` } };
    }
    // Official request — use official token if available
    if (this.userAuth.authToken) {
      return {
        headers: { Authorization: `Bearer ${this.userAuth.authToken}` },
      };
    }
    return { headers: {} };
  }

  private static readonly handleUnauthorizedError = async (err) => {
    if (err instanceof AxiosError && err.response?.status === 401) {
      if (this.selfHostedConfig) throw err;

      logger.error(
        "401 - Current credentials:",
        sanitizeNetworkLogPayload({
          credentials: this.userAuth,
          response: err.response?.data,
        })
      );

      this.userAuth = {
        authToken: "",
        expirationTimestamp: 0,
        refreshToken: "",
        subscription: null,
      };

      const { AchievementWatcherManager } = await import(
        "./achievements/achievement-watcher-manager"
      );
      AchievementWatcherManager.resetSessionState();

      const { stopAllLinuxGameCaptureSessions } = await import(
        "./linux-game-capture-session"
      );
      stopAllLinuxGameCaptureSessions();
      const { groupedSouvenirWorker } = await import(
        "./achievements/grouped-souvenir-worker"
      );
      groupedSouvenirWorker.stop();

      db.batch([
        {
          type: "del",
          key: levelKeys.auth,
        },
        {
          type: "del",
          key: levelKeys.user,
        },
      ]);

      SSEClient.close();
      this.sendSignOutEvent();
    }

    throw err;
  };

  private static async validateOptions(url: string, options?: HydraApiOptions) {
    const isOfficial = !this.selfHostedConfig || this.isOfficialOnlyUrl(url);

    const needsAuth = options?.needsAuth == undefined || options.needsAuth;
    const needsSubscription = options?.needsSubscription === true;

    if (!isOfficial) return;

    // In self-hosted mode, official-only requests are best-effort (no official JWT)
    if (this.selfHostedConfig) return;

    if (needsAuth) {
      if (!this.isLoggedIn()) throw new UserNotLoggedInError();
      await this.revalidateAccessTokenIfExpired();
    }

    if (needsSubscription && !this.hasActiveSubscription()) {
      await this.refreshUserSubscription();

      if (!this.hasActiveSubscription()) {
        throw new SubscriptionRequiredError();
      }
    }
  }

  private static async refreshUserSubscription() {
    if (!this.isLoggedIn()) return;

    try {
      const userDetails = await getUserData();
      if (userDetails) this.updateUserSubscription(userDetails.subscription);
    } catch (err) {
      logger.error("Failed to refresh subscription state", err);
    }
  }

  static async get<T = any>(
    url: string,
    params?: any,
    options?: HydraApiOptions
  ) {
    await this.validateOptions(url, options);

    const headers = {
      ...this.getAxiosConfig(url).headers,
      "Hydra-If-Modified-Since": options?.ifModifiedSince?.toUTCString(),
      "If-None-Match": options?.ifNoneMatch,
    };

    return this.getInstanceForUrl(url)
      .get<T>(url, {
        params,
        ...this.getAxiosConfig(url),
        headers,
        validateStatus: options?.validateStatus,
        signal: options?.signal,
      })
      .then((response) => response.data)
      .catch(this.handleUnauthorizedError);
  }

  static async getResponse<T = any>(
    url: string,
    params?: any,
    options?: HydraApiOptions
  ) {
    await this.validateOptions(url, options);

    const headers = {
      ...this.getAxiosConfig(url).headers,
      "Hydra-If-Modified-Since": options?.ifModifiedSince?.toUTCString(),
      "If-None-Match": options?.ifNoneMatch,
    };

    return this.getInstanceForUrl(url)
      .get<T>(url, {
        params,
        ...this.getAxiosConfig(url),
        headers,
        validateStatus: options?.validateStatus,
        signal: options?.signal,
      })
      .then((response) => ({
        status: response.status,
        data: response.data,
        headers: response.headers,
      }))
      .catch(this.handleUnauthorizedError);
  }

  static async post<T = any>(
    url: string,
    data?: any,
    options?: HydraApiOptions
  ) {
    await this.validateOptions(url, options);

    return this.getInstanceForUrl(url)
      .post<T>(url, data, {
        ...this.getAxiosConfig(url),
        signal: options?.signal,
      })
      .then((response) => response.data)
      .catch(this.handleUnauthorizedError);
  }

  static async postResponse<T = unknown>(
    url: string,
    data?: unknown,
    options?: HydraApiOptions
  ) {
    await this.validateOptions(url, options);

    return this.instance
      .post<T>(url, data, {
        ...this.getAxiosConfig(),
        validateStatus: options?.validateStatus,
        signal: options?.signal,
      })
      .then((response) => ({
        status: response.status,
        data: response.data,
      }))
      .catch(this.handleUnauthorizedError);
  }

  static async put<T = any>(
    url: string,
    data?: any,
    options?: HydraApiOptions
  ) {
    await this.validateOptions(url, options);

    return this.getInstanceForUrl(url)
      .put<T>(url, data, {
        ...this.getAxiosConfig(url),
        signal: options?.signal,
      })
      .then((response) => response.data)
      .catch(this.handleUnauthorizedError);
  }

  static async patch<T = any>(
    url: string,
    data?: any,
    options?: HydraApiOptions
  ) {
    await this.validateOptions(url, options);

    return this.getInstanceForUrl(url)
      .patch<T>(url, data, {
        ...this.getAxiosConfig(url),
        signal: options?.signal,
      })
      .then((response) => response.data)
      .catch(this.handleUnauthorizedError);
  }

  static async delete<T = any>(url: string, options?: HydraApiOptions) {
    await this.validateOptions(url, options);

    return this.getInstanceForUrl(url)
      .delete<T>(url, {
        ...this.getAxiosConfig(url),
        signal: options?.signal,
      })
      .then((response) => response.data)
      .catch(this.handleUnauthorizedError);
  }

  static async checkDownloadSourcesChanges(
    downloadSourceIds: string[],
    games: Array<{ shop: string; objectId: string }>,
    since: string
  ) {
    logger.info("HydraApi.checkDownloadSourcesChanges called with:", {
      downloadSourceIds,
      gamesCount: games.length,
      since,
      isLoggedIn: this.isLoggedIn(),
    });

    try {
      const result = await this.post<
        Array<{
          shop: string;
          objectId: string;
          newDownloadOptionsCount: number;
          downloadSourceIds: string[];
        }>
      >(
        "/download-sources/changes",
        {
          downloadSourceIds,
          games,
          since,
        },
        { needsAuth: true }
      );

      logger.info(
        "HydraApi.checkDownloadSourcesChanges completed successfully:",
        result
      );
      return result;
    } catch (error) {
      logger.error("HydraApi.checkDownloadSourcesChanges failed:", error);
      throw error;
    }
  }
}
