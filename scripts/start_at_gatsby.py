#!/usr/bin/env python3
"""Mirror the "Start your life at Gatsby" Google Doc onto the website.

Fetches the doc's public HTML export (no Google account or API key: it is shared
to anyone with the link) and rewrites it into a fragment the site can include,
at _includes/start_at_gatsby.html, rendered by _pages/start_at_gatsby.md.

The text is reproduced verbatim. The conversion only:

  * keeps the structural tags — p, ul, ol, li, a, br — and drops everything else,
  * turns Google's bold spans into <strong>, reading which classes are bold from
    the doc's own stylesheet, because those class names are regenerated on every
    export and cannot be hard-coded,
  * unwraps Google's redirect links back to the address they point at,
  * removes empty paragraphs, which the exporter emits between blocks,
  * applies the short CORRECTIONS list below — typo fixes Agostina approved one by
    one, since the doc cannot be edited from here.

    python3 scripts/start_at_gatsby.py [--check] [--allow-stale]

--check exits 1 if the doc has changed since the file on disk was written.
--allow-stale keeps the committed copy if the doc cannot be reached, so a Google
outage cannot block an unrelated deploy.
"""

import argparse
import html
import pathlib
import re
import sys
import urllib.parse
import urllib.request
from html.parser import HTMLParser

DOC_ID = "1W_oR6jErLU5m7IvkNu_V-yx__1VyaFbxWbyn6Pczts8"
DOC_URL = f"https://docs.google.com/document/d/{DOC_ID}/export?format=html"
EDIT_URL = f"https://docs.google.com/document/d/{DOC_ID}/edit"

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT_FILE = ROOT / "_includes" / "start_at_gatsby.html"

# Corrections Agostina asked for on 21 August 2026, applied to the doc's text on
# the way through. Each is an exact string she approved individually — nothing is
# changed here that she has not asked for. They are no-ops once the same fix is
# made in the doc, so this list can simply be deleted then.
CORRECTIONS = [
    ("of the the", "of the"),                                 # doubled "the"
    ("&nbsp;. Fill", ". Fill"),                               # space before full stop
    ("4.30p.m)", "4.30p.m.)"),                                # missing full stop
    ("my Labs slack", "my Lab's Slack"),                      # apostrophe, capital S
    (", this should be better spelled out)", ")"),            # note to self, removed
    ("Install software in your computer",                     # "on", not "in"
     "Install software on your computer"),
    ("This are support pages", "These are support pages"),    # These, not This
]

# Link fixes, same principle as CORRECTIONS but for hrefs. In the doc the words
# "register to vote" carry a Kensington and Chelsea link — left over from when the
# borough was named in the sentence, which has since been deleted. Point it at the
# national page the sentence actually names.
LINK_FIXES = {
    "https://www.rbkc.gov.uk/": "https://www.gov.uk/register-to-vote",
}

KEEP = {"p", "ul", "ol", "li", "a", "br"}

# Google names each list "lst-kix_<id>-<level>", where the trailing number is the
# indent level. It does not nest sub-lists in the markup — it emits them as
# siblings and carries the indentation in CSS — so the level has to be read from
# the class name and applied here. A list also gets split around each sub-list,
# so the continuation needs an explicit start= or the numbering restarts at 1.
LIST_RE = re.compile(r"lst-kix_(\w+?)-(\d+)")


def fetch(source=None):
    if source:
        return pathlib.Path(source).read_text(encoding="utf-8")
    request = urllib.request.Request(DOC_URL, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read().decode("utf-8")


def bold_classes(document):
    """Which of Google's generated classes mean bold, per the export's own CSS."""
    style = re.search(r"<style[^>]*>(.*?)</style>", document, re.S)
    if not style:
        return set()
    return {
        name
        for name, body in re.findall(r"\.(c\d+)\{([^}]*)\}", style.group(1))
        if "font-weight:700" in body
    }


def real_url(href):
    """Google wraps every link in a redirect; point at the destination instead."""
    if href.startswith("https://www.google.com/url?"):
        target = urllib.parse.parse_qs(urllib.parse.urlparse(href).query).get("q")
        if target:
            href = target[0]
    for prefix, replacement in LINK_FIXES.items():
        if href.startswith(prefix):
            return replacement
    return href


class Converter(HTMLParser):
    def __init__(self, bold):
        super().__init__(convert_charrefs=False)
        self.bold = bold
        self.out = []
        self.spans = []
        self.in_body = False
        self.lists = []
        self.counts = {}

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "body":
            self.in_body = True
            return
        if not self.in_body:
            return
        if tag == "span":
            is_bold = any(c in self.bold for c in attrs.get("class", "").split())
            self.spans.append(is_bold)
            if is_bold:
                self.out.append("<strong>")
        elif tag == "a":
            self.out.append(f'<a href="{html.escape(real_url(attrs.get("href", "")))}">')
        elif tag in ("ul", "ol"):
            classes = attrs.get("class", "")
            match = LIST_RE.search(classes)
            key = (match.group(1), int(match.group(2))) if match else (classes, 0)
            level = key[1]
            if "start" in classes.split():
                self.counts[key] = 0
            self.lists.append(key)
            opened = f"<{tag}"
            if level:
                opened += f' class="lvl-{level}"'
            already = self.counts.get(key, 0)
            if tag == "ol" and already:
                opened += f' start="{already + 1}"'
            self.out.append(opened + ">")
        elif tag == "li":
            if self.lists:
                self.counts[self.lists[-1]] = self.counts.get(self.lists[-1], 0) + 1
            self.out.append("<li>")
        elif tag in KEEP:
            self.out.append(f"<{tag}>")

    def handle_startendtag(self, tag, attrs):
        if self.in_body and tag == "br":
            self.out.append("<br>")

    def handle_endtag(self, tag):
        if tag == "body":
            self.in_body = False
            return
        if not self.in_body:
            return
        if tag == "span":
            if self.spans and self.spans.pop():
                self.out.append("</strong>")
        elif tag in ("ul", "ol"):
            if self.lists:
                self.lists.pop()
            self.out.append(f"</{tag}>")
        elif tag in KEEP and tag != "br":
            self.out.append(f"</{tag}>")

    def handle_data(self, data):
        if self.in_body:
            self.out.append(html.escape(data, quote=False))

    def handle_entityref(self, name):
        if self.in_body:
            self.out.append(f"&{name};")

    def handle_charref(self, name):
        if self.in_body:
            self.out.append(f"&#{name};")


def apply_corrections(fragment):
    """Apply the approved fixes to text only, never inside a tag's attributes."""
    parts = re.split(r"(<[^>]+>)", fragment)
    for index, part in enumerate(parts):
        if part.startswith("<"):
            continue
        for wrong, right in CORRECTIONS:
            part = part.replace(wrong, right)
        parts[index] = part
    return "".join(parts)


def tidy(fragment):
    # The exporter emits blank spacer paragraphs, sometimes wrapped in <strong>.
    blank = r"(?:\s|&nbsp;|<br>|<strong>|</strong>)*"
    fragment = re.sub(rf"<p>{blank}</p>", "", fragment)
    # An empty bullet left behind in the doc renders as a stray dot; drop it, and
    # any list that is then empty.
    fragment = re.sub(rf"<li>{blank}</li>", "", fragment)
    fragment = re.sub(r"<(ul|ol)[^>]*>\s*</\1>", "", fragment)
    fragment = re.sub(r"\n{3,}", "\n\n", fragment)
    # One block per line, so the diff of a doc edit is readable.
    fragment = re.sub(r"(</(?:p|ul|ol|li)>)", r"\1\n", fragment)
    return re.sub(r"\n\s*\n", "\n", fragment).strip()


def render(document):
    converter = Converter(bold_classes(document))
    converter.feed(document)
    body = tidy(apply_corrections("".join(converter.out)))
    return (
        "<!-- Generated by scripts/start_at_gatsby.py from the Google Doc.\n"
        f"     Edit the doc, not this file: {EDIT_URL} -->\n"
        f'<div class="gatsby-doc">\n{body}\n</div>\n'
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="report drift, write nothing")
    parser.add_argument("--from-html", help="read a local export instead of fetching")
    parser.add_argument("--allow-stale", action="store_true",
                        help="keep the copy on disk if the doc cannot be reached")
    args = parser.parse_args()

    try:
        document = fetch(args.from_html)
    except Exception as error:
        if args.allow_stale and OUT_FILE.exists():
            print(f"warning: could not read the doc ({error}); keeping the copy on disk")
            return
        raise

    fragment = render(document)
    if "<p>" not in fragment:
        sys.exit("The export contained no paragraphs — is the doc still shared by link?")

    unchanged = OUT_FILE.exists() and OUT_FILE.read_text(encoding="utf-8") == fragment
    blocks = fragment.count("<li>") + fragment.count("<p>")

    if args.check:
        if unchanged:
            print(f"up to date — {blocks} blocks")
            return
        sys.exit(f"out of date — {blocks} blocks")

    if not unchanged:
        OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
        OUT_FILE.write_text(fragment, encoding="utf-8")
    print(f"{blocks} blocks; " + ("wrote _includes/start_at_gatsby.html" if not unchanged else "no changes"))


if __name__ == "__main__":
    main()
