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
  if (parts[0] === "admin" && parts[1] === "classes") {
    return { name: "admin-classes", params: {} };
  }
  if (parts[0] === "admin" && parts[1] === "events" && parts[2] === "new") {
    return { name: "admin-event", params: { eventId: "new" } };
  }
  if (parts[0] === "admin" && parts[1] === "events" && parts[2]) {
    return { name: "admin-event", params: { eventId: decodeURIComponent(parts[2]) } };
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
  if (routeName === "admin-classes") {
    return "#/admin/classes";
  }
  if (routeName === "admin-event") {
    return `#/admin/events/${encodeURIComponent(value || "new")}`;
  }
  return "#/";
}
