import { formatClock, formatDateTimeStamp, formatDayLabel, formatMatchTimeText } from "./format.js";

const SCHEDULE_DAY_PREF_KEY = "tournament_schedule_day_pref";

const state = {
  config: null,
  mode: "missing",
  readOnly: true,
  bootstrap: null,
  pendingSync: new Map(),
  scheduleDayPreference: loadScheduleDayPreference(),
  scheduleTabs: {
    event: new Map(),
    class: new Map(),
  },
  route: { name: "home", params: {} },
  eventFilter: "",
  hoverPreview: null,
  banner: null,
  modal: {
    matchId: "",
    error: "",
    submitting: false,
    draft: {
      winnerSlot: "",
      memo: "",
      editorPin: "",
    },
    touched: {
      winnerSlot: false,
      memo: false,
      editorPin: false,
    },
  },
  indexes: {
    eventsById: new Map(),
    teamsById: new Map(),
    matchesById: new Map(),
    matchesByEvent: new Map(),
    teamIdsByClass: new Map(),
  },
};

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function getTokyoDateStamp() {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function loadScheduleDayPreference() {
  if (typeof localStorage === "undefined") {
    return { stamp: "", dayNo: "" };
  }
  try {
    const raw = JSON.parse(localStorage.getItem(SCHEDULE_DAY_PREF_KEY) || "{}");
    const today = getTokyoDateStamp();
    if (raw && raw.stamp === today && String(raw.dayNo || "").trim()) {
      return {
        stamp: today,
        dayNo: String(raw.dayNo).trim(),
      };
    }
  } catch (error) {
    console.warn("[store] failed to load schedule day preference", error);
  }
  return {
    stamp: getTokyoDateStamp(),
    dayNo: "",
  };
}

function persistScheduleDayPreference(dayNo) {
  const value = {
    stamp: getTokyoDateStamp(),
    dayNo: normalizeDayNo(dayNo),
  };
  state.scheduleDayPreference = value;
  if (typeof localStorage === "undefined") {
    return;
  }
  try {
    localStorage.setItem(SCHEDULE_DAY_PREF_KEY, JSON.stringify(value));
  } catch (error) {
    console.warn("[store] failed to persist schedule day preference", error);
  }
}

function normalizeWinnerSlot(value) {
  return value === "top" || value === "bottom" ? value : "";
}

function getWinnerSlot(match) {
  const explicit = normalizeWinnerSlot(match.winner_slot);
  if (explicit) {
    return explicit;
  }
  if (match.winner_team_id && match.winner_team_id === match.resolved_top_team_id) {
    return "top";
  }
  if (match.winner_team_id && match.winner_team_id === match.resolved_bottom_team_id) {
    return "bottom";
  }
  return "";
}

function createModalDraft(match, preferredWinnerSlot = "") {
  return {
    winnerSlot: normalizeWinnerSlot(preferredWinnerSlot) || getWinnerSlot(match),
    memo: match.correction_note || match.score_text || "",
    editorPin: "",
  };
}

function resetModalDraft(match = null, preferredWinnerSlot = "") {
  state.modal.draft = match ? createModalDraft(match, preferredWinnerSlot) : createModalDraft({});
  state.modal.touched = {
    winnerSlot: !!preferredWinnerSlot,
    memo: false,
    editorPin: false,
  };
}

function eventMatchesFilter(event, filter) {
  if (filter === "all") {
    return true;
  }
  return event.weather_mode === "all" || event.weather_mode === filter;
}

function normalizeEventFilter(filter) {
  const raw = String(filter || "").trim().toLowerCase();
  if (raw === "sunny" || raw === "rainy" || raw === "all") {
    return raw;
  }
  return "";
}

function normalizeDayNo(dayNo) {
  const raw = String(dayNo || "").trim();
  return raw || "";
}

function sortDayNo(a, b) {
  return Number(a || 99) - Number(b || 99);
}

function collectScheduleDays(items) {
  return unique(items.map((item) => normalizeDayNo((item && item.day_no) || "")).filter(Boolean)).sort(sortDayNo);
}

function resolveScheduleTab(kind, targetId, availableDays) {
  if (!availableDays.length) {
    return "";
  }
  const globalDay = normalizeDayNo(
    state.scheduleDayPreference && state.scheduleDayPreference.stamp === getTokyoDateStamp()
      ? state.scheduleDayPreference.dayNo
      : ""
  );
  if (globalDay && availableDays.includes(globalDay)) {
    return globalDay;
  }
  const bucket = state.scheduleTabs[kind];
  if (!bucket) {
    return availableDays[0];
  }
  const key = String(targetId || "");
  const stored = bucket.get(key);
  if (stored && availableDays.includes(stored)) {
    return stored;
  }
  const fallback = availableDays[0];
  bucket.set(key, fallback);
  return fallback;
}

function sortClassId(a, b) {
  const [gradeA, letterA] = [Number(a.slice(0, 1)), a.slice(1)];
  const [gradeB, letterB] = [Number(b.slice(0, 1)), b.slice(1)];
  if (gradeA !== gradeB) {
    return gradeA - gradeB;
  }
  return letterA.localeCompare(letterB, "ja");
}

function rebuildIndexes() {
  const eventsById = new Map();
  const teamsById = new Map();
  const matchesById = new Map();
  const matchesByEvent = new Map();
  const teamIdsByClass = new Map();

  for (const event of (state.bootstrap && state.bootstrap.events) || []) {
    eventsById.set(event.event_id, event);
  }
  for (const team of (state.bootstrap && state.bootstrap.teams) || []) {
    teamsById.set(team.team_id, team);
    if (team.class_id) {
      if (!teamIdsByClass.has(team.class_id)) {
        teamIdsByClass.set(team.class_id, []);
      }
      teamIdsByClass.get(team.class_id).push(team.team_id);
    }
  }
  for (const match of (state.bootstrap && state.bootstrap.matches) || []) {
    matchesById.set(match.match_id, match);
    if (!matchesByEvent.has(match.event_id)) {
      matchesByEvent.set(match.event_id, []);
    }
    matchesByEvent.get(match.event_id).push(match);
  }
  for (const matches of matchesByEvent.values()) {
    matches.sort((a, b) => Number(a.display_order) - Number(b.display_order));
  }

  state.indexes = { eventsById, teamsById, matchesById, matchesByEvent, teamIdsByClass };
  syncModalDraft();
}

function sortBySchedule(a, b) {
  const dayA = Number(a.day_no || 99);
  const dayB = Number(b.day_no || 99);
  if (dayA !== dayB) {
    return dayA - dayB;
  }
  if (a.start_time !== b.start_time) {
    return a.start_time.localeCompare(b.start_time);
  }
  const eventA = state.indexes.eventsById.get(a.event_id);
  const eventB = state.indexes.eventsById.get(b.event_id);
  if (eventA && eventB && eventA.display_order !== eventB.display_order) {
    return Number(eventA.display_order) - Number(eventB.display_order);
  }
  return Number(a.display_order) - Number(b.display_order);
}

function slotLabel(slotType, slotRef) {
  if (slotType === "team") {
    const team = state.indexes.teamsById.get(slotRef);
    return (team && team.display_name) || slotRef.split(":").pop() || "-";
  }
  if (slotType === "winner" || slotType === "loser") {
    const match = state.indexes.matchesById.get(slotRef);
    if (!match) {
      return "未設定";
    }
    const label = match.match_label || "自動進出";
    return `${label}の${slotType === "winner" ? "勝者" : "敗者"}`;
  }
  return "BYE";
}

function resolveTeamName(teamId) {
  const team = state.indexes.teamsById.get(teamId);
  return (team && team.display_name) || "";
}

function getAvailableWinnerChoices(match) {
  return [
    {
      slot: "top",
      teamId: match.resolved_top_team_id || "",
      label: (match.resolved_top_team_id && resolveTeamName(match.resolved_top_team_id)) || slotLabel(match.slot_top_type, match.slot_top_ref),
    },
    {
      slot: "bottom",
      teamId: match.resolved_bottom_team_id || "",
      label:
        (match.resolved_bottom_team_id && resolveTeamName(match.resolved_bottom_team_id)) || slotLabel(match.slot_bottom_type, match.slot_bottom_ref),
    },
  ].filter((choice) => choice.label && choice.label !== "BYE");
}

function syncModalDraft() {
  if (!state.modal.matchId) {
    return;
  }
  const match = state.indexes.matchesById.get(state.modal.matchId);
  if (!match) {
    state.modal.matchId = "";
    resetModalDraft();
    return;
  }

  const validWinnerSlots = new Set(getAvailableWinnerChoices(match).map((item) => item.slot));
  if (!state.modal.touched.winnerSlot) {
    state.modal.draft.winnerSlot = getWinnerSlot(match);
  } else if (state.modal.draft.winnerSlot && !validWinnerSlots.has(state.modal.draft.winnerSlot)) {
    state.modal.draft.winnerSlot = "";
    state.modal.touched.winnerSlot = false;
  }

  if (!state.modal.touched.memo) {
    state.modal.draft.memo = match.correction_note || match.score_text || "";
  }
  if (!state.modal.touched.editorPin) {
    state.modal.draft.editorPin = "";
  }
}

function resolveCandidateTeams(slotType, slotRef, seen = new Set()) {
  const cacheKey = `${slotType}:${slotRef}`;
  if (seen.has(cacheKey)) {
    return [];
  }

  if (slotType === "team") {
    return slotRef ? [slotRef] : [];
  }
  if (slotType === "bye") {
    return [];
  }

  const match = state.indexes.matchesById.get(slotRef);
  if (!match) {
    return [];
  }
  if (slotType === "winner" && match.winner_team_id) {
    return [match.winner_team_id];
  }
  if (slotType === "loser" && match.loser_team_id) {
    return [match.loser_team_id];
  }

  const nextSeen = new Set(seen);
  nextSeen.add(cacheKey);
  return unique([
    ...resolveCandidateTeams(match.slot_top_type, match.slot_top_ref, nextSeen),
    ...resolveCandidateTeams(match.slot_bottom_type, match.slot_bottom_ref, nextSeen),
  ]);
}

function classMatchesTeamIds(classId, teamIds) {
  const classTeamIds = new Set(state.indexes.teamIdsByClass.get(classId) || []);
  return teamIds.some((teamId) => classTeamIds.has(teamId));
}

function toBoolean(value, fallback = false) {
  if (typeof value === "boolean") {
    return value;
  }
  if (value == null || value === "") {
    return fallback;
  }
  const raw = String(value).trim().toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes" || raw === "on";
}

function nowIso() {
  return new Date().toISOString();
}

function cloneMatch(match) {
  return { ...match };
}

function buildPreviewedEventMatches(eventId, matches) {
  const preview = state.hoverPreview;
  if (!preview || preview.eventId !== eventId) {
    return matches;
  }
  const normalizedWinnerSlot = normalizeWinnerSlot(preview.winnerSlot);
  if (!normalizedWinnerSlot) {
    return matches;
  }
  const eventMatches = matches.map(cloneMatch);
  const targetMatch = eventMatches.find((match) => match.match_id === preview.matchId);
  if (!targetMatch) {
    return matches;
  }
  targetMatch.winner_slot = normalizedWinnerSlot;
  recalculateEventMatches(eventMatches);
  return eventMatches;
}

function buildMatchesById(matches) {
  return Object.fromEntries(matches.map((match) => [match.match_id, match]));
}

function resolveSlot(matchesById, slotType, slotRef) {
  if (slotType === "team") {
    return slotRef;
  }
  if (slotType === "bye") {
    return "";
  }
  const upstream = matchesById[slotRef];
  if (!upstream) {
    return "";
  }
  return slotType === "winner" ? upstream.winner_team_id : upstream.loser_team_id;
}

function recalculateEventMatches(matches) {
  matches.sort((a, b) => Number(a.display_order) - Number(b.display_order));
  const matchesById = buildMatchesById(matches);

  for (const match of matches) {
    match.resolved_top_team_id = resolveSlot(matchesById, match.slot_top_type, match.slot_top_ref);
    match.resolved_bottom_team_id = resolveSlot(matchesById, match.slot_bottom_type, match.slot_bottom_ref);

    const topTeam = match.resolved_top_team_id;
    const bottomTeam = match.resolved_bottom_team_id;
    const topIsBye = match.slot_top_type === "bye";
    const bottomIsBye = match.slot_bottom_type === "bye";
    let winnerSlot = getWinnerSlot(match);

    if (match.winner_team_id && !winnerSlot && match.winner_team_id !== topTeam && match.winner_team_id !== bottomTeam) {
      match.winner_team_id = "";
      match.loser_team_id = "";
      match.score_text = "";
      match.correction_note = "";
      match.updated_at = "";
      match.updated_by_session = "";
    }

    if (!winnerSlot) {
      if (topTeam && bottomIsBye) {
        winnerSlot = "top";
        match.winner_team_id = topTeam;
        match.loser_team_id = "";
      } else if (bottomTeam && topIsBye) {
        winnerSlot = "bottom";
        match.winner_team_id = bottomTeam;
        match.loser_team_id = "";
      }
    }

    match.winner_slot = winnerSlot;

    if (winnerSlot === "top") {
      match.winner_team_id = topTeam;
      match.loser_team_id = bottomTeam;
    } else if (winnerSlot === "bottom") {
      match.winner_team_id = bottomTeam;
      match.loser_team_id = topTeam;
    } else {
      match.winner_team_id = "";
      match.loser_team_id = "";
    }

    if (winnerSlot) {
      if (match.winner_team_id === topTeam) {
        match.loser_team_id = bottomTeam;
      } else if (match.winner_team_id === bottomTeam) {
        match.loser_team_id = topTeam;
      }
      match.status = match.correction_note ? "corrected" : "completed";
    } else if (topTeam && bottomTeam) {
      match.status = "ready";
    } else {
      match.status = "scheduled";
    }
  }
}

function winnerLabelFromMatch(match, topLabel, bottomLabel) {
  const winnerSlot = getWinnerSlot(match);
  if (winnerSlot === "top") {
    return topLabel;
  }
  if (winnerSlot === "bottom") {
    return bottomLabel;
  }
  return "";
}

export function setConfig(config) {
  state.config = config;
}

export function setMode(mode, readOnly = true) {
  state.mode = mode;
  state.readOnly = readOnly;
}

export function setBootstrap(payload) {
  state.bootstrap = payload;
  rebuildIndexes();
}

export function mergeUpdatedMatches(updatedMatches, meta = {}) {
  if (!state.bootstrap) {
    return;
  }
  const replaceMap = new Map(updatedMatches.map((item) => [item.match_id, item]));
  state.bootstrap.matches = state.bootstrap.matches.map((match) => replaceMap.get(match.match_id) || match);
  if (meta.dataVersion) {
    state.bootstrap.dataVersion = meta.dataVersion;
  }
  if (meta.currentWeatherMode) {
    state.bootstrap.currentWeatherMode = meta.currentWeatherMode;
  }
  if (meta.generatedAt) {
    state.bootstrap.generatedAt = meta.generatedAt;
  }
  rebuildIndexes();
}

export function applyOptimisticResult({ matchId, winnerSlot, scoreText, correctionNote, sessionId, clearResult = false }) {
  if (!state.bootstrap) {
    return false;
  }

  const eventMatches = state.bootstrap.matches
    .filter((match) => match.match_id === matchId || match.event_id === (state.indexes.matchesById.get(matchId) || {}).event_id)
    .map(cloneMatch);
  const targetMatch = eventMatches.find((match) => match.match_id === matchId);
  if (!targetMatch) {
    return false;
  }
  if (clearResult) {
    targetMatch.winner_slot = "";
    targetMatch.winner_team_id = "";
    targetMatch.loser_team_id = "";
    targetMatch.score_text = "";
    targetMatch.correction_note = "";
    targetMatch.updated_at = nowIso();
    targetMatch.updated_by_session = sessionId || "";

    recalculateEventMatches(eventMatches);
    state.pendingSync.set(matchId, (state.pendingSync.get(matchId) || 0) + 1);
    mergeUpdatedMatches(eventMatches);
    return true;
  }
  const normalizedWinnerSlot = normalizeWinnerSlot(winnerSlot);
  if (!normalizedWinnerSlot) {
    return false;
  }

  const hadWinner = !!getWinnerSlot(targetMatch);
  targetMatch.winner_slot = normalizedWinnerSlot;
  targetMatch.score_text = scoreText || "";
  targetMatch.correction_note = hadWinner ? (correctionNote || "corrected") : (correctionNote || "");
  targetMatch.updated_at = nowIso();
  targetMatch.updated_by_session = sessionId || "";

  recalculateEventMatches(eventMatches);
  state.pendingSync.set(matchId, (state.pendingSync.get(matchId) || 0) + 1);
  mergeUpdatedMatches(eventMatches);
  return true;
}

export function clearAllPendingSync() {
  state.pendingSync.clear();
}

export function hasPendingSync() {
  return state.pendingSync.size > 0;
}

export function isEditorPinRequired() {
  return toBoolean(state.config && state.config.REQUIRE_EDITOR_PIN, true);
}

export function setRoute(route) {
  state.route = route;
}

export function setHoverPreview(eventId, matchId, winnerSlot) {
  const normalizedWinnerSlot = normalizeWinnerSlot(winnerSlot);
  if (!eventId || !matchId || !normalizedWinnerSlot) {
    state.hoverPreview = null;
    return;
  }
  const nextPreview = {
    eventId: String(eventId),
    matchId: String(matchId),
    winnerSlot: normalizedWinnerSlot,
  };
  if (
    state.hoverPreview &&
    state.hoverPreview.eventId === nextPreview.eventId &&
    state.hoverPreview.matchId === nextPreview.matchId &&
    state.hoverPreview.winnerSlot === nextPreview.winnerSlot
  ) {
    return;
  }
  state.hoverPreview = nextPreview;
}

export function clearHoverPreview() {
  state.hoverPreview = null;
}

export function setBanner(message, type = "warn", options = {}) {
  const requestedDuration = Number(options.durationMs);
  const durationMs = Number.isFinite(requestedDuration)
    ? requestedDuration
    : type === "warn"
      ? 5200
      : 2600;
  state.banner = { message, type, durationMs };
}

export function clearBanner() {
  state.banner = null;
}

export function setEventFilter(filter) {
  state.eventFilter = normalizeEventFilter(filter);
}

export function setScheduleTab(kind, targetId, dayNo) {
  const bucket = state.scheduleTabs[kind];
  const normalizedDay = normalizeDayNo(dayNo);
  if (!bucket || !normalizedDay) {
    return;
  }
  bucket.set(String(targetId || ""), normalizedDay);
  persistScheduleDayPreference(normalizedDay);
}

export function openModal(matchId, options = {}) {
  state.modal.matchId = matchId;
  state.modal.error = "";
  state.modal.submitting = false;
  const match = state.indexes.matchesById.get(matchId);
  resetModalDraft(match || null, String(options.preferredWinnerSlot || "").trim());
}

export function closeModal() {
  state.modal.matchId = "";
  state.modal.error = "";
  state.modal.submitting = false;
  resetModalDraft();
}

export function setModalError(message) {
  state.modal.error = message;
}

export function setModalSubmitting(value) {
  state.modal.submitting = value;
}

export function updateModalDraft(field, value) {
  if (!state.modal.matchId) {
    return;
  }
  if (!(field in state.modal.draft)) {
    return;
  }
  state.modal.draft[field] = field === "winnerSlot" ? normalizeWinnerSlot(value) : String(value || "");
  state.modal.touched[field] = true;
  state.modal.error = "";
}

export function getState() {
  return state;
}

export function getCurrentWeatherMode() {
  return (state.bootstrap && state.bootstrap.currentWeatherMode) || "sunny";
}

export function getVisibleEvents() {
  const currentWeatherMode = getCurrentWeatherMode();
  const activeFilter = normalizeEventFilter(state.eventFilter) || currentWeatherMode || "all";
  return [...state.indexes.eventsById.values()]
    .filter((event) => eventMatchesFilter(event, activeFilter))
    .sort((a, b) => Number(a.display_order) - Number(b.display_order));
}

export function getEventFilter() {
  return state.eventFilter;
}

export function getClassIds() {
  const configured = ((state.bootstrap && state.bootstrap.classNames) || []).map((item) => String(item || "").trim()).filter(Boolean);
  return unique([...state.indexes.teamIdsByClass.keys(), ...configured]).sort(sortClassId);
}

export function getEventById(eventId) {
  return state.indexes.eventsById.get(eventId) || null;
}

export function getMatchesForEvent(eventId) {
  return [...(state.indexes.matchesByEvent.get(eventId) || [])];
}

export function getMatchView(match, selectedClassId = "") {
  const topResolvedName = resolveTeamName(match.resolved_top_team_id);
  const bottomResolvedName = resolveTeamName(match.resolved_bottom_team_id);
  const topLabel = topResolvedName || slotLabel(match.slot_top_type, match.slot_top_ref);
  const bottomLabel = bottomResolvedName || slotLabel(match.slot_bottom_type, match.slot_bottom_ref);
  const topTeam = state.indexes.teamsById.get(match.resolved_top_team_id);
  const bottomTeam = state.indexes.teamsById.get(match.resolved_bottom_team_id);
  const topClass = (topTeam && topTeam.class_id) || "";
  const bottomClass = (bottomTeam && bottomTeam.class_id) || "";
  const winnerSlot = getWinnerSlot(match);
  const winnerTeamId = match.winner_team_id;
  const loserTeamId = match.loser_team_id;
  const winnerLabel = winnerLabelFromMatch(match, topLabel, bottomLabel);
  const resultLabel = winnerLabel ? `${winnerLabel}勝` : "";
  const isPendingSync = state.pendingSync.has(match.match_id);
  const selectedClassOutcome =
    selectedClassId && winnerTeamId
      ? topClass === selectedClassId && winnerTeamId === match.resolved_top_team_id
        ? "win"
        : bottomClass === selectedClassId && winnerTeamId === match.resolved_bottom_team_id
          ? "win"
          : topClass === selectedClassId || bottomClass === selectedClassId
            ? "lose"
            : ""
      : "";
  const hasWinnerChoices = getAvailableWinnerChoices(match).length > 0;
  const canSubmit =
    !state.readOnly &&
    hasWinnerChoices &&
    (match.status === "scheduled" || match.status === "ready" || match.status === "completed" || match.status === "corrected");

  return {
    match,
    topLabel,
    bottomLabel,
    topResolvedName,
    bottomResolvedName,
    topTeamId: match.resolved_top_team_id,
    bottomTeamId: match.resolved_bottom_team_id,
    topClass,
    bottomClass,
    winnerSlot,
    winnerTeamId,
    loserTeamId,
    winnerLabel,
    resultLabel,
    timeText: formatMatchTimeText(match, state.config || {}),
    isTopWinner: winnerSlot === "top",
    isBottomWinner: winnerSlot === "bottom",
    isTopLoser: winnerSlot === "bottom",
    isBottomLoser: winnerSlot === "top",
    topHighlighted: selectedClassId && topClass === selectedClassId,
    bottomHighlighted: selectedClassId && bottomClass === selectedClassId,
    selectedClassOutcome,
    isPendingSync,
    canSubmit,
    progressLabel: isPendingSync ? "送信中" : resultLabel ? "実施済み" : canSubmit ? "未実施" : "未確定",
    statusText: resultLabel || (canSubmit ? "入力待ち" : "未確定"),
    formattedDay: formatDayLabel(match.day_no, state.config || {}),
    formattedTime: formatClock(match.start_time),
  };
}

export function getRouteData() {
  return state.route;
}

export function getHomeData() {
  const activeFilter = normalizeEventFilter(state.eventFilter) || getCurrentWeatherMode() || "all";
  return {
    appName: (state.config && state.config.APP_NAME) || "球技大会ライブ",
    currentWeatherMode: getCurrentWeatherMode(),
    events: getVisibleEvents(),
    classIds: getClassIds(),
    updatedAt: formatDateTimeStamp((state.bootstrap && state.bootstrap.generatedAt) || ""),
    isReadOnly: state.readOnly,
    mode: state.mode,
    eventFilter: activeFilter,
  };
}

export function getEventDetail(eventId) {
  const event = getEventById(eventId);
  if (!event) {
    return null;
  }
  const baseMatches = getMatchesForEvent(eventId);
  const matches = buildPreviewedEventMatches(eventId, baseMatches);
  const scheduledMatches = matches
    .filter((match) => match.day_no || match.start_time)
    .sort(sortBySchedule);
  const scheduleDays = collectScheduleDays(scheduledMatches);
  const activeScheduleDay = resolveScheduleTab("event", eventId, scheduleDays);
  return {
    event,
    teams: ((state.bootstrap && state.bootstrap.teams) || [])
      .filter((team) => team.event_id === eventId)
      .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0)),
    matches,
    baseMatches,
    scheduledMatches: activeScheduleDay
      ? scheduledMatches.filter((match) => normalizeDayNo(match.day_no) === activeScheduleDay)
      : scheduledMatches,
    scheduleDays,
    activeScheduleDay,
    selectedClassId: state.route.name === "class" ? state.route.params.classId || "" : "",
    isReadOnly: state.readOnly,
  };
}

function buildConditionText(match, classId) {
  const conditions = [];
  const topCandidates = resolveCandidateTeams(match.slot_top_type, match.slot_top_ref);
  const bottomCandidates = resolveCandidateTeams(match.slot_bottom_type, match.slot_bottom_ref);
  if (!match.resolved_top_team_id && classMatchesTeamIds(classId, topCandidates)) {
    conditions.push(slotLabel(match.slot_top_type, match.slot_top_ref));
  }
  if (!match.resolved_bottom_team_id && classMatchesTeamIds(classId, bottomCandidates)) {
    conditions.push(slotLabel(match.slot_bottom_type, match.slot_bottom_ref));
  }
  return conditions.join(" / ");
}

export function getClassSchedule(classId) {
  if (!classId) {
    return null;
  }
  const visibleEventIds = new Set(getVisibleEvents().map((event) => event.event_id));
  const confirmed = [];
  const conditional = [];

  for (const match of (state.bootstrap && state.bootstrap.matches) || []) {
    if (!visibleEventIds.has(match.event_id)) {
      continue;
    }
    const topTeam = state.indexes.teamsById.get(match.resolved_top_team_id);
    const bottomTeam = state.indexes.teamsById.get(match.resolved_bottom_team_id);
    const isConfirmed = (topTeam && topTeam.class_id === classId) || (bottomTeam && bottomTeam.class_id === classId);
    if (isConfirmed) {
      confirmed.push(match);
      continue;
    }
    const topCandidates = resolveCandidateTeams(match.slot_top_type, match.slot_top_ref);
    const bottomCandidates = resolveCandidateTeams(match.slot_bottom_type, match.slot_bottom_ref);
    if (classMatchesTeamIds(classId, topCandidates) || classMatchesTeamIds(classId, bottomCandidates)) {
      conditional.push(match);
    }
  }

  confirmed.sort(sortBySchedule);
  conditional.sort(sortBySchedule);

  const scheduleDays = collectScheduleDays([...confirmed, ...conditional]);
  const activeScheduleDay = resolveScheduleTab("class", classId, scheduleDays);
  const filterByDay = (match) => !activeScheduleDay || normalizeDayNo(match.day_no) === activeScheduleDay;

  return {
    classId,
    scheduleDays,
    activeScheduleDay,
    confirmed: confirmed.filter(filterByDay).map((match) => ({
      match,
      event: state.indexes.eventsById.get(match.event_id),
      view: getMatchView(match, classId),
      conditionText: "",
    })),
    conditional: conditional.filter(filterByDay).map((match) => ({
      match,
      event: state.indexes.eventsById.get(match.event_id),
      view: getMatchView(match, classId),
      conditionText: buildConditionText(match, classId),
    })),
  };
}

export function getModalMatch() {
  if (!state.modal.matchId) {
    return null;
  }
  const match = state.indexes.matchesById.get(state.modal.matchId);
  if (!match) {
    return null;
  }
  const event = state.indexes.eventsById.get(match.event_id);
  const availableWinnerChoices = getAvailableWinnerChoices(match);
  return {
    event,
    match,
    view: getMatchView(match),
    error: state.modal.error,
    submitting: state.modal.submitting,
    isReadOnly: state.readOnly,
    requireEditorPin: isEditorPinRequired(),
    draft: { ...state.modal.draft },
    availableWinnerChoices,
  };
}
