export function parseRoute(hash) {
  const normalized = (hash || "#/").replace(/^#/, "");
  const parts = normalized.split("/").filter(Boolean);

  if (parts.length === 0) {
    return { name: "home", params: {} };
  }
  if (parts[0] === "events" && parts[1]) {
    return { name: "event", params: { eventId: decodeURIComponent(parts[1]) } };
  }
  if (parts[0] === "classes" && parts[1]) {
    return { name: "class", params: { classId: decodeURIComponent(parts[1]) } };
  }
  return { name: "home", params: {} };
}

export function toHref(routeName, value = "") {
  if (routeName === "event") {
    return `#/events/${encodeURIComponent(value)}`;
  }
  if (routeName === "class") {
    return `#/classes/${encodeURIComponent(value)}`;
  }
  return "#/";
}
