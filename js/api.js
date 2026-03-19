function buildGetUrl(baseUrl, action) {
  const url = new URL(baseUrl, window.location.href);
  url.searchParams.set("action", action);
  return url.toString();
}

async function fetchJson(url, options = {}) {
  let response;
  try {
    response = await fetch(url, {
      headers: {
        Accept: "application/json",
        ...(options.headers || {}),
      },
      ...options,
    });
  } catch (error) {
    console.error("[api] fetch failed", {
      url,
      method: options.method || "GET",
      error,
    });
    const err = new Error("FETCH_FAILED");
    err.payload = { errorCode: "FETCH_FAILED" };
    throw err;
  }

  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch (error) {
    console.error("[api] json parse failed", {
      url,
      method: options.method || "GET",
      status: response.status,
      text,
    });
    throw new Error("JSON_PARSE_ERROR");
  }

  if (!response.ok || (payload && payload.ok === false)) {
    console.error("[api] request failed", {
      url,
      method: options.method || "GET",
      status: response.status,
      payload,
    });
    const message = (payload && (payload.message || payload.errorCode)) || response.statusText || "REQUEST_FAILED";
    const err = new Error(message);
    err.payload = payload;
    throw err;
  }

  return payload;
}

export function createApi(config) {
  const gasUrl = (config.GAS_WEB_APP_URL || "").trim();
  const mode = gasUrl ? "remote" : "missing";

  return {
    mode,
    isReadOnly() {
      return mode !== "remote";
    },
    async bootstrap() {
      if (mode === "missing") {
        const error = new Error("CONFIG_MISSING");
        error.payload = { errorCode: "CONFIG_MISSING" };
        throw error;
      }
      return fetchJson(buildGetUrl(gasUrl, "bootstrap"));
    },
    async meta() {
      if (mode === "missing") {
        const error = new Error("CONFIG_MISSING");
        error.payload = { errorCode: "CONFIG_MISSING" };
        throw error;
      }
      return fetchJson(buildGetUrl(gasUrl, "meta"));
    },
    async submitResult(body) {
      if (mode !== "remote") {
        const error = new Error("READ_ONLY");
        error.payload = { errorCode: "READ_ONLY" };
        throw error;
      }
      return fetchJson(gasUrl, {
        method: "POST",
        headers: {
          "Content-Type": "text/plain;charset=utf-8",
        },
        body: JSON.stringify({
          action: "submitResult",
          ...body,
        }),
      });
    },
    async saveAdminEvent(body) {
      if (mode !== "remote") {
        const error = new Error("READ_ONLY");
        error.payload = { errorCode: "READ_ONLY" };
        throw error;
      }
      return fetchJson(gasUrl, {
        method: "POST",
        headers: {
          "Content-Type": "text/plain;charset=utf-8",
        },
        body: JSON.stringify({
          action: "saveAdminEvent",
          ...body,
        }),
      });
    },
    async saveClassSettings(body) {
      if (mode !== "remote") {
        const error = new Error("READ_ONLY");
        error.payload = { errorCode: "READ_ONLY" };
        throw error;
      }
      return fetchJson(gasUrl, {
        method: "POST",
        headers: {
          "Content-Type": "text/plain;charset=utf-8",
        },
        body: JSON.stringify({
          action: "saveClassSettings",
          ...body,
        }),
      });
    },
  };
}
