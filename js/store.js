import { formatClock, formatDateTimeStamp, formatDayLabel, formatMatchTimeText } from "./format.js";

const state = {
  config: null,
  mode: "missing",
  readOnly: true,
  bootstrap: null,
  pendingSync: new Map(),
  scheduleTabs: {
    event: new Map(),
    class: new Map(),
  },
  route: { name: "home", params: {} },
  eventFilter: "",
  banner: null,
  modal: {
    matchId: "",
    error: "",
    submitting: false,
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
    return `${match.match_label}の${slotType === "winner" ? "勝者" : "敗者"}`;
  }
  return "BYE";
}

function resolveTeamName(teamId) {
  const team = state.indexes.teamsById.get(teamId);
  return (team && team.display_name) || "";
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

    if (match.winner_team_id && match.winner_team_id !== topTeam && match.winner_team_id !== bottomTeam) {
      match.winner_team_id = "";
      match.loser_team_id = "";
      match.score_text = "";
      match.correction_note = "";
      match.updated_at = "";
      match.updated_by_session = "";
    }

    if (!match.winner_team_id) {
      if (topTeam && bottomIsBye) {
        match.winner_team_id = topTeam;
        match.loser_team_id = "";
      } else if (bottomTeam && topIsBye) {
        match.winner_team_id = bottomTeam;
        match.loser_team_id = "";
      }
    }

    if (match.winner_team_id) {
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

function winnerLabelFromTeamId(teamId) {
  if (!teamId) {
    return "";
  }
  const team = state.indexes.teamsById.get(teamId);
  return (team && team.display_name) || "";
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

export function applyOptimisticResult({ matchId, winnerTeamId, scoreText, correctionNote, sessionId, clearResult = false }) {
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
  if (!targetMatch.resolved_top_team_id || !targetMatch.resolved_bottom_team_id) {
    return false;
  }
  if (winnerTeamId !== targetMatch.resolved_top_team_id && winnerTeamId !== targetMatch.resolved_bottom_team_id) {
    return false;
  }

  const hadWinner = !!targetMatch.winner_team_id;
  targetMatch.winner_team_id = winnerTeamId;
  targetMatch.loser_team_id = winnerTeamId === targetMatch.resolved_top_team_id ? targetMatch.resolved_bottom_team_id : targetMatch.resolved_top_team_id;
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
}

export function openModal(matchId) {
  state.modal.matchId = matchId;
  state.modal.error = "";
}

export function closeModal() {
  state.modal.matchId = "";
  state.modal.error = "";
  state.modal.submitting = false;
}

export function setModalError(message) {
  state.modal.error = message;
}

export function setModalSubmitting(value) {
  state.modal.submitting = value;
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
  return [...state.indexes.teamIdsByClass.keys()].sort(sortClassId);
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
  const winnerTeamId = match.winner_team_id;
  const loserTeamId = match.loser_team_id;
  const winnerLabel = winnerLabelFromTeamId(winnerTeamId);
  const resultLabel = winnerLabel ? `${winnerLabel}勝` : "";
  const isPendingSync = state.pendingSync.has(match.match_id);
  const canSubmit =
    !state.readOnly &&
    !!match.resolved_top_team_id &&
    !!match.resolved_bottom_team_id &&
    (match.status === "ready" || match.status === "completed" || match.status === "corrected");

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
    winnerTeamId,
    loserTeamId,
    winnerLabel,
    resultLabel,
    timeText: formatMatchTimeText(match, state.config || {}),
    isTopWinner: winnerTeamId && winnerTeamId === match.resolved_top_team_id,
    isBottomWinner: winnerTeamId && winnerTeamId === match.resolved_bottom_team_id,
    isTopLoser: loserTeamId && loserTeamId === match.resolved_top_team_id,
    isBottomLoser: loserTeamId && loserTeamId === match.resolved_bottom_team_id,
    topHighlighted: selectedClassId && topClass === selectedClassId,
    bottomHighlighted: selectedClassId && bottomClass === selectedClassId,
    isPendingSync,
    canSubmit,
    progressLabel: isPendingSync ? "送信中" : resultLabel ? "実施済み" : match.status === "ready" ? "未実施" : "未確定",
    statusText: resultLabel || (match.status === "ready" ? "入力待ち" : "未確定"),
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
  const matches = getMatchesForEvent(eventId);
  const scheduledMatches = matches
    .filter((match) => match.day_no || match.start_time)
    .sort(sortBySchedule);
  const scheduleDays = collectScheduleDays(scheduledMatches);
  const activeScheduleDay = resolveScheduleTab("event", eventId, scheduleDays);
  return {
    event,
    matches,
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
  return {
    event,
    match,
    view: getMatchView(match),
    error: state.modal.error,
    submitting: state.modal.submitting,
    isReadOnly: state.readOnly,
    requireEditorPin: isEditorPinRequired(),
  };
}
