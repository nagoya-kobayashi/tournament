(function (root, factory) {
  const api = factory(root.MatchboardInitialData || null);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.MatchboardModel = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (INITIAL_DATA) {
  "use strict";

  const SCHEMA_VERSION = 1;
  const COLORS = ["#2f6f59", "#db754b", "#5379bd", "#8c5caf", "#b99a35", "#3b8d97"];
  const FORMAT_LABELS = { league: "リーグ", tournament: "トーナメント", hybrid: "リーグ＋トーナメント" };
  const TEAM_SUFFIXES = ["①", "②", "③"];

  function uid(prefix) {
    const random = Math.random().toString(36).slice(2, 8);
    return `${prefix}_${Date.now().toString(36)}_${random}`;
  }

  function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function localDateTime(date) {
    const pad = (n) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function makeSlots(count, minutes, startDate) {
    const start = startDate ? new Date(startDate) : new Date();
    if (!startDate) {
      start.setHours(9, 0, 0, 0);
      start.setDate(start.getDate() + 1);
    }
    return Array.from({ length: count }, (_, index) => {
      const at = new Date(start.getTime() + index * minutes * 60000);
      return { id: uid("slot"), start: localDateTime(at) };
    });
  }

  function defaultCompetition(name, index, format) {
    return {
      id: uid("comp"),
      name,
      format,
      color: COLORS[index % COLORS.length],
      duration: 15,
      venues: [
        { id: uid("venue"), name: `${name} 第1会場` },
        { id: uid("venue"), name: `${name} 第2会場` },
      ],
      slots: makeSlots(12, 15),
    };
  }

  function createDemoInitialState() {
    const classes = ["1A", "1B", "2A", "2B", "3A", "3B"].map((name) => ({ id: uid("class"), name }));
    const competitions = [
      defaultCompetition("オセロ", 0, "tournament"),
      defaultCompetition("ボッチャ", 1, "hybrid"),
      defaultCompetition("UNO", 2, "league"),
      defaultCompetition("コネクト4", 3, "tournament"),
    ];
    const entries = {};
    competitions.forEach((competition) => {
      entries[competition.id] = {};
      classes.forEach((classInfo) => { entries[competition.id][classInfo.id] = 0; });
    });
    return {
      schemaVersion: SCHEMA_VERSION,
      event: { title: "インドア選手権" },
      classes,
      competitions,
      entries,
      draws: {},
      results: {},
      schedule: {},
      updatedAt: new Date().toISOString(),
    };
  }

  function sourceForInitialTeam(competitionId, classes, name) {
    const suffix = String(name).slice(-1).toLowerCase();
    const className = String(name).slice(0, -1);
    const classInfo = classes.find((item) => item.name === className);
    if (!classInfo || !["a", "b", "c"].includes(suffix)) return { type: "empty" };
    return { type: "team", teamId: `${competitionId}::${classInfo.id}::${suffix.charCodeAt(0) - 97}` };
  }

  function expandInitialHalf(competitionId, classes, names) {
    const sources = names.map((name) => sourceForInitialTeam(competitionId, classes, name));
    if (sources.length !== 25) return balanceBracketSources(sources, 32);
    const slots = [];
    let cursor = 0;
    for (let group = 0; group < 7; group += 1) {
      slots.push(sources[cursor++], { type: "bye" }, sources[cursor++], sources[cursor++]);
    }
    slots.push(sources[cursor++], sources[cursor++], sources[cursor++], sources[cursor++]);
    return slots;
  }

  function createConfiguredInitialState(definition) {
    const classes = definition.classes.map((name) => ({ id: `class_${name.toLowerCase()}`, name }));
    const baseDate = new Date();
    baseDate.setHours(0, 0, 0, 0);
    baseDate.setDate(baseDate.getDate() + (Number(definition.startOffsetDays) || 1));
    const competitions = definition.competitions.map((item) => {
      const competitionId = `comp_${item.key}`;
      const slots = [];
      item.days.forEach((day, dayIndex) => {
        const date = new Date(baseDate);
        date.setDate(baseDate.getDate() + dayIndex);
        day.rows.forEach(([time]) => {
          const [hours, minutes] = time.split(":").map(Number);
          const at = new Date(date);
          at.setHours(hours, minutes, 0, 0);
          slots.push({ id: `${competitionId}_day${dayIndex + 1}_${time.replace(":", "")}`, start: localDateTime(at), dayLabel: day.label });
        });
      });
      return {
        id: competitionId,
        name: item.name,
        format: "tournament",
        color: item.color,
        duration: item.duration,
        venues: item.venues.map((name, index) => ({ id: `${competitionId}_venue${index + 1}`, name })),
        slots,
      };
    });
    const entries = {};
    const draws = {};
    competitions.forEach((competition, index) => {
      const source = definition.competitions[index];
      entries[competition.id] = {};
      classes.forEach((classInfo) => { entries[competition.id][classInfo.id] = 2; });
      draws[competition.id] = {
        format: "tournament",
        tournament: {
          size: 64,
          thirdPlace: true,
          slots: [
            ...expandInitialHalf(competition.id, classes, source.left),
            ...expandInitialHalf(competition.id, classes, source.right),
          ],
        },
      };
    });
    const state = {
      schemaVersion: SCHEMA_VERSION,
      seedVersion: definition.seedVersion,
      event: { title: definition.eventTitle || "インドア選手権" },
      classes,
      competitions,
      entries,
      draws,
      results: {},
      schedule: {},
      updatedAt: new Date().toISOString(),
    };
    competitions.forEach((competition, competitionIndex) => {
      const source = definition.competitions[competitionIndex];
      const byNumber = new Map(buildMatches(state, competition.id).filter((match) => match.number).map((match) => [match.number, match]));
      source.days.forEach((day, dayIndex) => {
        day.rows.forEach(([time, numbers]) => {
          const slotId = `${competition.id}_day${dayIndex + 1}_${time.replace(":", "")}`;
          numbers.forEach((number, venueIndex) => {
            const match = byNumber.get(number);
            const venue = competition.venues[venueIndex];
            if (match && venue) state.schedule[match.id] = { competitionId: competition.id, slotId, venueId: venue.id };
          });
        });
      });
    });
    return state;
  }

  function createInitialState() {
    return INITIAL_DATA ? createConfiguredInitialState(INITIAL_DATA) : createDemoInitialState();
  }

  function normalizeState(input) {
    const state = input && typeof input === "object" ? deepClone(input) : createInitialState();
    state.schemaVersion = SCHEMA_VERSION;
    state.event = state.event || { title: "インドア選手権" };
    state.event.title = String(state.event.title || "インドア選手権");
    state.classes = Array.isArray(state.classes) ? state.classes : [];
    state.competitions = Array.isArray(state.competitions) ? state.competitions : [];
    state.entries = state.entries && typeof state.entries === "object" ? state.entries : {};
    state.draws = state.draws && typeof state.draws === "object" ? state.draws : {};
    state.results = state.results && typeof state.results === "object" ? state.results : {};
    state.schedule = state.schedule && typeof state.schedule === "object" ? state.schedule : {};
    state.competitions.forEach((competition, index) => {
      competition.color = competition.color || COLORS[index % COLORS.length];
      competition.format = FORMAT_LABELS[competition.format] ? competition.format : "tournament";
      competition.duration = Math.max(1, Number(competition.duration) || 15);
      competition.venues = Array.isArray(competition.venues) ? competition.venues : [];
      competition.slots = Array.isArray(competition.slots) ? competition.slots : [];
      state.entries[competition.id] = state.entries[competition.id] || {};
      state.classes.forEach((classInfo) => {
        const count = Number(state.entries[competition.id][classInfo.id]) || 0;
        state.entries[competition.id][classInfo.id] = Math.max(0, Math.min(3, count));
      });
    });
    return state;
  }

  function createCompetition(values) {
    const venueNames = Array.isArray(values.venueNames) ? values.venueNames : [];
    return {
      id: values.id || uid("comp"),
      name: String(values.name || "新しい競技").trim(),
      format: FORMAT_LABELS[values.format] ? values.format : "tournament",
      color: values.color || COLORS[0],
      duration: Math.max(1, Number(values.duration) || 15),
      venues: venueNames.filter(Boolean).map((name) => ({ id: uid("venue"), name: String(name).trim() })),
      slots: makeSlots(Math.max(1, Number(values.slotCount) || 1), Math.max(1, Number(values.duration) || 15), values.start),
    };
  }

  function teamsForCompetition(state, competitionId) {
    const counts = state.entries[competitionId] || {};
    const teams = [];
    state.classes.forEach((classInfo) => {
      const count = Math.max(0, Math.min(3, Number(counts[classInfo.id]) || 0));
      for (let index = 0; index < count; index += 1) {
        teams.push({
          id: `${competitionId}::${classInfo.id}::${index}`,
          competitionId,
          classId: classInfo.id,
          name: count === 1 ? classInfo.name : `${classInfo.name}${TEAM_SUFFIXES[index] || `(${index + 1})`}`,
        });
      }
    });
    return teams;
  }

  function allTeams(state) {
    return state.competitions.flatMap((competition) => teamsForCompetition(state, competition.id));
  }

  function nextPowerOfTwo(value) {
    let size = 2;
    while (size < Math.max(2, value)) size *= 2;
    return size;
  }

  function directTeamSource(teamId) {
    return teamId ? { type: "team", teamId } : { type: "empty" };
  }

  function distributeTeams(teams, groupCount) {
    const groups = Array.from({ length: groupCount }, () => []);
    teams.forEach((team, index) => groups[index % groupCount].push(directTeamSource(team.id)));
    return groups;
  }

  function balanceBracketSources(sources, size) {
    const entrants = sources.slice(0, size);
    const byeCount = Math.max(0, size - entrants.length);
    const slots = [];
    let cursor = 0;
    for (let pair = 0; pair < size / 2; pair += 1) {
      if (pair < byeCount && cursor < entrants.length) {
        slots.push(entrants[cursor++], { type: "bye" });
      } else {
        slots.push(entrants[cursor++] || { type: "bye" }, entrants[cursor++] || { type: "bye" });
      }
    }
    return slots;
  }

  function createDraw(state, competitionId, options) {
    const competition = state.competitions.find((item) => item.id === competitionId);
    if (!competition) return null;
    const teams = teamsForCompetition(state, competitionId);
    const groupCount = Math.max(1, Math.min(8, Number(options && options.groupCount) || (teams.length >= 8 ? 2 : 1)));
    const draw = { format: competition.format };

    if (competition.format === "league" || competition.format === "hybrid") {
      const distributed = distributeTeams(teams, groupCount);
      const minimumSize = Math.max(2, Math.ceil(Math.max(teams.length, groupCount * 2) / groupCount));
      draw.league = {
        groupCount,
        groups: distributed.map((sources, index) => ({
          id: `g${index + 1}`,
          name: `${String.fromCharCode(65 + index)}組`,
          slots: sources.concat(Array.from({ length: Math.max(0, minimumSize - sources.length) }, () => ({ type: "empty" }))),
        })),
      };
    }

    if (competition.format === "tournament" || competition.format === "hybrid") {
      const qualifierCount = competition.format === "hybrid" ? Math.max(2, groupCount * 2) : teams.length;
      const size = nextPowerOfTwo(qualifierCount);
      let slots;
      if (competition.format === "hybrid") {
        const qualifiers = [];
        for (let rank = 1; rank <= 2; rank += 1) {
          for (let groupIndex = 0; groupIndex < groupCount; groupIndex += 1) {
            qualifiers.push({ type: "leagueRank", groupId: `g${groupIndex + 1}`, rank });
          }
        }
        slots = balanceBracketSources(qualifiers, size);
      } else {
        slots = balanceBracketSources(teams.map((team) => directTeamSource(team.id)), size);
      }
      draw.tournament = { size, slots };
    }
    return draw;
  }

  function resizeTournament(draw, size) {
    const nextSize = nextPowerOfTwo(size);
    const current = draw.tournament && Array.isArray(draw.tournament.slots) ? draw.tournament.slots : [];
    const thirdPlace = Boolean(draw.tournament && draw.tournament.thirdPlace);
    draw.tournament = {
      size: nextSize,
      thirdPlace,
      slots: current.slice(0, nextSize).concat(Array.from({ length: Math.max(0, nextSize - current.length) }, () => ({ type: "empty" }))),
    };
  }

  function resizeLeague(draw, groupCount, teams) {
    const count = Math.max(1, Math.min(8, Number(groupCount) || 1));
    const existing = draw.league && draw.league.groups ? draw.league.groups.flatMap((group) => group.slots) : [];
    const teamSources = existing.filter((source) => source && source.type === "team");
    const assigned = new Set(teamSources.map((source) => source.teamId));
    (teams || []).forEach((team) => { if (!assigned.has(team.id)) teamSources.push(directTeamSource(team.id)); });
    const distributed = Array.from({ length: count }, () => []);
    teamSources.forEach((source, index) => distributed[index % count].push(source));
    const minimumSize = Math.max(2, Math.ceil(Math.max(teamSources.length, count * 2) / count));
    draw.league = {
      groupCount: count,
      groups: distributed.map((sources, index) => ({
        id: `g${index + 1}`,
        name: `${String.fromCharCode(65 + index)}組`,
        slots: sources.concat(Array.from({ length: Math.max(0, minimumSize - sources.length) }, () => ({ type: "empty" }))),
      })),
    };
  }

  function sourceKey(source) {
    if (!source) return "empty";
    if (source.type === "team") return `team:${source.teamId}`;
    if (source.type === "leagueRank") return `rank:${source.groupId}:${source.rank}`;
    return source.type;
  }

  function buildMatches(state, competitionId) {
    const competition = state.competitions.find((item) => item.id === competitionId);
    const draw = state.draws[competitionId];
    if (!competition || !draw) return [];
    const matches = [];

    if (draw.league && Array.isArray(draw.league.groups)) {
      draw.league.groups.forEach((group, groupIndex) => {
        const active = group.slots.map((source, slotIndex) => ({ source: source || { type: "empty" }, slotIndex }))
          .filter((item) => item.source.type !== "empty" && item.source.type !== "bye");
        let pairIndex = 0;
        for (let a = 0; a < active.length; a += 1) {
          for (let b = a + 1; b < active.length; b += 1) {
            pairIndex += 1;
            matches.push({
              id: `${competitionId}__L__${group.id}__${active[a].slotIndex}_${active[b].slotIndex}`,
              competitionId,
              phase: "league",
              groupId: group.id,
              groupName: group.name,
              round: pairIndex,
              number: matches.length + 1,
              sourceA: active[a].source,
              sourceB: active[b].source,
            });
          }
        }
      });
    }

    if (draw.tournament && draw.tournament.size >= 2) {
      const roundCount = Math.log2(draw.tournament.size);
      const tournamentMatches = [];
      let previousIds = [];
      for (let round = 0; round < roundCount; round += 1) {
        const matchCount = draw.tournament.size / Math.pow(2, round + 1);
        const currentIds = [];
        for (let index = 0; index < matchCount; index += 1) {
          const id = `${competitionId}__T__${round}_${index}`;
          currentIds.push(id);
          tournamentMatches.push({
            id,
            competitionId,
            phase: "tournament",
            round,
            roundCount,
            roundName: round === roundCount - 1 ? "決勝" : round === roundCount - 2 ? "準決勝" : round === roundCount - 3 ? "準々決勝" : `${round + 1}回戦`,
            index,
            number: null,
            sourceA: round === 0 ? (draw.tournament.slots[index * 2] || { type: "empty" }) : { type: "matchWinner", matchId: previousIds[index * 2] },
            sourceB: round === 0 ? (draw.tournament.slots[index * 2 + 1] || { type: "empty" }) : { type: "matchWinner", matchId: previousIds[index * 2 + 1] },
          });
        }
        previousIds = currentIds;
      }
      let nextNumber = matches.length + 1;
      const finalMatch = tournamentMatches.find((match) => match.round === roundCount - 1 && match.index === 0);
      tournamentMatches.forEach((match) => {
        const automaticBye = match.round === 0 && (match.sourceA.type === "bye" || match.sourceB.type === "bye");
        const reserveFinal = Boolean(draw.tournament.thirdPlace && match === finalMatch && roundCount >= 2);
        if (!automaticBye && !reserveFinal) match.number = nextNumber++;
      });
      matches.push(...tournamentMatches);
      if (draw.tournament.thirdPlace && roundCount >= 2) {
        const semifinals = tournamentMatches.filter((match) => match.round === roundCount - 2).sort((a, b) => a.index - b.index);
        if (semifinals.length === 2) {
          matches.push({
            id: `${competitionId}__T__third_place`,
            competitionId,
            phase: "placement",
            round: roundCount - 1,
            roundCount,
            roundName: "3位決定戦",
            index: 0,
            number: nextNumber++,
            sourceA: { type: "matchLoser", matchId: semifinals[0].id },
            sourceB: { type: "matchLoser", matchId: semifinals[1].id },
          });
          if (finalMatch) finalMatch.number = nextNumber++;
        }
      }
    }
    return matches;
  }

  function matchMap(state, competitionId) {
    return new Map(buildMatches(state, competitionId).map((match) => [match.id, match]));
  }

  function resolveLeagueRank(state, competitionId, groupId, rank, stack) {
    const draw = state.draws[competitionId];
    const group = draw && draw.league && draw.league.groups.find((item) => item.id === groupId);
    if (!group) return { type: "pending", label: "リーグ順位未定" };
    const groupMatches = buildMatches(state, competitionId).filter((match) => match.phase === "league" && match.groupId === groupId);
    if (!groupMatches.length || groupMatches.some((match) => !state.results[match.id])) {
      return { type: "pending", label: `${group.name} ${rank}位` };
    }
    const table = leagueStandings(state, competitionId, groupId, stack);
    const row = table[rank - 1];
    return row ? { type: "team", team: row.team } : { type: "pending", label: `${group.name} ${rank}位` };
  }

  function resolveSource(state, competitionId, source, stack) {
    const safeSource = source || { type: "empty" };
    if (safeSource.type === "empty") return { type: "pending", label: "未設定" };
    if (safeSource.type === "bye") return { type: "bye", label: "シード" };
    if (safeSource.type === "team") {
      const team = teamsForCompetition(state, competitionId).find((item) => item.id === safeSource.teamId);
      return team ? { type: "team", team } : { type: "pending", label: "エントリー変更済み" };
    }
    if (safeSource.type === "leagueRank") return resolveLeagueRank(state, competitionId, safeSource.groupId, safeSource.rank, stack);
    if (safeSource.type === "matchWinner" || safeSource.type === "matchLoser") {
      const key = safeSource.matchId;
      if (stack && stack.has(key)) return { type: "pending", label: "未定" };
      const matches = matchMap(state, competitionId);
      const match = matches.get(key);
      if (!match) return { type: "pending", label: "未定" };
      const nextStack = new Set(stack || []);
      nextStack.add(key);
      return safeSource.type === "matchWinner" ? winnerOfMatch(state, match, nextStack) : loserOfMatch(state, match, nextStack);
    }
    return { type: "pending", label: "未定" };
  }

  function participantsForMatch(state, match, stack) {
    return {
      a: resolveSource(state, match.competitionId, match.sourceA, stack),
      b: resolveSource(state, match.competitionId, match.sourceB, stack),
    };
  }

  function winnerOfMatch(state, match, stack) {
    const participants = participantsForMatch(state, match, stack);
    if (participants.a.type === "bye" && participants.b.type === "team") return participants.b;
    if (participants.b.type === "bye" && participants.a.type === "team") return participants.a;
    if (participants.a.type === "bye" && participants.b.type === "bye") return { type: "bye", label: "シード" };
    const result = state.results[match.id];
    if (!result) return { type: "pending", label: `試合 ${match.number} 勝者` };
    if (result.winnerSide === "a") return participants.a.type === "team" ? participants.a : { type: "pending", label: `試合 ${match.number} 勝者` };
    if (result.winnerSide === "b") return participants.b.type === "team" ? participants.b : { type: "pending", label: `試合 ${match.number} 勝者` };
    return { type: "pending", label: `試合 ${match.number} 勝者` };
  }

  function loserOfMatch(state, match, stack) {
    const participants = participantsForMatch(state, match, stack);
    const result = state.results[match.id];
    const label = `試合 ${match.number || ""} 敗者`.replace("  ", " ");
    if (!result) return { type: "pending", label };
    if (result.winnerSide === "a") return participants.b.type === "team" ? participants.b : { type: "pending", label };
    if (result.winnerSide === "b") return participants.a.type === "team" ? participants.a : { type: "pending", label };
    return { type: "pending", label };
  }

  function participantLabel(participant) {
    if (!participant) return "未定";
    if (participant.type === "team") return participant.team.name;
    return participant.label || "未定";
  }

  function leagueStandings(state, competitionId, groupId, guard) {
    const draw = state.draws[competitionId];
    const group = draw && draw.league && draw.league.groups.find((item) => item.id === groupId);
    if (!group) return [];
    const teams = group.slots.map((source) => resolveSource(state, competitionId, source, guard)).filter((participant) => participant.type === "team").map((participant) => participant.team);
    const rows = new Map(teams.map((team) => [team.id, { team, played: 0, wins: 0, losses: 0, scored: 0, conceded: 0, points: 0 }]));
    buildMatches(state, competitionId).filter((match) => match.phase === "league" && match.groupId === groupId).forEach((match) => {
      const result = state.results[match.id];
      if (!result) return;
      const participants = participantsForMatch(state, match, guard);
      if (participants.a.type !== "team" || participants.b.type !== "team") return;
      const rowA = rows.get(participants.a.team.id);
      const rowB = rows.get(participants.b.team.id);
      if (!rowA || !rowB) return;
      const scoreA = Number(result.scoreA) || 0;
      const scoreB = Number(result.scoreB) || 0;
      rowA.played += 1; rowB.played += 1;
      rowA.scored += scoreA; rowA.conceded += scoreB;
      rowB.scored += scoreB; rowB.conceded += scoreA;
      if (result.winnerSide === "a") { rowA.wins += 1; rowA.points += 3; rowB.losses += 1; }
      if (result.winnerSide === "b") { rowB.wins += 1; rowB.points += 3; rowA.losses += 1; }
    });
    return Array.from(rows.values()).sort((a, b) => b.points - a.points || (b.scored - b.conceded) - (a.scored - a.conceded) || b.scored - a.scored || a.team.name.localeCompare(b.team.name, "ja"));
  }

  function possibleTeamIds(state, competitionId, source, visited) {
    const safeSource = source || { type: "empty" };
    if (safeSource.type === "team") return new Set([safeSource.teamId]);
    if (safeSource.type === "leagueRank") {
      const draw = state.draws[competitionId];
      const group = draw && draw.league && draw.league.groups.find((item) => item.id === safeSource.groupId);
      if (!group) return new Set();
      const ids = group.slots.filter((item) => item && item.type === "team").map((item) => item.teamId);
      return new Set(ids);
    }
    if (safeSource.type === "matchWinner" || safeSource.type === "matchLoser") {
      const seen = new Set(visited || []);
      if (seen.has(safeSource.matchId)) return new Set();
      seen.add(safeSource.matchId);
      const match = matchMap(state, competitionId).get(safeSource.matchId);
      if (!match) return new Set();
      const a = possibleTeamIds(state, competitionId, match.sourceA, seen);
      const b = possibleTeamIds(state, competitionId, match.sourceB, seen);
      return new Set([...a, ...b]);
    }
    return new Set();
  }

  function possibleTeamsForMatch(state, match) {
    return new Set([
      ...possibleTeamIds(state, match.competitionId, match.sourceA),
      ...possibleTeamIds(state, match.competitionId, match.sourceB),
    ]);
  }

  function isPlayableMatch(state, match) {
    const participants = participantsForMatch(state, match);
    return participants.a.type !== "bye" && participants.b.type !== "bye" && possibleTeamsForMatch(state, match).size > 0;
  }

  function slotTime(state, assignment) {
    if (!assignment) return NaN;
    const competition = state.competitions.find((item) => item.id === assignment.competitionId);
    const slot = competition && competition.slots.find((item) => item.id === assignment.slotId);
    return slot ? new Date(slot.start).getTime() : NaN;
  }

  function setsIntersect(a, b) {
    for (const value of a) if (b.has(value)) return true;
    return false;
  }

  function scheduleConflicts(state, schedule) {
    const assignments = Object.entries(schedule || {}).map(([matchId, assignment]) => ({ matchId, ...assignment })).filter((item) => item.slotId && item.venueId);
    const allMatches = new Map(state.competitions.flatMap((competition) => buildMatches(state, competition.id)).map((match) => [match.id, match]));
    const competitions = new Map(state.competitions.map((competition) => [competition.id, competition]));
    const teamSets = new Map();
    const possibleFor = (match) => {
      if (!teamSets.has(match.id)) teamSets.set(match.id, possibleTeamsForMatch(state, match));
      return teamSets.get(match.id);
    };
    const issues = [];
    for (let left = 0; left < assignments.length; left += 1) {
      for (let right = left + 1; right < assignments.length; right += 1) {
        const a = assignments[left]; const b = assignments[right];
        const timeA = slotTime(state, a); const timeB = slotTime(state, b);
        if (!Number.isFinite(timeA) || !Number.isFinite(timeB)) continue;
        if (timeA === timeB && a.competitionId === b.competitionId && a.venueId === b.venueId) {
          issues.push({ type: "venue", matches: [a.matchId, b.matchId], message: "同じ会場・時刻に複数試合があります" });
        }
        const matchA = allMatches.get(a.matchId); const matchB = allMatches.get(b.matchId);
        if (!matchA || !matchB) continue;
        const compA = competitions.get(a.competitionId);
        const compB = competitions.get(b.competitionId);
        const gap = Math.max(Number(compA.duration) || 15, Number(compB.duration) || 15) * 2 * 60000;
        if (Math.abs(timeA - timeB) >= gap) continue;
        const teamsA = possibleFor(matchA); const teamsB = possibleFor(matchB);
        if (setsIntersect(teamsA, teamsB)) issues.push({ type: "team", matches: [a.matchId, b.matchId], message: "同じ可能性があるチームの試合間に、移動1枠を確保できません" });
      }
    }
    return issues;
  }

  function autoSchedule(state, options) {
    const onlyCompetitionId = options && options.competitionId;
    const schedule = options && options.keepExisting === false ? {} : deepClone(state.schedule || {});
    const competitions = onlyCompetitionId ? state.competitions.filter((item) => item.id === onlyCompetitionId) : state.competitions;
    const matches = competitions.flatMap((competition) => buildMatches(state, competition.id))
      .filter((match) => isPlayableMatch(state, match))
      .sort((a, b) => {
        const phaseA = a.phase === "league" ? 0 : 1;
        const phaseB = b.phase === "league" ? 0 : 1;
        return phaseA - phaseB || a.round - b.round || a.number - b.number;
      });
    const unassigned = [];

    matches.forEach((match) => {
      if (schedule[match.id]) return;
      const competition = state.competitions.find((item) => item.id === match.competitionId);
      const candidates = competition.slots.flatMap((slot) => competition.venues.map((venue) => ({
        competitionId: competition.id,
        slotId: slot.id,
        venueId: venue.id,
      }))).sort((a, b) => slotTime(state, a) - slotTime(state, b));
      let chosen = null;
      for (const candidate of candidates) {
        const trial = { ...schedule, [match.id]: candidate };
        const relatedIssues = scheduleConflicts(state, trial).filter((issue) => issue.matches.includes(match.id));
        if (!relatedIssues.length) { chosen = candidate; break; }
      }
      if (chosen) schedule[match.id] = chosen;
      else unassigned.push(match.id);
    });
    return { schedule, unassigned, conflicts: scheduleConflicts(state, schedule) };
  }

  function findLatestMatchForTeam(state, competitionId, teamId) {
    const matches = buildMatches(state, competitionId).filter((match) => {
      const participants = participantsForMatch(state, match);
      return (participants.a.type === "team" && participants.a.team.id === teamId) || (participants.b.type === "team" && participants.b.team.id === teamId);
    });
    return matches.sort((a, b) => {
      const completeA = state.results[a.id] ? 0 : 1;
      const completeB = state.results[b.id] ? 0 : 1;
      const phaseA = a.phase === "tournament" || a.phase === "placement" ? 1 : 0;
      const phaseB = b.phase === "tournament" || b.phase === "placement" ? 1 : 0;
      return phaseB - phaseA || b.round - a.round || completeB - completeA || b.number - a.number;
    })[0] || null;
  }

  function competitionProgress(state, competitionId) {
    const matches = buildMatches(state, competitionId).filter((match) => isPlayableMatch(state, match));
    const completed = matches.filter((match) => state.results[match.id]).length;
    return { total: matches.length, completed, remaining: Math.max(0, matches.length - completed) };
  }

  function pruneOrphans(state) {
    const validCompetitionIds = new Set(state.competitions.map((item) => item.id));
    Object.keys(state.entries).forEach((id) => { if (!validCompetitionIds.has(id)) delete state.entries[id]; });
    Object.keys(state.draws).forEach((id) => { if (!validCompetitionIds.has(id)) delete state.draws[id]; });
    const validMatches = new Set(state.competitions.flatMap((competition) => buildMatches(state, competition.id)).map((match) => match.id));
    Object.keys(state.results).forEach((id) => { if (!validMatches.has(id)) delete state.results[id]; });
    Object.keys(state.schedule).forEach((id) => {
      if (!validMatches.has(id)) { delete state.schedule[id]; return; }
      const assignment = state.schedule[id];
      const competition = state.competitions.find((item) => item.id === assignment.competitionId);
      const validSlot = competition && competition.slots.some((slot) => slot.id === assignment.slotId);
      const validVenue = competition && competition.venues.some((venue) => venue.id === assignment.venueId);
      if ((assignment.slotId && !validSlot) || (assignment.venueId && !validVenue)) delete state.schedule[id];
    });
  }

  return {
    SCHEMA_VERSION, COLORS, FORMAT_LABELS, TEAM_SUFFIXES, uid, deepClone, localDateTime, makeSlots,
    createInitialState, normalizeState, createCompetition, teamsForCompetition, allTeams,
    nextPowerOfTwo, createDraw, resizeTournament, resizeLeague, sourceKey,
    buildMatches, resolveSource, participantsForMatch, winnerOfMatch, participantLabel,
    leagueStandings, possibleTeamIds, possibleTeamsForMatch, scheduleConflicts,
    isPlayableMatch, autoSchedule, findLatestMatchForTeam, competitionProgress, pruneOrphans,
  };
});
