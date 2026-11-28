#!/usr/bin/env python3
"""Copies the scoring code the website uses into the browser extension.

Chrome extensions can't load code from a website, so extension/lib/ keeps its own copy of
roles.js, signals.js and matching.js, the text helpers from the job fetcher, and the
Supabase address from config.js. Run this after changing any of them:

    python3 scripts/sync-extension.py          # update extension/lib/
    python3 scripts/sync-extension.py --check  # fail if extension/lib/ is out of date (used by CI)
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LIB = ROOT / "extension" / "lib"
HEADER = "// Copied from {src} by scripts/sync-extension.py. Don't edit here: edit {src} and run the script.\n"


def plain(src):
    return HEADER.format(src=src) + (ROOT / src).read_text()


def job_text():
    # normalize.js is an ES module for the Edge Function; the extension needs a plain script.
    src = "supabase/functions/fetch-jobs/normalize.js"
    code = (ROOT / src).read_text()
    code = re.sub(r"^export ", "", code, flags=re.M)
    return (HEADER.format(src=src) + "window.JobText = (() => {\n" + code +
            "\nreturn { htmlToText, decode, citiesIn, experienceFrom, workModeFrom, jobTypeFrom };\n})();\n")


def config():
    # Only the public address and publishable key; secret keys never go in config.js.
    text = (ROOT / "config.js").read_text()
    url = re.search(r'SUPABASE_URL:\s*"([^"]+)"', text).group(1)
    key = re.search(r'SUPABASE_ANON_KEY:\s*"([^"]+)"', text).group(1)
    return (HEADER.format(src="config.js") +
            f'self.GOODFIT = {{\n  SUPABASE_URL: "{url}",\n  SUPABASE_ANON_KEY: "{key}",\n'
            '  SITE_URL: "https://goodfitjobsonly.com",\n};\n')


FILES = {
    "roles.js": lambda: plain("roles.js"),
    "signals.js": lambda: plain("signals.js"),
    "matching.js": lambda: plain("matching.js"),
    "jobtext.js": job_text,
    "config.js": config,
}


def main():
    check = "--check" in sys.argv
    LIB.mkdir(parents=True, exist_ok=True)
    stale = []
    for name, build in FILES.items():
        want = build()
        path = LIB / name
        if path.exists() and path.read_text() == want:
            continue
        stale.append(name)
        if not check:
            path.write_text(want)
    if check and stale:
        print("extension/lib/ is out of date: " + ", ".join(stale))
        print("Run: python3 scripts/sync-extension.py")
        sys.exit(1)
    print(("Up to date" if not stale else "Updated " + ", ".join(stale)) + ".")


main()
