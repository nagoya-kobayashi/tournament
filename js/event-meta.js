const EDITOR_META_PREFIX = "__EDITOR__=";

export function parseEventEditorMeta(noteText) {
  const raw = String(noteText || "").trim();
  if (!raw.startsWith(EDITOR_META_PREFIX)) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw.slice(EDITOR_META_PREFIX.length));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    console.warn("[event-meta] failed to parse editor meta", error);
    return {};
  }
}

export function serializeEventEditorMeta(meta) {
  return `${EDITOR_META_PREFIX}${JSON.stringify(meta || {})}`;
}

export function getEventFormatType(event) {
  const meta = parseEventEditorMeta(event && event.bracket_note);
  return meta.format === "league" ? "league" : "tournament";
}
