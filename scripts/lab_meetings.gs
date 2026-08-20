/**
 * Lab-meeting calendar sync — Google Apps Script.
 *
 * Reads the lab-meeting sheet and writes the schedule straight into the shared
 * "Palmigiano Lab" calendar, so everyone who already has that calendar sees
 * changes immediately. Runs inside the lab's own Google account on a daily
 * trigger: no API keys, no service account, nothing stored outside Google.
 *
 * The website page at palmigianolab.com/meetings is generated separately by
 * scripts/lab_meetings.py from the same sheet, following the same rules. That
 * script deliberately emits no .ics: this calendar is the only one, so the two
 * cannot drift apart.
 *
 * NOTE: this file is a version-controlled copy. The code that actually runs
 * lives in the Apps Script editor, and nothing syncs between them — after
 * editing here, paste it back in, and vice versa.
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

// Used only when a row has no explicit date in the "Reminder email date" column.
const REMINDER_DAYS = 10;

// Signs the reminders, and shown as the sender's name in the recipient's inbox.
const SENDER_NAME = "PalmiBot";
const MEETING_NAME = "Agos' lab meeting";
const SHEET_URL =
  "https://docs.google.com/spreadsheets/d/" + SHEET_ID + "/edit?gid=" + SHEET_GID;

// Stamped on every event this script creates, so it only ever touches its own
// entries and leaves deadlines, socials and anything hand-added alone.
const TAG_KEY = "labMeetingSync";
const TAG_VALUE = "sheet";

const CANCELLED_RE = /^\s*(cancell?ed|no lab meeting|summer break)\b/i;
const TIME_RE = /^\d{1,2}[:.]\d{2}(\s*[ap]\.?m\.?)?$|^\d{1,2}\s*[ap]\.?m\.?$/i;

const HEADER_ALIASES = {
  date: "date", day: "date", when: "date", "talk date": "date",
  time: "time", hora: "time", start: "time",
  who: "who", presenter: "who", speaker: "who", name: "who",
  "presenter's name": "who",
  topic: "topic", title: "topic", "presentation title": "topic",
  link: "link", url: "link", links: "link",
  notes: "notes", note: "notes",
  email: "email", emails: "email",
  reminder: "reminder", "reminder email date": "reminder",
};

/** Trim, lowercase and flatten curly apostrophes, so "Presenter's Name" matches. */
function headerKey(value) {
  return String(value || "").trim().toLowerCase().replace(/\u2019/g, "'");
}

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
      const key = HEADER_ALIASES[headerKey(value)];
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
      email: get(row, "email"),
      // Column E holds an explicit reminder date; fall back to REMINDER_DAYS before.
      reminder: "reminder" in columns
        ? toDate(row[columns.reminder]) || addDays(date, -REMINDER_DAYS)
        : addDays(date, -REMINDER_DAYS),
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

// --- reminder emails ----------------------------------------------------

function addDays(date, days) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function longDate(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), "EEEE d MMMM yyyy");
}

/** A cell may hold several addresses, comma or semicolon separated. */
function recipientsFor(value) {
  return String(value || "")
    .split(/[,;]+/)
    .map(function (part) { return part.trim(); })
    .filter(function (part) { return /^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$/.test(part); });
}

function reminderSubject(entry) {
  return "You are presenting on " + longDate(entry.date);
}

function timeOf(entry) {
  return ("0" + entry.hours).slice(-2) + ":" + ("0" + entry.minutes).slice(-2);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** The greeting and first sentence, shared by the plain-text and HTML versions. */
function reminderOpening(entry) {
  const when = longDate(entry.date) + " at " + timeOf(entry);
  // A group slot puts the session description in the name column, not a person.
  if (recipientsFor(entry.email).length > 1) {
    return "Hi all,\n\nYou are scheduled to present in " + MEETING_NAME + " on " +
      when + ": " + entry.who + ".";
  }
  return "Hi " + entry.who + ",\n\nYou are scheduled to present in " + MEETING_NAME +
    " on " + when + ". " +
    (entry.topic
      ? "The current title of your talk is " + entry.topic + "."
      : "The spreadsheet does not have a title for your talk yet — please add one.");
}

const REMINDER_TAIL =
  " If you can no longer make this date please find someone that is willing to " +
  "swap with you and modify the ";

function reminderBody(entry) {
  return (
    reminderOpening(entry) + REMINDER_TAIL + "Schedule sheet (" + SHEET_URL + ").\n\n" +
    "Cheers!\n\n" + SENDER_NAME
  );
}

/** Same words, with "Schedule sheet" as a link. */
function reminderHtml(entry) {
  const paragraphs = escapeHtml(reminderOpening(entry)).split("\n\n");
  const link = '<a href="' + SHEET_URL + '">Schedule sheet</a>';
  return (
    "<p>" + paragraphs[0] + "</p>" +
    "<p>" + paragraphs.slice(1).join(" ") + escapeHtml(REMINDER_TAIL) + link + ".</p>" +
    "<p>Cheers!</p><p>" + SENDER_NAME + "</p>"
  );
}

/** Meetings still to come that have a usable address. */
function reminderCandidates() {
  const today = startOfToday();
  return parseSchedule(readRows()).filter(function (entry) {
    return !entry.cancelled && entry.date >= today && recipientsFor(entry.email).length > 0;
  });
}

function reminderKey(entry) {
  return "reminded:" + Utilities.formatDate(entry.date, Session.getScriptTimeZone(), "yyyy-MM-dd");
}

/**
 * DRY RUN — sends nothing. Lists every upcoming presenter, the address the
 * reminder would go to, when it would be sent, and whether it already has been.
 * Run this after editing the sheet to check each name lines up with its address.
 */
function previewPresenterReminders() {
  const today = startOfToday();
  const sent = PropertiesService.getScriptProperties();
  const lines = reminderCandidates().map(function (entry) {
    const due = entry.reminder <= today;
    const already = sent.getProperty(reminderKey(entry)) !== null;
    return "  " + Utilities.formatDate(entry.date, Session.getScriptTimeZone(), "yyyy-MM-dd") +
      "  " + (entry.who + "                    ").slice(0, 20) +
      "  -> " + recipientsFor(entry.email).join(", ") +
      "   reminder " + Utilities.formatDate(entry.reminder, Session.getScriptTimeZone(), "yyyy-MM-dd") +
      (already ? "   [already sent]" : due ? "   [DUE — would send now]" : "");
  });
  const message =
    "DRY RUN, nothing sent. " + lines.length + " upcoming presenters with an address:\n" +
    lines.join("\n") +
    "\n\nCheck each name matches its address before running sendPresenterReminders.";
  console.log(message);
  return message;
}

/**
 * Emails whoever is due a reminder, once each. Sends from the account running
 * the script — no password anywhere; Gmail is reached through the same
 * authorisation you granted, not a stored credential.
 *
 * A reminder goes out when its date in column E has arrived (or, with that cell
 * empty, REMINDER_DAYS before the talk) and the talk has not yet happened. The
 * "already sent" note lives in script properties, so a missed night is caught up
 * the next morning rather than skipped, and nobody is emailed twice.
 */
function sendPresenterReminders() {
  const today = startOfToday();
  const sent = PropertiesService.getScriptProperties();
  const done = [];

  reminderCandidates().forEach(function (entry) {
    if (entry.reminder > today) return;           // not due yet
    const key = reminderKey(entry);
    if (sent.getProperty(key) !== null) return;   // already reminded

    MailApp.sendEmail(recipientsFor(entry.email).join(","), reminderSubject(entry),
      reminderBody(entry), { htmlBody: reminderHtml(entry), name: SENDER_NAME });
    sent.setProperty(key, Utilities.formatDate(today, Session.getScriptTimeZone(), "yyyy-MM-dd"));
    done.push(entry.who + " <" + entry.email + "> for " + longDate(entry.date));
  });

  const message = done.length
    ? "Sent " + done.length + " reminder(s):\n  " + done.join("\n  ")
    : "No reminders due today.";
  console.log(message);
  return message;
}

/**
 * Sends one sample reminder to yourself, built from the next upcoming presenter.
 * Changes nothing: the sheet is untouched, no sent-mark is recorded, and the
 * real recipients are not contacted. Use this to see the wording rather than
 * faking a row in the spreadsheet.
 */
function sendTestReminder() {
  const entry = reminderCandidates()[0];
  if (!entry) {
    console.log("Nothing upcoming with an address — nothing to preview.");
    return;
  }
  const me = Session.getEffectiveUser().getEmail();
  const note =
    "TEST COPY — this went only to you, and no sent-mark was recorded.\n" +
    "The real one goes to " + recipientsFor(entry.email).join(", ") +
    " on " + longDate(entry.reminder) + ".\n" +
    "----------------------------------------\n\n";
  MailApp.sendEmail(me, "[TEST] " + reminderSubject(entry), note + reminderBody(entry), {
    htmlBody: "<p style=\"color:#888\">" + escapeHtml(note).replace(/\n/g, "<br>") + "</p>" +
      reminderHtml(entry),
    name: SENDER_NAME,
  });
  console.log("Test reminder sent to " + me + ", for " + entry.who + "'s talk.");
}

/**
 * Forgets which reminders have been sent, so they can go out again. Only useful
 * if something went wrong and you want to re-send — normally leave alone.
 */
function resetReminderMemory() {
  const properties = PropertiesService.getScriptProperties();
  const keys = properties.getKeys().filter(function (k) { return k.indexOf("reminded:") === 0; });
  keys.forEach(function (k) { properties.deleteProperty(k); });
  console.log("Cleared " + keys.length + " sent-reminder marks.");
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

/**
 * Run once: sync the calendar nightly and send reminders each morning.
 * Safe to re-run — it replaces its own triggers rather than adding more.
 */
function installDailyTrigger() {
  const handlers = ["syncLabMeetings", "sendPresenterReminders"];
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (handlers.indexOf(trigger.getHandlerFunction()) !== -1) {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  ScriptApp.newTrigger("syncLabMeetings").timeBased().atHour(5).everyDays(1).create();
  ScriptApp.newTrigger("sendPresenterReminders").timeBased().atHour(9).everyDays(1).create();
  console.log(
    "Triggers installed — syncLabMeetings about 05:00, sendPresenterReminders about 09:00."
  );
}
