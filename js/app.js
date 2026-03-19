import { createApi } from "./api.js";
import {
  addCustomBracket,
  applyTimetableSettings,
  applyTimetablePaste,
  buildClassSettingsSavePayload,
  buildEventSavePayload,
  clearAdminInlineEditors,
  clearSelectedTimetableCells,
  clearEventEditorDraft,
  extendTimetableSelection,
  generateTimetable,
  getClassSettingsData,
  getEventEditorData,
  getTimetableClipboardText,
  removeCustomBracket,
  renderClassSettingsPage,
  renderEventEditorPage,
  selectBracketSource,
  selectEventSlot,
  selectTimetableCell,
  selectTimetableColumn,
  selectTimetableRow,
  setClassSettingsText,
  toggleConsolation,
  toggleCustomBracketSeed,
  toggleSeedMode,
  toggleThirdPlace,
  updateCustomBracketField,
  updateCustomBracketSource,
  updateCustomBracketSourceById,
  updateEventDraftField,
  updateSelectedSlotField,
  updateTimetableCell,
  updateTimetableCourtName,
  updateTimetableField,
  updateTimetableRowTime,
} from "./admin-editor.js";
import { renderClassSchedule } from "./render-class.js";
import { renderEventBracketPanel, renderEventDetail } from "./render-event.js";
import { renderHome } from "./render-home.js";
import { renderResultModal } from "./render-result-modal.js";
import { parseRoute, toHref } from "./router.js";
import {
  applyOptimisticResult,
  clearAllPendingSync,
  clearBanner,
  clearHoverPreview,
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
  setHoverPreview,
  setModalError,
  setMode,
  setRoute,
  setScheduleTab,
  updateModalDraft,
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
let resizeTimer = null;
let confirmedBootstrap = null;
let submissionQueue = [];
let isProcessingQueue = false;
let previewSuppressClearUntil = 0;
let isTimetableSelecting = false;
let lastTimetableSelectionKey = "";

function getTimetableSelectionBounds(selection) {
  return {
    startRow: Math.min(selection.anchorRow, selection.focusRow),
    endRow: Math.max(selection.anchorRow, selection.focusRow),
    startCol: Math.min(selection.anchorCol, selection.focusCol),
    endCol: Math.max(selection.anchorCol, selection.focusCol),
  };
}

function paintTimetableSelection(selection) {
  document.querySelectorAll(".admin-timetable-grid td.is-selected").forEach((cell) => {
    cell.classList.remove("is-selected", "is-range-top", "is-range-bottom", "is-range-left", "is-range-right");
  });
  document.querySelectorAll(".admin-timetable-grid .admin-cell-input.is-anchor").forEach((input) => {
    input.classList.remove("is-anchor");
  });
  if (!selection) {
    return;
  }
  const bounds = getTimetableSelectionBounds(selection);
  document.querySelectorAll("[data-action='admin-timetable-cell']").forEach((input) => {
    const dayNo = String(input.getAttribute("data-day-no") || "1");
    const rowIndex = Number(input.getAttribute("data-row-index") || 0);
    const courtIndex = Number(input.getAttribute("data-court-index") || 0);
    const cell = input.closest("td");
    if (cell) {
      const isSelected = dayNo === String(selection.dayNo || "1")
        && rowIndex >= bounds.startRow
        && rowIndex <= bounds.endRow
        && courtIndex >= bounds.startCol
        && courtIndex <= bounds.endCol;
      cell.classList.toggle("is-selected", isSelected);
      cell.classList.toggle("is-range-top", isSelected && rowIndex === bounds.startRow);
      cell.classList.toggle("is-range-bottom", isSelected && rowIndex === bounds.endRow);
      cell.classList.toggle("is-range-left", isSelected && courtIndex === bounds.startCol);
      cell.classList.toggle("is-range-right", isSelected && courtIndex === bounds.endCol);
    }
    input.classList.toggle("is-anchor", dayNo === String(selection.dayNo || "1") && rowIndex === selection.anchorRow && courtIndex === selection.anchorCol);
  });
}

function findTimetableSelectionTarget(target) {
  if (!target || !target.closest) {
    return null;
  }
  return target.closest("[data-action='admin-timetable-cell'], [data-action='admin-timetable-td']");
}

function syncTimetableFieldsFromDom(eventId, dayNo = null) {
  const selector = dayNo
    ? `[data-action='admin-timetable-field'][data-day-no='${dayNo}']`
    : "[data-action='admin-timetable-field']";
  document.querySelectorAll(selector).forEach((input) => {
    updateTimetableField(
      getState().bootstrap,
      eventId,
      input.getAttribute("data-day-no") || "1",
      input.getAttribute("data-field"),
      input.value
    );
  });
}

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
    MATCH_NOT_READY: "参加者が1つも確定していないため保存できません。",
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
        winnerSlot: requestBody.winnerSlot,
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

async function saveAdminEvent(routeEventId) {
  try {
    const response = await api.saveAdminEvent(buildEventSavePayload(getState().bootstrap, routeEventId));
    clearEventEditorDraft(routeEventId);
    await applyBootstrap(response, {
      mode: "remote",
      readOnly: false,
      bannerMessage: "種目設定を保存しました。",
    });
    const savedEventId = response.savedEventId || routeEventId;
    window.location.hash = toHref("admin-event", savedEventId);
  } catch (error) {
    debugLog("saveAdminEvent", error);
    setBanner(humanizeError(error), "warn", { durationMs: 6500 });
    renderBanner();
  }
}

async function saveClassSettings() {
  try {
    const response = await api.saveClassSettings(buildClassSettingsSavePayload());
    await applyBootstrap(response, {
      mode: "remote",
      readOnly: false,
      bannerMessage: "クラス名設定を保存しました。",
    });
  } catch (error) {
    debugLog("saveClassSettings", error);
    setBanner(humanizeError(error), "warn", { durationMs: 6500 });
    renderBanner();
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
  } else if (route.name === "admin-event") {
    appRoot.innerHTML = renderEventEditorPage(getEventEditorData(getState().bootstrap, route.params.eventId, getState().readOnly));
  } else if (route.name === "admin-classes") {
    appRoot.innerHTML = renderClassSettingsPage(getClassSettingsData(getState().bootstrap, getState().readOnly));
  } else {
    appRoot.innerHTML = renderHome(getHomeData());
  }

  renderModal();
  renderBanner();
}

function renderEventBracketOnly() {
  const route = getRouteData();
  if (route.name !== "event") {
    return;
  }
  const panel = appRoot.querySelector("[data-event-bracket-panel]");
  if (!panel) {
    return;
  }
  const detail = getEventDetail(route.params.eventId);
  if (!detail) {
    return;
  }
  previewSuppressClearUntil = Date.now() + 120;
  panel.innerHTML = renderEventBracketPanel(detail);
}

function queueResultSubmission(requestBody, options = {}) {
  const isDelete = !!requestBody.clearResult;
  submissionQueue.push({ requestBody });
  rebuildOptimisticState();
  clearHoverPreview();
  if (options.closeModal !== false) {
    closeModal();
  }
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
}

function submitDirectTeamWin(button) {
  const matchId = String(button.getAttribute("data-target-match-id") || "").trim();
  const winnerSlot = String(button.getAttribute("data-winner-slot") || "").trim();
  const match = getState().indexes.matchesById.get(matchId);
  if (!match) {
    setBanner("対象試合が見つかりません。", "warn");
    renderBanner();
    return;
  }
  if (getState().readOnly) {
    setBanner("現在は read-only 表示のため結果保存できません。", "warn");
    renderBanner();
    return;
  }
  const winnerTeamId = winnerSlot === "top" ? match.resolved_top_team_id || "" : match.resolved_bottom_team_id || "";
  if (!winnerTeamId) {
    setBanner("このチームはまだ対象試合へ進出確定していません。", "warn");
    renderBanner();
    return;
  }
  if (match.winner_slot === winnerSlot || match.winner_team_id === winnerTeamId) {
    setBanner("この結果はすでに反映済みです。", "info");
    renderBanner();
    return;
  }
  queueResultSubmission(
    {
      matchId,
      winnerSlot,
      winnerTeamId,
      scoreText: "",
      correctionNote: "",
      clearResult: false,
      editorPin: "",
      clientContext: {
        route: window.location.hash || "#/",
        sessionId,
        appVersion: (confirmedBootstrap && confirmedBootstrap.appVersion) || configuredAppVersion,
      },
    },
    { closeModal: false }
  );
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
  clearHoverPreview();
  setRoute(parseRoute(window.location.hash));
  renderCurrentRoute();
});

window.addEventListener("resize", () => {
  const route = getRouteData();
  if (!["event", "admin-event"].includes(route.name) || getState().modal.matchId) {
    return;
  }
  if (resizeTimer) {
    window.clearTimeout(resizeTimer);
  }
  resizeTimer = window.setTimeout(() => {
    renderCurrentRoute();
  }, 120);
});

document.addEventListener("click", (event) => {
  const adminSlotButton = event.target.closest("[data-action='admin-select-slot']");
  if (adminSlotButton) {
    const route = getRouteData();
    if (route.name === "admin-event") {
      selectEventSlot(getState().bootstrap, route.params.eventId, adminSlotButton.getAttribute("data-slot-id"));
      renderCurrentRoute();
    }
    return;
  }

  const adminSourceButton = event.target.closest("[data-action='admin-select-source']");
  if (adminSourceButton) {
    const route = getRouteData();
    if (route.name === "admin-event") {
      selectBracketSource(
        getState().bootstrap,
        route.params.eventId,
        adminSourceButton.getAttribute("data-bracket-id"),
        adminSourceButton.getAttribute("data-source-id")
      );
      renderCurrentRoute();
    }
    return;
  }

  const adminSeedToggle = event.target.closest("[data-action='admin-toggle-seed-mode']");
  if (adminSeedToggle) {
    const route = getRouteData();
    if (route.name === "admin-event") {
      toggleSeedMode(getState().bootstrap, route.params.eventId);
      renderCurrentRoute();
    }
    return;
  }

  const adminThirdPlaceToggle = event.target.closest("[data-action='admin-toggle-third-place']");
  if (adminThirdPlaceToggle) {
    const route = getRouteData();
    if (route.name === "admin-event") {
      toggleThirdPlace(getState().bootstrap, route.params.eventId);
      renderCurrentRoute();
    }
    return;
  }

  const adminConsolationToggle = event.target.closest("[data-action='admin-toggle-consolation']");
  if (adminConsolationToggle) {
    const route = getRouteData();
    if (route.name === "admin-event") {
      toggleConsolation(getState().bootstrap, route.params.eventId);
      renderCurrentRoute();
    }
    return;
  }

  const adminAddCustom = event.target.closest("[data-action='admin-add-custom']");
  if (adminAddCustom) {
    const route = getRouteData();
    if (route.name === "admin-event") {
      addCustomBracket(getState().bootstrap, route.params.eventId);
      renderCurrentRoute();
    }
    return;
  }

  const adminRemoveCustom = event.target.closest("[data-action='admin-remove-custom']");
  if (adminRemoveCustom) {
    const route = getRouteData();
    if (route.name === "admin-event") {
      removeCustomBracket(getState().bootstrap, route.params.eventId, adminRemoveCustom.getAttribute("data-custom-id"));
      renderCurrentRoute();
    }
    return;
  }

  const adminCustomSeed = event.target.closest("[data-action='admin-custom-seed']");
  if (adminCustomSeed) {
    const route = getRouteData();
    if (route.name === "admin-event") {
      toggleCustomBracketSeed(
        getState().bootstrap,
        route.params.eventId,
        adminCustomSeed.getAttribute("data-custom-id"),
        adminCustomSeed.getAttribute("data-source-id")
      );
      renderCurrentRoute();
    }
    return;
  }

  const adminGenerateTimetable = event.target.closest("[data-action='admin-generate-timetable']");
  if (adminGenerateTimetable) {
    const route = getRouteData();
    if (route.name === "admin-event") {
      syncTimetableFieldsFromDom(route.params.eventId);
      generateTimetable(getState().bootstrap, route.params.eventId);
      renderCurrentRoute();
    }
    return;
  }

  const adminSlotToken = event.target.closest("[data-action='admin-slot-token']");
  if (adminSlotToken) {
    const route = getRouteData();
    if (route.name === "admin-event") {
      updateSelectedSlotField(getState().bootstrap, route.params.eventId, "memberToken", adminSlotToken.getAttribute("data-token") || "");
      clearAdminInlineEditors(getState().bootstrap, route.params.eventId);
      renderCurrentRoute();
    }
    return;
  }

  const adminSaveEvent = event.target.closest("[data-action='admin-save-event']");
  if (adminSaveEvent) {
    const route = getRouteData();
    if (route.name === "admin-event") {
      void saveAdminEvent(route.params.eventId);
    }
    return;
  }

  const adminSaveClasses = event.target.closest("[data-action='admin-save-class-settings']");
  if (adminSaveClasses) {
    void saveClassSettings();
    return;
  }

  const selectTimetableRowButton = event.target.closest("[data-action='admin-select-timetable-row']");
  if (selectTimetableRowButton) {
    const route = getRouteData();
    if (route.name === "admin-event") {
      selectTimetableRow(
        getState().bootstrap,
        route.params.eventId,
        selectTimetableRowButton.getAttribute("data-day-no") || "1",
        Number(selectTimetableRowButton.getAttribute("data-row-index") || 0)
      );
      renderCurrentRoute();
    }
    return;
  }

  const selectTimetableColButton = event.target.closest("[data-action='admin-select-timetable-col']");
  if (selectTimetableColButton) {
    const route = getRouteData();
    if (route.name === "admin-event") {
      selectTimetableColumn(
        getState().bootstrap,
        route.params.eventId,
        selectTimetableColButton.getAttribute("data-day-no") || "1",
        Number(selectTimetableColButton.getAttribute("data-court-index") || 0)
      );
      renderCurrentRoute();
    }
    return;
  }

  const applyTimetableButton = event.target.closest("[data-action='admin-apply-timetable']");
  if (applyTimetableButton) {
    const route = getRouteData();
    if (route.name === "admin-event") {
      const dayNo = applyTimetableButton.getAttribute("data-day-no") || "1";
      syncTimetableFieldsFromDom(route.params.eventId, dayNo);
      applyTimetableSettings(
        getState().bootstrap,
        route.params.eventId,
        dayNo
      );
      renderCurrentRoute();
    }
    return;
  }

  const route = getRouteData();
  const clickedAdminBracketPaper = event.target.closest(".bracket-paper");
  const clickedInlineEditor = event.target.closest(".bracket-slot-inline-editor");
  const clickedBracketTarget = event.target.closest("[data-action='admin-select-slot'], [data-action='admin-select-source']");
  if (route.name === "admin-event" && clickedAdminBracketPaper && !clickedInlineEditor && !clickedBracketTarget) {
    clearAdminInlineEditors(getState().bootstrap, route.params.eventId);
    renderCurrentRoute();
    return;
  }

  const teamDirectButton = event.target.closest("[data-action='team-direct-win']");
  if (teamDirectButton) {
    submitDirectTeamWin(teamDirectButton);
    return;
  }

  const quickPickButton = event.target.closest("[data-action='quick-pick-winner']");
  if (quickPickButton) {
    clearHoverPreview();
    openModal(quickPickButton.getAttribute("data-match-id"), {
      preferredWinnerSlot: quickPickButton.getAttribute("data-winner-slot") || "",
    });
    renderModal();
    return;
  }

  const matchButton = event.target.closest("[data-match-id]");
  if (matchButton) {
    clearHoverPreview();
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

document.addEventListener("mouseover", (event) => {
  const previewButton = event.target.closest("[data-action='team-direct-win']");
  if (!previewButton) {
    return;
  }
  const eventId = previewButton.getAttribute("data-event-id");
  const matchId = previewButton.getAttribute("data-target-match-id");
  const winnerSlot = previewButton.getAttribute("data-winner-slot");
  const preview = getState().hoverPreview;
  if (
    preview &&
    preview.eventId === eventId &&
    preview.matchId === matchId &&
    preview.winnerSlot === winnerSlot
  ) {
    return;
  }
  setHoverPreview(eventId, matchId, winnerSlot);
  renderEventBracketOnly();
});

document.addEventListener("mouseout", (event) => {
  if (Date.now() < previewSuppressClearUntil) {
    return;
  }
  if (!getState().hoverPreview) {
    return;
  }
  const currentButton = event.target.closest("[data-action='team-direct-win']");
  if (!currentButton) {
    return;
  }
  const next = event.relatedTarget;
  const nextButton = next && next.closest ? next.closest("[data-action='team-direct-win']") : null;
  if (nextButton) {
    return;
  }
  clearHoverPreview();
  renderEventBracketOnly();
});

document.addEventListener("mousedown", (event) => {
  const route = getRouteData();
  if (route.name !== "admin-event") {
    return;
  }
  const cell = findTimetableSelectionTarget(event.target);
  if (!cell) {
    isTimetableSelecting = false;
    lastTimetableSelectionKey = "";
    document.body.classList.remove("is-timetable-selecting");
    return;
  }
  event.preventDefault();
  const rowIndex = Number(cell.getAttribute("data-row-index") || 0);
  const courtIndex = Number(cell.getAttribute("data-court-index") || 0);
  const dayNo = cell.getAttribute("data-day-no") || "1";
  const selection = selectTimetableCell(
    getState().bootstrap,
    route.params.eventId,
    dayNo,
    rowIndex,
    courtIndex
  );
  isTimetableSelecting = true;
  lastTimetableSelectionKey = `${dayNo}:${rowIndex}:${courtIndex}`;
  document.body.classList.add("is-timetable-selecting");
  if (typeof cell.focus === "function") {
    cell.focus({ preventScroll: true });
  }
  paintTimetableSelection(selection);
});

document.addEventListener("mousemove", (event) => {
  const route = getRouteData();
  if (!isTimetableSelecting || route.name !== "admin-event") {
    return;
  }
  const targetCell = findTimetableSelectionTarget(event.target);
  const hovered = document.elementFromPoint(event.clientX, event.clientY);
  const hoveredCell = findTimetableSelectionTarget(hovered);
  const cell = targetCell || hoveredCell;
  if (!cell) {
    return;
  }
  const rowIndex = Number(cell.getAttribute("data-row-index") || 0);
  const courtIndex = Number(cell.getAttribute("data-court-index") || 0);
  const dayNo = cell.getAttribute("data-day-no") || "1";
  const nextKey = `${dayNo}:${rowIndex}:${courtIndex}`;
  if (nextKey === lastTimetableSelectionKey) {
    return;
  }
  const selection = extendTimetableSelection(
    getState().bootstrap,
    route.params.eventId,
    dayNo,
    rowIndex,
    courtIndex
  );
  lastTimetableSelectionKey = nextKey;
  paintTimetableSelection(selection);
});

document.addEventListener("mouseup", () => {
  isTimetableSelecting = false;
  lastTimetableSelectionKey = "";
  document.body.classList.remove("is-timetable-selecting");
});

document.addEventListener("change", (event) => {
  const route = getRouteData();
  const adminAction = event.target && event.target.getAttribute && event.target.getAttribute("data-action");
  if (route.name === "admin-event") {
    if (adminAction === "admin-draft-field") {
      updateEventDraftField(getState().bootstrap, route.params.eventId, event.target.getAttribute("data-field"), event.target.value);
      renderCurrentRoute();
      return;
    }
    if (adminAction === "admin-slot-field") {
      updateSelectedSlotField(getState().bootstrap, route.params.eventId, event.target.getAttribute("data-field"), event.target.value);
      renderCurrentRoute();
      return;
    }
    if (adminAction === "admin-custom-field") {
      updateCustomBracketField(
        getState().bootstrap,
        route.params.eventId,
        event.target.getAttribute("data-custom-id"),
        event.target.getAttribute("data-field"),
        event.target.value
      );
      renderCurrentRoute();
      return;
    }
    if (adminAction === "admin-custom-source") {
      updateCustomBracketSource(
        getState().bootstrap,
        route.params.eventId,
        event.target.getAttribute("data-custom-id"),
        Number(event.target.getAttribute("data-index") || 0),
        event.target.value
      );
      renderCurrentRoute();
      return;
    }
    if (adminAction === "admin-inline-source") {
      updateCustomBracketSourceById(
        getState().bootstrap,
        route.params.eventId,
        event.target.getAttribute("data-bracket-id"),
        event.target.getAttribute("data-source-id"),
        event.target.value
      );
      renderCurrentRoute();
      return;
    }
    if (adminAction === "admin-timetable-field") {
      updateTimetableField(
        getState().bootstrap,
        route.params.eventId,
        event.target.getAttribute("data-day-no") || "1",
        event.target.getAttribute("data-field"),
        event.target.value
      );
      renderCurrentRoute();
      return;
    }
    if (adminAction === "admin-timetable-court-name") {
      updateTimetableCourtName(
        getState().bootstrap,
        route.params.eventId,
        event.target.getAttribute("data-day-no") || "1",
        Number(event.target.getAttribute("data-court-index") || 0),
        event.target.value
      );
      return;
    }
    if (adminAction === "admin-timetable-row-time") {
      updateTimetableRowTime(
        getState().bootstrap,
        route.params.eventId,
        event.target.getAttribute("data-day-no") || "1",
        Number(event.target.getAttribute("data-row-index") || 0),
        event.target.value
      );
      return;
    }
    if (adminAction === "admin-timetable-cell") {
      updateTimetableCell(
        getState().bootstrap,
        route.params.eventId,
        event.target.getAttribute("data-day-no") || "1",
        Number(event.target.getAttribute("data-row-index") || 0),
        Number(event.target.getAttribute("data-court-index") || 0),
        event.target.value
      );
      return;
    }
  }

  const form = event.target && event.target.closest && event.target.closest("#result-form");
  if (!form) {
    return;
  }
  if (event.target.name === "winnerSlot") {
    updateModalDraft("winnerSlot", event.target.value);
  } else if (event.target.name === "editorPin") {
    updateModalDraft("editorPin", event.target.value);
  }
});

document.addEventListener("input", (event) => {
  const route = getRouteData();
  const adminAction = event.target && event.target.getAttribute && event.target.getAttribute("data-action");
  if (adminAction === "admin-class-text") {
    setClassSettingsText(event.target.value);
    return;
  }
  if (route.name === "admin-event") {
    if (adminAction === "admin-timetable-field") {
      updateTimetableField(
        getState().bootstrap,
        route.params.eventId,
        event.target.getAttribute("data-day-no") || "1",
        event.target.getAttribute("data-field"),
        event.target.value
      );
      return;
    }
    if (adminAction === "admin-timetable-cell") {
      updateTimetableCell(
        getState().bootstrap,
        route.params.eventId,
        event.target.getAttribute("data-day-no") || "1",
        Number(event.target.getAttribute("data-row-index") || 0),
        Number(event.target.getAttribute("data-court-index") || 0),
        event.target.value
      );
      return;
    }
    if (adminAction === "admin-timetable-court-name") {
      updateTimetableCourtName(
        getState().bootstrap,
        route.params.eventId,
        event.target.getAttribute("data-day-no") || "1",
        Number(event.target.getAttribute("data-court-index") || 0),
        event.target.value
      );
      return;
    }
    if (adminAction === "admin-timetable-row-time") {
      updateTimetableRowTime(
        getState().bootstrap,
        route.params.eventId,
        event.target.getAttribute("data-day-no") || "1",
        Number(event.target.getAttribute("data-row-index") || 0),
        event.target.value
      );
      return;
    }
  }

  const form = event.target && event.target.closest && event.target.closest("#result-form");
  if (!form) {
    return;
  }
  if (event.target.name === "memo") {
    updateModalDraft("memo", event.target.value);
  } else if (event.target.name === "editorPin") {
    updateModalDraft("editorPin", event.target.value);
  }
});

document.addEventListener("paste", (event) => {
  const route = getRouteData();
  if (route.name !== "admin-event") {
    return;
  }
  const cell = findTimetableSelectionTarget(event.target);
  if (!cell) {
    return;
  }
  const text = event.clipboardData && event.clipboardData.getData("text/plain");
  if (!text) {
    return;
  }
  event.preventDefault();
  applyTimetablePaste(
    getState().bootstrap,
    route.params.eventId,
    cell.getAttribute("data-day-no") || "1",
    Number(cell.getAttribute("data-row-index") || 0),
    Number(cell.getAttribute("data-court-index") || 0),
    text
  );
  renderCurrentRoute();
});

document.addEventListener("copy", (event) => {
  const route = getRouteData();
  if (route.name !== "admin-event") {
    return;
  }
  const activeInTimetable =
    document.activeElement &&
    document.activeElement.closest &&
    document.activeElement.closest(".admin-timetable-grid");
  const hasSelection = !!document.querySelector(".admin-timetable-grid td.is-selected");
  if (!activeInTimetable && !hasSelection) {
    return;
  }
  const text = getTimetableClipboardText(getState().bootstrap, route.params.eventId);
  if (!text || !event.clipboardData) {
    return;
  }
  event.preventDefault();
  event.clipboardData.setData("text/plain", text);
});

document.addEventListener("keydown", (event) => {
  const route = getRouteData();
  if (route.name !== "admin-event") {
    return;
  }
  if (event.key !== "Delete" || event.ctrlKey || event.metaKey || event.altKey) {
    return;
  }
  const activeInTimetable =
    document.activeElement &&
    document.activeElement.closest &&
    document.activeElement.closest(".admin-timetable-grid");
  const hasSelection = !!document.querySelector(".admin-timetable-grid td.is-selected");
  if (!activeInTimetable && !hasSelection) {
    return;
  }
  event.preventDefault();
  clearSelectedTimetableCells(getState().bootstrap, route.params.eventId);
  renderCurrentRoute();
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
    const winnerSlot = String(formData.get("winnerSlot") || "").trim();
    const editorPin = String(formData.get("editorPin") || "").trim();
    const memoText = String(formData.get("memo") || "").trim();
    const requireEditorPin = isEditorPinRequired();
    const hadWinner = !!(modalData.match.winner_slot || modalData.match.winner_team_id);
    const isDelete = submitMode === "delete";
    const scoreText = isDelete ? "" : hadWinner ? (modalData.match.score_text || "") : memoText;
    const correctionNote = isDelete ? "" : hadWinner ? memoText : "";

    if (!isDelete && !winnerSlot) {
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
        winnerSlot: isDelete ? "" : winnerSlot,
        winnerTeamId:
          isDelete || !winnerSlot
            ? ""
            : winnerSlot === "top"
              ? modalData.match.resolved_top_team_id || ""
              : modalData.match.resolved_bottom_team_id || "",
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
      queueResultSubmission(requestBody);
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
  } else {
    clearHoverPreview();
  }
});

setRoute(parseRoute(window.location.hash));
loadBootstrap();
