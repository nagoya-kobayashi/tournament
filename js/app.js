import { createApi } from "./api.js";
import { renderClassSchedule } from "./render-class.js";
import { renderEventDetail } from "./render-event.js";
import { renderHome } from "./render-home.js";
import { renderResultModal } from "./render-result-modal.js";
import { parseRoute, toHref } from "./router.js";
import {
  applyOptimisticResult,
  clearAllPendingSync,
  clearBanner,
  closeModal,
  getClassIds,
  getClassSchedule,
  getEventDetail,
  getHomeData,
  hasPendingSync,
  isEditorPinRequired,
  getModalMatch,
  getRouteData,
  getState,
  openModal,
  setBanner,
  setBootstrap,
  setConfig,
  setEventFilter,
  setModalError,
  setMode,
  setRoute,
  setScheduleTab,
} from "./store.js";
import {
  consumeVersionResetFlag,
  enforceAppVersion,
  getBootstrapCache,
  setBootstrapCache,
} from "./version.js";

const appRoot = document.getElementById("app");
const bannerRoot = document.getElementById("system-banner");
const modalBackdrop = document.getElementById("modal-backdrop");
const modalRoot = document.getElementById("modal-root");
const siteTitle = document.getElementById("site-title");

const config = window.APP_CONFIG || {};
const api = createApi(config);
const sessionId = getSessionId();
const configuredAppVersion = String(config.APP_VERSION || "").trim();

let pollTimer = null;
let bannerTimer = null;
let confirmedBootstrap = null;
let submissionQueue = [];
let isProcessingQueue = false;

setConfig(config);
siteTitle.textContent = config.APP_NAME || "球技大会ライブ";

function getSessionId() {
  const key = "tournament_session_id";
  const existing = sessionStorage.getItem(key);
  if (existing) {
    return existing;
  }
  const created = `anon-${Math.random().toString(36).slice(2, 10)}`;
  sessionStorage.setItem(key, created);
  return created;
}

function clonePayload(value) {
  return value ? JSON.parse(JSON.stringify(value)) : null;
}

function humanizeError(error) {
  const code = (error && error.payload && error.payload.errorCode) || (error && error.message) || "SERVER_ERROR";
  const messages = {
    CONFIG_MISSING: "config.js の GAS URL が未設定です。URL を設定してください。",
    SETUP_REQUIRED: "GAS 側の初期化が未実施です。デプロイ済み URL の ?page=setup から初期データを投入してください。",
    SPREADSHEET_NOT_BOUND: "GAS がスプレッドシートに紐付いていません。セットアップ画面で接続先を指定してください。",
    INVALID_PIN: "PIN が一致しません。試験運用で PIN を無効にした場合は、最新の GAS と app_config.csv を反映してください。",
    MATCH_NOT_READY: "参加者が確定していないため保存できません。",
    WINNER_NOT_IN_MATCH: "選択した勝者がこの試合に含まれていません。",
    READ_ONLY: "現在は read-only 表示のため結果保存できません。",
    FETCH_FAILED: "GAS へ送信できませんでした。公開範囲または再デプロイ直後の反映待ちを確認してください。詳細はブラウザのコンソールに出力しています。",
    JSON_PARSE_ERROR: "サーバ応答を読み取れませんでした。",
    SERVER_ERROR: "サーバでエラーが発生しました。",
  };
  return messages[code] || `エラー: ${code}`;
}

function renderBanner() {
  const banner = getState().banner;
  if (bannerTimer) {
    window.clearTimeout(bannerTimer);
    bannerTimer = null;
  }
  if (!banner) {
    bannerRoot.className = "system-banner hidden";
    bannerRoot.textContent = "";
    return;
  }
  bannerRoot.className = `system-banner ${banner.type || "warn"}`;
  bannerRoot.textContent = banner.message;
  if (Number(banner.durationMs) > 0) {
    bannerTimer = window.setTimeout(() => {
      clearBanner();
      renderBanner();
    }, Number(banner.durationMs));
  }
}

function debugLog(scope, error) {
  console.error(`[app] ${scope}`, error);
}

function resolveAppVersion(serverAppVersion) {
  const remote = String(serverAppVersion || "").trim();
  if (configuredAppVersion && remote && configuredAppVersion !== remote) {
    console.warn("[app] APP_VERSION mismatch", {
      configuredAppVersion,
      remoteAppVersion: remote,
    });
  }
  return configuredAppVersion || remote;
}

function renderConfigError(message) {
  const gasUrl = (config.GAS_WEB_APP_URL || "").trim();
  const setupUrl = gasUrl ? `${gasUrl}?page=setup` : "";
  appRoot.innerHTML = `
    <section class="panel">
      <div class="panel-header">
        <div>
          <h2 class="panel-title">設定不足</h2>
          <p class="muted">${message}</p>
        </div>
      </div>
      <div class="empty-state">
        <p><code>config.js</code> の <code>GAS_WEB_APP_URL</code> を設定してください。</p>
        <p>GAS 利用時は <code>?page=setup</code> のセットアップ画面で、CSV 5 ファイルを投入してください。</p>
        ${setupUrl ? `<p><a class="button primary" href="${setupUrl}" target="_blank" rel="noreferrer">セットアップ画面を開く</a></p>` : ""}
      </div>
    </section>
  `;
}

function mergeMatchesIntoPayload(basePayload, updatedMatches, meta = {}) {
  const nextPayload = clonePayload(basePayload) || {};
  const replaceMap = new Map((updatedMatches || []).map((item) => [item.match_id, item]));
  nextPayload.matches = ((nextPayload.matches || []).map((match) => replaceMap.get(match.match_id) || match));
  if (meta.dataVersion) {
    nextPayload.dataVersion = meta.dataVersion;
  }
  if (meta.currentWeatherMode) {
    nextPayload.currentWeatherMode = meta.currentWeatherMode;
  }
  if (meta.generatedAt) {
    nextPayload.generatedAt = meta.generatedAt;
  }
  return nextPayload;
}

function rebuildOptimisticState() {
  if (!confirmedBootstrap) {
    return;
  }
  setBootstrap(clonePayload(confirmedBootstrap));
  clearAllPendingSync();
  for (const entry of submissionQueue) {
    const requestBody = entry.requestBody;
    const applied = applyOptimisticResult({
      matchId: requestBody.matchId,
      winnerTeamId: requestBody.winnerTeamId,
      scoreText: requestBody.scoreText,
      correctionNote: requestBody.correctionNote,
      sessionId: (requestBody.clientContext && requestBody.clientContext.sessionId) || sessionId,
      clearResult: !!requestBody.clearResult,
    });
    if (!applied) {
      console.warn("[app] optimistic replay skipped", requestBody);
    }
  }
}

function renderCurrentRoute() {
  const route = getRouteData();

  if (!getState().bootstrap) {
    appRoot.innerHTML = `
      <section class="panel">
        <div class="panel-header">
          <div>
            <h2 class="panel-title">読み込み中</h2>
            <p class="muted">大会データを取得しています。</p>
          </div>
        </div>
      </section>
    `;
    renderModal();
    renderBanner();
    return;
  }

  if (route.name === "event") {
    const detail = getEventDetail(route.params.eventId);
    if (detail) {
      appRoot.innerHTML = renderEventDetail(detail);
    } else {
      window.location.hash = toHref("home");
      return;
    }
  } else if (route.name === "class") {
    if (!getClassIds().includes(route.params.classId)) {
      window.location.hash = toHref("home");
      return;
    }
    appRoot.innerHTML = renderClassSchedule(getClassSchedule(route.params.classId));
  } else {
    appRoot.innerHTML = renderHome(getHomeData());
  }

  renderModal();
  renderBanner();
}

function renderModal() {
  const modalData = getModalMatch();
  if (!modalData) {
    modalBackdrop.classList.add("hidden");
    modalRoot.innerHTML = "";
    return;
  }
  modalBackdrop.classList.remove("hidden");
  modalRoot.innerHTML = renderResultModal(modalData);
}

async function processSubmissionQueue() {
  if (isProcessingQueue || !submissionQueue.length) {
    return;
  }

  isProcessingQueue = true;
  while (submissionQueue.length) {
    const entry = submissionQueue[0];
    const actionLabel = entry.requestBody.clearResult ? "保存済み結果を削除しました。" : "結果を保存しました。";
    const actionFailedLabel = entry.requestBody.clearResult ? "削除に失敗しました。" : "保存に失敗しました。";
    try {
      const response = await api.submitResult(entry.requestBody);
      submissionQueue.shift();
      confirmedBootstrap = mergeMatchesIntoPayload(confirmedBootstrap || getState().bootstrap, response.updatedMatches || [], {
        dataVersion: response.dataVersion,
        currentWeatherMode: response.currentWeatherMode,
        generatedAt: response.updatedAt,
      });
      setBootstrapCache(clonePayload(confirmedBootstrap));
      rebuildOptimisticState();
      setBanner(
        submissionQueue.length
          ? `${actionLabel} 残り ${submissionQueue.length} 件を送信しています。`
          : actionLabel,
        "info"
      );
      renderCurrentRoute();
    } catch (error) {
      submissionQueue.shift();
      debugLog("submitResult", error);
      rebuildOptimisticState();
      const suffix = submissionQueue.length ? ` 残り ${submissionQueue.length} 件は送信待ちのままです。` : "";
      setBanner(`${humanizeError(error)} 1件の${actionFailedLabel}${suffix}`, "warn", { durationMs: 6500 });
      renderCurrentRoute();
    }
  }
  isProcessingQueue = false;
}

async function applyBootstrap(payload, { mode, readOnly, bannerMessage = "" } = {}) {
  const effectiveAppVersion = resolveAppVersion(payload.appVersion);
  const versionOk = await enforceAppVersion(effectiveAppVersion);
  if (!versionOk) {
    return;
  }
  const nextPayload = {
    ...payload,
    appVersion: effectiveAppVersion,
  };
  confirmedBootstrap = clonePayload(nextPayload);
  setMode(mode || api.mode, typeof readOnly === "boolean" ? readOnly : api.isReadOnly());
  setBootstrap(clonePayload(nextPayload));
  setBootstrapCache(clonePayload(confirmedBootstrap));

  if (consumeVersionResetFlag()) {
    setBanner("更新を検知しました。端末データを初期化して再読み込みしました。", "info");
  } else if (bannerMessage) {
    setBanner(bannerMessage, readOnly ? "warn" : "info");
  } else {
    clearBanner();
  }
  renderCurrentRoute();
}

async function loadBootstrap() {
  try {
    const payload = await api.bootstrap();
    await applyBootstrap(payload, { mode: api.mode, readOnly: api.isReadOnly() });
    if (api.mode === "remote") {
      startMetaPolling();
    }
  } catch (error) {
    debugLog("loadBootstrap", error);
    const cached = getBootstrapCache();
    if (cached) {
      await applyBootstrap(cached, {
        mode: "cache",
        readOnly: true,
        bannerMessage: "通信できないため最新化に失敗しました。保存済みデータを表示中です。",
      });
      return;
    }
    renderConfigError(humanizeError(error));
    setBanner(humanizeError(error), "warn");
    renderBanner();
  }
}

async function pollMeta() {
  if (api.mode !== "remote" || !getState().bootstrap || hasPendingSync()) {
    return;
  }
  try {
    const meta = await api.meta();
    const current = confirmedBootstrap || getState().bootstrap;
    if (!current) {
      return;
    }
    const metaAppVersion = resolveAppVersion(meta.appVersion);
    if (metaAppVersion !== current.appVersion) {
      await enforceAppVersion(metaAppVersion);
      return;
    }
    if (meta.dataVersion !== current.dataVersion) {
      const fresh = await api.bootstrap();
      await applyBootstrap(fresh, {
        mode: "remote",
        readOnly: false,
        bannerMessage: "新しい結果を反映しました。",
      });
    }
  } catch (error) {
    debugLog("pollMeta", error);
    setBanner("更新確認に失敗しました。表示中データで継続します。", "warn");
    renderBanner();
  }
}

function startMetaPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
  }
  pollTimer = window.setInterval(pollMeta, Number(config.POLL_INTERVAL_MS || 60000));
}

window.addEventListener("hashchange", () => {
  setRoute(parseRoute(window.location.hash));
  renderCurrentRoute();
});

document.addEventListener("click", (event) => {
  const matchButton = event.target.closest("[data-match-id]");
  if (matchButton) {
    openModal(matchButton.getAttribute("data-match-id"));
    renderModal();
    return;
  }

  const filterButton = event.target.closest("[data-action='set-filter']");
  if (filterButton) {
    setEventFilter(filterButton.getAttribute("data-filter"));
    renderCurrentRoute();
    return;
  }

  const scheduleTabButton = event.target.closest("[data-action='set-schedule-day']");
  if (scheduleTabButton) {
    setScheduleTab(
      scheduleTabButton.getAttribute("data-schedule-kind"),
      scheduleTabButton.getAttribute("data-schedule-target"),
      scheduleTabButton.getAttribute("data-day-no")
    );
    renderCurrentRoute();
    return;
  }

  const retryButton = event.target.closest("[data-action='retry-bootstrap']");
  if (retryButton) {
    if (hasPendingSync()) {
      setBanner("結果送信中は再読み込みできません。", "warn");
      renderBanner();
      return;
    }
    loadBootstrap();
    return;
  }

  const closeButton = event.target.closest("[data-action='close-modal']");
  if (closeButton || event.target === modalBackdrop) {
    closeModal();
    renderModal();
  }
});

document.addEventListener("submit", async (event) => {
  const classJumpForm = event.target.closest("[data-form='class-jump']");
  if (classJumpForm) {
    event.preventDefault();
    const formData = new FormData(classJumpForm);
    const classId = String(formData.get("classId") || "").trim().toUpperCase();
    if (getClassIds().includes(classId)) {
      window.location.hash = toHref("class", classId);
    } else {
      setBanner("そのクラスは見つかりません。", "warn");
      renderBanner();
    }
    return;
  }

  if (event.target.id === "result-form") {
    event.preventDefault();
    const modalData = getModalMatch();
    if (!modalData) {
      return;
    }

    const formData = new FormData(event.target);
    const submitMode = (event.submitter && event.submitter.value) || "save";
    const winnerTeamId = String(formData.get("winnerTeamId") || "").trim();
    const editorPin = String(formData.get("editorPin") || "").trim();
    const memoText = String(formData.get("memo") || "").trim();
    const requireEditorPin = isEditorPinRequired();
    const hadWinner = !!modalData.match.winner_team_id;
    const isDelete = submitMode === "delete";
    const scoreText = isDelete ? "" : hadWinner ? (modalData.match.score_text || "") : memoText;
    const correctionNote = isDelete ? "" : hadWinner ? memoText : "";

    if (!isDelete && !winnerTeamId) {
      setModalError("勝者を選択してください。");
      renderModal();
      return;
    }
    if (isDelete && !hadWinner) {
      setModalError("削除できる保存済み結果がありません。");
      renderModal();
      return;
    }
    if (requireEditorPin && !editorPin) {
      setModalError("PIN を入力してください。");
      renderModal();
      return;
    }

    try {
      const requestBody = {
        matchId: modalData.match.match_id,
        winnerTeamId: isDelete ? "" : winnerTeamId,
        scoreText,
        correctionNote,
        clearResult: isDelete,
        editorPin: requireEditorPin ? editorPin : "",
        clientContext: {
          route: window.location.hash || "#/",
          sessionId,
          appVersion: (confirmedBootstrap && confirmedBootstrap.appVersion) || configuredAppVersion,
        },
      };
      submissionQueue.push({ requestBody });
      rebuildOptimisticState();
      closeModal();
      setBanner(
        submissionQueue.length > 1
          ? `${isDelete ? "削除内容" : "結果"}を反映しました。送信キュー ${submissionQueue.length} 件です。`
          : isDelete
            ? "削除内容を反映しました。バックグラウンドで保存しています。"
            : "結果を反映しました。バックグラウンドで保存しています。",
        "info"
      );
      renderCurrentRoute();
      void processSubmissionQueue();
    } catch (error) {
      debugLog("submitResultPrepare", error);
      setModalError(humanizeError(error));
      renderModal();
    }
  }
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    pollMeta();
  }
});

setRoute(parseRoute(window.location.hash));
loadBootstrap();
