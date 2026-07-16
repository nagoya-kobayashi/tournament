(function () {
  "use strict";

  const Model = window.MatchboardModel;
  const StoreUtils = window.MatchboardStoreUtils;
  const store = new window.MatchboardStore();
  const app = document.getElementById("app");
  const modalRoot = document.getElementById("modal-root");
  const toastRoot = document.getElementById("toast-root");
  const syncStatus = document.getElementById("sync-status");
  const sidebar = document.getElementById("sidebar");
  const VIEW_PREFS_KEY = "indoor-matchboard-view-prefs-v1";

  function readViewPreferences() {
    try {
      const parsed = JSON.parse(localStorage.getItem(VIEW_PREFS_KEY) || "{}");
      return {
        openDays: parsed.openDays && typeof parsed.openDays === "object" ? parsed.openDays : {},
        showPossible: parsed.showPossible === true,
      };
    } catch (_) {
      return { openDays: {}, showPossible: false };
    }
  }

  const viewPreferences = readViewPreferences();

  function saveViewPreferences() {
    try { localStorage.setItem(VIEW_PREFS_KEY, JSON.stringify(viewPreferences)); } catch (_) { /* 端末保存が使えない場合は現在の表示だけ維持 */ }
  }

  const ui = {
    route: "live",
    liveCompetitionId: "",
    drawCompetitionId: "",
    scheduleCompetitionId: "all",
    classId: "",
    competitionScheduleId: "",
    lastBracketKey: "",
    bracketZoom: "fit",
  };

  const routeInfo = {
    live: ["LIVE BOARD", "ライブ", "勝ち上がりとリーグ順位をリアルタイムに表示します。"],
    "class-schedule": ["CLASS TIMELINE", "クラス別予定", "クラスごとの競技、開始時刻、会場をまとめて確認できます。"],
    "competition-schedule": ["COMPETITION TIMELINE", "競技別予定", "競技ごとの試合、開始時刻、会場を日別に確認できます。"],
    schedule: ["MATCH SCHEDULE", "試合日程", "トーナメント表を見ながら、時刻×会場表へ試合番号を配置できます。"],
    competitions: ["COMPETITION SETUP", "競技設定", "競技方式、会場、試合枠を設定します。"],
    entries: ["ENTRY SETUP", "エントリー", "クラスごと・競技ごとの出場チーム数を0〜3で指定します。"],
    draw: ["DRAW SETUP", "組み合わせ", "出場枠へチーム、シード、リーグ順位枠を割り当てます。"],
  };

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
  }

  function attr(value) { return esc(value); }

  function formatDateTime(value, withDate) {
    if (!value) return "時刻未設定";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat("ja-JP", withDate ? { month: "numeric", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit" } : { hour: "2-digit", minute: "2-digit" }).format(date);
  }

  function formatSlot(slot, withDate) {
    if (!slot) return "時刻未設定";
    return slot.dayLabel ? `${slot.dayLabel} ${formatDateTime(slot.start, false)}` : formatDateTime(slot.start, withDate);
  }

  function scheduleDay(slot) {
    const label = String((slot && slot.dayLabel) || "").trim();
    if (label) return { key: `label:${label}`, label };
    const date = new Date(slot && slot.start);
    if (Number.isNaN(date.getTime())) return { key: "unspecified", label: "日付未設定" };
    const pad = (number) => String(number).padStart(2, "0");
    const dateKey = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    const dateLabel = new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric", weekday: "short" }).format(date);
    return { key: `date:${dateKey}`, label: dateLabel };
  }

  function scheduleDayGroups(events, slots) {
    const groups = new Map();
    const ensure = (slot) => {
      const day = scheduleDay(slot);
      if (!groups.has(day.key)) groups.set(day.key, { ...day, events: [], firstTime: Number.POSITIVE_INFINITY });
      const group = groups.get(day.key);
      const time = new Date(slot && slot.start).getTime();
      if (Number.isFinite(time)) group.firstTime = Math.min(group.firstTime, time);
      return group;
    };
    (slots || []).forEach(ensure);
    (events || []).forEach((event) => ensure(event.slot).events.push(event));
    return [...groups.values()].sort((a, b) => a.firstTime - b.firstTime || a.label.localeCompare(b.label, "ja"));
  }

  function scheduleMatchCard(event, columnCount, alignByVenue) {
    const possible = event.possible === true;
    const result = event.result;
    const completed = Boolean(result && ["a", "b"].includes(result.winnerSide));
    const winner = completed ? event.participants[result.winnerSide] : null;
    const winnerLabel = winner ? Model.participantLabel(winner) : "勝者未定";
    const scoreA = result && result.scoreA != null ? String(result.scoreA) : "";
    const scoreB = result && result.scoreB != null ? String(result.scoreB) : "";
    const score = completed && (scoreA !== "" || scoreB !== "") ? ` ${scoreA || "0"}–${scoreB || "0"}` : "";
    const matchup = completed
      ? `<span class="schedule-card-winner">${esc(winnerLabel)}</span><small>勝利${esc(score)}</small>`
      : `<span class="schedule-card-matchup">${esc(Model.participantLabel(event.participants.a))}<b>VS</b>${esc(Model.participantLabel(event.participants.b))}</span>`;
    const venueColumn = event.venueIndex >= 0 ? (event.venueIndex % columnCount) + 1 : 1;
    const columnStyle = alignByVenue ? `;grid-column:${venueColumn}` : "";
    return `<button class="schedule-match-card ${possible ? "possible-event" : ""} ${completed ? "completed" : ""}" type="button" data-result-match="${attr(event.match.id)}" style="--comp-color:${attr(event.competition.color)}${columnStyle}"><span class="schedule-card-head"><strong>${esc(event.heading)}${possible ? "（進出時）" : ""}</strong><span class="schedule-card-flags"><small>${esc(event.match.phase === "league" ? event.match.groupName : event.match.roundName)}</small>${possible ? `<em>仮予定</em>` : ""}</span></span><span class="schedule-card-result">${matchup}</span><span class="schedule-card-meta">${esc(event.venue ? event.venue.name : "会場未設定")}</span></button>`;
  }

  function renderScheduleTimeGroups(events, options) {
    const byTime = new Map();
    events.forEach((event) => {
      const key = String(event.slot.start || "");
      if (!byTime.has(key)) byTime.set(key, []);
      byTime.get(key).push(event);
    });
    const columnCount = Math.max(1, Math.min(4, Number(options.columnCount) || 4));
    const alignByVenue = options.alignByVenue !== false;
    const venueHeader = options.venueHeaders && options.venueHeaders.length
      ? `<div class="schedule-venue-head"><span></span><div class="schedule-venue-grid">${options.venueHeaders.slice(0, columnCount).map((venue) => `<strong>${esc(venue.name)}</strong>`).join("")}</div></div>`
      : "";
    const eventSort = alignByVenue
      ? (a, b) => a.venueIndex - b.venueIndex || a.competitionIndex - b.competitionIndex
      : (a, b) => Number(a.possible) - Number(b.possible) || a.competitionIndex - b.competitionIndex || a.venueIndex - b.venueIndex;
    const rows = [...byTime.entries()].sort((a, b) => new Date(a[0]) - new Date(b[0])).map(([start, timeEvents]) => `<div class="schedule-time-row"><time>${esc(formatDateTime(start, false))}</time><div class="schedule-venue-grid ${alignByVenue ? "venue-aligned" : "left-aligned"}">${timeEvents.sort(eventSort).map((event) => scheduleMatchCard(event, columnCount, alignByVenue)).join("")}</div></div>`).join("");
    return `<div class="schedule-board columns-${columnCount}" style="--venue-columns:${columnCount}">${venueHeader}<div class="schedule-time-list">${rows}</div></div>`;
  }

  function renderScheduleDays(events, slots, viewKey, includePossible, options) {
    const groups = scheduleDayGroups(events, slots);
    if (!groups.length) return "";
    const layout = options || {};
    return `<div class="schedule-days">${groups.map((group, index) => {
      const preferenceKey = `${viewKey}:${group.key}`;
      const open = viewPreferences.openDays[preferenceKey] === true;
      const possibleCount = group.events.filter((event) => event.possible).length;
      const definiteCount = group.events.length - possibleCount;
      const visibleEvents = includePossible ? group.events : group.events.filter((event) => !event.possible);
      const panelId = `schedule-day-${viewKey}-${index}`;
      const countLabel = possibleCount ? `確定 ${definiteCount}件・進出時 ${possibleCount}件${includePossible ? "" : "（非表示）"}` : `${definiteCount}件`;
      const emptyText = !includePossible && possibleCount ? "進出時の予定は現在非表示です。" : "この日の予定はありません。";
      return `<section class="schedule-day ${open ? "open" : ""}"><button class="schedule-day-toggle" type="button" data-schedule-day-toggle data-schedule-view="${attr(viewKey)}" data-day-key="${attr(group.key)}" aria-expanded="${open}" aria-controls="${attr(panelId)}"><span><strong>${esc(group.label)}</strong><small>${esc(countLabel)}</small></span><i aria-hidden="true">⌄</i></button><div class="schedule-day-panel" id="${attr(panelId)}" ${open ? "" : "hidden"}>${visibleEvents.length ? renderScheduleTimeGroups(visibleEvents, layout) : `<p class="schedule-day-empty">${esc(emptyText)}</p>`}</div></section>`;
    }).join("")}</div>`;
  }

  function pageHead(route, actions) {
    const info = routeInfo[route];
    return `<header class="page-head"><div><p class="eyebrow">${info[0]}</p><h1>${info[1]}</h1><p class="page-lead">${info[2]}</p></div><div class="head-actions">${actions || ""}</div></header>`;
  }

  function emptyState(icon, title, text, action) {
    return `<div class="card empty-state"><span class="empty-icon">${icon}</span><h2>${esc(title)}</h2><p>${esc(text)}</p>${action || ""}</div>`;
  }

  function toast(message, type) {
    const node = document.createElement("div");
    node.className = `toast ${type || ""}`;
    node.textContent = message;
    toastRoot.appendChild(node);
    setTimeout(() => node.remove(), 3400);
  }

  async function copyText(value) {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      return;
    }
    const node = document.createElement("textarea");
    node.value = value;
    node.setAttribute("readonly", "");
    node.style.position = "fixed";
    node.style.opacity = "0";
    document.body.appendChild(node);
    node.select();
    const copied = document.execCommand("copy");
    node.remove();
    if (!copied) throw new Error("クリップボードへコピーできませんでした");
  }

  function showModal(content, large) {
    modalRoot.innerHTML = `<div class="modal-backdrop" data-close-modal><section class="modal ${large ? "large" : ""}" role="dialog" aria-modal="true">${content}</section></div>`;
    const first = modalRoot.querySelector("input,select,button");
    if (first) setTimeout(() => first.focus(), 0);
  }

  function closeModal() { modalRoot.innerHTML = ""; }

  function modalFrame(title, subtitle, body, actions) {
    return `<header class="modal-head"><div><h2>${esc(title)}</h2>${subtitle ? `<p>${esc(subtitle)}</p>` : ""}</div><button class="modal-close" data-close-modal type="button" aria-label="閉じる">×</button></header><div class="modal-body">${body}</div>${actions ? `<footer class="modal-actions">${actions}</footer>` : ""}`;
  }

  function competitionById(state, id) { return state.competitions.find((item) => item.id === id); }
  function matchById(state, id) {
    for (const competition of state.competitions) {
      const found = Model.buildMatches(state, competition.id).find((match) => match.id === id);
      if (found) return found;
    }
    return null;
  }

  function clearCompetitionMatchData(state, competitionId) {
    Object.keys(state.results).forEach((id) => { if (id.startsWith(`${competitionId}__`)) delete state.results[id]; });
    Object.keys(state.schedule).forEach((id) => { if (id.startsWith(`${competitionId}__`)) delete state.schedule[id]; });
  }

  function competitionStageData(state, competitionId) {
    return {
      draw: Boolean(state.draws[competitionId]),
      schedules: Object.entries(state.schedule).filter(([id, assignment]) => id.startsWith(`${competitionId}__`) || assignment.competitionId === competitionId).length,
      results: Object.keys(state.results).filter((id) => id.startsWith(`${competitionId}__`)).length,
    };
  }

  function stageIsLocked(state, competitionId, stage) {
    const data = competitionStageData(state, competitionId);
    if (stage === "entry") return data.draw || data.schedules > 0 || data.results > 0;
    if (stage === "draw") return data.schedules > 0 || data.results > 0;
    if (stage === "schedule") return data.results > 0;
    return false;
  }

  function confirmStageReset(competitionIds, stage) {
    const ids = [...new Set(competitionIds)].filter(Boolean);
    const lockedIds = ids.filter((id) => stageIsLocked(store.state, id, stage));
    if (!lockedIds.length) return true;
    const totals = lockedIds.reduce((sum, id) => {
      const data = competitionStageData(store.state, id);
      sum.draws += data.draw ? 1 : 0; sum.schedules += data.schedules; sum.results += data.results;
      return sum;
    }, { draws: 0, schedules: 0, results: 0 });
    const competitionNames = lockedIds.map((id) => competitionById(store.state, id)).filter(Boolean).map((item) => item.name).join("・");
    const stageName = { entry: "エントリー", draw: "組み合わせ", schedule: "試合日程" }[stage] || "前段階";
    const resetItems = [];
    if (stage === "entry" && totals.draws) resetItems.push(`組み合わせ ${totals.draws}競技分`);
    if (["entry", "draw"].includes(stage) && totals.schedules) resetItems.push(`日程 ${totals.schedules}試合`);
    if (totals.results) resetItems.push(`勝敗結果 ${totals.results}試合`);
    return confirm(`${competitionNames}の${stageName}は、後続データがあるためロックされています。\n\n強制的に変更すると、${resetItems.join("、")}がリセットされます。\n\nロックを解除して変更しますか？`);
  }

  function clearResultsForCompetitions(state, competitionIds) {
    const ids = new Set(competitionIds);
    Object.keys(state.results).forEach((matchId) => {
      if ([...ids].some((competitionId) => matchId.startsWith(`${competitionId}__`))) delete state.results[matchId];
    });
  }

  function participantTeamButton(participant, competitionId, extraClass) {
    const label = Model.participantLabel(participant);
    if (participant.type !== "team") return `<span class="${extraClass || ""} unknown">${esc(label)}</span>`;
    return `<button type="button" class="${extraClass || ""}" data-team-result data-competition-id="${attr(competitionId)}" data-team-id="${attr(participant.team.id)}">${esc(label)}</button>`;
  }

  function currentRoute() {
    const name = location.hash.replace(/^#/, "").split("?")[0];
    return routeInfo[name] ? name : "live";
  }

  function setActiveNavigation() {
    document.querySelectorAll("[data-route]").forEach((link) => link.classList.toggle("active", link.dataset.route === ui.route));
  }

  function render() {
    const state = store.state;
    ui.route = currentRoute();
    document.getElementById("event-title").textContent = state.event.title;
    setActiveNavigation();
    if (ui.route === "live") renderLive(state);
    if (ui.route === "class-schedule") renderClassSchedule(state);
    if (ui.route === "competition-schedule") renderCompetitionSchedule(state);
    if (ui.route === "schedule") renderSchedule(state);
    if (ui.route === "competitions") renderCompetitions(state);
    if (ui.route === "entries") renderEntries(state);
    if (ui.route === "draw") renderDraw(state);
    sidebar.classList.remove("open");
  }

  function renderLive(state) {
    const competitions = state.competitions;
    const totalTeams = competitions.reduce((sum, competition) => sum + Model.teamsForCompetition(state, competition.id).length, 0);
    const allMatches = competitions.flatMap((competition) => Model.buildMatches(state, competition.id)).filter((match) => Model.isPlayableMatch(state, match));
    const completed = allMatches.filter((match) => state.results[match.id]).length;
    const scheduledNow = allMatches.filter((match) => {
      const assignment = state.schedule[match.id];
      if (!assignment) return false;
      const competition = competitionById(state, assignment.competitionId);
      const slot = competition && competition.slots.find((item) => item.id === assignment.slotId);
      const time = slot ? new Date(slot.start).getTime() : NaN;
      return Number.isFinite(time) && Math.abs(Date.now() - time) <= (competition.duration || 15) * 60000;
    }).length;
    if (!ui.liveCompetitionId || !competitionById(state, ui.liveCompetitionId)) ui.liveCompetitionId = competitions[0] ? competitions[0].id : "";
    const competition = competitionById(state, ui.liveCompetitionId);

    let html = `<div class="page">${pageHead("live", `<a class="button secondary" href="#class-schedule">クラス別予定</a>`)}
      <section class="stat-row">
        <div class="card stat"><span>競技数</span><strong>${competitions.length}</strong><small>種目</small></div>
        <div class="card stat"><span>エントリー</span><strong>${totalTeams}</strong><small>チーム</small></div>
        <div class="card stat"><span>完了試合</span><strong>${completed}<small> / ${allMatches.length}</small></strong><small>結果入力済み</small></div>
        <div class="card stat"><span>現在枠</span><strong>${scheduledNow}</strong><small>試合</small></div>
      </section>`;
    if (!competitions.length) {
      html += emptyState("◇", "競技がまだありません", "競技設定から最初の競技を追加してください。", `<a class="button primary" href="#competitions">競技設定へ</a>`);
      app.innerHTML = `${html}</div>`;
      return;
    }
    html += `<div class="filters"><div class="tabs">${competitions.map((item) => `<button class="tab ${item.id === competition.id ? "active" : ""}" type="button" data-live-competition="${attr(item.id)}">${esc(item.name)}</button>`).join("")}</div></div>`;
    const draw = state.draws[competition.id];
    if (!draw) {
      html += emptyState("⑂", `${competition.name}の組み合わせは未作成です`, "エントリー確定後、組み合わせ画面で対戦表を作成してください。", `<a class="button primary" href="#draw">組み合わせへ</a>`);
    } else {
      const progress = Model.competitionProgress(state, competition.id);
      html += `<section class="card live-competition"><div class="competition-color" style="--comp-color:${attr(competition.color)}"></div><div class="card-head"><div><h2>${esc(competition.name)}</h2><p>${esc(Model.FORMAT_LABELS[competition.format])} ・ ${progress.completed}/${progress.total}試合完了</p></div><span class="badge ${progress.remaining ? "live" : "done"}"><i class="dot"></i>${progress.remaining ? `残り ${progress.remaining}試合` : "全試合終了"}</span></div>`;
      if (draw.league) html += renderLeague(state, competition, draw);
      if (draw.tournament) {
        html += renderBracket(state, competition, draw);
      }
      html += `</section>`;
      const unscheduled = Model.buildMatches(state, competition.id).filter((match) => Model.isPlayableMatch(state, match) && !state.schedule[match.id] && !state.results[match.id]).slice(0, 8);
      if (unscheduled.length) {
        html += `<section class="card" style="margin-top:18px"><div class="card-head"><div><h3>未割り振りの試合</h3><p>日程画面から会場と時刻を指定できます</p></div><a href="#schedule" class="button secondary small">日程を開く</a></div><div class="card-body match-list">${unscheduled.map((match) => renderCompactMatch(state, match)).join("")}</div></section>`;
      }
    }
    app.innerHTML = `${html}</div>`;
    requestAnimationFrame(refreshBracketGraphics);
  }

  function renderCompactMatch(state, match) {
    const participants = Model.participantsForMatch(state, match);
    const result = state.results[match.id];
    return `<div class="match-row"><span class="match-no">試合 ${match.number}</span><span class="team-a ${result && result.winnerSide === "a" ? "winner" : ""}">${esc(Model.participantLabel(participants.a))}</span><span class="versus">${result ? `${esc(result.scoreA)} - ${esc(result.scoreB)}` : "vs"}</span><span class="${result && result.winnerSide === "b" ? "winner" : ""}">${esc(Model.participantLabel(participants.b))}</span><button type="button" class="button small ${result ? "secondary" : "primary"} result-button" data-result-match="${attr(match.id)}">${result ? "結果を修正" : "結果入力"}</button></div>`;
  }

  function renderLeague(state, competition, draw) {
    const matches = Model.buildMatches(state, competition.id).filter((match) => match.phase === "league");
    let html = `<div class="card-body"><div class="grid ${draw.league.groups.length > 1 ? "two" : ""}">`;
    draw.league.groups.forEach((group) => {
      const teams = group.slots.map((source) => Model.resolveSource(state, competition.id, source)).filter((participant) => participant.type === "team");
      const standings = Model.leagueStandings(state, competition.id, group.id);
      const matchLookup = new Map();
      matches.filter((match) => match.groupId === group.id).forEach((match) => {
        const p = Model.participantsForMatch(state, match);
        if (p.a.type === "team" && p.b.type === "team") {
          matchLookup.set(`${p.a.team.id}|${p.b.team.id}`, { match, side: "a" });
          matchLookup.set(`${p.b.team.id}|${p.a.team.id}`, { match, side: "b" });
        }
      });
      html += `<div><div class="card-head" style="padding-inline:0"><div><h3>${esc(group.name)} リーグ</h3><p>勝点 → 得失点差 → 総得点の順</p></div></div><div class="table-wrap"><table class="data-table league-table"><thead><tr><th>チーム</th>${teams.map((team) => `<th>${esc(team.team.name)}</th>`).join("")}<th>勝点</th><th>順位</th></tr></thead><tbody>`;
      teams.forEach((participant) => {
        const row = standings.find((item) => item.team.id === participant.team.id);
        const rank = standings.findIndex((item) => item.team.id === participant.team.id) + 1;
        html += `<tr><td class="team-cell">${participantTeamButton(participant, competition.id, "button ghost small")}</td>`;
        teams.forEach((opponent) => {
          if (opponent.team.id === participant.team.id) {
            html += `<td class="league-result-cell"><span class="league-result-button self">—</span></td>`;
            return;
          }
          const found = matchLookup.get(`${participant.team.id}|${opponent.team.id}`);
          const result = found && state.results[found.match.id];
          let value = "・"; let cls = "";
          if (result) {
            const won = result.winnerSide === found.side;
            value = won ? "○" : "●";
            cls = won ? "win" : "loss";
          }
          html += `<td class="league-result-cell"><button class="league-result-button ${cls}" type="button" data-result-match="${attr(found.match.id)}">${value}</button></td>`;
        });
        html += `<td><strong>${row ? row.points : 0}</strong></td><td><strong>${rank || "-"}</strong></td></tr>`;
      });
      html += `</tbody></table></div></div>`;
    });
    return `${html}</div></div>`;
  }

  function applyBracketZoom() {
    document.querySelectorAll(".pdf-bracket-scroll").forEach((scroller) => {
      const bracket = scroller.querySelector(".pdf-bracket");
      if (!bracket) return;
      bracket.style.zoom = "1";
      if (ui.bracketZoom === "fit") {
        const available = Math.max(320, scroller.clientWidth - 18);
        const scale = Math.min(1, available / bracket.scrollWidth);
        bracket.style.zoom = String(Math.max(.42, scale));
        scroller.scrollLeft = 0;
      } else {
        bracket.style.zoom = "1.35";
      }
    });
  }

  function refreshBracketGraphics() {
    document.querySelectorAll(".pdf-bracket").forEach((bracket) => { bracket.style.zoom = "1"; });
    drawBracketConnectors();
    applyBracketZoom();
  }

  function tournamentEliminatedTeamIds(state, matches) {
    const eliminated = new Set();
    matches.forEach((match) => {
      const result = state.results[match.id];
      if (!result || !["a", "b"].includes(result.winnerSide)) return;
      const participants = Model.participantsForMatch(state, match);
      const loser = participants[result.winnerSide === "a" ? "b" : "a"];
      if (loser && loser.type === "team") eliminated.add(loser.team.id);
    });
    return eliminated;
  }

  function tournamentAdvancedSeedMatchIds(state, matches) {
    const matchMap = new Map(matches.map((match) => [match.id, match]));
    const advancedSeeds = new Set();
    matches.forEach((match) => {
      const result = state.results[match.id];
      if (!result || !["a", "b"].includes(result.winnerSide)) return;
      const winningSource = result.winnerSide === "a" ? match.sourceA : match.sourceB;
      if (!winningSource || winningSource.type !== "matchWinner") return;
      const sourceMatch = matchMap.get(winningSource.matchId);
      if (sourceMatch && !sourceMatch.number) advancedSeeds.add(sourceMatch.id);
    });
    return advancedSeeds;
  }

  function bracketSourceEditor(state, competition, draw, teams, source, slotIndex, extraClass) {
    return `<span class="bracket-team bracket-edit-team ${extraClass || ""}"><select data-draw-source data-competition-id="${attr(competition.id)}" data-phase="tournament" data-slot-index="${slotIndex}" aria-label="出場枠 ${slotIndex + 1}">${sourceOptions(state, competition, draw, teams, source, "tournament")}</select></span>`;
  }

  function renderBracketMatchCard(state, competition, match, side, position, eliminatedTeamIds, advancedSeedMatchIds, options) {
    const settings = options || {};
    const participants = Model.participantsForMatch(state, match);
    const result = state.results[match.id];
    const sideClass = `side-${side}`;
    const positionStyle = Number.isFinite(position) ? ` style="--match-y:${position}px"` : "";
    const isOpening = match.phase === "tournament" && match.round === 0;
    const layoutClass = side === "center"
      ? (match.phase === "placement" ? "placement-match" : "center-match")
      : (isOpening ? "opening-match" : "progression-match");
    if (!match.number) {
      const participantSide = match.sourceA.type !== "bye" ? "a" : "b";
      const participant = participants[participantSide];
      const isEliminated = participant.type === "team" && eliminatedTeamIds.has(participant.team.id);
      const isAdvanced = advancedSeedMatchIds.has(match.id);
      let content;
      if (settings.editable) {
        const slotIndex = match.index * 2 + (participantSide === "a" ? 0 : 1);
        content = bracketSourceEditor(state, competition, settings.draw, settings.teams, participantSide === "a" ? match.sourceA : match.sourceB, slotIndex, "seed-team");
      } else if (participant.type === "team" && !settings.readOnly) {
        content = `<button class="bracket-team seed-team ${isAdvanced ? "advanced" : ""} ${isEliminated ? "eliminated" : ""}" type="button" data-team-result data-competition-id="${attr(competition.id)}" data-team-id="${attr(participant.team.id)}"><span>${esc(participant.team.name)}</span></button>`;
      } else {
        content = `<span class="bracket-team ${participant.type === "team" ? "" : "unknown"} seed-team ${isAdvanced ? "advanced" : ""} ${isEliminated ? "eliminated" : ""}"><span>${esc(Model.participantLabel(participant))}</span></span>`;
      }
      return `<article class="bracket-match bracket-seed opening-match ${sideClass}" data-bracket-match="${attr(match.id)}" title="シード枠"${positionStyle}>${content}</article>`;
    }
    const resultClass = result ? `completed winner-${result.winnerSide}` : "";
    const numberNode = settings.editable || settings.readOnly
      ? `<span class="match-number" title="試合 ${match.number}">${match.number}</span>`
      : `<button class="match-number" type="button" data-result-match="${attr(match.id)}" title="試合 ${match.number} の結果入力">${match.number}</button>`;
    let html = `<article class="bracket-match ${layoutClass} ${sideClass} ${resultClass}" data-bracket-match="${attr(match.id)}"${positionStyle}>${numberNode}`;
    if (!isOpening) {
      if (match.phase === "placement") {
        const loserLabel = (source, participant) => {
          const sourceMatch = source && source.matchId ? matchById(state, source.matchId) : null;
          return sourceMatch && sourceMatch.number ? `${sourceMatch.number}の敗者` : Model.participantLabel(participant);
        };
        html += `<span class="placement-sources"><span>${esc(loserLabel(match.sourceA, participants.a))}</span><span>${esc(loserLabel(match.sourceB, participants.b))}</span></span>`;
      }
      return `${html}</article>`;
    }
    ["a", "b"].forEach((teamSide) => {
      const participant = participants[teamSide];
      const isWinner = result && result.winnerSide === teamSide;
      const label = Model.participantLabel(participant);
      const score = result ? (teamSide === "a" ? result.scoreA : result.scoreB) : "";
      if (settings.editable) {
        const slotIndex = match.index * 2 + (teamSide === "a" ? 0 : 1);
        html += bracketSourceEditor(state, competition, settings.draw, settings.teams, teamSide === "a" ? match.sourceA : match.sourceB, slotIndex, "");
      } else if (participant.type === "team" && !settings.readOnly) {
        const isEliminated = eliminatedTeamIds.has(participant.team.id);
        html += `<button class="bracket-team ${isWinner ? "winner advanced" : ""} ${isEliminated ? "eliminated" : ""}" type="button" data-team-result data-competition-id="${attr(competition.id)}" data-team-id="${attr(participant.team.id)}"><span>${esc(label)}</span><span class="team-score">${esc(score)}</span></button>`;
      } else if (participant.type === "team") {
        const isEliminated = eliminatedTeamIds.has(participant.team.id);
        html += `<span class="bracket-team ${isWinner ? "winner advanced" : ""} ${isEliminated ? "eliminated" : ""}"><span>${esc(label)}</span><span class="team-score">${esc(score)}</span></span>`;
      } else {
        html += settings.readOnly
          ? `<span class="bracket-team unknown ${isWinner ? "winner advanced" : ""}"><span>${esc(label)}</span><span class="team-score">${esc(score)}</span></span>`
          : `<button class="bracket-team unknown ${isWinner ? "winner advanced" : ""}" type="button" data-result-match="${attr(match.id)}"><span>${esc(label)}</span><span class="team-score">${esc(score)}</span></button>`;
      }
    });
    return `${html}</article>`;
  }

  function renderConsolationMatch(state, match, position, options) {
    const settings = options || {};
    const participants = Model.participantsForMatch(state, match);
    const result = state.results[match.id];
    const sourceLabel = (source) => {
      const sourceMatch = source && source.matchId ? matchById(state, source.matchId) : null;
      return sourceMatch && sourceMatch.number ? `${sourceMatch.number}の敗者` : "試合敗者";
    };
    const numberNode = settings.editable || settings.readOnly
      ? `<span class="consolation-number" title="試合 ${esc(match.number)}">${esc(match.number)}</span>`
      : `<button class="consolation-number" type="button" data-result-match="${attr(match.id)}" title="コンソレーション ${attr(match.number)} の結果入力">${esc(match.number)}</button>`;
    const sourceNode = (side) => {
      const participant = participants[side];
      const isWinner = result && result.winnerSide === side;
      const isLoser = result && result.winnerSide !== side;
      const title = participant.type === "team" ? `${sourceLabel(side === "a" ? match.sourceA : match.sourceB)}：${participant.team.name}` : sourceLabel(side === "a" ? match.sourceA : match.sourceB);
      return `<span class="consolation-source source-${side} ${isWinner ? "winner" : ""} ${isLoser ? "lost" : ""}" title="${attr(title)}"><span>${esc(sourceLabel(side === "a" ? match.sourceA : match.sourceB))}</span></span>`;
    };
    return `<article class="consolation-match ${result ? `completed winner-${result.winnerSide}` : ""}" data-bracket-match="${attr(match.id)}" style="--match-y:${position}px">${sourceNode("a")}${sourceNode("b")}${numberNode}</article>`;
  }

  function renderBracket(state, competition, draw, options) {
    const settings = options || {};
    const allMatches = Model.buildMatches(state, competition.id);
    const matches = allMatches.filter((match) => match.phase === "tournament");
    const placement = allMatches.find((match) => match.phase === "placement");
    const consolation = allMatches.filter((match) => match.phase === "consolation").sort((a, b) => a.index - b.index);
    const eliminatedTeamIds = tournamentEliminatedTeamIds(state, matches);
    const advancedSeedMatchIds = tournamentAdvancedSeedMatchIds(state, matches);
    const roundCount = Math.log2(draw.tournament.size);
    const rounds = Array.from({ length: roundCount }, (_, round) => matches.filter((match) => match.round === round).sort((a, b) => a.index - b.index));
    const openingRound = rounds[0] || [];
    const openingHalf = Math.floor(openingRound.length / 2);
    const slotStep = 36;
    const matchPositions = new Map();
    const positionOpeningMatches = (roundMatches) => {
      let cursor = 0;
      roundMatches.forEach((match) => {
        const visibleSlots = match.number ? 2 : 1;
        matchPositions.set(match.id, cursor + (visibleSlots * slotStep / 2));
        cursor += visibleSlots * slotStep;
      });
      return cursor;
    };
    const leftHeight = positionOpeningMatches(openingRound.slice(0, openingHalf));
    const rightHeight = positionOpeningMatches(openingRound.slice(openingHalf));
    for (let round = 1; round < roundCount; round += 1) {
      rounds[round].forEach((match) => {
        const sourcePositions = [match.sourceA, match.sourceB]
          .filter((source) => source && (source.type === "matchWinner" || source.type === "matchLoser"))
          .map((source) => matchPositions.get(source.matchId))
          .filter(Number.isFinite);
        if (sourcePositions.length) matchPositions.set(match.id, sourcePositions.reduce((sum, value) => sum + value, 0) / sourcePositions.length);
      });
    }
    const mainHeight = Math.max(360, leftHeight, rightHeight);
    const consolationStep = 72;
    const consolationHeight = consolation.length ? consolation.length * consolationStep : mainHeight;
    const bracketHeight = Math.max(mainHeight, consolationHeight);
    let html = `<div class="bracket-scroll pdf-bracket-scroll"><div class="bracket pdf-bracket" style="--bracket-height:${bracketHeight}px;--main-height:${mainHeight}px;--consolation-height:${consolationHeight}px" data-bracket="${attr(competition.id)}"><svg class="bracket-svg" aria-hidden="true"></svg><div class="bracket-main"><div class="bracket-paper-title">${esc(competition.name)}トーナメント</div>`;

    for (let round = 0; round < roundCount - 1; round += 1) {
      const roundMatches = rounds[round];
      const half = Math.floor(roundMatches.length / 2);
      html += `<div class="bracket-round bracket-branch left-branch" data-round="${round}" data-side="left"><span class="round-title">${esc(roundMatches[0] ? roundMatches[0].roundName : "")}</span>${roundMatches.slice(0, half).map((match) => renderBracketMatchCard(state, competition, match, "left", matchPositions.get(match.id), eliminatedTeamIds, advancedSeedMatchIds, settings)).join("")}</div>`;
    }

    const finalMatch = rounds[roundCount - 1] && rounds[roundCount - 1][0];
    const champion = finalMatch ? Model.winnerOfMatch(state, finalMatch) : null;
    const finalPosition = finalMatch ? matchPositions.get(finalMatch.id) : bracketHeight / 2;
    const placementPosition = Math.max(finalPosition + 120, mainHeight - slotStep);
    html += `<div class="bracket-center"><span class="bracket-outcome-label champion-label" style="--match-y:${finalPosition}px">優勝${champion && champion.type === "team" ? `　${esc(champion.team.name)}` : ""}</span>${finalMatch ? renderBracketMatchCard(state, competition, finalMatch, "center", finalPosition, eliminatedTeamIds, advancedSeedMatchIds, settings) : ""}${placement ? `<span class="bracket-outcome-label placement-label" style="--match-y:${placementPosition}px">3位</span>${renderBracketMatchCard(state, competition, placement, "center", placementPosition, eliminatedTeamIds, advancedSeedMatchIds, settings)}` : ""}</div>`;

    for (let round = roundCount - 2; round >= 0; round -= 1) {
      const roundMatches = rounds[round];
      const half = Math.floor(roundMatches.length / 2);
      html += `<div class="bracket-round bracket-branch right-branch" data-round="${round}" data-side="right"><span class="round-title">${esc(roundMatches[half] ? roundMatches[half].roundName : "")}</span>${roundMatches.slice(half).map((match) => renderBracketMatchCard(state, competition, match, "right", matchPositions.get(match.id), eliminatedTeamIds, advancedSeedMatchIds, settings)).join("")}</div>`;
    }
    html += `</div>`;
    if (consolation.length) {
      html += `<aside class="consolation-branch" aria-label="コンソレーション試合">${consolation.map((match, index) => renderConsolationMatch(state, match, index * consolationStep + consolationStep / 2, settings)).join("")}</aside>`;
    }
    const toolbarText = settings.editable ? ["対戦表から出場枠を編集", "チーム名を選択すると入れ替えできます"] : settings.readOnly ? ["試合番号を確認", "数値・かな番号を日程表へ配置します"] : ["PDF準拠の対戦表", "右側にコンソレーション「あ〜た」を表示します"];
    const toolbar = `<div class="bracket-view-toolbar"><div><strong>${toolbarText[0]}</strong><span>${toolbarText[1]}</span></div><div class="tabs"><button class="tab ${ui.bracketZoom === "fit" ? "active" : ""}" type="button" data-bracket-zoom="fit">全体表示</button><button class="tab ${ui.bracketZoom === "detail" ? "active" : ""}" type="button" data-bracket-zoom="detail">拡大表示</button></div></div>`;
    return `${toolbar}${html}</div></div>`;
  }

  function drawBracketConnectors() {
    document.querySelectorAll("[data-bracket]").forEach((bracket) => {
      const svg = bracket.querySelector(".bracket-svg");
      if (!svg) return;
      const box = bracket.getBoundingClientRect();
      const width = bracket.scrollWidth; const height = bracket.scrollHeight;
      svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
      svg.innerHTML = "";
      const elements = new Map(Array.from(bracket.querySelectorAll("[data-bracket-match]")).map((node) => [node.dataset.bracketMatch, node]));
      const competitionId = bracket.dataset.bracket;
      const targets = Model.buildMatches(store.state, competitionId).filter((match) => match.phase === "tournament" && match.round > 0);
      targets.forEach((targetMatch) => {
        const target = elements.get(targetMatch.id);
        if (!target) return;
        [targetMatch.sourceA, targetMatch.sourceB].forEach((sourceRef, sourceIndex) => {
          if (!sourceRef || sourceRef.type !== "matchWinner") return;
          const source = elements.get(sourceRef.matchId);
          if (!source) return;
          const s = source.getBoundingClientRect(); const t = target.getBoundingClientRect();
          const movesRight = s.left + s.width / 2 < t.left + t.width / 2;
          const x1 = (movesRight ? s.right : s.left) - box.left;
          const y1 = s.top - box.top + s.height / 2;
          const x2 = (movesRight ? t.left : t.right) - box.left;
          const y2 = t.top - box.top + t.height / 2;
          const sourceMatch = matchById(store.state, sourceRef.matchId);
          const sourceAdvanced = sourceMatch && store.state.results[sourceMatch.id];
          const targetResult = store.state.results[targetMatch.id];
          const winsTarget = targetResult && targetResult.winnerSide === (sourceIndex === 0 ? "a" : "b");
          const horizontal = document.createElementNS("http://www.w3.org/2000/svg", "path");
          horizontal.setAttribute("d", `M ${x1} ${y1} H ${x2}`);
          horizontal.setAttribute("class", `connector connector-horizontal ${sourceAdvanced ? "advanced" : ""}`);
          horizontal.dataset.sourceMatch = sourceMatch ? sourceMatch.id : "";
          horizontal.dataset.targetMatch = targetMatch.id;
          svg.appendChild(horizontal);
          const vertical = document.createElementNS("http://www.w3.org/2000/svg", "path");
          vertical.setAttribute("d", `M ${x2} ${y1} V ${y2}`);
          vertical.setAttribute("class", `connector connector-vertical ${winsTarget ? "advanced" : ""}`);
          vertical.dataset.sourceMatch = sourceMatch ? sourceMatch.id : "";
          vertical.dataset.targetMatch = targetMatch.id;
          vertical.dataset.targetSide = sourceIndex === 0 ? "a" : "b";
          svg.appendChild(vertical);
        });
      });
    });
  }

  function renderCompetitions(state) {
    const cards = state.competitions.map((competition) => {
      const teamCount = Model.teamsForCompetition(state, competition.id).length;
      return `<article class="card competition-card"><div class="competition-color" style="--comp-color:${attr(competition.color)}"></div><div class="card-head"><div><h2>${esc(competition.name)}</h2><p><span class="badge format">${esc(Model.FORMAT_LABELS[competition.format])}</span></p></div></div><div class="card-body"><div class="meta-list"><div><span>会場</span><strong>${competition.venues.length}か所</strong></div><div><span>試合枠</span><strong>${competition.slots.length}枠 × ${competition.duration}分</strong></div><div><span>エントリー</span><strong>${teamCount}チーム</strong></div><div><span>開始</span><strong>${competition.slots[0] ? formatSlot(competition.slots[0], true) : "未設定"}</strong></div></div><div class="card-actions"><button class="button danger small" type="button" data-delete-competition="${attr(competition.id)}">削除</button><button class="button secondary small" type="button" data-edit-competition="${attr(competition.id)}">編集</button></div></div></article>`;
    }).join("");
    app.innerHTML = `<div class="page">${pageHead("competitions", `<button class="button primary" type="button" data-add-competition>＋ 競技を追加</button>`)}${cards ? `<div class="grid three">${cards}</div>` : emptyState("◇", "競技を追加してください", "競技名、方式、会場、時間枠をまとめて設定できます。", `<button class="button primary" type="button" data-add-competition>最初の競技を追加</button>`)}</div>`;
  }

  function openCompetitionModal(competition) {
    const isEdit = Boolean(competition);
    const firstSlot = competition && competition.slots[0];
    const defaultStart = firstSlot ? firstSlot.start : Model.localDateTime(new Date(Date.now() + 86400000));
    const body = `<form id="competition-form" class="form-grid">
      <div class="field"><label for="competition-name">競技名</label><input id="competition-name" name="name" class="input" required maxlength="40" value="${attr(competition ? competition.name : "")}" placeholder="例：オセロ"></div>
      <div class="field"><label for="competition-format">競技方式</label><select id="competition-format" name="format" class="select">${Object.entries(Model.FORMAT_LABELS).map(([value, label]) => `<option value="${value}" ${competition && competition.format === value ? "selected" : ""}>${esc(label)}</option>`).join("")}</select></div>
      <div class="field"><label for="competition-duration">1試合枠（分）</label><input id="competition-duration" name="duration" class="input" type="number" min="1" max="180" required value="${competition ? competition.duration : 15}"></div>
      <div class="field"><label for="competition-color">表示色</label><input id="competition-color" name="color" class="input" type="color" value="${attr(competition ? competition.color : Model.COLORS[0])}"></div>
      <div class="field full"><label for="competition-venues">会場名（1行に1会場）</label><textarea id="competition-venues" name="venues" class="textarea" required placeholder="体育館Aコート&#10;体育館Bコート">${esc(competition ? competition.venues.map((venue) => venue.name).join("\n") : "第1会場\n第2会場")}</textarea></div>
      <div class="field"><label for="competition-start">最初の試合枠</label><input id="competition-start" name="start" class="input" type="datetime-local" value="${attr(defaultStart)}"></div>
      <div class="field"><label for="competition-slot-count">枠数</label><input id="competition-slot-count" name="slotCount" class="input" type="number" min="1" max="200" value="${competition ? competition.slots.length : 12}"><small>開始時刻から等間隔で生成します</small></div>
      <div class="field full"><label for="competition-slot-times">個別の試合枠（任意・1行に1つ）</label><textarea id="competition-slot-times" name="slotTimes" class="textarea" placeholder="2026-09-12T09:00&#10;2026-09-12T09:20">${esc(competition ? competition.slots.map((slot) => slot.start).join("\n") : "")}</textarea><small>ここに入力がある場合は、上の開始時刻・枠数より優先します。不規則な時間割にも対応できます。</small></div>
    </form>`;
    const actions = `<button class="button secondary" data-close-modal type="button">キャンセル</button><button class="button primary" type="submit" form="competition-form" data-save-competition="${attr(competition ? competition.id : "")}">${isEdit ? "変更を保存" : "競技を追加"}</button>`;
    showModal(modalFrame(isEdit ? "競技設定を編集" : "競技を追加", "会場名と試合枠はあとから変更できます", body, actions), true);
  }

  function renderEntries(state) {
    const classes = state.classes;
    const competitions = state.competitions;
    const hasLockedEntries = competitions.some((competition) => stageIsLocked(state, competition.id, "entry"));
    let content;
    if (!competitions.length) {
      content = emptyState("＋", "先に競技を作成してください", "エントリー数は競技ごとに設定します。", `<a class="button primary" href="#competitions">競技設定へ</a>`);
    } else if (!classes.length) {
      content = emptyState("組", "クラスを追加してください", "クラスを追加するとエントリー表が表示されます。", `<button class="button primary" type="button" data-add-class>クラスを追加</button>`);
    } else {
      content = `${hasLockedEntries ? `<div class="info-box stage-lock-notice">後続データがある競技のエントリーは保護されています。変更操作をすると、リセット対象を示してロック解除を確認します。</div>` : ""}<section class="card"><div class="table-wrap"><table class="data-table"><thead><tr><th class="sticky-col">クラス</th>${competitions.map((competition) => `<th class="center">${esc(competition.name)}${stageIsLocked(state, competition.id, "entry") ? `<br><span class="badge locked">ロック中</span>` : ""}</th>`).join("")}<th>生成されるチーム名</th></tr></thead><tbody>${classes.map((classInfo) => {
        const previews = [];
        const cells = competitions.map((competition) => {
          const count = Number((state.entries[competition.id] || {})[classInfo.id]) || 0;
          if (count) {
            const names = Array.from({ length: count }, (_, index) => count === 1 ? classInfo.name : `${classInfo.name}${Model.TEAM_SUFFIXES[index] || `(${index + 1})`}`);
            previews.push(`${competition.name}: ${names.join("・")}`);
          }
          return `<td class="center"><select class="entry-count ${stageIsLocked(state, competition.id, "entry") ? "locked-control" : ""}" data-entry-count data-competition-id="${attr(competition.id)}" data-class-id="${attr(classInfo.id)}" aria-label="${attr(classInfo.name)} ${attr(competition.name)} エントリー数">${[0,1,2,3].map((value) => `<option value="${value}" ${value === count ? "selected" : ""}>${value}</option>`).join("")}</select></td>`;
        }).join("");
        return `<tr><td class="sticky-col nowrap"><strong>${esc(classInfo.name)}</strong> <button class="button ghost small" type="button" data-delete-class="${attr(classInfo.id)}" aria-label="${attr(classInfo.name)}を削除">×</button></td>${cells}<td class="team-preview">${previews.length ? esc(previews.join(" / ")) : "エントリーなし"}</td></tr>`;
      }).join("")}</tbody></table></div></section>`;
    }
    app.innerHTML = `<div class="page">${pageHead("entries", `<button class="button secondary" type="button" data-add-class>＋ クラスを追加</button>`)}<section class="card" style="margin-bottom:18px"><div class="card-head"><div><h3>クラス</h3><p>同じ競技に複数出場する場合だけ、末尾に ①・②・③ が付きます</p></div></div><div class="card-body class-list">${classes.map((classInfo) => `<span class="class-chip">${esc(classInfo.name)}<button type="button" data-delete-class="${attr(classInfo.id)}">×</button></span>`).join("") || "<span class='page-lead'>未登録</span>"}</div></section>${content}</div>`;
  }

  function openClassModal() {
    showModal(modalFrame("クラスを追加", "例：1A、2B、教職員", `<form id="class-form" class="field"><label for="class-name">クラス名</label><input id="class-name" name="name" class="input" required maxlength="20" autocomplete="off"></form>`, `<button class="button secondary" type="button" data-close-modal>キャンセル</button><button class="button primary" type="submit" form="class-form">追加</button>`));
  }

  function renderDraw(state) {
    const competitions = state.competitions;
    if (!ui.drawCompetitionId || !competitionById(state, ui.drawCompetitionId)) ui.drawCompetitionId = competitions[0] ? competitions[0].id : "";
    const competition = competitionById(state, ui.drawCompetitionId);
    if (!competition) {
      app.innerHTML = `<div class="page">${pageHead("draw")}${emptyState("⑂", "競技がありません", "競技設定から競技を追加してください。", `<a class="button primary" href="#competitions">競技設定へ</a>`)}</div>`;
      return;
    }
    const teams = Model.teamsForCompetition(state, competition.id);
    const draw = state.draws[competition.id];
    const drawLocked = stageIsLocked(state, competition.id, "draw");
    const tabs = `<div class="tabs">${competitions.map((item) => `<button class="tab ${item.id === competition.id ? "active" : ""}" type="button" data-draw-competition="${attr(item.id)}">${esc(item.name)}</button>`).join("")}</div>`;
    let content;
    if (!teams.length) {
      content = emptyState("＋", `${competition.name}のエントリーがありません`, "エントリー画面で出場数を設定してください。", `<a class="button primary" href="#entries">エントリーへ</a>`);
    } else if (!draw) {
      content = emptyState("⑂", "組み合わせ表を作成", `${teams.length}チームの出場枠を自動作成します。作成後にすべて手動調整できます。`, `<button class="button primary" type="button" data-create-draw="${attr(competition.id)}">組み合わせを作成</button>`);
    } else {
      let editor = "";
      if (draw.league) editor += renderLeagueAssignments(state, competition, draw, teams);
      if (draw.tournament) editor += renderTournamentAssignments(state, competition, draw, teams);
      content = `<div class="stack">${editor}</div>`;
    }
    const lockNotice = drawLocked ? `<div class="warning-box stage-lock-notice"><strong>組み合わせをロック中</strong><br>日程または勝敗結果が登録されています。変更操作をすると、リセット対象を示してロック解除を確認します。</div>` : "";
    app.innerHTML = `<div class="page">${pageHead("draw", `<a class="button secondary" href="#schedule">日程へ進む</a>`)}<div class="filters">${tabs}${drawLocked ? `<span class="badge locked">ロック中</span>` : ""}</div>${lockNotice}${content}</div>`;
    if (draw && draw.tournament) requestAnimationFrame(refreshBracketGraphics);
  }

  function sourceOptions(state, competition, draw, teams, selected, phase) {
    const options = [{ key: "empty", label: "未設定" }];
    if (phase === "tournament") options.push({ key: "bye", label: "シード（不戦勝）" });
    teams.forEach((team) => options.push({ key: `team:${team.id}`, label: team.name }));
    if (phase === "tournament" && draw.league) {
      draw.league.groups.forEach((group) => {
        for (let rank = 1; rank <= Math.min(2, group.slots.length); rank += 1) options.push({ key: `rank:${group.id}:${rank}`, label: `${group.name} ${rank}位` });
      });
    }
    const selectedKey = Model.sourceKey(selected);
    return options.map((option) => `<option value="${attr(option.key)}" ${option.key === selectedKey ? "selected" : ""}>${esc(option.label)}</option>`).join("");
  }

  function renderLeagueAssignments(state, competition, draw, teams) {
    return `<section class="card draw-section"><div class="draw-toolbar"><div class="field"><label>リーグ数</label><select class="select" data-league-group-count="${attr(competition.id)}">${[1,2,3,4,5,6,7,8].map((count) => `<option value="${count}" ${count === draw.league.groupCount ? "selected" : ""}>${count}</option>`).join("")}</select></div><button class="button secondary" type="button" data-auto-league="${attr(competition.id)}">チームを再配置</button></div><div class="group-grid">${draw.league.groups.map((group, groupIndex) => `<div class="group-box"><div class="group-title">${esc(group.name)}</div><div class="assignment-list">${group.slots.map((source, slotIndex) => `<div class="assignment-row"><label>出場枠 ${slotIndex + 1}</label><select class="select" data-draw-source data-competition-id="${attr(competition.id)}" data-phase="league" data-group-index="${groupIndex}" data-slot-index="${slotIndex}">${sourceOptions(state, competition, draw, teams, source, "league")}</select></div>`).join("")}</div></div>`).join("")}</div></section>`;
  }

  function renderTournamentAssignments(state, competition, draw, teams) {
    const sizes = [2,4,8,16,32,64].filter((size) => size >= Math.min(teams.length, 64) || size === draw.tournament.size);
    return `<section class="card draw-section draw-bracket-editor"><div class="draw-toolbar"><div class="field"><label>トーナメント枠</label><select class="select" data-tournament-size="${attr(competition.id)}">${sizes.map((size) => `<option value="${size}" ${size === draw.tournament.size ? "selected" : ""}>${size}枠</option>`).join("")}</select></div><button class="button secondary" type="button" data-auto-tournament="${attr(competition.id)}">バランス配置</button></div>${renderBracket(state, competition, draw, { editable: true, draw, teams })}</section>`;
  }

  function renderScheduleMatrix(state, competition, matches, conflictIds) {
    const matchByCell = new Map();
    Object.entries(state.schedule).forEach(([matchId, assignment]) => {
      if (assignment.competitionId === competition.id && assignment.slotId && assignment.venueId) matchByCell.set(`${assignment.slotId}|${assignment.venueId}`, matchId);
    });
    const days = new Map();
    competition.slots.slice().sort((a, b) => new Date(a.start) - new Date(b.start)).forEach((slot) => {
      const day = scheduleDay(slot);
      if (!days.has(day.key)) days.set(day.key, { label: day.label, slots: [] });
      days.get(day.key).slots.push(slot);
    });
    const options = matches.slice().sort((a, b) => Model.matchNumberOrder(a.number) - Model.matchNumberOrder(b.number)).map((match) => {
      return { match, label: String(match.number) };
    });
    return `<div class="schedule-matrix-days">${[...days.values()].map((day) => `<section class="schedule-matrix-day"><h3>${esc(day.label)}</h3><div class="table-wrap"><table class="schedule-matrix-table"><thead><tr><th>時刻</th>${competition.venues.map((venue) => `<th>${esc(venue.name)}</th>`).join("")}</tr></thead><tbody>${day.slots.map((slot) => `<tr><th>${esc(formatDateTime(slot.start, false))}</th>${competition.venues.map((venue) => {
      const currentMatchId = matchByCell.get(`${slot.id}|${venue.id}`) || "";
      const completed = Boolean(currentMatchId && state.results[currentMatchId]);
      const conflict = currentMatchId && conflictIds.has(currentMatchId);
      return `<td class="${currentMatchId ? "assigned" : ""} ${completed ? "completed" : ""} ${conflict ? "conflict" : ""}"><select data-schedule-cell data-competition-id="${attr(competition.id)}" data-slot-id="${attr(slot.id)}" data-venue-id="${attr(venue.id)}" aria-label="${attr(day.label)} ${attr(formatDateTime(slot.start, false))} ${attr(venue.name)}"><option value="">—</option>${options.map((option) => `<option value="${attr(option.match.id)}" ${option.match.id === currentMatchId ? "selected" : ""}>${esc(option.label)}</option>`).join("")}</select></td>`;
    }).join("")}</tr>`).join("")}</tbody></table></div></section>`).join("")}</div>`;
  }

  function renderSchedule(state) {
    const competitions = state.competitions;
    if (!ui.scheduleCompetitionId || ui.scheduleCompetitionId === "all" || !competitionById(state, ui.scheduleCompetitionId)) ui.scheduleCompetitionId = competitions[0] ? competitions[0].id : "";
    const competition = competitionById(state, ui.scheduleCompetitionId);
    const competitionFilter = competitions.length ? `<select class="select" style="width:auto" data-schedule-filter>${competitions.map((item) => `<option value="${attr(item.id)}" ${item.id === ui.scheduleCompetitionId ? "selected" : ""}>${esc(item.name)}</option>`).join("")}</select>` : "";
    if (!competition) {
      app.innerHTML = `<div class="page">${pageHead("schedule")}${emptyState("◇", "競技がありません", "競技設定から競技を追加してください。", `<a class="button primary" href="#competitions">競技設定へ</a>`)}</div>`;
      return;
    }
    const draw = state.draws[competition.id];
    const matches = Model.buildMatches(state, competition.id).filter((match) => match.number && Model.isPlayableMatch(state, match));
    const matchIds = new Set(matches.map((match) => match.id));
    const conflicts = Model.scheduleConflicts(state, state.schedule).filter((issue) => issue.matches.some((id) => matchIds.has(id)));
    const conflictIds = new Set(conflicts.flatMap((issue) => issue.matches));
    const assigned = matches.filter((match) => state.schedule[match.id]).length;
    const scheduleLocked = stageIsLocked(state, competition.id, "schedule");
    const actions = `${competitionFilter}<button class="button accent" type="button" data-auto-schedule>自動割り振り</button><button class="button secondary" type="button" data-clear-schedule>割り振り解除</button>`;
    let content;
    if (!draw || !matches.length) {
      content = emptyState("◷", "割り振る試合がありません", "エントリーと組み合わせを先に作成してください。", `<a class="button primary" href="#draw">組み合わせへ</a>`);
    } else {
      const unassignedNumbers = matches.filter((match) => !state.schedule[match.id]).map((match) => match.number);
      const bracketReference = draw.tournament
        ? renderBracket(state, competition, draw, { readOnly: true })
        : `<div class="card-body match-list">${matches.map((match) => renderCompactMatch(state, match)).join("")}</div>`;
      content = `<div class="schedule-editor-split"><section class="card schedule-reference-card"><div class="card-head"><div><h2>${esc(competition.name)} トーナメント表</h2><p>試合番号を右の日程表へ配置します</p></div>${assigned ? `<span class="badge locked">試合番号ロック中</span>` : ""}</div>${bracketReference}</section><section class="card schedule-matrix-card"><div class="card-head"><div><h2>試合日程表</h2><p>${assigned}/${matches.length}試合を配置済み${unassignedNumbers.length ? ` ・ 未配置 ${unassignedNumbers.join("・")}` : ""}</p></div>${conflicts.length ? `<span class="badge waiting">要確認 ${conflicts.length}</span>` : `<span class="badge done">競合なし</span>`}</div><div class="card-body">${renderScheduleMatrix(state, competition, matches, conflictIds)}</div></section></div>`;
      if (conflicts.length) content += `<section class="card" style="margin-top:18px"><div class="card-head"><div><h3>割り振りの確認事項</h3><p>変更内容は保存されています。以下を確認してください。</p></div></div><div class="card-body stack">${conflicts.map((issue) => `<div class="warning-box">${esc(issue.message)}（${issue.matches.map((id) => { const match = matchById(state, id); return match ? `試合 ${match.number}` : id; }).join(" / ")}）</div>`).join("")}</div></section>`;
    }
    app.innerHTML = `<div class="page">${pageHead("schedule", actions)}<div class="info-box" style="margin-bottom:16px">左のトーナメント表で試合番号を確認し、右の表で行＝時刻、列＝会場のセルへ番号を配置します。日程がある間は、番号が変わらないよう組み合わせをロックします。</div>${scheduleLocked ? `<div class="warning-box stage-lock-notice"><strong>試合日程をロック中</strong><br>勝敗結果が登録されています。日程変更時は対象結果のリセットを確認します。</div>` : ""}${content}</div>`;
    if (draw && draw.tournament) requestAnimationFrame(refreshBracketGraphics);
  }

  function renderClassSchedule(state) {
    if (!ui.classId || !state.classes.some((item) => item.id === ui.classId)) ui.classId = state.classes[0] ? state.classes[0].id : "";
    const classInfo = state.classes.find((item) => item.id === ui.classId);
    let content;
    if (!classInfo) {
      content = emptyState("組", "クラスがありません", "エントリー画面でクラスを追加してください。", `<a class="button primary" href="#entries">エントリーへ</a>`);
    } else {
      const classTeamIds = new Set(state.competitions.flatMap((competition) => Model.teamsForCompetition(state, competition.id).filter((team) => team.classId === classInfo.id).map((team) => team.id)));
      const events = [];
      state.competitions.forEach((competition, competitionIndex) => {
        Model.buildMatches(state, competition.id).forEach((match) => {
          const assignment = state.schedule[match.id];
          if (!assignment) return;
          const possible = Model.possibleTeamsForMatch(state, match);
          if (![...possible].some((id) => classTeamIds.has(id))) return;
          const slot = competition.slots.find((item) => item.id === assignment.slotId);
          const venue = competition.venues.find((item) => item.id === assignment.venueId);
          if (!slot) return;
          const participants = Model.participantsForMatch(state, match);
          const definite = [participants.a, participants.b].some((participant) => participant.type === "team" && classTeamIds.has(participant.team.id));
          events.push({
            competition, match, slot, venue, participants,
            venueIndex: competition.venues.findIndex((item) => item.id === assignment.venueId),
            result: state.results[match.id],
            competitionIndex,
            possible: !definite,
            heading: `${competition.name}　試合 ${match.number}`,
          });
        });
      });
      events.sort((a,b) => new Date(a.slot.start) - new Date(b.slot.start));
      const columnCount = Math.min(4, Math.max(1, ...state.competitions.map((competition) => competition.venues.length)));
      const daySections = renderScheduleDays(events, state.competitions.flatMap((competition) => competition.slots), "class-schedule", viewPreferences.showPossible, { columnCount, alignByVenue: false });
      content = daySections || emptyState("◷", `${classInfo.name}の予定はまだありません`, "組み合わせ作成後、試合日程で割り振りを行ってください。", `<a class="button primary" href="#schedule">試合日程へ</a>`);
    }
    const selector = state.classes.length ? `<select class="select" data-class-filter>${state.classes.map((item) => `<option value="${attr(item.id)}" ${item.id === ui.classId ? "selected" : ""}>${esc(item.name)}</option>`).join("")}</select>` : "";
    const possibleToggle = classInfo ? `<button class="button secondary possible-toggle ${viewPreferences.showPossible ? "active" : ""}" type="button" data-toggle-possible aria-pressed="${viewPreferences.showPossible}">${viewPreferences.showPossible ? "進出時を非表示" : "進出時を表示"}</button>` : "";
    app.innerHTML = `<div class="page">${pageHead("class-schedule", `${selector}${possibleToggle}`)}${classInfo ? `<section class="card"><div class="card-head"><div><h2>${esc(classInfo.name)} の試合予定</h2><p>「進出時」は勝ち上がった場合に出場する可能性がある枠です</p></div></div><div class="card-body">${content}</div></section>` : content}</div>`;
  }

  function renderCompetitionSchedule(state) {
    if (!ui.competitionScheduleId || !competitionById(state, ui.competitionScheduleId)) ui.competitionScheduleId = state.competitions[0] ? state.competitions[0].id : "";
    const competition = competitionById(state, ui.competitionScheduleId);
    let content;
    if (!competition) {
      content = emptyState("◇", "競技がありません", "競技設定で競技を追加してください。", `<a class="button primary" href="#competitions">競技設定へ</a>`);
    } else {
      const events = [];
      Model.buildMatches(state, competition.id).forEach((match) => {
        const assignment = state.schedule[match.id];
        if (!assignment) return;
        const slot = competition.slots.find((item) => item.id === assignment.slotId);
        if (!slot) return;
        const venue = competition.venues.find((item) => item.id === assignment.venueId);
        const phaseName = match.phase === "league" ? match.groupName : match.roundName;
        events.push({
          competition, match, slot, venue,
          participants: Model.participantsForMatch(state, match),
          venueIndex: competition.venues.findIndex((item) => item.id === assignment.venueId),
          result: state.results[match.id],
          competitionIndex: state.competitions.findIndex((item) => item.id === competition.id),
          possible: false,
          heading: `${phaseName ? `${phaseName}　` : ""}試合 ${match.number}`,
        });
      });
      events.sort((a, b) => new Date(a.slot.start) - new Date(b.slot.start));
      const daySections = renderScheduleDays(events, competition.slots, "competition-schedule", true, { columnCount: competition.venues.length, venueHeaders: competition.venues });
      content = daySections || emptyState("◷", `${competition.name}の予定はまだありません`, "組み合わせ作成後、試合日程で割り振りを行ってください。", `<a class="button primary" href="#schedule">試合日程へ</a>`);
    }
    const selector = state.competitions.length ? `<select class="select" data-competition-schedule-filter>${state.competitions.map((item) => `<option value="${attr(item.id)}" ${item.id === ui.competitionScheduleId ? "selected" : ""}>${esc(item.name)}</option>`).join("")}</select>` : "";
    app.innerHTML = `<div class="page">${pageHead("competition-schedule", selector)}${competition ? `<section class="card"><div class="card-head"><div><h2>${esc(competition.name)} の試合予定</h2><p>割り振り済みの全試合を日ごとに表示します</p></div></div><div class="card-body">${content}</div></section>` : content}</div>`;
  }

  function parseSource(value) {
    if (value === "bye") return { type: "bye" };
    if (value === "empty") return { type: "empty" };
    if (value.startsWith("team:")) return { type: "team", teamId: value.slice(5) };
    if (value.startsWith("rank:")) {
      const parts = value.split(":");
      return { type: "leagueRank", groupId: parts[1], rank: Number(parts[2]) };
    }
    return { type: "empty" };
  }

  function balancedTournamentSources(state, competition, draw) {
    let sources;
    if (competition.format === "hybrid" && draw.league) {
      sources = [];
      for (let rank = 1; rank <= 2; rank += 1) draw.league.groups.forEach((group) => sources.push({ type: "leagueRank", groupId: group.id, rank }));
    } else {
      sources = Model.teamsForCompetition(state, competition.id).map((team) => ({ type: "team", teamId: team.id }));
    }
    const size = draw.tournament.size;
    sources = sources.slice(0, size);
    const byes = Math.max(0, size - sources.length);
    const slots = [];
    let cursor = 0;
    for (let pair = 0; pair < size / 2; pair += 1) {
      if (pair < byes && cursor < sources.length) {
        slots.push(sources[cursor++], { type: "bye" });
      } else {
        slots.push(sources[cursor++] || { type: "bye" }, sources[cursor++] || { type: "bye" });
      }
    }
    return slots;
  }

  function openResultModal(matchId, defaultTeamId) {
    const state = store.state;
    const match = matchById(state, matchId);
    if (!match) { toast("対戦情報が見つかりません", "error"); return; }
    const competition = competitionById(state, match.competitionId);
    const participants = Model.participantsForMatch(state, match);
    if (participants.a.type === "bye" || participants.b.type === "bye") {
      toast("シードのため結果入力は不要です");
      return;
    }
    const result = state.results[match.id];
    let defaultSide = result ? result.winnerSide : "";
    if (!defaultSide && defaultTeamId) {
      if (participants.a.type === "team" && participants.a.team.id === defaultTeamId) defaultSide = "a";
      if (participants.b.type === "team" && participants.b.team.id === defaultTeamId) defaultSide = "b";
    }
    const hasPending = participants.a.type === "pending" || participants.b.type === "pending";
    const body = `<form id="result-form">
      ${hasPending ? `<div class="warning-box" style="margin-bottom:16px">相手が未定でも先に入力できます。前提の試合結果が確定すると、チーム名がこの結果へ自動反映されます。</div>` : ""}
      <input type="hidden" name="winnerSide" value="${attr(defaultSide)}">
      <div class="result-teams">
        <label class="result-team ${defaultSide === "a" ? "selected" : ""}" data-winner-option="a"><button type="button" data-select-winner="a">${esc(Model.participantLabel(participants.a))}</button><input class="input" type="number" name="scoreA" step="any" value="${attr(result ? result.scoreA : "")}" placeholder="得点" aria-label="${attr(Model.participantLabel(participants.a))}の得点"></label>
        <strong>vs</strong>
        <label class="result-team ${defaultSide === "b" ? "selected" : ""}" data-winner-option="b"><button type="button" data-select-winner="b">${esc(Model.participantLabel(participants.b))}</button><input class="input" type="number" name="scoreB" step="any" value="${attr(result ? result.scoreB : "")}" placeholder="得点" aria-label="${attr(Model.participantLabel(participants.b))}の得点"></label>
      </div>
      <div class="info-box">勝った側のチーム名を選択してください。得点は空欄でも保存できます。</div>
    </form>`;
    const actions = `${result ? `<button class="button danger" type="button" data-cancel-result="${attr(match.id)}">結果を取り消す</button>` : ""}<button class="button secondary" type="button" data-close-modal>閉じる</button><button class="button primary" type="submit" form="result-form" data-save-result="${attr(match.id)}">結果を保存</button>`;
    showModal(modalFrame(`${competition.name}　試合 ${match.number}`, match.phase === "league" ? `${match.groupName} リーグ` : match.roundName, body, actions));
  }

  function openSyncModal() {
    const cfg = store.config;
    const body = `<form id="sync-form" class="stack"><div class="field"><label for="event-name-setting">イベント名</label><input id="event-name-setting" name="eventTitle" class="input" required maxlength="50" value="${attr(store.state.event.title)}"></div><div class="field"><label for="gas-endpoint">GASウェブアプリURL</label><input id="gas-endpoint" name="endpoint" class="input" type="url" value="${attr(cfg.endpoint)}" placeholder="https://script.google.com/macros/s/.../exec"><small>空欄のまま保存すると、この端末だけに保存します。</small></div><div class="field"><label for="gas-key">アクセスキー（GAS側で設定した場合のみ）</label><input id="gas-key" name="accessKey" class="input" value="${attr(cfg.accessKey)}" autocomplete="off"></div><div class="info-box">共有時は3秒ごとに更新を確認します。通信はGETと form-urlencoded のPOSTだけを使い、CORSプリフライトを発生させません。<br>配布用URLにはGAS URLだけを埋め込み、アクセスキーは含めません。</div></form>`;
    const actions = `${cfg.endpoint ? `<button class="button danger" type="button" data-disconnect>共有を解除</button><button class="button secondary" type="button" data-copy-distribution-url>配布用URLをコピー</button>` : ""}<button class="button secondary" type="button" data-close-modal>キャンセル</button><button class="button primary" type="submit" form="sync-form">設定を保存</button>`;
    showModal(modalFrame("共有・イベント設定", store.mode === "remote" ? "Googleスプレッドシートと共有中" : "現在はこの端末に保存しています", body, actions));
  }

  document.addEventListener("click", async (event) => {
    const target = event.target.closest("button,a,[data-close-modal]");
    if (!target) return;
    if (target.matches("[data-close-modal]") && (target === event.target || target.tagName === "BUTTON")) { closeModal(); return; }
    if (target.matches("[data-schedule-day-toggle]")) {
      const preferenceKey = `${target.dataset.scheduleView}:${target.dataset.dayKey}`;
      const open = target.getAttribute("aria-expanded") !== "true";
      viewPreferences.openDays[preferenceKey] = open;
      saveViewPreferences();
      target.setAttribute("aria-expanded", String(open));
      target.closest(".schedule-day").classList.toggle("open", open);
      const panel = document.getElementById(target.getAttribute("aria-controls"));
      if (panel) panel.hidden = !open;
      return;
    }
    if (target.matches("[data-toggle-possible]")) {
      viewPreferences.showPossible = !viewPreferences.showPossible;
      saveViewPreferences();
      render();
      return;
    }
    if (target.matches("[data-live-competition]")) { ui.liveCompetitionId = target.dataset.liveCompetition; render(); return; }
    if (target.matches("[data-bracket-zoom]")) {
      ui.bracketZoom = target.dataset.bracketZoom;
      document.querySelectorAll("[data-bracket-zoom]").forEach((button) => button.classList.toggle("active", button.dataset.bracketZoom === ui.bracketZoom));
      applyBracketZoom();
      return;
    }
    if (target.matches("[data-draw-competition]")) { ui.drawCompetitionId = target.dataset.drawCompetition; render(); return; }
    if (target.matches("[data-add-competition]")) { openCompetitionModal(null); return; }
    if (target.matches("[data-edit-competition]")) { openCompetitionModal(competitionById(store.state, target.dataset.editCompetition)); return; }
    if (target.matches("[data-delete-competition]")) {
      const competition = competitionById(store.state, target.dataset.deleteCompetition);
      if (competition && confirm(`${competition.name}と、関連する組み合わせ・結果・日程を削除しますか？`)) {
        await store.mutate((state) => { state.competitions = state.competitions.filter((item) => item.id !== competition.id); delete state.entries[competition.id]; delete state.draws[competition.id]; }, "競技削除");
        toast("競技を削除しました");
      }
      return;
    }
    if (target.matches("[data-add-class]")) { openClassModal(); return; }
    if (target.matches("[data-delete-class]")) {
      const classInfo = store.state.classes.find((item) => item.id === target.dataset.deleteClass);
      if (classInfo && confirm(`${classInfo.name}を削除しますか？\n\n全競技の組み合わせ・日程・勝敗結果がリセットされます。`)) {
        await store.mutate((state) => {
          state.classes = state.classes.filter((item) => item.id !== classInfo.id);
          state.competitions.forEach((competition) => {
            delete state.entries[competition.id][classInfo.id];
            delete state.draws[competition.id];
            clearCompetitionMatchData(state, competition.id);
          });
        }, "クラス削除");
        toast("クラスを削除しました");
      }
      return;
    }
    if (target.matches("[data-create-draw]")) {
      const id = target.dataset.createDraw;
      await store.mutate((state) => { state.draws[id] = Model.createDraw(state, id); }, "組み合わせ作成");
      toast("組み合わせを作成しました");
      return;
    }
    if (target.matches("[data-auto-league]")) {
      const id = target.dataset.autoLeague;
      if (!confirmStageReset([id], "draw")) return;
      await store.mutate((state) => {
        const draw = state.draws[id];
        Model.resizeLeague(draw, draw.league.groupCount, Model.teamsForCompetition(state, id));
        clearCompetitionMatchData(state, id);
      }, "リーグ再配置");
      return;
    }
    if (target.matches("[data-auto-tournament]")) {
      const id = target.dataset.autoTournament;
      if (!confirmStageReset([id], "draw")) return;
      await store.mutate((state) => {
        const competition = competitionById(state, id); const draw = state.draws[id];
        draw.tournament.slots = balancedTournamentSources(state, competition, draw);
        clearCompetitionMatchData(state, id);
      }, "トーナメント再配置");
      toast("シードが偏らないように配置しました");
      return;
    }
    if (target.matches("[data-result-match]")) { openResultModal(target.dataset.resultMatch); return; }
    if (target.matches("[data-team-result]")) {
      const match = Model.findLatestMatchForTeam(store.state, target.dataset.competitionId, target.dataset.teamId);
      if (match) openResultModal(match.id, target.dataset.teamId); else toast("このチームの対戦がまだありません", "error");
      return;
    }
    if (target.matches("[data-select-winner]")) {
      const form = document.getElementById("result-form");
      form.elements.winnerSide.value = target.dataset.selectWinner;
      form.querySelectorAll("[data-winner-option]").forEach((node) => node.classList.toggle("selected", node.dataset.winnerOption === target.dataset.selectWinner));
      return;
    }
    if (target.matches("[data-cancel-result]")) {
      const id = target.dataset.cancelResult;
      if (confirm("この試合結果を取り消しますか？ 後続のチーム表示も更新されます。")) {
        await store.mutate((state) => { delete state.results[id]; }, "結果取消"); closeModal(); toast("試合結果を取り消しました");
      }
      return;
    }
    if (target.matches("[data-auto-schedule]")) {
      const competitionIds = ui.scheduleCompetitionId === "all" ? store.state.competitions.map((competition) => competition.id) : [ui.scheduleCompetitionId];
      if (!confirmStageReset(competitionIds, "schedule")) return;
      let result;
      await store.mutate((state) => {
        clearResultsForCompetitions(state, competitionIds);
        result = Model.autoSchedule(state, { competitionId: ui.scheduleCompetitionId === "all" ? null : ui.scheduleCompetitionId });
        state.schedule = result.schedule;
      }, "日程自動割り振り");
      toast(result.unassigned.length ? `${result.unassigned.length}試合は空き枠不足で未設定です` : "すべての試合を割り振りました", result.unassigned.length ? "error" : "");
      return;
    }
    if (target.matches("[data-clear-schedule]")) {
      const filter = ui.scheduleCompetitionId;
      const competitionIds = filter === "all" ? store.state.competitions.map((competition) => competition.id) : [filter];
      const hasResults = competitionIds.some((id) => stageIsLocked(store.state, id, "schedule"));
      if ((hasResults ? confirmStageReset(competitionIds, "schedule") : confirm("表示中の試合の割り振りを解除しますか？"))) {
        await store.mutate((state) => {
          clearResultsForCompetitions(state, competitionIds);
          if (filter === "all") state.schedule = {};
          else Object.keys(state.schedule).forEach((id) => { if (state.schedule[id].competitionId === filter) delete state.schedule[id]; });
        }, "日程解除");
      }
      return;
    }
    if (target.matches("[data-copy-distribution-url]")) {
      const url = StoreUtils.distributionUrl(store.config.endpoint, window.location.href);
      if (!url) { toast("配布用URLを作成できませんでした", "error"); return; }
      try {
        await copyText(url);
        toast("配布用URLをコピーしました");
      } catch (_) {
        window.prompt("次の配布用URLをコピーしてください", url);
      }
      return;
    }
    if (target.matches("[data-disconnect]")) { store.disconnect(); closeModal(); render(); toast("共有を解除し、この端末での保存に切り替えました"); return; }
  });

  document.addEventListener("change", async (event) => {
    const target = event.target;
    if (target.matches("[data-entry-count]")) {
      const competitionId = target.dataset.competitionId; const classId = target.dataset.classId; const count = Number(target.value);
      const previousCount = Number((store.state.entries[competitionId] || {})[classId]) || 0;
      if (count === previousCount) return;
      if (!confirmStageReset([competitionId], "entry")) { target.value = String(previousCount); return; }
      await store.mutate((state) => {
        state.entries[competitionId][classId] = count;
        delete state.draws[competitionId];
        Object.keys(state.results).forEach((id) => { if (id.startsWith(`${competitionId}__`)) delete state.results[id]; });
        Object.keys(state.schedule).forEach((id) => { if (id.startsWith(`${competitionId}__`)) delete state.schedule[id]; });
      }, "エントリー変更");
      toast("エントリーを変更しました。組み合わせは再作成してください");
      return;
    }
    if (target.matches("[data-draw-source]")) {
      const competitionId = target.dataset.competitionId; const phase = target.dataset.phase; const source = parseSource(target.value); const groupIndex = Number(target.dataset.groupIndex); const slotIndex = Number(target.dataset.slotIndex);
      if (!confirmStageReset([competitionId], "draw")) { render(); return; }
      await store.mutate((state) => {
        const draw = state.draws[competitionId];
        const sourceIsUnique = ["team", "leagueRank"].includes(source.type);
        const selectedKey = Model.sourceKey(source);
        if (phase === "league") {
          const targetSlots = draw.league.groups[groupIndex].slots;
          const previous = targetSlots[slotIndex] || { type: "empty" };
          if (sourceIsUnique) {
            draw.league.groups.forEach((group, candidateGroupIndex) => group.slots.forEach((current, candidateSlotIndex) => {
              if ((candidateGroupIndex !== groupIndex || candidateSlotIndex !== slotIndex) && Model.sourceKey(current) === selectedKey) group.slots[candidateSlotIndex] = previous;
            }));
          }
          targetSlots[slotIndex] = source;
        } else {
          const slots = draw.tournament.slots;
          const previous = slots[slotIndex] || { type: "empty" };
          if (sourceIsUnique) {
            const duplicateIndex = slots.findIndex((current, index) => index !== slotIndex && Model.sourceKey(current) === selectedKey);
            if (duplicateIndex >= 0) slots[duplicateIndex] = previous;
          }
          slots[slotIndex] = source;
        }
        clearCompetitionMatchData(state, competitionId);
      }, "出場枠変更");
      return;
    }
    if (target.matches("[data-league-group-count]")) {
      const id = target.dataset.leagueGroupCount; const count = Number(target.value);
      if (count === Number(store.state.draws[id].league.groupCount)) return;
      if (!confirmStageReset([id], "draw")) { render(); return; }
      await store.mutate((state) => { Model.resizeLeague(state.draws[id], count, Model.teamsForCompetition(state, id)); clearCompetitionMatchData(state, id); }, "リーグ数変更");
      return;
    }
    if (target.matches("[data-tournament-size]")) {
      const id = target.dataset.tournamentSize; const size = Number(target.value);
      if (size === Number(store.state.draws[id].tournament.size)) return;
      if (!confirmStageReset([id], "draw")) { render(); return; }
      await store.mutate((state) => { Model.resizeTournament(state.draws[id], size); clearCompetitionMatchData(state, id); }, "トーナメント枠変更");
      return;
    }
    if (target.matches("[data-schedule-filter]")) { ui.scheduleCompetitionId = target.value; render(); return; }
    if (target.matches("[data-class-filter]")) { ui.classId = target.value; render(); return; }
    if (target.matches("[data-competition-schedule-filter]")) { ui.competitionScheduleId = target.value; render(); return; }
    if (target.matches("[data-schedule-cell]")) {
      const competitionId = target.dataset.competitionId;
      const slotId = target.dataset.slotId;
      const venueId = target.dataset.venueId;
      const nextMatchId = target.value;
      const currentMatchId = Object.keys(store.state.schedule).find((matchId) => {
        const assignment = store.state.schedule[matchId];
        return assignment.competitionId === competitionId && assignment.slotId === slotId && assignment.venueId === venueId;
      }) || "";
      if (nextMatchId === currentMatchId) return;
      const affectedResultIds = [currentMatchId, nextMatchId].filter((matchId, index, values) => matchId && values.indexOf(matchId) === index && store.state.results[matchId]);
      if (affectedResultIds.length && !confirm(`変更する試合のうち${affectedResultIds.length}試合は勝敗入力済みです。\n\n日程を強制変更すると、対象の勝敗結果がリセットされます。\n\nロックを解除して変更しますか？`)) { target.value = currentMatchId; return; }
      await store.mutate((state) => {
        const currentId = Object.keys(state.schedule).find((matchId) => {
          const assignment = state.schedule[matchId];
          return assignment.competitionId === competitionId && assignment.slotId === slotId && assignment.venueId === venueId;
        }) || "";
        const nextPreviousAssignment = nextMatchId && state.schedule[nextMatchId] ? { ...state.schedule[nextMatchId] } : null;
        if (currentId) delete state.schedule[currentId];
        if (nextMatchId) {
          if (currentId && nextPreviousAssignment && (nextPreviousAssignment.slotId !== slotId || nextPreviousAssignment.venueId !== venueId)) state.schedule[currentId] = nextPreviousAssignment;
          state.schedule[nextMatchId] = { competitionId, slotId, venueId };
        }
        affectedResultIds.forEach((matchId) => { delete state.results[matchId]; });
      }, "日程表変更");
      return;
    }
    if (target.matches("[data-schedule-slot], [data-schedule-venue]")) {
      const matchId = target.dataset.matchId; const match = matchById(store.state, matchId);
      if (!match) return;
      const field = target.matches("[data-schedule-slot]") ? "slotId" : "venueId";
      const value = target.value;
      const previousValue = (store.state.schedule[matchId] || {})[field] || "";
      if (value === previousValue) return;
      if (store.state.results[matchId] && !confirm("この試合は勝敗入力済みのため、日程がロックされています。\n\n強制的に変更すると、この試合の勝敗結果がリセットされます。\n\nロックを解除して変更しますか？")) { target.value = previousValue; return; }
      await store.mutate((state) => {
        delete state.results[matchId];
        state.schedule[matchId] = state.schedule[matchId] || { competitionId: match.competitionId, slotId: "", venueId: "" };
        state.schedule[matchId][field] = value;
        if (!state.schedule[matchId].slotId && !state.schedule[matchId].venueId) delete state.schedule[matchId];
      }, "日程調整");
    }
  });

  document.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.target;
    if (form.id === "competition-form") {
      const data = new FormData(form); const submitter = event.submitter; const id = submitter ? submitter.dataset.saveCompetition : "";
      const venueNames = String(data.get("venues") || "").split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
      const explicitTimes = String(data.get("slotTimes") || "").split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
      if (!venueNames.length) { toast("会場を1つ以上入力してください", "error"); return; }
      const values = { id: id || undefined, name: data.get("name"), format: data.get("format"), duration: Number(data.get("duration")), color: data.get("color"), venueNames, start: data.get("start"), slotCount: Number(data.get("slotCount")) };
      await store.mutate((state) => {
        const previous = id ? competitionById(state, id) : null;
        const competition = Model.createCompetition(values);
        if (explicitTimes.length) competition.slots = explicitTimes.map((start, index) => ({ id: previous && previous.slots[index] ? previous.slots[index].id : Model.uid("slot"), start }));
        if (previous) {
          competition.venues = venueNames.map((name, index) => ({ id: previous.venues[index] ? previous.venues[index].id : Model.uid("venue"), name }));
          state.competitions[state.competitions.findIndex((item) => item.id === id)] = competition;
          if (previous.format !== competition.format) {
            delete state.draws[id];
            clearCompetitionMatchData(state, id);
          }
        } else {
          state.competitions.push(competition); state.entries[competition.id] = {};
          state.classes.forEach((classInfo) => { state.entries[competition.id][classInfo.id] = 0; });
        }
      }, id ? "競技設定変更" : "競技追加");
      closeModal(); toast(id ? "競技設定を更新しました" : "競技を追加しました"); return;
    }
    if (form.id === "class-form") {
      const name = String(new FormData(form).get("name") || "").trim();
      if (!name) return;
      if (store.state.classes.some((item) => item.name.toLowerCase() === name.toLowerCase())) { toast("同じクラス名が既にあります", "error"); return; }
      const id = Model.uid("class");
      await store.mutate((state) => { state.classes.push({ id, name }); state.competitions.forEach((competition) => { state.entries[competition.id][id] = 0; }); }, "クラス追加");
      closeModal(); toast(`${name}を追加しました`); return;
    }
    if (form.id === "result-form") {
      const data = new FormData(form); const matchId = event.submitter && event.submitter.dataset.saveResult; const winnerSide = data.get("winnerSide");
      if (!matchId || !["a","b"].includes(winnerSide)) { toast("勝った側を選択してください", "error"); return; }
      await store.mutate((state) => { state.results[matchId] = { winnerSide, scoreA: String(data.get("scoreA") || ""), scoreB: String(data.get("scoreB") || ""), updatedAt: new Date().toISOString() }; }, "試合結果入力");
      closeModal(); toast("試合結果を保存しました"); return;
    }
    if (form.id === "sync-form") {
      const data = new FormData(form); const endpoint = String(data.get("endpoint") || "").trim(); const title = String(data.get("eventTitle") || "").trim();
      try {
        if (endpoint) await store.connect(endpoint, data.get("accessKey")); else if (store.mode === "remote") store.disconnect();
        await store.mutate((state) => { state.event.title = title || "インドア選手権"; }, "イベント名変更");
        closeModal(); toast(endpoint ? "Googleスプレッドシート共有を開始しました" : "設定を保存しました");
      } catch (error) { toast(error.message || "接続できませんでした", "error"); }
    }
  });

  document.getElementById("open-settings").addEventListener("click", openSyncModal);
  document.getElementById("menu-button").addEventListener("click", () => sidebar.classList.toggle("open"));
  window.addEventListener("hashchange", render);
  window.addEventListener("resize", () => requestAnimationFrame(refreshBracketGraphics));
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeModal(); });

  store.subscribe(render);
  store.onStatus((status) => {
    syncStatus.className = `sync-pill ${status.state}`;
    const labels = { local: "この端末に保存", syncing: "共有へ保存中…", online: "スプレッドシート共有中", error: "共有エラー" };
    syncStatus.innerHTML = `<i></i>${labels[status.state] || status.message}`;
    syncStatus.title = status.message || labels[status.state] || "";
  });
  store.init();
})();
