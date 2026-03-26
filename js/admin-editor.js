import { buildBracketSections } from "./bracket-layout.js";
import { parseEventEditorMeta, serializeEventEditorMeta, getEventFormatType } from "./event-meta.js";
import { toHref } from "./router.js";

const MEMBER_TOKENS = ["", "①", "②", "③"];
const DEFAULT_INTERVAL_MINUTES = 15;
const DAY_KEYS = ["1", "2"];
const adminState = {
  drafts: new Map(),
  classSettingsText: "",
  timetableSelections: new Map(),
};

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function unique(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function sortClassId(a, b) {
  return String(a || "").localeCompare(String(b || ""), "ja", { numeric: true });
}

function clampInt(value, fallback, minValue = 1, maxValue = 128) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(minValue, Math.min(maxValue, parsed));
}

function nextPowerOfTwo(value) {
  let size = 1;
  while (size < value) {
    size *= 2;
  }
  return Math.max(2, size);
}

function getDraftSlotCount(format, teamCount) {
  const normalized = clampInt(teamCount, 2, 2, 64);
  return format === "league" ? normalized : nextPowerOfTwo(normalized);
}

function getRequiredSeedCount(teamCount) {
  const normalized = clampInt(teamCount, 2, 2, 64);
  return Math.max(0, nextPowerOfTwo(normalized) - normalized);
}

function getOpponentSlotIndex(index) {
  return index % 2 === 0 ? index + 1 : index - 1;
}

function buildDefaultSeedCandidateIndexes(teamCount) {
  const requiredCount = getRequiredSeedCount(teamCount);
  const bracketSize = nextPowerOfTwo(teamCount);
  const seedPlacement = buildSeedPlacement(bracketSize);
  return Array.from({ length: requiredCount }, (_, index) => seedPlacement.indexOf(index + 1)).filter((index) => index >= 0);
}

function buildDefaultSeedSlotIds(slots, teamCount) {
  const requiredCount = getRequiredSeedCount(teamCount);
  return buildDefaultSeedCandidateIndexes(teamCount)
    .slice(0, requiredCount)
    .map((index) => slots[index])
    .filter(Boolean)
    .map((slot) => slot.slotId);
}

function normalizeSeedSlotIdsForExactCount(slots, teamCount, seedSlotIds, format = "tournament") {
  if (format === "league") {
    return [];
  }
  const requiredCount = getRequiredSeedCount(teamCount);
  const slotCount = getDraftSlotCount(format, teamCount);
  const slotIndexById = new Map(slots.slice(0, slotCount).map((slot, index) => [slot.slotId, index]));
  const filtered = [];
  const usedPairs = new Set();
  for (const slotId of seedSlotIds || []) {
    const index = slotIndexById.get(slotId);
    const slot = index == null ? null : slots[index];
    const pairIndex = index == null ? -1 : Math.floor(index / 2);
    if (
      index == null ||
      !slot ||
      usedPairs.has(pairIndex) ||
      filtered.length >= requiredCount
    ) {
      continue;
    }
    filtered.push(slotId);
    usedPairs.add(pairIndex);
  }
  for (const index of buildDefaultSeedCandidateIndexes(teamCount)) {
    if (filtered.length >= requiredCount || usedPairs.has(Math.floor(index / 2))) {
      continue;
    }
    const slot = slots[index];
    if (!slot) {
      continue;
    }
    filtered.push(slot.slotId);
    usedPairs.add(Math.floor(index / 2));
  }
  for (let index = 0; index < slotCount && filtered.length < requiredCount; index += 1) {
    if (usedPairs.has(Math.floor(index / 2))) {
      continue;
    }
    const slot = slots[index];
    if (!slot) {
      continue;
    }
    filtered.push(slot.slotId);
    usedPairs.add(Math.floor(index / 2));
  }
  return filtered;
}

function buildSeedRemovedSlotIdSet(draft) {
  if (draft.format === "league") {
    return new Set();
  }
  const slotCount = getDraftSlotCount(draft.format, draft.teamCount);
  const slots = draft.slots.slice(0, slotCount);
  const seedSlotIds = normalizeSeedSlotIdsForExactCount(slots, draft.teamCount, draft.seedSlotIds, draft.format);
  const seedSet = new Set(seedSlotIds);
  const removed = new Set();
  slots.forEach((slot, index) => {
    if (!seedSet.has(slot.slotId)) {
      return;
    }
    const opponentIndex = getOpponentSlotIndex(index);
    const opponentSlot = slots[opponentIndex];
    if (!opponentSlot || seedSet.has(opponentSlot.slotId)) {
      return;
    }
    removed.add(opponentSlot.slotId);
  });
  return removed;
}

function getActiveMainSlots(draft) {
  const slotCount = getDraftSlotCount(draft.format, draft.teamCount);
  const slots = draft.slots.slice(0, slotCount);
  if (draft.format === "league") {
    return slots.slice(0, draft.teamCount);
  }
  const removed = buildSeedRemovedSlotIdSet(draft);
  return slots.filter((slot) => !removed.has(slot.slotId));
}

function parseTimeToMinutes(value) {
  const match = String(value || "").trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    return 0;
  }
  const hours = Math.max(0, Math.min(23, Number(match[1])));
  const minutes = Math.max(0, Math.min(59, Number(match[2])));
  return hours * 60 + minutes;
}

function formatMinutes(totalMinutes) {
  const safe = Math.max(0, Number(totalMinutes) || 0);
  const hours = Math.floor(safe / 60);
  const minutes = safe % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function buildCourtNames(count) {
  return Array.from({ length: clampInt(count, 1, 1, 16) }, (_, index) => `コート${index + 1}`);
}

function buildDraftCourtNames(rawNames, count) {
  const defaults = buildCourtNames(count);
  return Array.from({ length: count }, (_, index) => String(((rawNames || [])[index]) || defaults[index] || `コート${index + 1}`).trim());
}

function sanitizeDayTimetable(source, courtCount) {
  const rows = ((source && source.rows) || []).map((row) => ({
    time: String(row.time || ""),
    cells: Array.from({ length: courtCount }, (_, index) => String(((row.cells || [])[index]) || "")),
  }));
  return {
    enabled: !!(source && source.enabled) || rows.length > 0,
    startTime: String((source && source.startTime) || "09:00"),
    endTime: String((source && source.endTime) || "12:00"),
    intervalMinutes: clampInt(source && source.intervalMinutes, DEFAULT_INTERVAL_MINUTES, 5, 120),
    courtNames: buildDraftCourtNames(source && source.courtNames, courtCount),
    rows,
  };
}

function buildEmptyDayTimetable(courtCount) {
  return sanitizeDayTimetable({}, courtCount);
}

function getDayTimetable(draft, dayNo) {
  const key = String(dayNo || "1");
  return draft.dayTimetables[key] || buildEmptyDayTimetable(draft.courtCount);
}

function buildSlotId(index) {
  return `slot-${index + 1}`;
}

function createSlot(index) {
  return {
    slotId: buildSlotId(index),
    className: "",
    memberToken: "",
  };
}

function buildClassNamesFromBootstrap(bootstrap) {
  const configured = ((bootstrap && bootstrap.classNames) || []).map((item) => String(item || "").trim()).filter(Boolean);
  const used = ((bootstrap && bootstrap.teams) || []).map((team) => String(team.class_id || "").trim()).filter(Boolean);
  return unique([...configured, ...used]).sort(sortClassId);
}

function buildClassSettingsText(bootstrap) {
  return buildClassNamesFromBootstrap(bootstrap).join("\n");
}

function parseClassSettingsText(text) {
  return unique(
    String(text || "")
      .split(/[\r\n,\t ]+/)
      .map((item) => item.trim())
      .filter(Boolean)
  ).sort(sortClassId);
}

function buildSourceId(prefix, index) {
  return `${prefix}-source-${index + 1}`;
}

function sanitizeBracketSource(source, index, prefix) {
  return {
    sourceId: String((source && source.sourceId) || buildSourceId(prefix, index)),
    kind: ["slot", "winner", "loser", "bye"].includes(source && source.kind) ? source.kind : "bye",
    value: String((source && source.value) || ""),
  };
}

function sanitizeEditableBracket(item, fallbackId, fallbackTitle, fallbackTeamCount = 2) {
  const teamCount = clampInt(item && item.teamCount, 2, 2, 16);
  const bracketId = String((item && item.id) || fallbackId);
  const sources = Array.from({ length: teamCount }, (_, sourceIndex) =>
    sanitizeBracketSource(((item && item.sources) || [])[sourceIndex] || {}, sourceIndex, bracketId)
  );
  return {
    id: bracketId,
    title: String((item && item.title) || fallbackTitle),
    teamCount,
    sources,
    seedSourceIds: ((item && item.seedSourceIds) || []).filter((sourceId) => sources.some((source) => source.sourceId === sourceId)),
  };
}

function sanitizeDraft(rawDraft, routeKey) {
  const source = clone(rawDraft || {});
  const format = source.format === "league" ? "league" : "tournament";
  const teamCount = clampInt(source.teamCount, 8, 2, 64);
  const courtCount = clampInt(source.courtCount, 1, 1, 16);
  const slotCount = getDraftSlotCount(format, teamCount);
  const slots = Array.from({ length: slotCount }, (_, index) => {
    const slot = (source.slots || [])[index] || {};
    return {
      slotId: slot.slotId || buildSlotId(index),
      className: String(slot.className || ""),
      memberToken: MEMBER_TOKENS.includes(slot.memberToken) ? slot.memberToken : "",
    };
  });
  const legacyTimetable = source.timetable || {};
  const legacyDayNo = String(legacyTimetable.dayNo || "1");
  const rawDayTimetables = source.dayTimetables || {};
  const draft = {
    routeKey,
    eventId: String(source.eventId || (routeKey !== "new" ? routeKey : `custom_${Date.now()}`)),
    originalEventId: String(source.originalEventId || (routeKey !== "new" ? routeKey : "")),
    displayName: String(source.displayName || ""),
    shortName: String(source.shortName || ""),
    format,
    teamCount,
    courtCount,
    slots,
    seedSlotIds: (source.seedSlotIds || []).filter((slotId) => slots.some((slot) => slot.slotId === slotId)),
    seedMode: !!source.seedMode,
    selectedSlotId: String(source.selectedSlotId || (slots[0] && slots[0].slotId) || ""),
    editingSlotId: String(source.editingSlotId || ""),
    selectedBracketId: String(source.selectedBracketId || ""),
    selectedSourceId: String(source.selectedSourceId || ""),
    thirdPlaceEnabled: !!source.thirdPlaceEnabled,
    consolationBracket: source.consolationBracket
      ? sanitizeEditableBracket(source.consolationBracket, "consolation", "コンソレーション", 4)
      : source.consolationEnabled
        ? sanitizeEditableBracket({}, "consolation", "コンソレーション", 4)
        : null,
    customBrackets: (source.customBrackets || []).map((item, index) =>
      sanitizeEditableBracket(item, `custom-${index + 1}`, `その他トーナメント${index + 1}`, 2)
    ),
    dayTimetables: Object.fromEntries(
      DAY_KEYS.map((dayNo) => [
        dayNo,
        sanitizeDayTimetable(
          rawDayTimetables[dayNo] || (legacyDayNo === dayNo ? legacyTimetable : {}),
          courtCount
        ),
      ])
    ),
  };
  if (Array.isArray(source.seedSlotIds)) {
    draft.seedSlotIds = normalizeSeedSlotIdsForExactCount(slots, teamCount, draft.seedSlotIds, format);
  } else {
    draft.seedSlotIds = format === "tournament" ? buildDefaultSeedSlotIds(slots, teamCount) : [];
  }
  if (draft.format === "league") {
    draft.seedMode = false;
    draft.seedSlotIds = [];
    draft.selectedBracketId = "";
    draft.selectedSourceId = "";
    draft.thirdPlaceEnabled = false;
    draft.consolationBracket = null;
    draft.customBrackets = [];
  }
  if (!slots.some((slot) => slot.slotId === draft.selectedSlotId)) {
    draft.selectedSlotId = (slots[0] && slots[0].slotId) || "";
  }
  if (!slots.some((slot) => slot.slotId === draft.editingSlotId)) {
    draft.editingSlotId = "";
  }
  if (
    draft.selectedBracketId &&
    ![draft.consolationBracket, ...draft.customBrackets]
      .filter(Boolean)
      .some((bracket) => bracket.id === draft.selectedBracketId && bracket.sources.some((sourceItem) => sourceItem.sourceId === draft.selectedSourceId))
  ) {
    draft.selectedBracketId = "";
    draft.selectedSourceId = "";
  }
  return draft;
}

function createEmptyDraft(routeKey = "new") {
  return sanitizeDraft(
    {
      eventId: routeKey !== "new" ? routeKey : `custom_${Date.now()}`,
      originalEventId: routeKey !== "new" ? routeKey : "",
      displayName: "",
      shortName: "",
      format: "tournament",
      teamCount: 8,
      courtCount: 1,
      slots: Array.from({ length: 8 }, (_, index) => createSlot(index)),
      seedMode: false,
      selectedSlotId: buildSlotId(0),
      editingSlotId: "",
      selectedBracketId: "",
      selectedSourceId: "",
      thirdPlaceEnabled: false,
      consolationBracket: null,
      customBrackets: [],
      dayTimetables: Object.fromEntries(DAY_KEYS.map((dayNo) => [dayNo, buildEmptyDayTimetable(1)])),
    },
    routeKey
  );
}

function buildDraftFromExistingRows(bootstrap, routeKey) {
  const event = ((bootstrap && bootstrap.events) || []).find((item) => item.event_id === routeKey);
  if (!event) {
    return createEmptyDraft(routeKey);
  }
  const teams = ((bootstrap && bootstrap.teams) || [])
    .filter((team) => team.event_id === routeKey)
    .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));
  const matches = ((bootstrap && bootstrap.matches) || []).filter((match) => match.event_id === routeKey);
  const draft = sanitizeDraft(
    {
      eventId: routeKey,
      originalEventId: routeKey,
      displayName: event.display_name || "",
      shortName: event.short_name || event.display_name || "",
      format: getEventFormatType(event),
      teamCount: Math.max(2, teams.length || 2),
      courtCount: Math.max(1, unique(matches.map((match) => match.court).filter(Boolean)).length || 1),
      thirdPlaceEnabled: matches.some((match) => match.bracket_type === "third_place"),
      consolationBracket: null,
    },
    routeKey
  );
  const targetSlots = draft.format === "league" ? draft.slots.slice(0, draft.teamCount) : getActiveMainSlots(draft);
  targetSlots.forEach((slot, index) => {
    const team = teams[index];
    if (!team) {
      return;
    }
    slot.className = String(team.class_id || team.display_name || "");
    slot.memberToken = MEMBER_TOKENS.includes(team.member_token) ? team.member_token : "";
  });
  if (matches.some((match) => match.bracket_type === "consolation")) {
    draft.consolationBracket = buildDefaultConsolationBracket(draft);
  }
  return draft;
}

function ensureDraft(bootstrap, routeKey = "new") {
  if (adminState.drafts.has(routeKey)) {
    return adminState.drafts.get(routeKey);
  }
  let draft = null;
  if (routeKey !== "new") {
    const event = ((bootstrap && bootstrap.events) || []).find((item) => item.event_id === routeKey);
    const meta = parseEventEditorMeta(event && event.bracket_note);
    if (meta && meta.draft) {
      draft = sanitizeDraft({ ...meta.draft, eventId: routeKey, originalEventId: routeKey }, routeKey);
    }
  }
  if (!draft) {
    draft = routeKey === "new" ? createEmptyDraft(routeKey) : buildDraftFromExistingRows(bootstrap, routeKey);
  }
  adminState.drafts.set(routeKey, draft);
  return draft;
}

function commitDraft(bootstrap, routeKey, updater) {
  const current = ensureDraft(bootstrap, routeKey);
  const nextDraft = typeof updater === "function" ? updater(clone(current)) : clone(updater);
  const normalized = sanitizeDraft(nextDraft, routeKey);
  adminState.drafts.set(routeKey, normalized);
  return normalized;
}

function buildSlotDisplayLabel(slot, index) {
  const className = String(slot.className || "").trim();
  return className ? `${className}${slot.memberToken || ""}` : `枠${index + 1}`;
}

function buildTeamRows(draft) {
  const removedSlotIds = buildSeedRemovedSlotIdSet(draft);
  const slotEntries = draft.format === "league"
    ? draft.slots.slice(0, draft.teamCount).map((slot, index) => ({ slot, index }))
    : draft.slots
      .slice(0, getDraftSlotCount(draft.format, draft.teamCount))
      .map((slot, index) => ({ slot, index }))
      .filter(({ slot }) => !removedSlotIds.has(slot.slotId));
  return slotEntries.map(({ slot, index }) => ({
    team_id: `${draft.eventId}:${slot.slotId}`,
    event_id: draft.eventId,
    class_id: String(slot.className || ""),
    display_name: buildSlotDisplayLabel(slot, index),
    source_label: slot.slotId,
    member_token: slot.memberToken || "",
    sort_order: String(index + 1),
    _slotId: slot.slotId,
  }));
}
function buildSeedPlacement(size) {
  if (size <= 1) {
    return [1];
  }
  let seeds = [1, 2];
  while (seeds.length < size) {
    const nextSize = seeds.length * 2;
    seeds = seeds.flatMap((seed) => [seed, nextSize + 1 - seed]);
  }
  return seeds;
}

function buildMatchLabelFactory(prefix = "") {
  let counter = 1;
  return function nextLabel() {
    const label = prefix ? `${prefix}${counter}` : String(counter);
    counter += 1;
    return label;
  };
}

function buildRoundKey(roundNumber, totalRounds) {
  if (totalRounds <= 1) {
    return "f";
  }
  if (roundNumber === totalRounds) {
    return "f";
  }
  if (roundNumber === totalRounds - 1) {
    return "sf";
  }
  return `r${roundNumber}`;
}

function createMatchRow(eventId, bracketType, roundKey, matchLabel, displayOrder, top, bottom, options = {}) {
  return {
    match_id: `${eventId}:m${displayOrder}`,
    event_id: eventId,
    bracket_type: bracketType,
    round_key: roundKey,
    match_label: matchLabel,
    display_order: String(displayOrder),
    day_no: "",
    start_time: "",
    court: "",
    source_page: "",
    slot_top_type: top.type,
    slot_top_ref: top.ref || "",
    slot_bottom_type: bottom.type,
    slot_bottom_ref: bottom.ref || "",
    resolved_top_team_id: "",
    resolved_bottom_team_id: "",
    status: "",
    winner_slot: "",
    winner_team_id: "",
    loser_team_id: "",
    score_text: "",
    correction_note: "",
    updated_at: "",
    updated_by_session: "",
    _hideChip: !!options.hideChip,
    _editorBindings: options.editorBindings || null,
  };
}

function renumberMatchLabels(matches) {
  const grouped = new Map();
  matches
    .slice()
    .sort((a, b) => Number(a.display_order || 0) - Number(b.display_order || 0))
    .forEach((match) => {
      if (!grouped.has(match.bracket_type)) {
        grouped.set(match.bracket_type, []);
      }
      grouped.get(match.bracket_type).push(match);
    });
  const customTypes = [...grouped.keys()].filter((type) => !["main", "third_place", "consolation", "league"].includes(type));
  const customPrefixByType = new Map(customTypes.map((type, index) => [type, `他${index + 1}-`]));
  grouped.forEach((items, type) => {
    let counter = 1;
    items
      .sort((a, b) => Number(a.display_order || 0) - Number(b.display_order || 0))
      .forEach((match) => {
        if (match._hideChip) {
          match.match_label = "";
          return;
        }
        if (type === "third_place") {
          match.match_label = "3決1";
          return;
        }
        if (type === "consolation") {
          match.match_label = `コ${counter}`;
          counter += 1;
          return;
        }
        if (type === "league") {
          match.match_label = `L${counter}`;
          counter += 1;
          return;
        }
        if (type === "main") {
          match.match_label = String(counter);
          counter += 1;
          return;
        }
        match.match_label = `${customPrefixByType.get(type) || ""}${counter}`;
        counter += 1;
      });
  });
}

function buildEliminationSection(eventId, bracketType, labelFactory, leafSources, displayOrderStart) {
  const matches = [];
  let nextDisplayOrder = displayOrderStart;
  let currentRound = leafSources.map((source) => ({ ...source }));
  const totalRounds = Math.log2(currentRound.length);
  const firstRoundIds = [];
  let semifinalIds = [];
  let roundNumber = 1;

  while (currentRound.length > 1) {
    const nextRound = [];
    const createdIds = [];
    for (let index = 0; index < currentRound.length; index += 2) {
      const top = currentRound[index];
      const bottom = currentRound[index + 1];
      const matchLabel = labelFactory();
      const hideChip =
        roundNumber === 1 &&
        ((top.type === "bye" && bottom.type !== "bye") || (bottom.type === "bye" && top.type !== "bye"));
      const row = createMatchRow(
        eventId,
        bracketType,
        buildRoundKey(roundNumber, totalRounds),
        matchLabel,
        nextDisplayOrder,
        top,
        bottom,
        {
          hideChip,
          editorBindings:
            roundNumber === 1
              ? {
                  top: top._editorBinding || null,
                  bottom: bottom._editorBinding || null,
                }
              : null,
        }
      );
      nextDisplayOrder += 1;
      matches.push(row);
      createdIds.push(row.match_id);
      nextRound.push({ type: "winner", ref: row.match_id });
    }
    if (roundNumber === 1) {
      firstRoundIds.push(...createdIds);
    }
    if (currentRound.length === 4) {
      semifinalIds = createdIds.slice();
    }
    currentRound = nextRound;
    roundNumber += 1;
  }

  return {
    matches,
    nextDisplayOrder,
    firstRoundIds,
    semifinalIds,
  };
}

function resolveSource(matchesById, slotType, slotRef) {
  if (slotType === "team") {
    return slotRef;
  }
  if (slotType === "bye") {
    return "";
  }
  const upstream = matchesById.get(slotRef);
  if (!upstream) {
    return "";
  }
  return slotType === "winner" ? upstream.winner_team_id : upstream.loser_team_id;
}

function recalculateMatches(matches) {
  const matchesById = new Map(matches.map((match) => [match.match_id, match]));
  matches.sort((a, b) => Number(a.display_order || 0) - Number(b.display_order || 0));
  matches.forEach((match) => {
    match.resolved_top_team_id = resolveSource(matchesById, match.slot_top_type, match.slot_top_ref);
    match.resolved_bottom_team_id = resolveSource(matchesById, match.slot_bottom_type, match.slot_bottom_ref);
    const topTeam = match.resolved_top_team_id;
    const bottomTeam = match.resolved_bottom_team_id;
    const topIsBye = match.slot_top_type === "bye";
    const bottomIsBye = match.slot_bottom_type === "bye";
    let winnerSlot = match.winner_slot === "top" || match.winner_slot === "bottom" ? match.winner_slot : "";

    if (!winnerSlot) {
      if (match.winner_team_id && match.winner_team_id === topTeam) {
        winnerSlot = "top";
      } else if (match.winner_team_id && match.winner_team_id === bottomTeam) {
        winnerSlot = "bottom";
      }
    }
    if (!winnerSlot) {
      if (topTeam && bottomIsBye) {
        winnerSlot = "top";
      } else if (bottomTeam && topIsBye) {
        winnerSlot = "bottom";
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
      match.status = match.correction_note ? "corrected" : "completed";
    } else if (topTeam && bottomTeam) {
      match.status = "ready";
    } else {
      match.status = "scheduled";
    }
  });
}

function buildMainLeafSources(draft, teamRows) {
  const bracketSize = getDraftSlotCount(draft.format, draft.teamCount);
  const leaves = Array.from({ length: bracketSize }, () => ({ type: "bye", ref: "" }));
  const removedSlotIds = buildSeedRemovedSlotIdSet(draft);
  const teamBySlotId = new Map(teamRows.map((team) => [team._slotId, team]));
  for (let index = 0; index < bracketSize; index += 1) {
    const slot = draft.slots[index];
    if (!slot) {
      continue;
    }
    const binding = {
      kind: "main-slot",
      slotId: slot.slotId,
    };
    if (removedSlotIds.has(slot.slotId)) {
      leaves[index] = {
        type: "bye",
        ref: "",
        _editorBinding: binding,
      };
      continue;
    }
    const team = teamBySlotId.get(slot.slotId);
    leaves[index] = {
      type: team ? "team" : "bye",
      ref: team ? team.team_id : "",
      _editorBinding: binding,
    };
  }
  return leaves;
}

function buildDefaultConsolationSourceMatches(draft) {
  const teamRows = buildTeamRows(draft);
  const main = buildEliminationSection(
    draft.eventId,
    "main",
    buildMatchLabelFactory(""),
    buildMainLeafSources(draft, teamRows),
    1
  );
  recalculateMatches(main.matches);
  const visibleMatches = main.matches
    .filter((match) => !match._hideChip)
    .sort((a, b) => Number(a.display_order || 0) - Number(b.display_order || 0));
  const firstVisibleMatchIdByTeamId = new Map();
  visibleMatches.forEach((match) => {
    if (match.resolved_top_team_id && !firstVisibleMatchIdByTeamId.has(match.resolved_top_team_id)) {
      firstVisibleMatchIdByTeamId.set(match.resolved_top_team_id, match.match_id);
    }
    if (match.resolved_bottom_team_id && !firstVisibleMatchIdByTeamId.has(match.resolved_bottom_team_id)) {
      firstVisibleMatchIdByTeamId.set(match.resolved_bottom_team_id, match.match_id);
    }
  });
  const targetMatchIds = new Set(
    teamRows
      .map((team) => firstVisibleMatchIdByTeamId.get(team.team_id))
      .filter(Boolean)
  );
  return visibleMatches.filter((match) => targetMatchIds.has(match.match_id));
}

function buildDefaultConsolationSources(draft) {
  return buildDefaultConsolationSourceMatches(draft).map((match, index) =>
    sanitizeBracketSource(
      {
        sourceId: buildSourceId("consolation", index),
        kind: "loser",
        value: match.match_id,
      },
      index,
      "consolation"
    )
  );
}

function buildDefaultConsolationBracket(draft) {
  const sources = buildDefaultConsolationSources(draft);
  return sanitizeEditableBracket(
    {
      id: "consolation",
      title: "コンソレーション",
      teamCount: Math.max(2, sources.length || 2),
      sources,
    },
    "consolation",
    "コンソレーション",
    Math.max(2, sources.length || 2)
  );
}

function buildCurrentMainPairMap(draft) {
  const pairMap = new Map();
  const slots = draft.slots.slice(0, getDraftSlotCount(draft.format, draft.teamCount));
  for (let index = 0; index < slots.length; index += 2) {
    const top = slots[index];
    const bottom = slots[index + 1];
    if (top) {
      pairMap.set(top.slotId, bottom ? bottom.slotId : "");
    }
    if (bottom) {
      pairMap.set(bottom.slotId, top ? top.slotId : "");
    }
  }
  return pairMap;
}

function buildBracketSourceOptions(draft, bracket, teamRows, matchRefs) {
  const teamBySlotId = new Map(teamRows.map((team) => [team._slotId, team]));
  const activeSources = (bracket.sources || []).slice(0, bracket.teamCount);
  const seededIds = (bracket.seedSourceIds || []).filter((sourceId) => activeSources.some((source) => source.sourceId === sourceId));
  const seededSet = new Set(seededIds);
  const orderedSources = [
    ...seededIds.map((sourceId) => activeSources.find((source) => source.sourceId === sourceId)).filter(Boolean),
    ...activeSources.filter((source) => !seededSet.has(source.sourceId)),
  ];
  const seedPlacement = buildSeedPlacement(nextPowerOfTwo(bracket.teamCount));
  const bySeed = new Map();
  orderedSources.forEach((source, index) => {
    bySeed.set(index + 1, source);
  });

  return seedPlacement.map((seedNumber) => {
    const source = bySeed.get(seedNumber);
    if (!source) {
      return { type: "bye", ref: "" };
    }
    if (source.kind === "slot") {
      const team = teamBySlotId.get(source.value);
      return team
        ? {
            type: "team",
            ref: team.team_id,
            _editorBinding: {
              kind: "bracket-source",
              bracketId: bracket.id,
              sourceId: source.sourceId,
            },
          }
        : {
            type: "bye",
            ref: "",
            _editorBinding: {
              kind: "bracket-source",
              bracketId: bracket.id,
              sourceId: source.sourceId,
            },
          };
    }
    if ((source.kind === "winner" || source.kind === "loser") && matchRefs.has(source.value)) {
      return {
        type: source.kind,
        ref: matchRefs.get(source.value),
        _editorBinding: {
          kind: "bracket-source",
          bracketId: bracket.id,
          sourceId: source.sourceId,
        },
      };
    }
    return {
      type: "bye",
      ref: "",
      _editorBinding: {
        kind: "bracket-source",
        bracketId: bracket.id,
        sourceId: source.sourceId,
      },
    };
  });
}

function buildTournamentMatches(draft, teamRows) {
  const leafSources = buildMainLeafSources(draft, teamRows);
  const main = buildEliminationSection(draft.eventId, "main", buildMatchLabelFactory(""), leafSources, 1);
  const matchIdByLabel = new Map();
  main.matches.forEach((match) => {
    if (match.match_label) {
      matchIdByLabel.set(match.match_label, match.match_id);
    }
    matchIdByLabel.set(match.match_id, match.match_id);
  });
  let matches = [...main.matches];
  let nextDisplayOrder = main.nextDisplayOrder;

  if (draft.thirdPlaceEnabled && main.semifinalIds.length === 2) {
    const thirdPlace = createMatchRow(draft.eventId, "third_place", "3rd", "3決1", nextDisplayOrder, { type: "loser", ref: main.semifinalIds[0] }, { type: "loser", ref: main.semifinalIds[1] });
    matches.push(thirdPlace);
    if (thirdPlace.match_label) {
      matchIdByLabel.set(thirdPlace.match_label, thirdPlace.match_id);
    }
    matchIdByLabel.set(thirdPlace.match_id, thirdPlace.match_id);
    nextDisplayOrder += 1;
  }

  if (draft.consolationBracket) {
    const defaultSources = buildDefaultConsolationSources(draft);
    const bracket = sanitizeEditableBracket(
      {
        ...draft.consolationBracket,
        sources: draft.consolationBracket.sources && draft.consolationBracket.sources.some((source) => source.kind !== "bye")
          ? draft.consolationBracket.sources
          : defaultSources,
      },
      "consolation",
      "コンソレーション",
      Math.max(2, defaultSources.length || draft.consolationBracket.teamCount || 2)
    );
    const consolationLeafs = buildBracketSourceOptions(draft, bracket, teamRows, matchIdByLabel);
    const consolation = buildEliminationSection(draft.eventId, "consolation", buildMatchLabelFactory("コ"), consolationLeafs, nextDisplayOrder);
    consolation.matches.forEach((match) => {
      match._customBracketId = "consolation";
    });
    matches = matches.concat(consolation.matches);
    nextDisplayOrder = consolation.nextDisplayOrder;
    consolation.matches.forEach((match) => {
      if (match.match_label) {
        matchIdByLabel.set(match.match_label, match.match_id);
      }
      matchIdByLabel.set(match.match_id, match.match_id);
    });
  }

  draft.customBrackets.forEach((custom, index) => {
    const sources = buildBracketSourceOptions(draft, custom, teamRows, matchIdByLabel);
    const bracketType = String(custom.title || `その他トーナメント${index + 1}`).trim() || `その他トーナメント${index + 1}`;
    const extra = buildEliminationSection(draft.eventId, bracketType, buildMatchLabelFactory(`他${index + 1}-`), sources, nextDisplayOrder);
    extra.matches.forEach((match) => {
      match._customBracketId = custom.id;
    });
    matches = matches.concat(extra.matches);
    nextDisplayOrder = extra.nextDisplayOrder;
    extra.matches.forEach((match) => {
      if (match.match_label) {
        matchIdByLabel.set(match.match_label, match.match_id);
      }
      matchIdByLabel.set(match.match_id, match.match_id);
    });
  });

  return matches;
}

function buildLeagueMatches(draft, teamRows) {
  const matches = [];
  let displayOrder = 1;
  let counter = 1;
  for (let topIndex = 0; topIndex < teamRows.length; topIndex += 1) {
    for (let bottomIndex = topIndex + 1; bottomIndex < teamRows.length; bottomIndex += 1) {
      matches.push(createMatchRow(draft.eventId, "league", "league", `L${counter}`, displayOrder, { type: "team", ref: teamRows[topIndex].team_id }, { type: "team", ref: teamRows[bottomIndex].team_id }));
      displayOrder += 1;
      counter += 1;
    }
  }
  return matches;
}

function getConfiguredTimetableRowCount(timetable) {
  const start = parseTimeToMinutes(timetable.startTime || "09:00");
  const end = parseTimeToMinutes(timetable.endTime || "12:00");
  const interval = clampInt(timetable.intervalMinutes, DEFAULT_INTERVAL_MINUTES, 5, 120);
  if (end <= start) {
    return 1;
  }
  return Math.floor((end - start) / interval) + 1;
}

function buildTimedRows(timetable, courtCount, rowCount) {
  const start = parseTimeToMinutes(timetable.startTime || "09:00");
  const interval = clampInt(timetable.intervalMinutes, DEFAULT_INTERVAL_MINUTES, 5, 120);
  return Array.from({ length: rowCount }, (_, index) => ({
    time: formatMinutes(start + (interval * index)),
    cells: Array.from({ length: courtCount }, () => ""),
  }));
}

function getLastNonEmptyRowIndex(rows) {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    if ((rows[index].cells || []).some((cell) => String(cell || "").trim())) {
      return index;
    }
  }
  return -1;
}

function resizeTimetableRows(timetable, courtCount) {
  const configuredCount = getConfiguredTimetableRowCount(timetable);
  const preservedRows = (timetable.rows || []).map((row) => ({
    time: String(row.time || ""),
    cells: Array.from({ length: courtCount }, (_, index) => String(((row.cells || [])[index]) || "")),
  }));
  const requiredCount = Math.max(configuredCount, getLastNonEmptyRowIndex(preservedRows) + 1, 1);
  const rows = buildTimedRows(timetable, courtCount, requiredCount);
  rows.forEach((row, index) => {
    const previous = preservedRows[index];
    if (!previous) {
      return;
    }
    row.cells = Array.from({ length: courtCount }, (_, courtIndex) => String(((previous.cells || [])[courtIndex]) || ""));
  });
  timetable.rows = rows;
  timetable.endTime = rows[rows.length - 1] ? rows[rows.length - 1].time : timetable.endTime;
  timetable.enabled = true;
  timetable.courtNames = buildDraftCourtNames(timetable.courtNames, courtCount);
  return timetable;
}

function buildAutoDayTimetables(draft, matches) {
  const schedulableMatches = matches.filter((match) => !match._hideChip);
  const courtCount = clampInt(draft.courtCount, 1, 1, 16);
  const dayTimetables = Object.fromEntries(DAY_KEYS.map((dayNo) => [
    dayNo,
    resizeTimetableRows(clone(getDayTimetable(draft, dayNo)), courtCount),
  ]));
  let matchIndex = 0;
  DAY_KEYS.forEach((dayNo, dayIndex) => {
    const timetable = dayTimetables[dayNo];
    if (dayIndex === DAY_KEYS.length - 1) {
      const remaining = schedulableMatches.length - matchIndex;
      const capacity = timetable.rows.length * courtCount;
      if (remaining > capacity) {
        const extraRows = Math.ceil((remaining - capacity) / courtCount);
        const start = parseTimeToMinutes(timetable.startTime || "09:00");
        const interval = clampInt(timetable.intervalMinutes, DEFAULT_INTERVAL_MINUTES, 5, 120);
        const baseCount = timetable.rows.length;
        for (let rowOffset = 0; rowOffset < extraRows; rowOffset += 1) {
          timetable.rows.push({
            time: formatMinutes(start + (interval * (baseCount + rowOffset))),
            cells: Array.from({ length: courtCount }, () => ""),
          });
        }
        timetable.endTime = timetable.rows[timetable.rows.length - 1].time;
      }
    }
    timetable.rows.forEach((row) => {
      row.cells = row.cells.map(() => (schedulableMatches[matchIndex] ? schedulableMatches[matchIndex++].match_label : ""));
    });
  });
  return dayTimetables;
}

function applyTimetable(draft, matches) {
  matches.forEach((match) => {
    match.day_no = "";
    match.start_time = "";
    match.court = "";
  });
  const byLabel = new Map(matches.map((match) => [match.match_label, match]));
  DAY_KEYS.forEach((dayNo) => {
    const timetable = getDayTimetable(draft, dayNo);
    if (!timetable.enabled) {
      return;
    }
    const courts = buildDraftCourtNames(timetable.courtNames, draft.courtCount);
    (timetable.rows || []).forEach((row) => {
      (row.cells || []).forEach((label, courtIndex) => {
        const match = byLabel.get(String(label || "").trim());
        if (!match) {
          return;
        }
        match.day_no = dayNo;
        match.start_time = row.time || "";
        match.court = courts[courtIndex] || "";
      });
    });
  });
}

function buildPersistentDraft(draft) {
  return sanitizeDraft(
    {
      eventId: draft.eventId,
      originalEventId: draft.originalEventId,
      displayName: draft.displayName,
      shortName: draft.shortName,
      format: draft.format,
      teamCount: draft.teamCount,
      courtCount: draft.courtCount,
      slots: draft.slots,
      seedSlotIds: draft.seedSlotIds,
      thirdPlaceEnabled: draft.thirdPlaceEnabled,
      consolationBracket: draft.consolationBracket,
      customBrackets: draft.customBrackets,
      dayTimetables: draft.dayTimetables,
    },
    draft.routeKey || "new"
  );
}

function buildPreviewBundle(draft) {
  const teamRows = buildTeamRows(draft);
  const matches = draft.format === "league" ? buildLeagueMatches(draft, teamRows) : buildTournamentMatches(draft, teamRows);
  renumberMatchLabels(matches);
  applyTimetable(draft, matches);
  recalculateMatches(matches);
  return {
    event: {
      event_id: draft.eventId,
      display_name: draft.displayName || "新しい種目",
      short_name: draft.shortName || draft.displayName || "新規種目",
      weather_mode: "all",
      printed_page: "",
      display_order: "",
      bracket_note: serializeEventEditorMeta({ format: draft.format, draft: buildPersistentDraft(draft) }),
      schedule_note: "",
    },
    teams: teamRows,
    matches,
  };
}

function getReadableMatchLabel(match) {
  if (!match) {
    return "";
  }
  const label = String(match.match_label || "").trim();
  if (label) {
    return label;
  }
  return "自動進出";
}

function getPreviewData(draft) {
  const bundle = buildPreviewBundle(draft);
  const editorBindings = new Map();
  const matchById = new Map(bundle.matches.map((match) => [match.match_id, match]));
  const activeMainSlots = getActiveMainSlots(draft);
  const slotIndexById = new Map(draft.slots.map((slot, index) => [slot.slotId, index]));
  const baseSourceOptions = [
    { label: "BYE", kind: "bye", value: "" },
    ...activeMainSlots.map((slot) => ({
      label: `${buildSlotDisplayLabel(slot, slotIndexById.get(slot.slotId) || 0)} を直接配置`,
      kind: "slot",
      value: slot.slotId,
    })),
  ];
  const accumulatedOptions = [...baseSourceOptions];
  const customSourceOptionsById = new Map();
  bundle.matches
    .slice()
    .sort((a, b) => Number(a.display_order || 0) - Number(b.display_order || 0))
    .forEach((match) => {
      if (match._editorBindings) {
        if (match._editorBindings.top) {
          editorBindings.set(`${match.match_id}:top`, match._editorBindings.top);
        }
        if (match._editorBindings.bottom) {
          editorBindings.set(`${match.match_id}:bottom`, match._editorBindings.bottom);
        }
      }
      if (match._customBracketId && !customSourceOptionsById.has(match._customBracketId)) {
        customSourceOptionsById.set(match._customBracketId, accumulatedOptions.slice());
      }
      const optionLabel = getReadableMatchLabel(match);
      accumulatedOptions.push(
        { label: `${optionLabel} の勝者`, kind: "winner", value: match.match_id },
        { label: `${optionLabel} の敗者`, kind: "loser", value: match.match_id }
      );
    });
  return {
    bundle,
    teamById: new Map(bundle.teams.map((team) => [team.team_id, team])),
    slotIdByTeamId: new Map(bundle.teams.map((team) => [team.team_id, team._slotId])),
    matchById,
    customSourceOptions: accumulatedOptions,
    customSourceOptionsById,
    editorBindings,
  };
}
function renderEditorChip(node) {
  if (node.match._hideChip) {
    return "";
  }
  return `
    <div class="bracket-match-chip status-${escapeHtml(node.match.status)} is-readonly" style="left:${node.left}px; top:${node.top}px;">
      <span class="chip-label">${escapeHtml(node.match.match_label)}</span>
    </div>
  `;
}

function renderEditorHiddenNodeBridge(node) {
  if (!node.match._hideChip) {
    return "";
  }
  const width = Math.max(0, (node.right || 0) - (node.left || 0));
  return `<div class="bracket-hidden-bridge" style="left:${node.left}px; top:${node.centerY}px; width:${width}px;"></div>`;
}

function renderMainInlineEditor(slotId, slot, draft) {
  const selectedSlot = draft.slots.find((item) => item.slotId === slotId);
  if (!selectedSlot) {
    return "";
  }
  return `
    <div class="bracket-slot-inline-editor" style="left:${slot.left}px; top:${slot.top}px; width:${Math.max(slot.width, 168)}px;">
      <input
        class="text-input bracket-inline-input"
        type="text"
        list="admin-class-list"
        value="${escapeHtml(selectedSlot.className)}"
        data-action="admin-slot-field"
        data-field="className"
        placeholder="例: 1A"
        autofocus
      />
      <div class="token-row bracket-inline-token-row">
        ${MEMBER_TOKENS.map((token) => `
          <button class="filter-chip ${selectedSlot.memberToken === token ? "active" : ""}" type="button" data-action="admin-slot-token" data-token="${escapeHtml(token)}">${escapeHtml(token || "無")}</button>
        `).join("")}
      </div>
    </div>
  `;
}

function renderBracketSourceInlineEditor(slot, draft, preview, binding) {
  const sourceOptions = preview.customSourceOptionsById.get(binding.bracketId) || preview.customSourceOptions;
  const bracket = [draft.consolationBracket, ...draft.customBrackets].filter(Boolean).find((item) => item.id === binding.bracketId);
  const source = bracket && bracket.sources.find((item) => item.sourceId === binding.sourceId);
  const selectedValue = source ? `${source.kind}|${source.value}` : "bye|";
  return `
    <div class="bracket-slot-inline-editor" style="left:${slot.left}px; top:${slot.top}px; width:${Math.max(slot.width + 36, 188)}px;">
      <select
        class="text-input bracket-inline-input"
        data-action="admin-inline-source"
        data-bracket-id="${escapeHtml(binding.bracketId)}"
        data-source-id="${escapeHtml(binding.sourceId)}"
        autofocus
      >
        ${sourceOptions.map((option) => `<option value="${escapeHtml(`${option.kind}|${option.value}`)}" ${selectedValue === `${option.kind}|${option.value}` ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}
      </select>
    </div>
  `;
}

function renderEditorSlot(slot, draft, preview, binding) {
  const isMainBinding = binding && binding.kind === "main-slot";
  const isSourceBinding = binding && binding.kind === "bracket-source";
  if (isMainBinding && slot.slotType === "bye") {
    return "";
  }
  let label = "BYE";
  let slotId = "";
  let isTeam = false;
  if (slot.slotType === "team") {
    const team = preview.teamById.get(slot.slotRef);
    label = (team && team.display_name) || "未設定";
    slotId = preview.slotIdByTeamId.get(slot.slotRef) || "";
    isTeam = !!slotId;
  } else if (slot.slotType === "winner" || slot.slotType === "loser") {
    const sourceMatch = preview.matchById.get(slot.slotRef);
    const sourceLabel = getReadableMatchLabel(sourceMatch) || (slot.slotRef || "").split(":").pop();
    label = `${sourceLabel}の${slot.slotType === "winner" ? "勝者" : "敗者"}`;
  }
  const seedRank = isMainBinding && slotId ? draft.seedSlotIds.indexOf(slotId) : -1;
  const classes = [
    "bracket-slot",
    `align-${slot.align}`,
    slot.slotType !== "team" ? "is-reference" : "",
    isMainBinding && slotId && draft.selectedSlotId === slotId ? "is-selected" : "",
    isSourceBinding && draft.selectedBracketId === binding.bracketId && draft.selectedSourceId === binding.sourceId ? "is-selected" : "",
    seedRank >= 0 ? "is-seeded" : "",
    draft.seedMode && isTeam ? "is-seed-mode" : "",
  ].filter(Boolean).join(" ");
  const attrs = isMainBinding && slotId
    ? `data-action="admin-select-slot" data-slot-id="${escapeHtml(slotId)}"`
    : isSourceBinding
      ? `data-action="admin-select-source" data-bracket-id="${escapeHtml(binding.bracketId)}" data-source-id="${escapeHtml(binding.sourceId)}"`
      : "";
  if (isMainBinding && !draft.seedMode && draft.editingSlotId === slotId) {
    return renderMainInlineEditor(slotId, slot, draft);
  }
  if (isSourceBinding && draft.selectedBracketId === binding.bracketId && draft.selectedSourceId === binding.sourceId) {
    return renderBracketSourceInlineEditor(slot, draft, preview, binding);
  }
  return `
    <button class="${classes}" type="button" ${attrs} style="left:${slot.left}px; top:${slot.top}px; width:${slot.width}px;" title="${escapeHtml(label)}">
      <span class="slot-text">${escapeHtml(label)}</span>
      ${seedRank >= 0 ? `<span class="seed-pill">S${seedRank + 1}</span>` : ""}
    </button>
  `;
}

function renderEditableBracket(preview, draft) {
  const sectionTitles = Object.fromEntries(
    draft.customBrackets.map((custom) => [String(custom.title || custom.id).trim() || custom.id, custom.title || custom.id])
  );
  const sections = buildBracketSections(preview.bundle.matches, preview.bundle.matches, sectionTitles);
  const baseWidth = Math.max(...sections.map((section) => section.layout.width), 1);
  const viewportWidth = typeof window === "undefined" ? baseWidth : Math.max(320, (window.innerWidth || document.documentElement.clientWidth || 1280) - 84);
  const scale = Math.min(1, Math.max(0.45, viewportWidth / baseWidth));
  const requiredSeedCount = getRequiredSeedCount(draft.teamCount);
  const selectedSeedCount = draft.seedSlotIds.length;
  const canFinishSeedMode = selectedSeedCount === requiredSeedCount;
  return `
    <div class="bracket-stack admin-bracket-stack">
      ${sections.map((section) => {
        const scaledWidth = Math.round(section.layout.width * scale * 10) / 10;
        const scaledHeight = Math.round(section.layout.height * scale * 10) / 10;
        const isConsolation = section.type === "consolation" && draft.consolationBracket;
        return `
          <section class="bracket-paper">
            <div class="bracket-paper-head">
              <div>
                <h3 class="panel-title">${escapeHtml(section.title)}</h3>
                ${isConsolation ? `
                  <div class="admin-inline-head-fields">
                    <input class="text-input admin-inline-head-input" type="text" value="${escapeHtml(draft.consolationBracket.title)}" data-action="admin-custom-field" data-custom-id="consolation" data-field="title" />
                    <input class="text-input admin-inline-head-input admin-inline-head-count" type="number" min="2" max="16" value="${escapeHtml(draft.consolationBracket.teamCount)}" data-action="admin-custom-field" data-custom-id="consolation" data-field="teamCount" />
                  </div>
                ` : ""}
              </div>
              ${section.type === "main" ? `<div class="toolbar-actions"><span class="muted">シード ${selectedSeedCount}/${requiredSeedCount}</span><button class="button ghost ${draft.seedMode ? "active" : ""}" type="button" data-action="admin-toggle-seed-mode" ${draft.seedMode && !canFinishSeedMode ? "disabled" : ""}>${draft.seedMode ? "シード設定終了" : "シードを設定する"}</button></div>` : isConsolation ? `<div class="toolbar-actions"><button class="button ghost" type="button" data-action="admin-toggle-consolation">コンソレーションを外す</button></div>` : ""}
            </div>
            <div class="bracket-fit-frame">
              <div class="bracket-fit-inner" style="width:${scaledWidth}px; height:${scaledHeight}px;">
                <div class="bracket-canvas bracket-stage variant-${escapeHtml(section.layout.variant)}" style="width:${section.layout.width}px; height:${section.layout.height}px; transform:scale(${scale.toFixed(4)});">
                  <svg class="bracket-svg" viewBox="0 0 ${section.layout.width} ${section.layout.height}" aria-hidden="true">
                    ${section.layout.connections.map((connection) => `
                      <path class="bracket-connection base state-${escapeHtml(connection.state)}" d="${escapeHtml(connection.d)}"></path>
                      ${connection.state === "winning" ? `<path class="bracket-connection fill state-${escapeHtml(connection.state)}" d="${escapeHtml(connection.fillD || connection.d)}"></path>` : ""}
                    `).join("")}
                  </svg>
                  ${section.layout.leaves.map((slot) => renderEditorSlot(slot, draft, preview, preview.editorBindings.get(`${slot.matchId}:${slot.slot}`))).join("")}
                  ${section.layout.nodes.map((node) => renderEditorHiddenNodeBridge(node)).join("")}
                  ${section.layout.nodes.map((node) => renderEditorChip(node)).join("")}
                </div>
              </div>
            </div>
          </section>
        `;
      }).join("")}
    </div>
  `;
}

function renderLeaguePreview(preview) {
  const teams = preview.bundle.teams.slice().sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));
  const byPair = new Map();
  preview.bundle.matches.forEach((match) => {
    byPair.set(`${match.resolved_top_team_id}|${match.resolved_bottom_team_id}`, match.match_label);
    byPair.set(`${match.resolved_bottom_team_id}|${match.resolved_top_team_id}`, match.match_label);
  });
  return `
    <div class="league-grid-wrap">
      <table class="league-grid">
        <thead>
          <tr>
            <th>クラス</th>
            ${teams.map((team) => `<th>${escapeHtml(team.display_name)}</th>`).join("")}
          </tr>
        </thead>
        <tbody>
          ${teams.map((rowTeam) => `
            <tr>
              <th>${escapeHtml(rowTeam.display_name)}</th>
              ${teams.map((colTeam) => {
                if (rowTeam.team_id === colTeam.team_id) {
                  return '<td class="league-cell diagonal">-</td>';
                }
                return `<td class="league-cell">${escapeHtml(byPair.get(`${rowTeam.team_id}|${colTeam.team_id}`) || "-")}</td>`;
              }).join("")}
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderAdditionalBracketEditors(draft, preview) {
  const brackets = draft.customBrackets.map((custom) => ({ ...custom, _kind: "custom" }));
  if (!brackets.length) {
    return "";
  }
  return `
    <section class="section-grid">
      ${brackets.map((custom) => {
        const sourceOptions = preview.customSourceOptionsById.get(custom.id) || preview.customSourceOptions;
        return `
        <section class="panel admin-subpanel">
          <div class="panel-header compact">
            <div><h3 class="panel-title">${escapeHtml(custom.title || custom.id)}</h3></div>
            <div class="toolbar-actions">
              ${custom._kind === "custom" ? `<button class="button ghost" type="button" data-action="admin-remove-custom" data-custom-id="${escapeHtml(custom.id)}">削除</button>` : `<button class="button ghost" type="button" data-action="admin-toggle-consolation">コンソレーションを外す</button>`}
            </div>
          </div>
          <div class="admin-form-grid compact-grid">
            <label><span class="field-label">名称</span><input class="text-input" type="text" value="${escapeHtml(custom.title)}" data-action="admin-custom-field" data-custom-id="${escapeHtml(custom.id)}" data-field="title" /></label>
            <label><span class="field-label">出場枠数</span><input class="text-input" type="number" min="2" max="16" value="${escapeHtml(custom.teamCount)}" data-action="admin-custom-field" data-custom-id="${escapeHtml(custom.id)}" data-field="teamCount" /></label>
          </div>
          <div class="admin-source-grid">
            ${custom.sources.map((source, index) => `
              <div class="admin-source-row">
                <span class="muted">枠${index + 1}</span>
                <select class="text-input" data-action="admin-custom-source" data-custom-id="${escapeHtml(custom.id)}" data-index="${index}">
                  ${sourceOptions.map((option) => `<option value="${escapeHtml(`${option.kind}|${option.value}`)}" ${(option.kind === source.kind && option.value === source.value) ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}
                </select>
                <button class="button ghost ${custom.seedSourceIds.includes(source.sourceId) ? "active" : ""}" type="button" data-action="admin-custom-seed" data-custom-id="${escapeHtml(custom.id)}" data-source-id="${escapeHtml(source.sourceId)}">${custom.seedSourceIds.includes(source.sourceId) ? "シード中" : "シード"}</button>
              </div>
            `).join("")}
          </div>
        </section>
      `;
      }).join("")}
    </section>
  `;
}

function renderTimetableEditor(draft, preview) {
  const renderDayTable = (dayNo) => {
    const timetable = getDayTimetable(draft, dayNo);
    const rows = timetable.rows || [];
    const selection = getTimetableSelection(draft.routeKey, draft, dayNo);
    const isDaySelected = selection && String(selection.dayNo) === String(dayNo);
    const bounds = isDaySelected ? getSelectionBounds(selection) : null;
    const courtNames = buildDraftCourtNames(timetable.courtNames, draft.courtCount);
    return `
      <section class="admin-timetable-day-block">
        <div class="admin-form-grid compact-grid">
          <label><span class="field-label">開始時刻</span><input class="text-input" type="time" value="${escapeHtml(timetable.startTime)}" data-action="admin-timetable-field" data-day-no="${dayNo}" data-field="startTime" /></label>
          <label><span class="field-label">終了時刻</span><input class="text-input" type="time" value="${escapeHtml(timetable.endTime)}" data-action="admin-timetable-field" data-day-no="${dayNo}" data-field="endTime" /></label>
          <label><span class="field-label">1試合の時間</span><input class="text-input" type="number" min="5" max="120" step="5" value="${escapeHtml(timetable.intervalMinutes)}" data-action="admin-timetable-field" data-day-no="${dayNo}" data-field="intervalMinutes" /></label>
          <div class="admin-day-apply"><button class="button ghost" type="button" data-action="admin-apply-timetable" data-day-no="${dayNo}">適用</button></div>
        </div>
        ${rows.length ? `
          <div class="admin-timetable-wrap">
            <table class="admin-timetable-grid">
              <thead>
                <tr>
                  <th class="admin-day-corner">${escapeHtml(`${dayNo}日目`)}</th>
                  ${courtNames.map((court, courtIndex) => `<th><div class="admin-timetable-head-cell"><button class="admin-select-header" type="button" data-action="admin-select-timetable-col" data-day-no="${dayNo}" data-court-index="${courtIndex}">列</button><input class="text-input admin-head-input" type="text" value="${escapeHtml(court)}" data-action="admin-timetable-court-name" data-day-no="${dayNo}" data-court-index="${courtIndex}" /></div></th>`).join("")}
                </tr>
              </thead>
              <tbody>
                ${rows.map((row, rowIndex) => `
                  <tr>
                    <th><div class="admin-timetable-head-cell admin-timetable-row-head"><button class="admin-select-header admin-select-row" type="button" data-action="admin-select-timetable-row" data-day-no="${dayNo}" data-row-index="${rowIndex}">行</button><input class="text-input admin-head-input admin-time-input" type="time" value="${escapeHtml(row.time)}" data-action="admin-timetable-row-time" data-day-no="${dayNo}" data-row-index="${rowIndex}" /></div></th>
                    ${(row.cells || []).map((cell, courtIndex) => {
                      const isSelected = !!(bounds && rowIndex >= bounds.startRow && rowIndex <= bounds.endRow && courtIndex >= bounds.startCol && courtIndex <= bounds.endCol);
                      const classes = [
                        isSelected ? "is-selected" : "",
                        isSelected && rowIndex === bounds.startRow ? "is-range-top" : "",
                        isSelected && rowIndex === bounds.endRow ? "is-range-bottom" : "",
                        isSelected && courtIndex === bounds.startCol ? "is-range-left" : "",
                        isSelected && courtIndex === bounds.endCol ? "is-range-right" : "",
                      ].filter(Boolean).join(" ");
                      return `
                        <td class="${classes}" data-action="admin-timetable-td" data-day-no="${dayNo}" data-row-index="${rowIndex}" data-court-index="${courtIndex}">
                          <input class="text-input admin-cell-input ${selection && selection.anchorRow === rowIndex && selection.anchorCol === courtIndex && String(selection.dayNo) === String(dayNo) ? "is-anchor" : ""}" type="text" list="admin-match-label-list" value="${escapeHtml(cell)}" data-action="admin-timetable-cell" data-day-no="${dayNo}" data-row-index="${rowIndex}" data-court-index="${courtIndex}" />
                        </td>
                      `;
                    }).join("")}
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        ` : '<div class="empty-state">開始時刻・終了時刻・1試合の時間を入れて適用、または自動生成すると表が出ます。</div>'}
      </section>
    `;
  };
  return `
    <section class="panel admin-subpanel">
      <div class="panel-header compact">
        <div><h3 class="panel-title">タイムテーブル</h3><p class="muted">セル単位で編集できます。ドラッグで範囲選択、見出しクリックで行・列選択、コピー＆ペーストにも対応します。</p></div>
        <button class="button ghost" type="button" data-action="admin-generate-timetable">タイムテーブル表を作成</button>
      </div>
      <div class="admin-timetable-stack">
        ${DAY_KEYS.map((dayNo) => renderDayTable(dayNo)).join("")}
      </div>
      <datalist id="admin-match-label-list">${preview.bundle.matches.filter((match) => match.match_label).map((match) => `<option value="${escapeHtml(match.match_label)}"></option>`).join("")}</datalist>
    </section>
  `;
}

function getSelectionBounds(selection) {
  return {
    startRow: Math.min(selection.anchorRow, selection.focusRow),
    endRow: Math.max(selection.anchorRow, selection.focusRow),
    startCol: Math.min(selection.anchorCol, selection.focusCol),
    endCol: Math.max(selection.anchorCol, selection.focusCol),
  };
}

function clampSelection(routeKey, draft, selection) {
  if (!selection) {
    return null;
  }
  const timetable = getDayTimetable(draft, selection.dayNo || "1");
  if (!(timetable.rows || []).length) {
    return null;
  }
  const maxRow = Math.max(0, (timetable.rows || []).length - 1);
  const maxCol = Math.max(0, draft.courtCount - 1);
  const next = {
    dayNo: String(selection.dayNo || "1"),
    anchorRow: Math.max(0, Math.min(maxRow, selection.anchorRow)),
    anchorCol: Math.max(0, Math.min(maxCol, selection.anchorCol)),
    focusRow: Math.max(0, Math.min(maxRow, selection.focusRow)),
    focusCol: Math.max(0, Math.min(maxCol, selection.focusCol)),
  };
  adminState.timetableSelections.set(routeKey, next);
  return next;
}

function getTimetableSelection(routeKey, draft, dayNo = "1") {
  const current = adminState.timetableSelections.get(routeKey);
  if (current && String(current.dayNo) === String(dayNo)) {
    return clampSelection(routeKey, draft, current);
  }
  const timetable = getDayTimetable(draft, dayNo);
  if (!(timetable.rows || []).length) {
    return null;
  }
  const initial = { dayNo: String(dayNo), anchorRow: 0, anchorCol: 0, focusRow: 0, focusCol: 0 };
  adminState.timetableSelections.set(routeKey, initial);
  return initial;
}

export function selectTimetableCell(bootstrap, routeKey, dayNo, rowIndex, courtIndex) {
  const draft = ensureDraft(bootstrap, routeKey);
  return clampSelection(routeKey, draft, {
    dayNo: String(dayNo || "1"),
    anchorRow: rowIndex,
    anchorCol: courtIndex,
    focusRow: rowIndex,
    focusCol: courtIndex,
  });
}

export function extendTimetableSelection(bootstrap, routeKey, dayNo, rowIndex, courtIndex) {
  const draft = ensureDraft(bootstrap, routeKey);
  const current = getTimetableSelection(routeKey, draft, dayNo);
  if (!current) {
    return null;
  }
  return clampSelection(routeKey, draft, {
    ...current,
    dayNo: String(dayNo || current.dayNo || "1"),
    focusRow: rowIndex,
    focusCol: courtIndex,
  });
}

export function selectTimetableRow(bootstrap, routeKey, dayNo, rowIndex) {
  const draft = ensureDraft(bootstrap, routeKey);
  return clampSelection(routeKey, draft, {
    dayNo: String(dayNo || "1"),
    anchorRow: rowIndex,
    focusRow: rowIndex,
    anchorCol: 0,
    focusCol: Math.max(0, draft.courtCount - 1),
  });
}

export function selectTimetableColumn(bootstrap, routeKey, dayNo, courtIndex) {
  const draft = ensureDraft(bootstrap, routeKey);
  const timetable = getDayTimetable(draft, dayNo);
  return clampSelection(routeKey, draft, {
    dayNo: String(dayNo || "1"),
    anchorRow: 0,
    focusRow: Math.max(0, (timetable.rows || []).length - 1),
    anchorCol: courtIndex,
    focusCol: courtIndex,
  });
}

export function applyTimetablePaste(bootstrap, routeKey, dayNo, rowIndex, courtIndex, text) {
  return commitDraft(bootstrap, routeKey, (draft) => {
    const timetable = getDayTimetable(draft, dayNo);
    const rows = String(text || "").replace(/\r/g, "").split("\n").filter((row) => row !== "");
    rows.forEach((line, rowOffset) => {
      const row = timetable.rows[rowIndex + rowOffset];
      if (!row) {
        return;
      }
      line.split("\t").forEach((cell, colOffset) => {
        const nextCol = courtIndex + colOffset;
        if (nextCol < draft.courtCount) {
          row.cells[nextCol] = String(cell || "").trim();
        }
      });
    });
    timetable.enabled = true;
    return draft;
  });
}

export function getTimetableClipboardText(bootstrap, routeKey) {
  const draft = ensureDraft(bootstrap, routeKey);
  const current = adminState.timetableSelections.get(routeKey);
  const selection = current ? getTimetableSelection(routeKey, draft, current.dayNo || "1") : null;
  if (!selection) {
    return "";
  }
  const bounds = getSelectionBounds(selection);
  return getDayTimetable(draft, selection.dayNo).rows
    .slice(bounds.startRow, bounds.endRow + 1)
    .map((row) => row.cells.slice(bounds.startCol, bounds.endCol + 1).join("\t"))
    .join("\n");
}

export function clearSelectedTimetableCells(bootstrap, routeKey) {
  return commitDraft(bootstrap, routeKey, (draft) => {
    const current = adminState.timetableSelections.get(routeKey);
    const selection = current ? getTimetableSelection(routeKey, draft, current.dayNo || "1") : null;
    if (!selection) {
      return draft;
    }
    const bounds = getSelectionBounds(selection);
    const timetable = getDayTimetable(draft, selection.dayNo);
    for (let rowIndex = bounds.startRow; rowIndex <= bounds.endRow; rowIndex += 1) {
      const row = timetable.rows[rowIndex];
      if (!row) {
        continue;
      }
      for (let courtIndex = bounds.startCol; courtIndex <= bounds.endCol; courtIndex += 1) {
        row.cells[courtIndex] = "";
      }
    }
    timetable.enabled = true;
    return draft;
  });
}

export function getClassSettingsData(bootstrap, isReadOnly) {
  if (!adminState.classSettingsText) {
    adminState.classSettingsText = buildClassSettingsText(bootstrap);
  }
  return {
    text: adminState.classSettingsText,
    classNames: parseClassSettingsText(adminState.classSettingsText),
    isReadOnly,
  };
}

export function setClassSettingsText(value) {
  adminState.classSettingsText = String(value || "");
}

export function buildClassSettingsSavePayload() {
  return { classNames: parseClassSettingsText(adminState.classSettingsText) };
}

export function getEventEditorData(bootstrap, routeKey = "new", isReadOnly = false) {
  const draft = ensureDraft(bootstrap, routeKey);
  return {
    routeKey,
    draft,
    preview: getPreviewData(draft),
    classNames: buildClassNamesFromBootstrap(bootstrap),
    isReadOnly,
  };
}
export function renderClassSettingsPage(data) {
  return `
    <section class="hero-panel event-hero">
      <div class="route-row"><a class="route-link" data-nav href="${toHref("home")}">ホーム</a><span class="muted">/</span><span>クラス名設定</span></div>
      <div class="event-hero-grid event-hero-simple"><div><h2 class="hero-title">クラス名設定</h2></div></div>
    </section>
    <section class="panel admin-panel">
      <div class="panel-header"><div><h2 class="panel-title">クラス一覧</h2><p class="muted"><code>1A</code> や <code>2C</code> のように、そのまま文字で入力します。</p></div></div>
      <textarea class="admin-textarea" data-action="admin-class-text">${escapeHtml(data.text)}</textarea>
      <div class="toolbar-actions" style="margin-top:16px; justify-content:flex-end;"><button class="button primary" type="button" data-action="admin-save-class-settings" ${data.isReadOnly ? "disabled" : ""}>保存</button></div>
      <div class="chip-row" style="margin-top:16px;">${data.classNames.map((className) => `<span class="nav-chip static">${escapeHtml(className)}</span>`).join("")}</div>
    </section>
  `;
}

export function renderEventEditorPage(data) {
  const { draft, preview, classNames, isReadOnly } = data;
  return `
    <section class="hero-panel event-hero">
      <div class="route-row"><a class="route-link" data-nav href="${toHref("home")}">ホーム</a><span class="muted">/</span><span>${draft.originalEventId ? "種目編集" : "種目追加"}</span></div>
      <div class="event-hero-grid event-hero-simple"><div><h2 class="hero-title">${draft.originalEventId ? "種目編集" : "種目追加"}</h2></div></div>
    </section>

    <section class="panel admin-panel">
      <div class="panel-header"><div><h2 class="panel-title">基本設定</h2></div><div class="toolbar-actions"><button class="button primary" type="button" data-action="admin-save-event" ${isReadOnly ? "disabled" : ""}>保存</button></div></div>
      <div class="admin-form-grid">
        <label><span class="field-label">種目名</span><input class="text-input" type="text" value="${escapeHtml(draft.displayName)}" data-action="admin-draft-field" data-field="displayName" /></label>
        <label><span class="field-label">短縮名</span><input class="text-input" type="text" value="${escapeHtml(draft.shortName)}" data-action="admin-draft-field" data-field="shortName" /></label>
        <label><span class="field-label">出場チーム数</span><input class="text-input" type="number" min="2" max="64" value="${escapeHtml(draft.teamCount)}" data-action="admin-draft-field" data-field="teamCount" /></label>
        <label><span class="field-label">形式</span><select class="text-input" data-action="admin-draft-field" data-field="format"><option value="tournament" ${draft.format === "tournament" ? "selected" : ""}>トーナメント</option><option value="league" ${draft.format === "league" ? "selected" : ""}>リーグ</option></select></label>
        <label><span class="field-label">コート数</span><input class="text-input" type="number" min="1" max="16" value="${escapeHtml(draft.courtCount)}" data-action="admin-draft-field" data-field="courtCount" /></label>
      </div>
      <div class="toolbar-actions admin-action-row">
        <button class="button ghost" type="button" data-action="admin-toggle-third-place" ${draft.format === "league" ? "disabled" : ""}>${draft.thirdPlaceEnabled ? "3位決定戦を外す" : "3位決定戦を生成"}</button>
        <button class="button ghost" type="button" data-action="admin-toggle-consolation" ${draft.format === "league" ? "disabled" : ""}>${draft.consolationBracket ? "コンソレーションを外す" : "コンソレーションを生成"}</button>
        <button class="button ghost" type="button" data-action="admin-add-custom" ${draft.format === "league" ? "disabled" : ""}>その他のトーナメントを作成</button>
        <button class="button ghost" type="button" data-action="admin-generate-timetable">タイムテーブル表を作成</button>
      </div>
    </section>

    <section class="panel">
      <div class="panel-header">
        <div>
          <h2 class="panel-title">${draft.format === "league" ? "リーグ表プレビュー" : "トーナメント表プレビュー"}</h2>
          ${draft.format === "tournament" ? `<p class="muted">チーム名をクリックすると、その場所で直接編集できます。</p>` : ""}
        </div>
      </div>
      ${draft.format === "league" ? renderLeaguePreview(preview) : renderEditableBracket(preview, draft)}
      <datalist id="admin-class-list">${classNames.map((className) => `<option value="${escapeHtml(className)}"></option>`).join("")}</datalist>
    </section>

    ${renderAdditionalBracketEditors(draft, preview)}
    ${renderTimetableEditor(draft, preview)}

    <section class="panel admin-save-bottom-panel">
      <div class="toolbar-actions" style="justify-content:flex-end;">
        <button class="button primary" type="button" data-action="admin-save-event" ${isReadOnly ? "disabled" : ""}>保存</button>
      </div>
    </section>
  `;
}

export function updateEventDraftField(bootstrap, routeKey, field, value) {
  return commitDraft(bootstrap, routeKey, (draft) => {
    if (field === "displayName") {
      draft.displayName = String(value || "");
      if (!draft.shortName) {
        draft.shortName = draft.displayName;
      }
    } else if (field === "shortName") {
      draft.shortName = String(value || "");
    } else if (field === "teamCount") {
      draft.teamCount = clampInt(value, draft.teamCount, 2, 64);
      const slotCount = getDraftSlotCount(draft.format, draft.teamCount);
      if (draft.slots.length < slotCount) {
        for (let index = draft.slots.length; index < slotCount; index += 1) {
          draft.slots.push(createSlot(index));
        }
      }
      draft.slots = draft.slots.slice(0, slotCount);
      draft.seedSlotIds = normalizeSeedSlotIdsForExactCount(draft.slots, draft.teamCount, draft.seedSlotIds, draft.format);
      if (!draft.slots.some((slot) => slot.slotId === draft.selectedSlotId)) {
        draft.selectedSlotId = (draft.slots[0] && draft.slots[0].slotId) || "";
      }
    } else if (field === "format") {
      draft.format = value === "league" ? "league" : "tournament";
      const slotCount = getDraftSlotCount(draft.format, draft.teamCount);
      if (draft.slots.length < slotCount) {
        for (let index = draft.slots.length; index < slotCount; index += 1) {
          draft.slots.push(createSlot(index));
        }
      }
      draft.slots = draft.slots.slice(0, slotCount);
      if (draft.format === "league") {
        draft.seedMode = false;
        draft.editingSlotId = "";
        draft.selectedBracketId = "";
        draft.selectedSourceId = "";
      } else {
        draft.seedSlotIds = normalizeSeedSlotIdsForExactCount(draft.slots, draft.teamCount, draft.seedSlotIds, draft.format);
      }
    } else if (field === "courtCount") {
      draft.courtCount = clampInt(value, draft.courtCount, 1, 16);
      DAY_KEYS.forEach((dayNo) => {
        const timetable = getDayTimetable(draft, dayNo);
        timetable.courtNames = buildDraftCourtNames(timetable.courtNames, draft.courtCount);
        timetable.rows = (timetable.rows || []).map((row) => ({ ...row, cells: Array.from({ length: draft.courtCount }, (_, index) => String((row.cells || [])[index] || "")) }));
        draft.dayTimetables[dayNo] = timetable;
      });
    }
    return draft;
  });
}

export function selectEventSlot(bootstrap, routeKey, slotId) {
  return commitDraft(bootstrap, routeKey, (draft) => {
    if (draft.seedMode) {
      const requiredSeedCount = getRequiredSeedCount(draft.teamCount);
      if (!draft.slots.some((slot) => slot.slotId === slotId)) {
        return draft;
      }
      const pairMap = buildCurrentMainPairMap(draft);
      const pairedSlotId = pairMap.get(slotId) || "";
      const existingIndex = draft.seedSlotIds.indexOf(slotId);
      if (existingIndex >= 0) {
        draft.seedSlotIds.splice(existingIndex, 1);
        return draft;
      }
      const opponentSeedIndex = pairedSlotId ? draft.seedSlotIds.indexOf(pairedSlotId) : -1;
      if (opponentSeedIndex >= 0) {
        draft.seedSlotIds.splice(opponentSeedIndex, 1, slotId);
        return draft;
      }
      if (draft.seedSlotIds.length >= requiredSeedCount) {
        draft.seedSlotIds.splice(requiredSeedCount - 1, 1, slotId);
        return draft;
      }
      draft.seedSlotIds.push(slotId);
    } else {
      draft.selectedSlotId = slotId;
      draft.editingSlotId = slotId;
      draft.selectedBracketId = "";
      draft.selectedSourceId = "";
    }
    return draft;
  });
}

export function selectBracketSource(bootstrap, routeKey, bracketId, sourceId) {
  return commitDraft(bootstrap, routeKey, (draft) => {
    draft.editingSlotId = "";
    draft.selectedBracketId = String(bracketId || "");
    draft.selectedSourceId = String(sourceId || "");
    return draft;
  });
}

export function updateSelectedSlotField(bootstrap, routeKey, field, value) {
  return commitDraft(bootstrap, routeKey, (draft) => {
    const selected = draft.slots.find((slot) => slot.slotId === draft.selectedSlotId);
    if (!selected) {
      return draft;
    }
    if (field === "className") {
      selected.className = String(value || "").trim();
    } else if (field === "memberToken") {
      selected.memberToken = MEMBER_TOKENS.includes(value) ? value : "";
    }
    return draft;
  });
}

export function clearAdminInlineEditors(bootstrap, routeKey) {
  return commitDraft(bootstrap, routeKey, (draft) => {
    draft.editingSlotId = "";
    draft.selectedBracketId = "";
    draft.selectedSourceId = "";
    return draft;
  });
}

export function toggleSeedMode(bootstrap, routeKey) {
  return commitDraft(bootstrap, routeKey, (draft) => {
    draft.seedMode = !draft.seedMode;
    if (draft.seedMode) {
      draft.editingSlotId = "";
      draft.selectedBracketId = "";
      draft.selectedSourceId = "";
    }
    return draft;
  });
}
export function toggleThirdPlace(bootstrap, routeKey) { return commitDraft(bootstrap, routeKey, (draft) => { draft.thirdPlaceEnabled = !draft.thirdPlaceEnabled; return draft; }); }
export function toggleConsolation(bootstrap, routeKey) {
  return commitDraft(bootstrap, routeKey, (draft) => {
    if (draft.consolationBracket) {
      draft.consolationBracket = null;
      if (draft.selectedBracketId === "consolation") {
        draft.selectedBracketId = "";
        draft.selectedSourceId = "";
      }
    } else {
      draft.consolationBracket = buildDefaultConsolationBracket(draft);
    }
    return draft;
  });
}
export function addCustomBracket(bootstrap, routeKey) {
  return commitDraft(bootstrap, routeKey, (draft) => {
    const nextIndex = draft.customBrackets.length + 1;
    draft.customBrackets.push(sanitizeEditableBracket({}, `custom-${nextIndex}`, `その他トーナメント${nextIndex}`, 2));
    return draft;
  });
}
export function removeCustomBracket(bootstrap, routeKey, customId) {
  return commitDraft(bootstrap, routeKey, (draft) => {
    draft.customBrackets = draft.customBrackets.filter((item) => item.id !== customId);
    if (draft.selectedBracketId === customId) {
      draft.selectedBracketId = "";
      draft.selectedSourceId = "";
    }
    return draft;
  });
}
export function updateCustomBracketField(bootstrap, routeKey, customId, field, value) {
  return commitDraft(bootstrap, routeKey, (draft) => {
    const target = (draft.consolationBracket && draft.consolationBracket.id === customId ? draft.consolationBracket : null) || draft.customBrackets.find((item) => item.id === customId);
    if (!target) {
      return draft;
    }
    if (field === "title") {
      target.title = String(value || "").trim();
    } else if (field === "teamCount") {
      target.teamCount = clampInt(value, target.teamCount, 2, 16);
      target.sources = Array.from({ length: target.teamCount }, (_, index) =>
        sanitizeBracketSource(target.sources[index] || {}, index, target.id)
      );
      target.seedSourceIds = target.seedSourceIds.filter((sourceId) => target.sources.some((source) => source.sourceId === sourceId));
    }
    return draft;
  });
}
export function updateCustomBracketSource(bootstrap, routeKey, customId, index, rawValue) {
  return commitDraft(bootstrap, routeKey, (draft) => {
    const target = (draft.consolationBracket && draft.consolationBracket.id === customId ? draft.consolationBracket : null) || draft.customBrackets.find((item) => item.id === customId);
    if (!target) {
      return draft;
    }
    const [kind, value] = String(rawValue || "bye|").split("|");
    target.sources[index] = {
      ...sanitizeBracketSource(target.sources[index] || {}, index, target.id),
      kind: ["slot", "winner", "loser", "bye"].includes(kind) ? kind : "bye",
      value: value || "",
    };
    return draft;
  });
}
export function updateCustomBracketSourceById(bootstrap, routeKey, customId, sourceId, rawValue) {
  return commitDraft(bootstrap, routeKey, (draft) => {
    const target = (draft.consolationBracket && draft.consolationBracket.id === customId ? draft.consolationBracket : null) || draft.customBrackets.find((item) => item.id === customId);
    if (!target) {
      return draft;
    }
    const index = target.sources.findIndex((item) => item.sourceId === sourceId);
    if (index < 0) {
      return draft;
    }
    const [kind, value] = String(rawValue || "bye|").split("|");
    target.sources[index] = {
      ...target.sources[index],
      kind: ["slot", "winner", "loser", "bye"].includes(kind) ? kind : "bye",
      value: value || "",
    };
    return draft;
  });
}
export function toggleCustomBracketSeed(bootstrap, routeKey, customId, sourceId) {
  return commitDraft(bootstrap, routeKey, (draft) => {
    const target = (draft.consolationBracket && draft.consolationBracket.id === customId ? draft.consolationBracket : null) || draft.customBrackets.find((item) => item.id === customId);
    if (!target) {
      return draft;
    }
    const currentIndex = target.seedSourceIds.indexOf(sourceId);
    if (currentIndex >= 0) {
      target.seedSourceIds.splice(currentIndex, 1);
    } else {
      target.seedSourceIds.push(sourceId);
    }
    return draft;
  });
}
export function updateTimetableField(bootstrap, routeKey, dayNo, field, value) {
  return commitDraft(bootstrap, routeKey, (draft) => {
    const timetable = getDayTimetable(draft, dayNo);
    if (field === "startTime") {
      timetable.startTime = String(value || "09:00");
    } else if (field === "endTime") {
      timetable.endTime = String(value || "12:00");
    } else if (field === "intervalMinutes") {
      timetable.intervalMinutes = clampInt(value, timetable.intervalMinutes, 5, 120);
    }
    draft.dayTimetables[String(dayNo || "1")] = timetable;
    return draft;
  });
}

export function applyTimetableSettings(bootstrap, routeKey, dayNo) {
  return commitDraft(bootstrap, routeKey, (draft) => {
    const timetable = resizeTimetableRows(getDayTimetable(draft, dayNo), draft.courtCount);
    draft.dayTimetables[String(dayNo || "1")] = timetable;
    return draft;
  });
}

export function updateTimetableCourtName(bootstrap, routeKey, dayNo, courtIndex, value) {
  return commitDraft(bootstrap, routeKey, (draft) => {
    const timetable = getDayTimetable(draft, dayNo);
    timetable.courtNames = buildDraftCourtNames(timetable.courtNames, draft.courtCount);
    if (courtIndex >= 0 && courtIndex < draft.courtCount) {
      timetable.courtNames[courtIndex] = String(value || "").trim() || buildCourtNames(draft.courtCount)[courtIndex];
    }
    draft.dayTimetables[String(dayNo || "1")] = timetable;
    return draft;
  });
}

export function updateTimetableRowTime(bootstrap, routeKey, dayNo, rowIndex, value) {
  return commitDraft(bootstrap, routeKey, (draft) => {
    const timetable = getDayTimetable(draft, dayNo);
    if (timetable.rows[rowIndex]) {
      timetable.rows[rowIndex].time = String(value || "").trim() || timetable.rows[rowIndex].time || "09:00";
      timetable.enabled = true;
    }
    draft.dayTimetables[String(dayNo || "1")] = timetable;
    return draft;
  });
}

export function generateTimetable(bootstrap, routeKey) {
  return commitDraft(bootstrap, routeKey, (draft) => {
    const preview = buildPreviewBundle(draft);
    draft.dayTimetables = buildAutoDayTimetables(draft, preview.matches);
    return draft;
  });
}

export function updateTimetableCell(bootstrap, routeKey, dayNo, rowIndex, courtIndex, value) {
  return commitDraft(bootstrap, routeKey, (draft) => {
    const timetable = getDayTimetable(draft, dayNo);
    if (!timetable.rows[rowIndex]) {
      return draft;
    }
    timetable.enabled = true;
    timetable.rows[rowIndex].cells[courtIndex] = String(value || "").trim();
    draft.dayTimetables[String(dayNo || "1")] = timetable;
    return draft;
  });
}

export function buildEventSavePayload(bootstrap, routeKey) {
  const draft = ensureDraft(bootstrap, routeKey);
  if (draft.format === "tournament") {
    const requiredSeedCount = getRequiredSeedCount(draft.teamCount);
    const normalizedSeedSlotIds = normalizeSeedSlotIdsForExactCount(draft.slots, draft.teamCount, draft.seedSlotIds, draft.format);
    if (normalizedSeedSlotIds.length !== requiredSeedCount || getActiveMainSlots(draft).length !== draft.teamCount) {
      throw new Error("シード設定が未完了です。必要数のシードを設定してください。");
    }
  }
  const preview = buildPreviewBundle(draft);
  const existing = ((bootstrap && bootstrap.events) || []).find((event) => event.event_id === (draft.originalEventId || draft.eventId));
  const maxDisplayOrder = ((bootstrap && bootstrap.events) || []).reduce((acc, event) => Math.max(acc, Number(event.display_order || 0)), 0);
  preview.event.display_order = String(existing ? existing.display_order || maxDisplayOrder + 1 : maxDisplayOrder + 1);
  preview.event.printed_page = existing ? String(existing.printed_page || "") : "";
  preview.event.bracket_note = serializeEventEditorMeta({ format: draft.format, draft: buildPersistentDraft(draft) });
  return {
    originalEventId: draft.originalEventId || "",
    event: preview.event,
    teams: preview.teams.map(({ _slotId, ...team }) => team),
    matches: preview.matches,
  };
}

export function clearEventEditorDraft(routeKey) { adminState.drafts.delete(routeKey); }
