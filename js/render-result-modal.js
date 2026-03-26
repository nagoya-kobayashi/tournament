function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderWinnerChoice(slot, label, selected, disabled) {
  return `
    <label class="winner-choice-card ${selected ? "is-selected" : ""} ${disabled ? "is-disabled" : ""}">
      <input class="winner-choice-input" type="radio" name="winnerSlot" value="${escapeHtml(slot)}" ${selected ? "checked" : ""} ${disabled ? "disabled" : ""} />
      <span class="winner-choice-text">${escapeHtml(label)}</span>
    </label>
  `;
}

export function renderResultModal(data) {
  if (!data) {
    return "";
  }

  const winnerChoices = data.availableWinnerChoices || [];
  const canPickWinner = winnerChoices.length > 0 && !data.isReadOnly;
  const canDelete = !data.isReadOnly && !!(data.match.winner_slot || data.match.winner_team_id);
  const memoValue = data.draft.memo || "";
  const pinDisabled = !data.requireEditorPin || data.isReadOnly;
  const selectedWinnerSlot = data.draft.winnerSlot || "";
  const editorPinValue = data.draft.editorPin || "";

  return `
    ${
      data.isReadOnly
        ? '<div class="error-box">read-only モードのため結果は送信できません。</div>'
        : winnerChoices.length === 0
          ? '<div class="error-box">参加者が1つも確定していないため、まだ結果登録できません。</div>'
          : ""
    }

    ${data.error ? `<div class="error-box">${escapeHtml(data.error)}</div>` : ""}

    <form id="result-form" class="form-row">
      <label>
        勝者クラス
        <div class="winner-choice-grid ${winnerChoices.length === 1 ? "is-single" : ""}">
          ${winnerChoices
            .map((choice) => renderWinnerChoice(choice.slot, choice.label, selectedWinnerSlot === choice.slot, !canPickWinner))
            .join("")}
        </div>
      </label>

      <label>
        メモ
        <textarea name="memo" placeholder="任意" ${data.isReadOnly ? "disabled" : ""}>${escapeHtml(memoValue)}</textarea>
      </label>

      <label>
        PIN
        <input type="password" name="editorPin" autocomplete="current-password" placeholder="${data.requireEditorPin ? "入力担当者用 PIN" : "現在は不要"}" value="${escapeHtml(editorPinValue)}" ${pinDisabled ? "disabled" : ""} />
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
