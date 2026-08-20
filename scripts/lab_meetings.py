#!/usr/bin/env python3
"""Build the lab-meeting schedule from the shared Google Sheet.

Reads the public CSV export of the lab-meeting sheet (no Google account or API
key involved — the sheet is world-readable) and writes the schedule to _data/lab_meetings.yml, for _pages/lab_meetings.md.

Calendar entries are not this script's job: scripts/lab_meetings.gs syncs the same
sheet into the shared "Palmigiano Lab" Google Calendar, which the page links to.
Keeping one calendar rather than two means they cannot silently disagree.

Columns are located by their header row (who, topic, link, notes, and an
optional time), so reordering the sheet is safe. A slot counts as *cancelled*
when the who cell is empty, or reads "Cancelled ..." / "Summer break ...".
Cancelled slots are left off the web page but kept in the calendar, where they
appear as "No lab meeting", so a blank Thursday is never ambiguous.

    python3 scripts/lab_meetings.py [--check]

--check exits 1 if the generated files differ from what is on disk, without
writing anything.
"""

import argparse
import csv
import datetime as dt
import io
import pathlib
import re
import sys
import urllib.request

SHEET_ID = "1eFwE60c2c8yb65StrekVcHklJR5QyfKbMxsZOxgz4FI"
GID = "44289246"
CSV_URL = f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/export?format=csv&gid={GID}"

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA_FILE = ROOT / "_data" / "lab_meetings.yml"

DEFAULT_TIME = dt.time(13, 0)

# A who cell starting with one of these means there is no meeting that week.
CANCELLED_RE = re.compile(r"^\s*(cancell?ed|no lab meeting|summer break)\b", re.I)


def fetch_rows(source=None):
    if source:
        text = pathlib.Path(source).read_text(encoding="utf-8")
    else:
        with urllib.request.urlopen(CSV_URL, timeout=60) as response:
            text = response.read().decode("utf-8")
    return list(csv.reader(io.StringIO(text)))


def parse_date(value):
    for fmt in ("%m/%d/%Y", "%d/%m/%Y", "%Y-%m-%d"):
        try:
            return dt.datetime.strptime(value.strip(), fmt).date()
        except ValueError:
            continue
    return None


def parse_time(value):
    value = (value or "").strip()
    if not value:
        return DEFAULT_TIME
    for fmt in ("%H:%M", "%H:%M:%S", "%I:%M %p", "%I:%M%p", "%I %p"):
        try:
            return dt.datetime.strptime(value.upper(), fmt).time()
        except ValueError:
            continue
    return DEFAULT_TIME


def cell(row, index):
    return row[index].strip() if len(row) > index else ""


HEADER_ALIASES = {
    "date": "date", "day": "date", "when": "date", "talk date": "date",
    "time": "time", "hora": "time", "start": "time",
    "who": "who", "presenter": "who", "speaker": "who", "name": "who",
    "presenter's name": "who",
    "topic": "topic", "title": "topic", "presentation title": "topic",
    "link": "link", "url": "link", "links": "link",
    "notes": "notes", "note": "notes",
    # Read so their columns are not mistaken for something else. The addresses
    # are deliberately never written to _data/, which is a public repo.
    "email": "email", "emails": "email",
    "reminder": "reminder", "reminder email date": "reminder",
}


def header_key(value):
    """Normalise a header cell: trim, lowercase, and flatten curly apostrophes."""
    return str(value or "").strip().lower().replace("\u2019", "'")

TIME_RE = re.compile(r"^\d{1,2}[:.]\d{2}(\s*[ap]\.?m\.?)?$|^\d{1,2}\s*[ap]\.?m\.?$", re.I)


def detect_columns(rows):
    """Locate the columns by their header, so reordering the sheet doesn't break us."""
    columns = {}
    for row in rows:
        found = {}
        for index, value in enumerate(row):
            key = HEADER_ALIASES.get(header_key(value))
            if key and key not in found:
                found[key] = index
        if "who" in found:
            columns = found
            break

    if "who" not in columns:  # no header row — fall back to the usual order
        columns = {"date": 0, "who": 1, "topic": 2, "link": 3, "notes": 4}

    columns.setdefault("date", 0)

    # A time column is often left unlabelled; sniff for one between date and who.
    if "time" not in columns:
        dated = [r for r in rows if parse_date(cell(r, columns["date"])) is not None]
        for index in range(columns["date"] + 1, columns["who"]):
            if dated and sum(1 for r in dated if TIME_RE.match(cell(r, index))) > len(dated) / 2:
                columns["time"] = index
                break

    return columns


def parse_schedule(rows):
    """Pull every dated row out of the sheet, ignoring the banner/header rows."""
    columns = detect_columns(rows)

    def get(row, key):
        return cell(row, columns[key]) if key in columns else ""

    entries = []
    for row in rows:
        date = parse_date(get(row, "date"))
        if date is None:
            continue
        who = get(row, "who")
        entry = {
            "date": date,
            "time": parse_time(get(row, "time")),
            "who": who,
            "topic": get(row, "topic"),
            "link": get(row, "link"),
            "notes": get(row, "notes"),
            "cancelled": not who or bool(CANCELLED_RE.match(who)),
        }
        # "Cancelled Cosyne" -> reason "Cosyne"; a bare "Cancelled" has no reason.
        entry["reason"] = ""
        if entry["cancelled"] and who:
            reason = CANCELLED_RE.sub("", who).strip(" -–—:,")
            entry["reason"] = reason if reason else ""
            if CANCELLED_RE.match(who).group(1).lower() == "summer break":
                entry["reason"] = who
        entries.append(entry)
    entries.sort(key=lambda e: (e["date"], e["time"]))
    return entries


# --- YAML ---------------------------------------------------------------


def yaml_quote(value):
    return '"' + str(value).replace("\\", "\\\\").replace('"', '\\"') + '"'


def render_yaml(entries):
    lines = [
        "# Generated by scripts/lab_meetings.py from the shared Google Sheet.",
        "# Edit the sheet, not this file:",
        f"# https://docs.google.com/spreadsheets/d/{SHEET_ID}/edit?gid={GID}",
        "",
    ]
    for e in entries:
        date = e["date"]
        lines.append(f"- date: {date.isoformat()}")
        lines.append(f"  ymd: {date.strftime('%Y%m%d')}")
        lines.append(f"  display: {yaml_quote(date.strftime('%-d %B %Y'))}")
        lines.append(f"  weekday: {yaml_quote(date.strftime('%A'))}")
        lines.append(f"  time: {yaml_quote(e['time'].strftime('%H:%M'))}")
        lines.append(f"  cancelled: {'true' if e['cancelled'] else 'false'}")
        lines.append(f"  who: {yaml_quote('' if e['cancelled'] else e['who'])}")
        lines.append(f"  reason: {yaml_quote(e['reason'])}")
        lines.append(f"  topic: {yaml_quote(e['topic'])}")
        lines.append(f"  link: {yaml_quote(e['link'])}")
    return "\n".join(lines) + "\n"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="report drift, write nothing")
    parser.add_argument("--from-csv", help="read a local CSV instead of fetching the sheet")
    parser.add_argument(
        "--allow-stale",
        action="store_true",
        help="if the sheet cannot be read but a schedule is already on disk, keep it "
        "and exit cleanly (used in CI, so an unrelated deploy is not blocked)",
    )
    args = parser.parse_args()

    try:
        rows = fetch_rows(args.from_csv)
    except Exception as error:
        if args.allow_stale and DATA_FILE.exists():
            print(f"warning: could not read the sheet ({error}); keeping the schedule on disk")
            return
        raise

    entries = parse_schedule(rows)
    if not entries:
        sys.exit("No dated rows found in the sheet — has its layout changed?")

    yaml_text = render_yaml(entries)
    unchanged = DATA_FILE.exists() and DATA_FILE.read_text(encoding="utf-8") == yaml_text

    meetings = sum(1 for e in entries if not e["cancelled"])
    summary = (
        f"{len(entries)} slots: {meetings} meetings, {len(entries) - meetings} without one"
    )

    if args.check:
        if unchanged:
            print(f"up to date — {summary}")
            return
        sys.exit(f"out of date — {summary}")

    if not unchanged:
        DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
        DATA_FILE.write_text(yaml_text, encoding="utf-8")

    print(f"{summary}; " + ("wrote _data/lab_meetings.yml" if not unchanged else "no changes"))


if __name__ == "__main__":
    main()
