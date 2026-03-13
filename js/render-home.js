import { toHref } from "./router.js";

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function renderHome(data) {
  const eventCards = data.events
    .map(
      (event) => `
        <article class="event-card">
          <h3>${escapeHtml(event.display_name)}</h3>
          <div class="event-card-actions">
            <a class="button primary" data-nav href="${toHref("event", event.event_id)}">トーナメントを見る</a>
          </div>
        </article>
      `
    )
    .join("");

  const classChips = data.classIds
    .map(
      (classId) => `
        <a class="nav-chip" data-nav href="${toHref("class", classId)}">${escapeHtml(classId)}</a>
      `
    )
    .join("");

  const readOnlyNote = data.isReadOnly
    ? `<p class="muted toolbar-note">通信障害のため read-only 表示です。</p>`
    : "";

  return `
    <section class="panel home-toolbar-panel">
      <div class="home-toolbar">
        <div class="filter-strip home-filter-strip">
          ${[
            ["sunny", "晴天系"],
            ["rainy", "雨天系"],
            ["all", "すべて"],
          ]
            .map(
              ([value, label]) => `
                <button class="filter-chip ${data.eventFilter === value ? "active" : ""}" data-action="set-filter" data-filter="${value}">
                  ${label}
                </button>
              `
            )
            .join("")}
        </div>
        <div class="toolbar-actions">
          <button class="button ghost" data-action="retry-bootstrap">再読み込み</button>
          <span class="toolbar-time">最終取得 ${escapeHtml(data.updatedAt || "-")}</span>
        </div>
      </div>
      ${readOnlyNote}
    </section>

    <section class="section-grid">
      <section class="panel">
        <div class="panel-header">
          <div>
            <h2 class="panel-title">種目一覧</h2>
          </div>
        </div>
        <div class="events-grid">
          ${eventCards || '<div class="empty-state">この条件に一致する種目はありません。</div>'}
        </div>
      </section>

      <section class="panel">
        <div class="panel-header">
          <div>
            <h2 class="panel-title">クラス別日程</h2>
          </div>
        </div>
        <form class="search-row" data-form="class-jump">
          <input name="classId" placeholder="例: 1A" list="class-list" autocomplete="off" />
          <button class="button primary" type="submit">開く</button>
          <datalist id="class-list">
            ${data.classIds.map((classId) => `<option value="${escapeHtml(classId)}"></option>`).join("")}
          </datalist>
        </form>
        <div class="chip-row" style="margin-top:14px;">
          ${classChips}
        </div>
      </section>
    </section>
  `;
}
