var SHEET_NAMES = {
  APP_CONFIG: "app_config",
  EVENTS: "events",
  TEAMS: "teams",
  MATCHES: "matches",
  AUDIT_LOG: "audit_log",
};

var EVENT_HEADERS = [
  "event_id",
  "display_name",
  "short_name",
  "weather_mode",
  "printed_page",
  "display_order",
  "bracket_note",
  "schedule_note",
];

var TEAM_HEADERS = [
  "team_id",
  "event_id",
  "class_id",
  "display_name",
  "source_label",
  "member_token",
  "sort_order",
];

var MATCH_HEADERS = [
  "match_id",
  "event_id",
  "bracket_type",
  "round_key",
  "match_label",
  "display_order",
  "day_no",
  "start_time",
  "court",
  "source_page",
  "slot_top_type",
  "slot_top_ref",
  "slot_bottom_type",
  "slot_bottom_ref",
  "resolved_top_team_id",
  "resolved_bottom_team_id",
  "status",
  "winner_team_id",
  "loser_team_id",
  "score_text",
  "correction_note",
  "updated_at",
  "updated_by_session",
];

var APP_CONFIG_HEADERS = ["key", "value", "note", "updated_at"];

var AUDIT_LOG_HEADERS = [
  "log_id",
  "timestamp",
  "level",
  "event_name",
  "session_id",
  "route",
  "app_version",
  "data_version",
  "event_id",
  "match_id",
  "class_id",
  "status",
  "message",
  "sanitized_payload_json",
];

var SCRIPT_PROPERTY_KEYS = {
  SPREADSHEET_ID: "TOURNAMENT_SPREADSHEET_ID",
};

function doGet(e) {
  try {
    var page = (e && e.parameter && e.parameter.page) || "";
    if (page === "setup") {
      return HtmlService.createHtmlOutput(buildSetupPageHtml_())
        .setTitle("球技大会セットアップ")
        .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
    }
    var action = (e && e.parameter && e.parameter.action) || "bootstrap";
    if (action === "bootstrap") {
      return jsonOutput_(buildBootstrapResponse_());
    }
    if (action === "meta") {
      return jsonOutput_(buildMetaResponse_());
    }
    return jsonOutput_(errorResponse_("SERVER_ERROR", "Unknown action"));
  } catch (error) {
    return jsonOutput_(mapErrorResponse_(error));
  }
}

function doPost(e) {
  try {
    var payload = parsePostBody_(e);
    var action = payload.action || "";
    if (action === "setupCsvBundle") {
      return jsonOutput_(setupFromCsvTexts(payload.csvTexts || {}));
    }
    if (action === "submitResult") {
      return jsonOutput_(submitResult_(payload));
    }
    return jsonOutput_(errorResponse_("SERVER_ERROR", "Unknown action"));
  } catch (error) {
    return jsonOutput_(mapErrorResponse_(error));
  }
}

function setupFromCsvTexts(csvTexts) {
  return writeBundleToSheets_(
    {
      appConfigRows: parseCsvRows_(csvTexts["app_config.csv"], APP_CONFIG_HEADERS, "app_config.csv"),
      eventsRows: parseCsvRows_(csvTexts["events.csv"], EVENT_HEADERS, "events.csv"),
      teamsRows: parseCsvRows_(csvTexts["teams.csv"], TEAM_HEADERS, "teams.csv"),
      matchesRows: parseCsvRows_(csvTexts["matches.csv"], MATCH_HEADERS, "matches.csv"),
      auditLogRows: parseCsvRows_(csvTexts["audit_log.csv"], AUDIT_LOG_HEADERS, "audit_log.csv"),
    },
    "setup_csv_success",
    "csv bundle imported"
  );
}

function getSetupContext() {
  var appUrl = ScriptApp.getService().getUrl() || "";
  try {
    var spreadsheet = getSpreadsheet_();
    return {
      ok: true,
      bound: true,
      spreadsheetId: spreadsheet.getId(),
      spreadsheetName: spreadsheet.getName(),
      spreadsheetUrl: spreadsheet.getUrl(),
      appUrl: appUrl,
      existingSheets: spreadsheet.getSheets().map(function(sheet) {
        return sheet.getName();
      }),
    };
  } catch (error) {
    if (error && error.message === "SPREADSHEET_NOT_BOUND") {
      return {
        ok: true,
        bound: false,
        spreadsheetId: "",
        spreadsheetName: "",
        spreadsheetUrl: "",
        appUrl: appUrl,
        existingSheets: [],
      };
    }
    throw error;
  }
}

function bindSpreadsheetId(value) {
  var spreadsheetId = parseSpreadsheetId_(value);
  if (!spreadsheetId) {
    throw new Error("INVALID_SPREADSHEET_ID");
  }
  PropertiesService.getScriptProperties().setProperty(SCRIPT_PROPERTY_KEYS.SPREADSHEET_ID, spreadsheetId);
  return getSetupContext();
}

function parsePostBody_(e) {
  if (!e || !e.postData || !e.postData.contents) {
    throw new Error("Missing request body");
  }
  return JSON.parse(e.postData.contents);
}

function jsonOutput_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}

function errorResponse_(code, message) {
  return {
    ok: false,
    errorCode: code,
    message: message,
  };
}

function mapErrorResponse_(error) {
  var message = (error && error.message) || "Unexpected error";
  if (message === "INVALID_SPREADSHEET_ID") {
    return errorResponse_("INVALID_SPREADSHEET_ID", "Invalid spreadsheet URL or ID.");
  }
  if (message === "SPREADSHEET_NOT_BOUND") {
    return errorResponse_("SPREADSHEET_NOT_BOUND", "Spreadsheet is not bound. Open ?page=setup to connect one.");
  }
  if (message.indexOf("Missing sheet:") === 0) {
    return errorResponse_("SETUP_REQUIRED", "Open ?page=setup and import the CSV files.");
  }
  return errorResponse_("SERVER_ERROR", message);
}

function writeBundleToSheets_(bundle, eventName, message) {
  var spreadsheet = getSpreadsheet_();
  var summary = {
    ok: true,
    spreadsheetId: spreadsheet.getId(),
    spreadsheetName: spreadsheet.getName(),
    spreadsheetUrl: spreadsheet.getUrl(),
    source: eventName,
    sheets: [],
    updatedAt: nowIso_(),
  };

  summary.sheets.push(writeSeedSheet_(SHEET_NAMES.APP_CONFIG, APP_CONFIG_HEADERS, bundle.appConfigRows));
  summary.sheets.push(writeSeedSheet_(SHEET_NAMES.EVENTS, EVENT_HEADERS, bundle.eventsRows));
  summary.sheets.push(writeSeedSheet_(SHEET_NAMES.TEAMS, TEAM_HEADERS, bundle.teamsRows));
  summary.sheets.push(writeSeedSheet_(SHEET_NAMES.MATCHES, MATCH_HEADERS, bundle.matchesRows));
  summary.sheets.push(writeSeedSheet_(SHEET_NAMES.AUDIT_LOG, AUDIT_LOG_HEADERS, bundle.auditLogRows));

  logEvent_({
    level: "info",
    event_name: eventName,
    status: "ok",
    message: message,
    sanitized_payload_json: JSON.stringify({
      sheets: summary.sheets,
    }),
  });

  return summary;
}

function parseCsvRows_(csvText, headers, fileName) {
  var text = String(csvText || "").replace(/^\uFEFF/, "");
  if (!text) {
    throw new Error("Missing CSV: " + fileName);
  }
  var matrix = Utilities.parseCsv(text);
  if (!matrix.length) {
    throw new Error("Empty CSV: " + fileName);
  }
  var actualHeaders = matrix[0];
  if (actualHeaders.join("\u0001") !== headers.join("\u0001")) {
    throw new Error("Header mismatch: " + fileName);
  }
  return matrix.slice(1).filter(function(row) {
    return row.some(function(value) {
      return String(value || "").trim() !== "";
    });
  }).map(function(row) {
    var item = {};
    headers.forEach(function(header, index) {
      item[header] = row[index] == null ? "" : String(row[index]);
    });
    return item;
  });
}

function parseSpreadsheetId_(value) {
  var source = String(value || "").trim();
  var match = source.match(/[-\w]{25,}/);
  return match ? match[0] : "";
}

function buildBootstrapResponse_() {
  var config = getConfigMap_();
  var payload = {
    ok: true,
    appVersion: config.app_version || "",
    dataVersion: config.data_version || "",
    currentWeatherMode: config.current_weather_mode || "sunny",
    generatedAt: nowIso_(),
    events: getRows_(SHEET_NAMES.EVENTS),
    teams: getRows_(SHEET_NAMES.TEAMS),
    matches: getRows_(SHEET_NAMES.MATCHES),
    announcements: config.announcement_text ? [config.announcement_text] : [],
  };
  logEvent_({
    level: "info",
    event_name: "bootstrap_success",
    status: "ok",
    message: "bootstrap served",
  });
  return payload;
}

function buildMetaResponse_() {
  var config = getConfigMap_();
  return {
    ok: true,
    appVersion: config.app_version || "",
    dataVersion: config.data_version || "",
    currentWeatherMode: config.current_weather_mode || "sunny",
    generatedAt: nowIso_(),
  };
}

function submitResult_(payload) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(5000);
  } catch (error) {
    logEvent_({
      level: "error",
      event_name: "result_submit_failed",
      match_id: payload.matchId || "",
      event_id: "",
      status: "failed",
      message: "lock failed",
      sanitized_payload_json: JSON.stringify({ errorCode: "LOCK_FAILED" }),
      session_id: payload.clientContext && payload.clientContext.sessionId,
      route: payload.clientContext && payload.clientContext.route,
      app_version: payload.clientContext && payload.clientContext.appVersion,
    });
    return errorResponse_("LOCK_FAILED", "Another update is in progress");
  }

  try {
    validateEditorPin_(payload.editorPin);

    var headers = getSheet_(SHEET_NAMES.MATCHES).getDataRange().getValues()[0];
    var allMatches = getRows_(SHEET_NAMES.MATCHES);
    var byId = buildMatchesById_(allMatches);
    var targetMatch = byId[payload.matchId];

    if (!targetMatch) {
      return errorResponse_("MATCH_NOT_FOUND", "Match not found");
    }

    var eventMatches = allMatches.filter(function(match) {
      return match.event_id === targetMatch.event_id;
    });
    recalculateEventMatches_(eventMatches);

    targetMatch = buildMatchesById_(eventMatches)[payload.matchId];
    var hadWinner = !!targetMatch.winner_team_id;
    if (payload.clearResult) {
      targetMatch.winner_team_id = "";
      targetMatch.loser_team_id = "";
      targetMatch.score_text = "";
      targetMatch.correction_note = "";
    } else {
      if (!targetMatch.resolved_top_team_id || !targetMatch.resolved_bottom_team_id) {
        return errorResponse_("MATCH_NOT_READY", "Participants are not ready");
      }
      if (payload.winnerTeamId !== targetMatch.resolved_top_team_id && payload.winnerTeamId !== targetMatch.resolved_bottom_team_id) {
        return errorResponse_("WINNER_NOT_IN_MATCH", "Winner not in match");
      }
      targetMatch.winner_team_id = payload.winnerTeamId;
      targetMatch.loser_team_id = payload.winnerTeamId === targetMatch.resolved_top_team_id ? targetMatch.resolved_bottom_team_id : targetMatch.resolved_top_team_id;
      targetMatch.score_text = payload.scoreText || "";
      targetMatch.correction_note = hadWinner ? (payload.correctionNote || "corrected") : (payload.correctionNote || "");
    }
    targetMatch.updated_at = nowIso_();
    targetMatch.updated_by_session = (payload.clientContext && payload.clientContext.sessionId) || "";

    recalculateEventMatches_(eventMatches);

    var updatedEventMatchesById = buildMatchesById_(eventMatches);
    allMatches = allMatches.map(function(match) {
      return updatedEventMatchesById[match.match_id] || match;
    });
    setRows_(SHEET_NAMES.MATCHES, headers, allMatches);

    var dataVersion = nextDataVersion_();
    updateConfigValue_("data_version", dataVersion, "Updated by submitResult");

    logEvent_({
      level: payload.clearResult || hadWinner ? "warn" : "info",
      event_name: payload.clearResult ? "result_deleted" : hadWinner ? "result_corrected" : "result_submit_success",
      session_id: payload.clientContext && payload.clientContext.sessionId,
      route: payload.clientContext && payload.clientContext.route,
      app_version: payload.clientContext && payload.clientContext.appVersion,
      data_version: dataVersion,
      event_id: targetMatch.event_id,
      match_id: targetMatch.match_id,
      status: "ok",
      message: payload.clearResult ? "result deleted" : hadWinner ? "result corrected" : "winner saved",
      sanitized_payload_json: JSON.stringify({
        winnerTeamId: payload.winnerTeamId,
        scoreText: payload.scoreText || "",
        clearResult: !!payload.clearResult,
      }),
    });

    return {
      ok: true,
      dataVersion: dataVersion,
      updatedEventId: targetMatch.event_id,
      updatedMatches: eventMatches,
      updatedAt: nowIso_(),
    };
  } catch (error) {
    logEvent_({
      level: "error",
      event_name: "result_submit_failed",
      session_id: payload.clientContext && payload.clientContext.sessionId,
      route: payload.clientContext && payload.clientContext.route,
      app_version: payload.clientContext && payload.clientContext.appVersion,
      match_id: payload.matchId || "",
      status: "failed",
      message: error.message || "submit failed",
      sanitized_payload_json: JSON.stringify({
        errorCode: error.message || "SERVER_ERROR",
      }),
    });
    return errorResponse_(error.message || "SERVER_ERROR", error.message || "submit failed");
  } finally {
    lock.releaseLock();
  }
}

function validateEditorPin_(editorPin) {
  if (!isEditorPinRequired_()) {
    return;
  }
  var expectedHash = getConfigValue_("editor_pin_sha256", "");
  if (!expectedHash || hashPin_(editorPin || "") !== expectedHash) {
    throw new Error("INVALID_PIN");
  }
}

function isEditorPinRequired_() {
  var raw = String(getConfigValue_("require_editor_pin", "false")).toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes" || raw === "on";
}

function buildMatchesById_(matches) {
  var byId = {};
  matches.forEach(function(match) {
    byId[match.match_id] = match;
  });
  return byId;
}

function resolveSlot_(matchesById, slotType, slotRef) {
  if (slotType === "team") {
    return slotRef;
  }
  if (slotType === "bye") {
    return "";
  }
  var upstream = matchesById[slotRef];
  if (!upstream) {
    return "";
  }
  return slotType === "winner" ? upstream.winner_team_id : upstream.loser_team_id;
}

function recalculateEventMatches_(matches) {
  matches.sort(function(a, b) {
    return Number(a.display_order) - Number(b.display_order);
  });
  var byId = buildMatchesById_(matches);

  matches.forEach(function(match) {
    match.resolved_top_team_id = resolveSlot_(byId, match.slot_top_type, match.slot_top_ref);
    match.resolved_bottom_team_id = resolveSlot_(byId, match.slot_bottom_type, match.slot_bottom_ref);

    var topTeam = match.resolved_top_team_id;
    var bottomTeam = match.resolved_bottom_team_id;
    var topIsBye = match.slot_top_type === "bye";
    var bottomIsBye = match.slot_bottom_type === "bye";

    if (match.winner_team_id && match.winner_team_id !== topTeam && match.winner_team_id !== bottomTeam) {
      match.winner_team_id = "";
      match.loser_team_id = "";
      match.score_text = "";
      match.correction_note = "";
      match.updated_at = "";
      match.updated_by_session = "";
    }

    if (!match.winner_team_id) {
      if (topTeam && bottomIsBye) {
        match.winner_team_id = topTeam;
        match.loser_team_id = "";
      } else if (bottomTeam && topIsBye) {
        match.winner_team_id = bottomTeam;
        match.loser_team_id = "";
      }
    }

    if (match.winner_team_id) {
      if (match.winner_team_id === topTeam) {
        match.loser_team_id = bottomTeam;
      } else if (match.winner_team_id === bottomTeam) {
        match.loser_team_id = topTeam;
      }
      match.status = match.correction_note ? "corrected" : "completed";
    } else if (topTeam && bottomTeam) {
      match.status = "ready";
    } else {
      match.status = "scheduled";
    }
  });
}

function logEvent_(payload) {
  try {
    appendLogRow_({
      log_id: "log-" + new Date().getTime(),
      timestamp: nowIso_(),
      level: payload.level || "info",
      event_name: payload.event_name || "unknown",
      session_id: payload.session_id || "",
      route: payload.route || "",
      app_version: payload.app_version || "",
      data_version: payload.data_version || getConfigValue_("data_version", ""),
      event_id: payload.event_id || "",
      match_id: payload.match_id || "",
      class_id: payload.class_id || "",
      status: payload.status || "",
      message: payload.message || "",
      sanitized_payload_json: payload.sanitized_payload_json || "",
    });
  } catch (error) {
    Logger.log("logEvent_ failed: " + error.message);
  }
}

function nowIso_() {
  return Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyy-MM-dd'T'HH:mm:ss'+09:00'");
}

function nextDataVersion_() {
  return Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyyMMddHHmmss");
}

function getSpreadsheet_() {
  var active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) {
    return active;
  }
  var storedId = PropertiesService.getScriptProperties().getProperty(SCRIPT_PROPERTY_KEYS.SPREADSHEET_ID);
  if (storedId) {
    return SpreadsheetApp.openById(storedId);
  }
  throw new Error("SPREADSHEET_NOT_BOUND");
}

function getSheet_(sheetName) {
  var sheet = getSpreadsheet_().getSheetByName(sheetName);
  if (!sheet) {
    throw new Error("Missing sheet: " + sheetName);
  }
  return sheet;
}

function getRows_(sheetName) {
  var sheet = getSheet_(sheetName);
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) {
    return [];
  }
  var headers = values[0];
  return values.slice(1).map(function(row) {
    var item = {};
    headers.forEach(function(header, index) {
      item[header] = normalizeCellValue_(header, row[index]);
    });
    return item;
  });
}

function normalizeCellValue_(header, value) {
  if (value === null || value === undefined) {
    return "";
  }
  if (Object.prototype.toString.call(value) === "[object Date]" && !isNaN(value.getTime())) {
    if (header === "start_time") {
      return Utilities.formatDate(value, "Asia/Tokyo", "HH:mm");
    }
    if (header === "updated_at" || header === "timestamp") {
      return Utilities.formatDate(value, "Asia/Tokyo", "yyyy-MM-dd'T'HH:mm:ss'+09:00'");
    }
    return Utilities.formatDate(value, "Asia/Tokyo", "yyyy-MM-dd");
  }
  return String(value);
}

function setRows_(sheetName, headers, rows) {
  var sheet = getSheet_(sheetName);
  writeSheetValues_(sheet, headers, rows);
}

function getConfigRows_() {
  return getRows_(SHEET_NAMES.APP_CONFIG);
}

function getConfigMap_() {
  var map = {};
  getConfigRows_().forEach(function(row) {
    map[row.key] = row.value;
  });
  return map;
}

function getConfigValue_(key, fallback) {
  var map = getConfigMap_();
  if (Object.prototype.hasOwnProperty.call(map, key)) {
    return map[key];
  }
  return fallback;
}

function updateConfigValue_(key, value, note) {
  var rows = getRows_(SHEET_NAMES.APP_CONFIG);
  var headers = getSheet_(SHEET_NAMES.APP_CONFIG).getDataRange().getValues()[0];
  var found = false;
  rows.forEach(function(row) {
    if (row.key === key) {
      row.value = value;
      row.note = note || row.note;
      row.updated_at = nowIso_();
      found = true;
    }
  });
  if (!found) {
    rows.push({
      key: key,
      value: value,
      note: note || "",
      updated_at: nowIso_(),
    });
  }
  setRows_(SHEET_NAMES.APP_CONFIG, headers, rows);
}

function hashPin_(pin) {
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, pin, Utilities.Charset.UTF_8);
  return digest
    .map(function(byte) {
      var value = byte;
      if (value < 0) {
        value += 256;
      }
      return ("0" + value.toString(16)).slice(-2);
    })
    .join("");
}

function appendLogRow_(row) {
  var sheet = getSheet_(SHEET_NAMES.AUDIT_LOG);
  var values = AUDIT_LOG_HEADERS.map(function(header) {
    return row[header] == null ? "" : row[header];
  });
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, AUDIT_LOG_HEADERS.length).setValues([AUDIT_LOG_HEADERS]);
  }
  sheet.appendRow(values);
}

function writeSeedSheet_(sheetName, headers, rows) {
  var spreadsheet = getSpreadsheet_();
  var sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(sheetName);
  }
  writeSheetValues_(sheet, headers, rows);
  sheet.setFrozenRows(1);
  return {
    sheetName: sheetName,
    rowCount: rows.length,
  };
}

function writeSheetValues_(sheet, headers, rows) {
  var values = [headers].concat(
    rows.map(function(row) {
      return headers.map(function(header) {
        return row[header] == null ? "" : row[header];
      });
    })
  );
  sheet.clearContents();
  sheet.getRange(1, 1, values.length, headers.length).setValues(values);
}

function buildSetupPageHtml_() {
  var appUrl = ScriptApp.getService().getUrl() || "";
  return [
    '<!doctype html>',
    '<html lang="ja">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>球技大会セットアップ</title>',
    '<style>',
    'body{margin:0;font-family:"BIZ UDPGothic","Hiragino Kaku Gothic ProN","Meiryo",sans-serif;background:linear-gradient(180deg,#fff9f2,#f2e7d4);color:#27404c;}',
    '.wrap{max-width:960px;margin:0 auto;padding:24px 16px 40px;}',
    '.hero,.panel{background:rgba(255,252,247,.95);border:1px solid rgba(39,64,76,.12);border-radius:28px;box-shadow:0 20px 44px rgba(39,64,76,.1);padding:22px 18px;}',
    '.hero{background:linear-gradient(135deg,#294f63 0%,#36667f 38%,#ff8358 38%,#ff9b6c 100%);color:#fffdf9;}',
    '.hero h1{margin:0 0 8px;font-size:2rem;}',
    '.hero p{margin:0;line-height:1.7;}',
    '.stack{display:grid;gap:16px;margin-top:18px;}',
    '.grid{display:grid;gap:16px;}',
    '.muted{color:#60717a;}',
    '.pill{display:inline-flex;align-items:center;padding:6px 10px;border-radius:999px;background:rgba(255,255,255,.18);font-size:.8rem;margin-bottom:10px;}',
    '.row{display:flex;flex-wrap:wrap;gap:10px;align-items:center;}',
    '.button{cursor:pointer;border:none;border-radius:16px;padding:12px 16px;font:inherit;background:#fff;color:#27404c;box-shadow:0 10px 18px rgba(39,64,76,.08);}',
    '.button.primary{background:linear-gradient(135deg,#ff8358,#ff9b6c);color:#fffefb;}',
    '.button.ghost{background:transparent;border:1px solid rgba(39,64,76,.14);box-shadow:none;}',
    '.button:disabled{opacity:.45;cursor:not-allowed;}',
    '.dropzone{border:2px dashed rgba(39,64,76,.18);border-radius:24px;padding:26px 18px;text-align:center;background:rgba(255,255,255,.72);}',
    '.dropzone.dragover{border-color:#ff8358;background:rgba(255,131,88,.08);}',
    '.files{display:grid;gap:8px;margin-top:12px;}',
    '.file{display:flex;justify-content:space-between;gap:12px;padding:10px 12px;border-radius:14px;background:rgba(39,64,76,.05);}',
    '.ok{color:#2b8f67;font-weight:700;}',
    '.warn{color:#c85d43;font-weight:700;}',
    '.status{padding:12px 14px;border-radius:16px;background:rgba(255,255,255,.78);border:1px solid rgba(39,64,76,.08);white-space:pre-wrap;line-height:1.7;}',
    'input[type=text]{width:100%;border-radius:16px;border:1px solid rgba(39,64,76,.16);padding:12px 14px;font:inherit;}',
    'code{background:rgba(39,64,76,.06);padding:2px 6px;border-radius:8px;}',
    '@media (min-width:800px){.grid{grid-template-columns:minmax(0,1fr) minmax(0,1fr);}}',
    '</style>',
    '</head>',
    '<body>',
    '<div class="wrap">',
    '<section class="hero">',
    '<div class="pill">GAS Setup</div>',
    '<h1>球技大会 セットアップ</h1>',
    '<p>この画面では、接続先スプレッドシートの紐付けと CSV 5 ファイルの投入だけを行います。初期データは埋め込まず、CSV をそのまま反映します。</p>',
    '</section>',
    '<div class="stack">',
    '<section class="panel">',
    '<h2>1. 接続先の確認</h2>',
    '<div id="context" class="status">接続先を確認しています...</div>',
    '<div id="bind-box" class="stack" style="display:none;margin-top:14px;">',
    '<p class="muted">この GAS がスプレッドシートに紐付いていない場合は、対象スプレッドシートの URL または ID を入力してください。</p>',
    '<input id="spreadsheet-id-input" type="text" placeholder="https://docs.google.com/spreadsheets/d/... またはスプレッドシートID">',
    '<div class="row"><button id="bind-button" class="button">このスプレッドシートに紐付ける</button></div>',
    '</div>',
    '</section>',
    '<section class="panel">',
    '<h2>2. CSV をドラッグして投入</h2>',
    '<p class="muted">このリポジトリの <code>seed/output</code> にある 5 ファイルを、そのままこの画面へドラッグしてください。</p>',
    '<p class="muted">必要なファイル: <code>app_config.csv</code> / <code>events.csv</code> / <code>teams.csv</code> / <code>matches.csv</code> / <code>audit_log.csv</code></p>',
    '<div id="dropzone" class="dropzone">',
    '<p><strong>ここへ CSV をドラッグ</strong></p>',
    '<p class="muted">または下のボタンから選択します。</p>',
    '<input id="file-input" type="file" accept=".csv" multiple style="display:none;">',
    '<button id="pick-button" class="button" type="button">CSV を選ぶ</button>',
    '</div>',
    '<div id="files" class="files"></div>',
    '<div class="row" style="margin-top:12px;">',
    '<button id="csv-button" class="button primary" disabled>CSV を投入する</button>',
    '<a class="button ghost" href="' + appUrl + '" target="_blank" rel="noreferrer">Web App を開く</a>',
    '</div>',
    '</section>',
    '<section class="panel">',
    '<h2>3. 実行結果</h2>',
    '<div id="result" class="status">まだ実行していません。</div>',
    '</section>',
    '</div>',
    '</div>',
    '<script>',
    'const REQUIRED_FILES=["app_config.csv","events.csv","teams.csv","matches.csv","audit_log.csv"];',
    'const loadedFiles={};',
    'function byId(id){return document.getElementById(id);}',
    'function setResult(message,isError){const el=byId("result");el.textContent=message;el.className="status "+(isError?"warn":"");}',
    'function renderFiles(){const html=REQUIRED_FILES.map((name)=>{const ok=Object.prototype.hasOwnProperty.call(loadedFiles,name);return `<div class="file"><span>${name}</span><span class="${ok?"ok":"warn"}">${ok?"読み込み済み":"未選択"}</span></div>`;}).join("");byId("files").innerHTML=html;byId("csv-button").disabled=!REQUIRED_FILES.every((name)=>Object.prototype.hasOwnProperty.call(loadedFiles,name));}',
    'function readFiles(fileList){const jobs=[...fileList].filter((file)=>REQUIRED_FILES.includes(file.name)).map((file)=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>{loadedFiles[file.name]=reader.result;resolve();};reader.onerror=()=>reject(reader.error||new Error("FILE_READ_ERROR"));reader.readAsText(file,"utf-8");}));return Promise.all(jobs).then(renderFiles);}',
    'function showContext(context){if(context.bound){byId("context").textContent=`接続先: ${context.spreadsheetName}\\n${context.spreadsheetUrl || context.spreadsheetId}`;byId("bind-box").style.display="none";}else{byId("context").textContent="この GAS はまだスプレッドシートに紐付いていません。";byId("bind-box").style.display="grid";}}',
    'function loadContext(){google.script.run.withSuccessHandler(showContext).withFailureHandler((error)=>setResult(String((error&&error.message)||error),true)).getSetupContext();}',
    'function runCsvSetup(){setResult("CSV を投入しています...",false);google.script.run.withSuccessHandler((summary)=>{setResult(`CSV の投入が完了しました。\\n${summary.spreadsheetName}\\n${summary.sheets.map((sheet)=>`${sheet.sheetName}: ${sheet.rowCount}行`).join("\\n")}`,false);loadContext();}).withFailureHandler((error)=>setResult(String((error&&error.message)||error),true)).setupFromCsvTexts(loadedFiles);}',
    'function bindSpreadsheet(){const value=byId("spreadsheet-id-input").value.trim();if(!value){setResult("スプレッドシート URL または ID を入力してください。",true);return;}google.script.run.withSuccessHandler((context)=>{setResult("スプレッドシートを紐付けました。",false);showContext(context);}).withFailureHandler((error)=>setResult(String((error&&error.message)||error),true)).bindSpreadsheetId(value);}',
    'const dropzone=byId("dropzone");',
    'dropzone.addEventListener("dragover",(event)=>{event.preventDefault();dropzone.classList.add("dragover");});',
    'dropzone.addEventListener("dragleave",()=>dropzone.classList.remove("dragover"));',
    'dropzone.addEventListener("drop",(event)=>{event.preventDefault();dropzone.classList.remove("dragover");readFiles(event.dataTransfer.files).catch((error)=>setResult(String((error&&error.message)||error),true));});',
    'byId("pick-button").addEventListener("click",()=>byId("file-input").click());',
    'byId("file-input").addEventListener("change",(event)=>{readFiles(event.target.files).catch((error)=>setResult(String((error&&error.message)||error),true));});',
    'byId("csv-button").addEventListener("click",runCsvSetup);',
    'byId("bind-button").addEventListener("click",bindSpreadsheet);',
    'renderFiles();',
    'loadContext();',
    '</script>',
    '</body>',
    '</html>',
  ].join("");
}
