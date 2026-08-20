/**
 * Lab-meeting calendar sync — Google Apps Script.
 *
 * Reads the lab-meeting sheet and writes the schedule straight into the shared
 * "Palmigiano Lab" calendar, so everyone who already has that calendar sees
 * changes immediately. Runs inside the lab's own Google account on a daily
 * trigger: no API keys, no service account, nothing stored outside Google.
 *
 * The website page and the .ics feed are generated separately by
 * scripts/lab_meetings.py from the same sheet, and follow the same rules.
 *
 * WHICH ACCOUNT TO RUN IT AS
 *   Authorising this grants access to *all* of that account's calendars and
 *   sheets — Apps Script has no per-calendar scope — so prefer the lab's own
 *   Google account over a personal one. It addresses the sheet by ID rather
 *   than being bound to it, so it runs perfectly well as a standalone project
 *   created at script.google.com. The lab account needs "Make changes to
 *   events" on the calendar below; view-only is not enough. Sign in as that
 *   account *before* creating the project — in a separate browser profile or a
 *   private window — or the project silently belongs to whoever was signed in.
 *
 * SETUP (once)
 *   1. Either open the sheet -> Extensions -> Apps Script, or create a
 *      standalone project at script.google.com. Paste this file in.
 *   2. Project Settings -> Time zone -> London.  The dropdown labels it with
 *      whatever offset is in force today, so it reads (GMT+01:00) London in
 *      summer and (GMT+00:00) London in winter — either is the right entry, it
 *      is the same Europe/London region and it follows the clocks by itself.
 *      Do NOT pick a bare "GMT+00:00" or "UTC" with no city: those never shift,
 *      so every meeting would be an hour out for half the year.  This matters
 *      because the script builds 13:00 in the project's zone.
 *      Run `checkTimeZone` afterwards to confirm it took.
 *   3. Run `syncLabMeetings` once by hand and grant the two permissions it asks
 *      for (read this spreadsheet, manage this calendar).
 *   4. Run `installDailyTrigger` once. From then on it syncs itself each night.
 *
 * To stop it, delete the trigger under Triggers in the Apps Script sidebar.
 */

const SHEET_ID = "1eFwE60c2c8yb65StrekVcHklJR5QyfKbMxsZOxgz4FI";
const SHEET_GID = 44289246;
const CALENDAR_ID =
  "f5c9488f769b31385a47399999bf7a34584471674f33bc82386c4742411be9dd@group.calendar.google.com";

const DEFAULT_TIME = "13:00";
const DURATION_MINUTES = 60;
const LOCATION = "Gatsby seminar room";
const SCHEDULE_URL = "https://palmigianolab.com/meetings/";

// Stamped on every event this script creates, so it only ever touches its own
// entries and leaves deadlines, socials and anything hand-added alone.
const TAG_KEY = "labMeetingSync";
const TAG_VALUE = "sheet";

const CANCELLED_RE = /^\s*(cancell?ed|no lab meeting|summer break)\b/i;
const TIME_RE = /^\d{1,2}[:.]\d{2}(\s*[ap]\.?m\.?)?$|^\d{1,2}\s*[ap]\.?m\.?$/i;

const HEADER_ALIASES = {
  date: "date", day: "date", when: "date",
  time: "time", hora: "time", start: "time",
  who: "who", presenter: "who", speaker: "who", name: "who",
  topic: "topic", title: "topic",
  link: "link", url: "link",
  notes: "notes", note: "notes",
};

// --- reading the sheet --------------------------------------------------

function readRows() {
  const sheets = SpreadsheetApp.openById(SHEET_ID).getSheets();
  const sheet = sheets.filter(function (s) {
    return s.getSheetId() === SHEET_GID;
  })[0];
  if (!sheet) throw new Error("No tab with gid " + SHEET_GID + " in the sheet.");
  return sheet.getDataRange().getValues();
}

function toDate(value) {
  if (value instanceof Date && !isNaN(value)) return value;
  const text = String(value || "").trim();
  const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); // M/D/YYYY
  if (match) return new Date(+match[3], +match[1] - 1, +match[2]);
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return new Date(+iso[1], +iso[2] - 1, +iso[3]);
  return null;
}

function toTime(value) {
  if (value instanceof Date && !isNaN(value)) {
    return [value.getHours(), value.getMinutes()];
  }
  const text = String(value || "").trim();
  const match = text.match(/^(\d{1,2})[:.](\d{2})/);
  if (match) return [+match[1], +match[2]];
  const parts = DEFAULT_TIME.split(":");
  return [+parts[0], +parts[1]];
}

/** Locate columns by their header, mirroring scripts/lab_meetings.py. */
function detectColumns(rows) {
  let columns = null;
  for (let r = 0; r < rows.length && !columns; r++) {
    const found = {};
    rows[r].forEach(function (value, index) {
      const key = HEADER_ALIASES[String(value || "").trim().toLowerCase()];
      if (key && !(key in found)) found[key] = index;
    });
    if ("who" in found) columns = found;
  }
  if (!columns) columns = { date: 0, who: 1, topic: 2, link: 3, notes: 4 };
  if (!("date" in columns)) columns.date = 0;

  // A time column is often left unlabelled; sniff between date and who.
  if (!("time" in columns)) {
    const dated = rows.filter(function (row) {
      return toDate(row[columns.date]) !== null;
    });
    for (let i = columns.date + 1; i < columns.who; i++) {
      const hits = dated.filter(function (row) {
        const v = row[i];
        return v instanceof Date || TIME_RE.test(String(v || "").trim());
      }).length;
      if (dated.length && hits > dated.length / 2) {
        columns.time = i;
        break;
      }
    }
  }
  return columns;
}

function parseSchedule(rows) {
  const columns = detectColumns(rows);
  const get = function (row, key) {
    return key in columns ? String(row[columns[key]] || "").trim() : "";
  };

  const entries = [];
  rows.forEach(function (row) {
    const date = toDate(row[columns.date]);
    if (!date) return;
    const who = get(row, "who");
    const cancelled = !who || CANCELLED_RE.test(who);

    let reason = "";
    if (cancelled && who) {
      const match = who.match(CANCELLED_RE);
      reason = who.replace(CANCELLED_RE, "").replace(/^[\s\-–—:,]+/, "").trim();
      if (match[1].toLowerCase() === "summer break") reason = who;
    }

    const time = "time" in columns ? toTime(row[columns.time]) : toTime(null);
    entries.push({
      date: date,
      hours: time[0],
      minutes: time[1],
      who: who,
      topic: get(row, "topic"),
      notes: get(row, "notes"),
      cancelled: cancelled,
      reason: reason,
    });
  });
  entries.sort(function (a, b) {
    return a.date - b.date;
  });
  return entries;
}

// --- writing to the calendar --------------------------------------------

function titleFor(entry) {
  if (entry.cancelled) {
    return entry.reason ? "No lab meeting — " + entry.reason : "No lab meeting";
  }
  return "Lab meeting — " + entry.who + (entry.topic ? ": " + entry.topic : "");
}

function descriptionFor(entry) {
  const lines = [];
  if (entry.topic && !entry.cancelled) lines.push("Topic: " + entry.topic);
  if (entry.notes) lines.push(entry.notes);
  lines.push("Schedule: " + SCHEDULE_URL);
  return lines.join("\n");
}

function dayKey(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), "yyyy-MM-dd");
}

function syncLabMeetings() {
  const entries = parseSchedule(readRows());
  if (!entries.length) throw new Error("No dated rows found — has the sheet moved?");

  const calendar = CalendarApp.getCalendarById(CALENDAR_ID);
  if (!calendar) {
    throw new Error(
      "Cannot open the calendar. Check CALENDAR_ID, and that this account may edit it."
    );
  }

  let created = 0, updated = 0, removed = 0;
  const wanted = {};

  entries.forEach(function (entry) {
    const start = new Date(
      entry.date.getFullYear(), entry.date.getMonth(), entry.date.getDate(),
      entry.hours, entry.minutes, 0, 0
    );
    const end = new Date(start.getTime() + DURATION_MINUTES * 60 * 1000);
    wanted[dayKey(start)] = true;

    // Only ever consider events this script made.
    const ours = calendar.getEventsForDay(start).filter(function (event) {
      return event.getTag(TAG_KEY) === TAG_VALUE;
    });

    const title = titleFor(entry);
    const description = descriptionFor(entry);
    const location = entry.cancelled ? "" : LOCATION;

    if (!ours.length) {
      const event = calendar.createEvent(title, start, end, {
        description: description,
        location: location,
      });
      event.setTag(TAG_KEY, TAG_VALUE);
      created++;
      return;
    }

    const event = ours[0];
    let changed = false;
    if (event.getTitle() !== title) { event.setTitle(title); changed = true; }
    if (event.getDescription() !== description) { event.setDescription(description); changed = true; }
    if (event.getLocation() !== location) { event.setLocation(location); changed = true; }
    if (event.getStartTime().getTime() !== start.getTime() ||
        event.getEndTime().getTime() !== end.getTime()) {
      event.setTime(start, end);
      changed = true;
    }
    if (changed) updated++;

    ours.slice(1).forEach(function (duplicate) { // tidy any stray duplicates
      duplicate.deleteEvent();
      removed++;
    });
  });

  // Drop our events on days the sheet no longer lists (a deleted row).
  const first = entries[0].date;
  const last = entries[entries.length - 1].date;
  const windowEnd = new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1);
  calendar.getEvents(first, windowEnd).forEach(function (event) {
    if (event.getTag(TAG_KEY) !== TAG_VALUE) return;
    if (!wanted[dayKey(event.getStartTime())]) {
      event.deleteEvent();
      removed++;
    }
  });

  const summary =
    entries.length + " slots — created " + created + ", updated " + updated +
    ", removed " + removed;
  console.log(summary);
  return summary;
}

/**
 * Diagnostic: lists every calendar this account can reach, with its id and
 * whether this account may edit it. Run this when syncLabMeetings reports
 * "Cannot open the calendar" — if CALENDAR_ID is not in the list, the calendar
 * has not been shared with the account running the script.
 */
function listMyCalendars() {
  const lines = CalendarApp.getAllCalendars().map(function (calendar) {
    const id = calendar.getId();
    return (id === CALENDAR_ID ? "  >> " : "     ") +
      calendar.getName() + "  [" + id + "]" +
      (calendar.isOwnedByMe() ? "  (owned)" : "") +
      (id === CALENDAR_ID ? "   <-- this is the one the script wants" : "");
  });
  const reachable = CalendarApp.getCalendarById(CALENDAR_ID) !== null;
  const message =
    "Calendars visible to " + Session.getEffectiveUser().getEmail() + ":\n" +
    lines.join("\n") + "\n\nCALENDAR_ID reachable: " + reachable;
  console.log(message);
  return message;
}

/**
 * Confirms the project time zone follows British Summer Time. Expect:
 *   Europe/London — January 13:00 is GMT (+0000), July 13:00 is BST (+0100)
 * If both show the same offset, the wrong zone is set: see step 2 above.
 */
function checkTimeZone() {
  const zone = Session.getScriptTimeZone();
  const winter = Utilities.formatDate(new Date(2026, 0, 15, 13, 0), zone, "Z z");
  const summer = Utilities.formatDate(new Date(2026, 6, 15, 13, 0), zone, "Z z");
  const message =
    zone + " — January 13:00 is " + winter + ", July 13:00 is " + summer +
    (winter === summer ? "  <-- WRONG: this zone does not follow the clocks" : "  (correct)");
  console.log(message);
  return message;
}

/** Run once: sync every night. Safe to re-run, it replaces its own trigger. */
function installDailyTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === "syncLabMeetings") {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  ScriptApp.newTrigger("syncLabMeetings").timeBased().atHour(5).everyDays(1).create();
  console.log("Daily trigger installed — syncLabMeetings runs about 05:00.");
}
