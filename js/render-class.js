import { formatDayLabel } from "./format.js";
import { toHref } from "./router.js";

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
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
      <span class="schedule-team ${view.isTopWinner ? "is-winner" : view.isTopLoser ? "is-loser" : ""} ${view.topHighlighted ? "is-highlight" : ""}">${escapeHtml(view.topLabel)}${renderWinnerBadge(view.isTopWinner)}</span>
      <span class="schedule-vs">VS</span>
      <span class="schedule-team ${view.isBottomWinner ? "is-winner" : view.isBottomLoser ? "is-loser" : ""} ${view.bottomHighlighted ? "is-highlight" : ""}">${escapeHtml(view.bottomLabel)}${renderWinnerBadge(view.isBottomWinner)}</span>
    </span>
  `;
}

function renderScheduleGroup(items, emptyText) {
  if (!items.length) {
    return `<div class="empty-state">${escapeHtml(emptyText)}</div>`;
  }

  return items
    .map(
      ({ match, event, view }) => `
        <button class="schedule-line schedule-line-class ${view.resultLabel ? "is-completed" : ""} ${view.isPendingSync ? "is-pending" : ""}" data-match-id="${escapeHtml(match.match_id)}">
          <span class="schedule-cell schedule-cell-time">${escapeHtml(view.formattedTime || "-")}</span>
          <span class="schedule-cell schedule-cell-event">${escapeHtml((event && event.display_name) || "-")}</span>
          <span class="schedule-cell schedule-cell-court">${escapeHtml(match.court || "-")}</span>
          <span class="schedule-cell schedule-cell-label">${escapeHtml(match.match_label)}</span>
          <span class="schedule-cell schedule-cell-matchup">${renderMatchup(view)}</span>
        </button>
      `
    )
    .join("");
}

export function renderClassSchedule(data) {
  return `
    <section class="panel">
      <div class="route-row">
        <a class="route-link" data-nav href="${toHref("home")}">ホーム</a>
        <span class="muted">/</span>
        <span>${escapeHtml(data.classId)}</span>
      </div>
      <div class="panel-header schedule-panel-head" style="margin-top:14px;">
        <div>
          <h2 class="panel-title">${escapeHtml(data.classId)} の試合一覧</h2>
        </div>
        ${renderDayTabs("class", data.classId, data.scheduleDays, data.activeScheduleDay)}
      </div>
    </section>

    <section class="panel class-section">
      <div class="panel-header">
        <div>
          <h2 class="panel-title">確定試合</h2>
        </div>
      </div>
      <div class="schedule-table-wrap">
        <div class="schedule-table">
          ${renderScheduleGroup(data.confirmed, "この日の確定試合はありません。")}
        </div>
      </div>
    </section>

    <section class="panel class-section">
      <div class="panel-header">
        <div>
          <h2 class="panel-title">条件付き試合</h2>
        </div>
      </div>
      <div class="schedule-table-wrap">
        <div class="schedule-table">
          ${renderScheduleGroup(data.conditional, "この日の条件付き試合はありません。")}
        </div>
      </div>
    </section>
  `;
}
