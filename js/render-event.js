import { formatDayLabel } from "./format.js";
import { buildBracketSections } from "./bracket-layout.js";
import { getEventFormatType, parseEventEditorMeta } from "./event-meta.js";
import { getMatchView } from "./store.js";
import { toHref } from "./router.js";

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function sortByDisplayOrderDesc(a, b) {
  return Number(b.display_order) - Number(a.display_order);
}

function resolveLatestTeamTarget(matches, teamId) {
  if (!teamId) {
    return null;
  }
  for (const match of [...matches].sort(sortByDisplayOrderDesc)) {
    if (match.resolved_top_team_id === teamId) {
      return {
        matchId: match.match_id,
        winnerSlot: "top",
      };
    }
    if (match.resolved_bottom_team_id === teamId) {
      return {
        matchId: match.match_id,
        winnerSlot: "bottom",
      };
    }
  }
  return null;
}

function resolveQuickPickTarget(slot, view, isTop) {
  const teamId = isTop ? view.topTeamId : view.bottomTeamId;
  const winnerSlot = isTop ? "top" : "bottom";
  if (!teamId) {
    return {
      matchId: slot.match.match_id,
      winnerSlot,
    };
  }
  if (slot.slotType === "winner" && slot.slotRef) {
    if (slot.sourceMatch) {
      const sourceView = getMatchView(slot.sourceMatch);
      return {
        matchId: slot.slotRef,
        winnerSlot: sourceView.topTeamId === teamId ? "top" : "bottom",
      };
    }
    return {
      matchId: slot.slotRef,
      winnerSlot,
    };
  }
  return {
    matchId: slot.match.match_id,
    winnerSlot,
  };
}

function isCollapsibleSeedMatch(match) {
  const hiddenChip = !!(match && (match._hideChip || !String(match.match_label || "").trim()));
  if (!match || !hiddenChip) {
    return false;
  }
  const topIsBye = match.slot_top_type === "bye";
  const bottomIsBye = match.slot_bottom_type === "bye";
  return (topIsBye && !bottomIsBye) || (bottomIsBye && !topIsBye);
}

function collapseDisplaySource(matchMap, slotType, slotRef) {
  let nextType = slotType;
  let nextRef = slotRef;
  const seen = new Set();
  while (nextType === "winner" && nextRef && !seen.has(nextRef)) {
    const upstream = matchMap.get(nextRef);
    if (!isCollapsibleSeedMatch(upstream)) {
      break;
    }
    seen.add(nextRef);
    if (upstream.slot_top_type === "bye") {
      nextType = upstream.slot_bottom_type;
      nextRef = upstream.slot_bottom_ref;
      continue;
    }
    if (upstream.slot_bottom_type === "bye") {
      nextType = upstream.slot_top_type;
      nextRef = upstream.slot_top_ref;
      continue;
    }
    break;
  }
  return {
    slotType: nextType,
    slotRef: nextRef,
  };
}

function buildDisplayMatches(matches) {
  const sourceMap = new Map(matches.map((match) => [match.match_id, match]));
  return matches
    .filter((match) => !isCollapsibleSeedMatch(match))
    .map((match) => {
      const displayMatch = { ...match };
      const top = collapseDisplaySource(sourceMap, match.slot_top_type, match.slot_top_ref);
      const bottom = collapseDisplaySource(sourceMap, match.slot_bottom_type, match.slot_bottom_ref);
      displayMatch.slot_top_type = top.slotType;
      displayMatch.slot_top_ref = top.slotRef;
      displayMatch.slot_bottom_type = bottom.slotType;
      displayMatch.slot_bottom_ref = bottom.slotRef;
      return displayMatch;
    });
}

function getBracketScale(layoutWidth) {
  if (typeof window === "undefined") {
    return 1;
  }
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 1200;
  const horizontalPadding = viewportWidth < 768 ? 44 : 96;
  const availableWidth = Math.max(280, Math.min(1120, viewportWidth - horizontalPadding));
  return Math.min(1, availableWidth / layoutWidth);
}

function renderBracketChip(node, selectedClassId = "") {
  const hideChip = node.match._hideChip || !String(node.match.match_label || "").trim();
  if (hideChip) {
    return "";
  }
  const view = getMatchView(node.match, selectedClassId);
  const classes = [
    "bracket-match-chip",
    `status-${node.match.status}`,
    view.canSubmit ? "is-clickable" : "is-readonly",
  ]
    .filter(Boolean)
    .join(" ");

  return `
    <button
      class="${classes}"
      data-match-id="${escapeHtml(node.match.match_id)}"
      style="left:${node.left}px; top:${node.top}px;"
      aria-label="${escapeHtml(node.match.match_label)} ${escapeHtml(view.topLabel)} 対 ${escapeHtml(view.bottomLabel)}"
      title="${escapeHtml(node.match.match_label)}"
    >
      <span class="chip-label">${escapeHtml(node.match.match_label)}</span>
      ${view.isPendingSync ? '<span class="chip-sync">送信中</span>' : ""}
    </button>
  `;
}

function renderHiddenNodeBridge(node) {
  if (!node.match._hideChip && String(node.match.match_label || "").trim()) {
    return "";
  }
  const width = Math.max(0, (node.right || 0) - (node.left || 0));
  return `<div class="bracket-hidden-bridge" style="left:${node.left}px; top:${node.centerY}px; width:${width}px;"></div>`;
}

function renderBracketSlot(slot, selectedClassId = "", actionMatches = []) {
  if (!slot.match) {
    return "";
  }
  if (slot.slotType === "bye") {
    return "";
  }
  const view = getMatchView(slot.match, selectedClassId);
  const isTop = slot.slot === "top";
  const resolvedTeamId = isTop ? view.topTeamId : view.bottomTeamId;
  const label = isTop ? view.topLabel : view.bottomLabel;
  const isWinner = isTop ? view.isTopWinner : view.isBottomWinner;
  const isLoser = isTop ? view.isTopLoser : view.isBottomLoser;
  const isHighlighted = isTop ? view.topHighlighted : view.bottomHighlighted;
  const directTarget = resolvedTeamId ? resolveLatestTeamTarget(actionMatches, resolvedTeamId) : null;
  const quickPick = resolveQuickPickTarget(slot, view, isTop);
  const classes = [
    "bracket-slot",
    `align-${slot.align}`,
    !resolvedTeamId && slot.slotType !== "team" ? "is-reference" : "",
    isWinner ? "winner" : "",
    isLoser ? "loser" : "",
    isHighlighted ? "highlight" : "",
    view.isPendingSync ? "pending-sync" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const actionAttrs = directTarget
    ? `data-action="team-direct-win" data-target-match-id="${escapeHtml(directTarget.matchId)}" data-winner-slot="${escapeHtml(directTarget.winnerSlot)}" data-event-id="${escapeHtml(slot.match.event_id)}"`
    : quickPick
      ? `data-action="quick-pick-winner" data-winner-slot="${escapeHtml(quickPick.winnerSlot)}"`
      : "";
  const matchId = directTarget ? directTarget.matchId : (quickPick && quickPick.matchId) || slot.match.match_id;
  const ariaLabel = directTarget ? `${label} を勝者として入力する` : `${label} を選んで入力を開く`;

  return `
    <button
      class="${classes}"
      data-match-id="${escapeHtml(matchId)}"
      ${actionAttrs}
      style="left:${slot.left}px; top:${slot.top}px; width:${slot.width}px;"
      aria-label="${escapeHtml(ariaLabel)}"
      title="${escapeHtml(label)}"
    >
      <span class="slot-text">${escapeHtml(label)}</span>
    </button>
  `;
}

function renderBracketSection(section, selectedClassId, scale, actionMatches) {
  const scaledWidth = Math.round(section.layout.width * scale * 10) / 10;
  const scaledHeight = Math.round(section.layout.height * scale * 10) / 10;
  const visibleConnections = section.layout.connections.filter((connection) => !connection.hideInEventView);
  return `
    <section class="bracket-paper">
      <div class="bracket-paper-head">
        <div>
          <h3 class="panel-title">${escapeHtml(section.title)}</h3>
        </div>
      </div>
      <div class="bracket-fit-frame">
        <div class="bracket-fit-inner" style="width:${scaledWidth}px; height:${scaledHeight}px;">
          <div class="bracket-canvas bracket-stage variant-${escapeHtml(section.layout.variant)}" style="width:${section.layout.width}px; height:${section.layout.height}px; transform:scale(${scale.toFixed(4)});">
            <svg class="bracket-svg" viewBox="0 0 ${section.layout.width} ${section.layout.height}" aria-hidden="true">
              ${visibleConnections
                .map(
                  (connection) => `
                    <path class="bracket-connection base state-${escapeHtml(connection.state)}" d="${escapeHtml(connection.d)}"></path>
                    ${connection.state === "winning" ? `<path class="bracket-connection fill state-${escapeHtml(connection.state)}" d="${escapeHtml(connection.fillD || connection.d)}"></path>` : ""}
                  `
                )
                .join("")}
            </svg>
            ${section.layout.leaves.map((slot) => renderBracketSlot(slot, selectedClassId, actionMatches)).join("")}
            ${section.layout.nodes.map((node) => renderHiddenNodeBridge(node)).join("")}
            ${section.layout.nodes.map((node) => renderBracketChip(node, selectedClassId)).join("")}
          </div>
        </div>
      </div>
    </section>
  `;
}

function buildBracketSectionsForRender(data) {
  const displayMatches = buildDisplayMatches(data.matches);
  const matchMap = new Map(displayMatches.map((match) => [match.match_id, match]));
  const actionMatches = data.baseMatches || data.matches;
  const meta = parseEventEditorMeta(data.event && data.event.bracket_note);
  const titleOverrides = Object.fromEntries((((meta && meta.draft && meta.draft.customBrackets) || []).map((custom) => [String(custom.title || custom.id).trim() || custom.id, custom.title || custom.id])));
  const sections = buildBracketSections(displayMatches, displayMatches, titleOverrides).map((section) => ({
    ...section,
    layout: {
      ...section.layout,
      leaves: section.layout.leaves.map((slot) => ({
        ...slot,
        match: matchMap.get(slot.matchId) || null,
        sourceMatch: matchMap.get(slot.slotRef) || null,
      })),
    },
  }));
  const sharedScale = getBracketScale(Math.max(...sections.map((section) => section.layout.width), 1));
  return {
    sections,
    sharedScale,
    actionMatches,
  };
}

export function renderEventBracketPanel(data) {
  const { sections, sharedScale, actionMatches } = buildBracketSectionsForRender(data);
  return `
    <div class="panel-header">
      <div>
        <h2 class="panel-title">トーナメント表</h2>
      </div>
    </div>
    <div class="bracket-stack" data-bracket-preview-scope>
      ${sections.map((section) => renderBracketSection(section, data.selectedClassId, sharedScale, actionMatches)).join("")}
    </div>
  `;
}

function renderLeaguePanel(data) {
  const teams = (data.teams || [])
    .slice()
    .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));
  const byPair = new Map();
  data.matches.forEach((match) => {
    byPair.set(`${match.resolved_top_team_id}|${match.resolved_bottom_team_id}`, match);
    byPair.set(`${match.resolved_bottom_team_id}|${match.resolved_top_team_id}`, match);
  });
  return `
    <section class="panel">
      <div class="panel-header">
        <div>
          <h2 class="panel-title">リーグ表</h2>
        </div>
      </div>
      <div class="league-grid-wrap">
        <table class="league-grid">
          <thead>
            <tr>
              <th>クラス</th>
              ${teams.map((team) => `<th>${escapeHtml(team.display_name)}</th>`).join("")}
            </tr>
          </thead>
          <tbody>
            ${teams
              .map(
                (rowTeam) => `
                  <tr>
                    <th>${escapeHtml(rowTeam.display_name)}</th>
                    ${teams
                      .map((colTeam) => {
                        if (rowTeam.team_id === colTeam.team_id) {
                          return '<td class="league-cell diagonal">-</td>';
                        }
                        const match = byPair.get(`${rowTeam.team_id}|${colTeam.team_id}`);
                        return `<td class="league-cell ${match ? "is-clickable" : ""}" ${match ? `data-match-id="${escapeHtml(match.match_id)}"` : ""}>${match ? escapeHtml(match.match_label) : "-"}</td>`;
                      })
                      .join("")}
                  </tr>
                `
              )
              .join("")}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderDayTabs(kind, targetId, days, activeDay) {
  if (!days.length) {
    return "";
  }
  return `
    <div class="day-tab-row">
      ${days
        .map(
          (day) => `
            <button
              class="filter-chip ${day === activeDay ? "active" : ""}"
              type="button"
              data-action="set-schedule-day"
              data-schedule-kind="${escapeHtml(kind)}"
              data-schedule-target="${escapeHtml(targetId)}"
              data-day-no="${escapeHtml(day)}"
            >
              ${escapeHtml(formatDayLabel(day))}
            </button>
          `
        )
        .join("")}
    </div>
  `;
}

function renderOutcomeBadge(isWinner, isLoser) {
  if (isWinner) {
    return '<span class="team-outcome is-win">勝</span>';
  }
  if (isLoser) {
    return '<span class="team-outcome is-lose">負</span>';
  }
  return "";
}

function renderMatchup(view) {
  return `
    <span class="schedule-matchup">
      <span class="schedule-team ${view.isTopWinner ? "is-winner" : view.isTopLoser ? "is-loser" : ""}">${escapeHtml(view.topLabel)}${renderOutcomeBadge(view.isTopWinner, view.isTopLoser)}</span>
      <span class="schedule-vs">VS</span>
      <span class="schedule-team ${view.isBottomWinner ? "is-winner" : view.isBottomLoser ? "is-loser" : ""}">${escapeHtml(view.bottomLabel)}${renderOutcomeBadge(view.isBottomWinner, view.isBottomLoser)}</span>
    </span>
  `;
}

function renderEventScheduleRow(match) {
  const view = getMatchView(match);
  return `
    <button class="schedule-line schedule-line-event ${view.resultLabel ? "is-completed" : ""} ${view.isPendingSync ? "is-pending" : ""}" data-match-id="${escapeHtml(match.match_id)}">
      <span class="schedule-cell schedule-cell-time">${escapeHtml(view.formattedTime || "-")}</span>
      <span class="schedule-cell schedule-cell-court">${escapeHtml(match.court || "-")}</span>
      <span class="schedule-cell schedule-cell-label">${escapeHtml(match.match_label)}</span>
      <span class="schedule-cell schedule-cell-matchup">${renderMatchup(view)}</span>
    </button>
  `;
}

export function renderEventDetail(data) {
  const scheduleRows = data.scheduledMatches.map((match) => renderEventScheduleRow(match)).join("");
  const formatType = getEventFormatType(data.event);

  return `
    <section class="hero-panel event-hero">
      <div class="route-row">
        <a class="route-link" data-nav href="${toHref("home")}">ホーム</a>
        <span class="muted">/</span>
        <span>${escapeHtml(data.event.display_name)}</span>
      </div>
      <div class="event-hero-grid event-hero-simple">
        <div>
          <h2 class="hero-title">${escapeHtml(data.event.display_name)}</h2>
        </div>
      </div>
    </section>

    ${
      formatType === "league"
        ? renderLeaguePanel(data)
        : `
      <section class="panel" data-event-bracket-panel>
        ${renderEventBracketPanel(data)}
      </section>
    `
    }

    <section class="panel">
      <div class="panel-header schedule-panel-head">
        <div>
          <h2 class="panel-title">タイムテーブル</h2>
        </div>
        ${renderDayTabs("event", data.event.event_id, data.scheduleDays, data.activeScheduleDay)}
      </div>
      <div class="schedule-table-wrap">
        <div class="schedule-table">
          ${scheduleRows || '<div class="empty-state">この日のタイムテーブルはありません。</div>'}
        </div>
      </div>
    </section>
  `;
}
