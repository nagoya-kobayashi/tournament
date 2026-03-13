const APP_VERSION_KEY = "tournament_app_version";
const BOOTSTRAP_CACHE_KEY = "tournament_bootstrap_cache";

export function getBootstrapCache() {
  const raw = localStorage.getItem(BOOTSTRAP_CACHE_KEY);
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    return null;
  }
}

export function setBootstrapCache(payload) {
  localStorage.setItem(BOOTSTRAP_CACHE_KEY, JSON.stringify(payload));
}

async function clearClientCaches() {
  localStorage.removeItem(BOOTSTRAP_CACHE_KEY);
  localStorage.removeItem(APP_VERSION_KEY);
  sessionStorage.clear();
  if ("caches" in window) {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
  }
}

export async function enforceAppVersion(appVersion) {
  const current = localStorage.getItem(APP_VERSION_KEY);
  if (current && current !== appVersion) {
    await clearClientCaches();
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set("v", appVersion);
    nextUrl.searchParams.set("versionReset", "1");
    window.location.replace(nextUrl.toString());
    return false;
  }
  localStorage.setItem(APP_VERSION_KEY, appVersion);
  return true;
}

export function consumeVersionResetFlag() {
  const url = new URL(window.location.href);
  if (url.searchParams.get("versionReset") !== "1") {
    return false;
  }
  url.searchParams.delete("versionReset");
  window.history.replaceState({}, "", url.toString());
  return true;
}
