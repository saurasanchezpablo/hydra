import { registerEvent } from "../register-event";
import { HydraApi } from "@main/services";
import {
  steamCatalogueSearch,
  steamShopDetails,
  steamGameBasic,
  steamCatalogueCategory,
  steamSearchSuggestions,
} from "@main/services/steam-catalogue";
import axios from "axios";
import type { HowLongToBeatCategory } from "@types";

interface HydraApiCallPayload {
  method: "get" | "post" | "postResponse" | "put" | "patch" | "delete";
  url: string;
  data?: unknown;
  params?: unknown;
  options?: {
    needsAuth?: boolean;
    needsSubscription?: boolean;
    ifModifiedSince?: Date;
    acceptedStatuses?: number[];
  };
}

const hltbCache = new Map<string, HowLongToBeatCategory[] | null>();
const HLTB_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

async function fetchHltbDirect(
  shop: string,
  objectId: string
): Promise<HowLongToBeatCategory[] | null> {
  const cacheKey = `${shop}:${objectId}`;
  if (hltbCache.has(cacheKey)) return hltbCache.get(cacheKey)!;

  const steamRes = await axios
    .get("https://store.steampowered.com/api/appdetails", {
      params: { appids: objectId, l: "english", cc: "us" },
      timeout: 8000,
    })
    .catch(() => null);
  const appData = steamRes?.data?.[objectId];
  if (!appData?.success) {
    hltbCache.set(cacheKey, null);
    return null;
  }

  const name = appData.data?.name;
  if (!name) {
    hltbCache.set(cacheKey, null);
    return null;
  }

  const initHeaders = {
    "User-Agent": HLTB_UA,
    Referer: "https://howlongtobeat.com",
  };
  const auth = await axios
    .get(`https://howlongtobeat.com/api/bleed/init?t=${Date.now()}`, {
      headers: initHeaders,
      timeout: 8000,
    })
    .catch(() => null);

  if (!auth?.data?.token) {
    hltbCache.set(cacheKey, null);
    return null;
  }
  const { token, hpKey, hpVal } = auth.data;

  const res = await axios
    .post(
      "https://howlongtobeat.com/api/bleed",
      {
        [hpKey]: hpVal,
        searchType: "games",
        searchTerms: name.split(" "),
        searchPage: 1,
        size: 1,
        searchOptions: {
          games: {
            userId: 0,
            platform: "",
            sortCategory: "popular",
            rangeCategory: "main",
            rangeTime: { min: 0, max: 0 },
            gameplay: { perspective: "", flow: "", genre: "", difficulty: "" },
            modifier: "",
          },
          filter: "",
          sort: 0,
          randomizer: 0,
        },
      },
      {
        headers: {
          "Content-Type": "application/json",
          Accept: "*/*",
          "User-Agent": HLTB_UA,
          Referer: "https://howlongtobeat.com",
          "X-Auth-Token": token,
          "X-Hp-Key": hpKey,
          "X-Hp-Val": hpVal,
        },
        timeout: 10000,
      }
    )
    .catch(() => null);

  const game = res?.data?.data?.[0];
  if (!game) {
    hltbCache.set(cacheKey, null);
    return null;
  }

  const fmt = (secs: number) =>
    secs < 3600
      ? `${Math.round(secs / 60)} Mins`
      : `${Math.round(secs / 3600)} Hours`;
  const categories: HowLongToBeatCategory[] = [];
  if (game.comp_main)
    categories.push({
      title: "Main Story",
      duration: fmt(game.comp_main),
      accuracy: "average",
    });
  if (game.comp_plus)
    categories.push({
      title: "Main + Extras",
      duration: fmt(game.comp_plus),
      accuracy: "average",
    });
  if (game.comp_100)
    categories.push({
      title: "Completionist",
      duration: fmt(game.comp_100),
      accuracy: "average",
    });

  hltbCache.set(cacheKey, categories.length ? categories : null);
  return categories.length ? categories : null;
}

async function fetchProtondbDirect(objectId: string) {
  const res = await axios
    .get(`https://www.protondb.com/api/v1/reports/summaries/${objectId}.json`, {
      timeout: 8000,
    })
    .catch(() => null);
  return res?.data ?? null;
}

const hydraApiCall = async (
  _event: Electron.IpcMainInvokeEvent,
  payload: HydraApiCallPayload
) => {
  const { method, url, data, params, options } = payload;
  const hydraApiOptions = {
    ...options,
    validateStatus: options?.acceptedStatuses
      ? (status: number) =>
          status !== 401 &&
          (options.acceptedStatuses?.includes(status) ?? false)
      : undefined,
  };

  const getErrorMessage = (error: unknown): string | null => {
    if (typeof error === "object" && error !== null) {
      const msg = (error as any).response?.data?.message;
      if (typeof msg === "string") return msg;
    }

    if (error instanceof Error && error.message) {
      return error.message;
    }

    return null;
  };

  try {
    let request: Promise<unknown>;

    const hltbMatch = url.match(/^\/games\/([^/]+)\/([^/]+)\/how-long-to-beat/);
    const protondbMatch = url.match(/^\/games\/([^/]+)\/([^/]+)\/protondb/);
    const isReviewsUrl =
      url.match(/^\/(games\/[^/]+\/[^/]+\/reviews|users\/[^/]+\/reviews)/) !==
      null;

    if (hltbMatch) {
      return fetchHltbDirect(hltbMatch[1], hltbMatch[2]);
    }

    if (protondbMatch) {
      return fetchProtondbDirect(protondbMatch[2]);
    }

    // Steam catalogue — runs client-side via net.fetch, no self-hosted needed
    const steamIdMatch = url.match(/^\/games\/steam\/(\d+)$/);
    const categoryMatch = url.match(/^\/catalogue\/(hot|weekly|achievements)$/);

    if (HydraApi.useSelfHostedCatalogue) {
      if (url === "/catalogue/search" && method === "post") {
        request = steamCatalogueSearch(data);
      } else if (url === "/games/shop-details" && method === "post") {
        request = steamShopDetails(data);
      } else if (steamIdMatch) {
        const lang = (params as any)?.l ?? "english";
        request = steamGameBasic(steamIdMatch[1], lang);
      } else if (categoryMatch) {
        const take = parseInt((params as any)?.take ?? "12");
        request = steamCatalogueCategory(categoryMatch[1], take);
      } else if (url === "/catalogue/search/suggestions") {
        const q = (params as any)?.query ?? "";
        const limit = parseInt((params as any)?.limit ?? "5");
        request = steamSearchSuggestions(q, limit);
      } else {
        request = HydraApi.get(url, params, hydraApiOptions);
      }
    } else if (isReviewsUrl && HydraApi.useSelfHostedReviews) {
      switch (method) {
        case "get":
          request = HydraApi.gameDataGet(url, params);
          break;
        case "post":
          request = HydraApi.gameDataPost(url, data);
          break;
        case "put":
          request = HydraApi.gameDataPut(url, data);
          break;
        case "delete":
          request = HydraApi.gameDataDelete(url);
          break;
        default:
          request = HydraApi.get(url, params, hydraApiOptions);
      }
    } else {
      switch (method) {
        case "get":
          request = HydraApi.get(url, params, hydraApiOptions);
          break;
        case "post":
          request = HydraApi.post(url, data, hydraApiOptions);
          break;
        case "postResponse":
          request = HydraApi.postResponse(url, data, hydraApiOptions);
          break;
        case "put":
          request = HydraApi.put(url, data, hydraApiOptions);
          break;
        case "patch":
          request = HydraApi.patch(url, data, hydraApiOptions);
          break;
        case "delete":
          request = HydraApi.delete(url, hydraApiOptions);
          break;
        default:
          throw new Error(`Unsupported HTTP method: ${method}`);
      }
    }

    return await request;
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    throw new Error(errorMessage ?? "hydra-api-call-failed");
  }
};

registerEvent("hydraApiCall", hydraApiCall);
