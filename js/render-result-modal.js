function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderWinnerChoice(teamId, label, selected, disabled) {
  return `
    <label class="winner-choice-card ${selected ? "is-selected" : ""} ${disabled ? "is-disabled" : ""}">
      <input class="winner-choice-input" type="radio" name="winnerTeamId" value="${escapeHtml(teamId)}" ${selected ? "checked" : ""} ${disabled ? "disabled" : ""} />
      <span class="winner-choice-text">${escapeHtml(label)}</span>
    </label>
  `;
}

export function renderResultModal(data) {
  if (!data) {
    return "";
  }

  const canPickWinner = data.view.topTeamId && data.view.bottomTeamId && !data.isReadOnly;
  const canDelete = !data.isReadOnly && !!data.match.winner_team_id;
  const memoValue = data.match.correction_note || data.match.score_text || "";
  const pinDisabled = !data.requireEditorPin || data.isReadOnly;

  return `
    ${
      data.isReadOnly
        ? '<div class="error-box">read-only モードのため結果は送信できません。</div>'
        : !data.view.topTeamId || !data.view.bottomTeamId
          ? '<div class="error-box">参加者が確定していないため、まだ結果登録できません。</div>'
          : ""
    }

    ${data.error ? `<div class="error-box">${escapeHtml(data.error)}</div>` : ""}

    <form id="result-form" class="form-row">
      <label>
        勝者クラス
        <div class="winner-choice-grid">
          ${renderWinnerChoice(data.view.topTeamId, data.view.topLabel, data.match.winner_team_id === data.view.topTeamId, !canPickWinner)}
          ${renderWinnerChoice(data.view.bottomTeamId, data.view.bottomLabel, data.match.winner_team_id === data.view.bottomTeamId, !canPickWinner)}
        </div>
      </label>

      <label>
        メモ
        <textarea name="memo" placeholder="任意" ${data.isReadOnly ? "disabled" : ""}>${escapeHtml(memoValue)}</textarea>
      </label>

      <label>
        PIN
        <input type="password" name="editorPin" autocomplete="current-password" placeholder="${data.requireEditorPin ? "入力担当者用 PIN" : "現在は不要"}" ${pinDisabled ? "disabled" : ""} />
      </label>

      <div class="modal-submit-stack">
        <button class="button primary" type="submit" name="submitMode" value="save" ${canPickWinner ? "" : "disabled"}>
          ${data.submitting ? "送信中..." : "結果を保存"}
        </button>
        <button class="button danger-ghost" type="submit" name="submitMode" value="delete" ${canDelete ? "" : "disabled"}>
          保存済み結果を削除
        </button>
      </div>

      <div class="modal-actions">
        <button class="button ghost" type="button" data-action="close-modal">キャンセル</button>
      </div>
    </form>
  `;
}
