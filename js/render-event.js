import { formatDayLabel } from "./format.js";
import { buildBracketSections } from "./bracket-layout.js";
import { getMatchView } from "./store.js";
import { toHref } from "./router.js";

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function statusLabel(status) {
  if (status === "completed" || status === "corrected") return "";
  if (status === "ready") return "入力待ち";
  return "未確定";
}

function renderBracketChip(node, selectedClassId = "") {
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
      <span class="chip-status">${escapeHtml(view.resultLabel || statusLabel(node.match.status))}</span>
      ${view.isPendingSync ? '<span class="chip-sync">送信中</span>' : ""}
    </button>
  `;
}

function renderBracketSlot(slot, selectedClassId = "") {
  if (!slot.match) {
    return "";
  }
  const view = getMatchView(slot.match, selectedClassId);
  const isTop = slot.slot === "top";
  const label = isTop ? view.topLabel : view.bottomLabel;
  const isWinner = isTop ? view.isTopWinner : view.isBottomWinner;
  const isLoser = isTop ? view.isTopLoser : view.isBottomLoser;
  const isHighlighted = isTop ? view.topHighlighted : view.bottomHighlighted;
  const classes = [
    "bracket-slot",
    `align-${slot.align}`,
    slot.slotType !== "team" ? "is-reference" : "",
    isWinner ? "winner" : "",
    isLoser ? "loser" : "",
    isHighlighted ? "highlight" : "",
    view.isPendingSync ? "pending-sync" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return `
    <button
      class="${classes}"
      data-match-id="${escapeHtml(slot.match.match_id)}"
      style="left:${slot.left}px; top:${slot.top}px; width:${slot.width}px;"
      aria-label="${escapeHtml(label)} ${escapeHtml(slot.match.match_label)} の詳細を開く"
      title="${escapeHtml(label)}"
    >
      <span class="slot-text">${escapeHtml(label)}</span>
      ${isWinner ? '<span class="slot-badge">勝</span>' : ""}
    </button>
  `;
}

function renderBracketSection(section, selectedClassId) {
  return `
    <section class="bracket-paper">
      <div class="bracket-paper-head">
        <div>
          <h3 class="panel-title">${escapeHtml(section.title)}</h3>
        </div>
      </div>
      <div class="bracket-scroll">
        <div class="bracket-canvas variant-${escapeHtml(section.layout.variant)}" style="width:${section.layout.width}px; height:${section.layout.height}px;">
          <svg class="bracket-svg" viewBox="0 0 ${section.layout.width} ${section.layout.height}" aria-hidden="true">
            ${section.layout.connections
              .map(
                (connection) => `
                  <path class="bracket-connection state-${escapeHtml(connection.state)}" d="${escapeHtml(connection.d)}"></path>
                `
              )
              .join("")}
          </svg>
          ${section.layout.leaves.map((slot) => renderBracketSlot(slot, selectedClassId)).join("")}
          ${section.layout.nodes.map((node) => renderBracketChip(node, selectedClassId)).join("")}
        </div>
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

function renderWinnerBadge(isWinner) {
  return isWinner ? '<span class="team-outcome">勝</span>' : "";
}

function renderMatchup(view) {
  return `
    <span class="schedule-matchup">
      <span class="schedule-team ${view.isTopWinner ? "is-winner" : view.isTopLoser ? "is-loser" : ""}">${escapeHtml(view.topLabel)}${renderWinnerBadge(view.isTopWinner)}</span>
      <span class="schedule-vs">VS</span>
      <span class="schedule-team ${view.isBottomWinner ? "is-winner" : view.isBottomLoser ? "is-loser" : ""}">${escapeHtml(view.bottomLabel)}${renderWinnerBadge(view.isBottomWinner)}</span>
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
  const matchMap = new Map(data.matches.map((match) => [match.match_id, match]));
  const sections = buildBracketSections(data.matches).map((section) => ({
    ...section,
    layout: {
      ...section.layout,
      leaves: section.layout.leaves.map((slot) => ({
        ...slot,
        match: matchMap.get(slot.matchId) || null,
      })),
    },
  }));

  const scheduleRows = data.scheduledMatches.map((match) => renderEventScheduleRow(match)).join("");

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

    <section class="panel legend-panel">
      <div class="legend-row">
        <span class="legend-item"><span class="legend-line pending"></span>未確定</span>
        <span class="legend-item"><span class="legend-line resolved"></span>参加者確定</span>
        <span class="legend-item"><span class="legend-line winning"></span>勝ち上がり確定</span>
      </div>
    </section>

    <section class="panel">
      <div class="panel-header">
        <div>
          <h2 class="panel-title">トーナメント表</h2>
        </div>
      </div>
      <div class="bracket-stack">
        ${sections.map((section) => renderBracketSection(section, data.selectedClassId)).join("")}
      </div>
    </section>

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
