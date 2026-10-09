#!/usr/bin/env python3
"""
configure_cobalt.py — Replace the upstream TizenTube userscript URL
in a TizenTubeCobalt source checkout with an immutable HTTPS URL
chosen by the user.

Usage:
    python3 configure_cobalt.py /path/to/TizenTubeCobalt https://example.com/userScript.js

This tool modifies source files in place. Always work on a copy or
commit before running.

It searches for the known upstream CDN URL pattern and replaces it
with the provided URL. The search covers C/C++ source files, header
files, and Python files (in case build scripts reference the URL).

If the upstream URL pattern changes in future versions, update the
SEARCH_PATTERN constant below.
"""

import os
import sys
import re

# The exact upstream CDN URL prefix as documented in the handoff.
# The version query parameter may change across releases.
SEARCH_PATTERN = 'https://cdn.jsdelivr.net/npm/@foxreis/tizentube/dist/userScript.js'

# File extensions to search
SEARCH_EXTENSIONS = {
    '.cc', '.cpp', '.c', '.h', '.hpp', '.py', '.gn', '.gni',
    '.java', '.kt', '.xml', '.json', '.js', '.ts',
}

def find_source_root(path):
    """Validate that the path looks like a TizenTubeCobalt checkout."""
    if not os.path.isdir(path):
        print(f"Error: {path} is not a directory", file=sys.stderr)
        sys.exit(1)
    return path

def search_and_replace(root, new_url):
    """Walk the source tree, find files containing the upstream URL, and replace."""
    replacements = []

    for dirpath, dirnames, filenames in os.walk(root):
        # Skip common non-source directories
        dirnames[:] = [d for d in dirnames if d not in {
            '.git', 'node_modules', 'out', 'build', '.idea', '__pycache__'
        }]

        for filename in filenames:
            ext = os.path.splitext(filename)[1].lower()
            if ext not in SEARCH_EXTENSIONS:
                continue

            filepath = os.path.join(dirpath, filename)
            try:
                with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
                    content = f.read()
            except (OSError, UnicodeDecodeError):
                continue

            if SEARCH_PATTERN not in content:
                continue

            # Replace the full URL (including any query string after the pattern)
            new_content = re.sub(
                re.escape(SEARCH_PATTERN) + r'[^\s"\'\\]*',
                new_url,
                content
            )

            if new_content != content:
                try:
                    with open(filepath, 'w', encoding='utf-8') as f:
                        f.write(new_content)
                    rel_path = os.path.relpath(filepath, root)
                    count = content.count(SEARCH_PATTERN)
                    replacements.append((rel_path, count))
                except OSError as e:
                    print(f"Warning: Could not write {filepath}: {e}", file=sys.stderr)

    return replacements

def main():
    if len(sys.argv) < 3:
        print("Usage: python3 configure_cobalt.py <cobalt-source-dir> <new-userscript-url>")
        print()
        print("Example:")
        print("  python3 configure_cobalt.py ./TizenTubeCobalt https://mycdn.example.com/userScript.js")
        sys.exit(1)

    cobalt_dir = sys.argv[1]
    new_url = sys.argv[2]

    if not new_url.startswith('https://'):
        print("Warning: URL does not start with https:// — this may cause mixed-content issues", file=sys.stderr)

    root = find_source_root(cobalt_dir)

    print(f"Searching for upstream userscript URL pattern:")
    print(f"  {SEARCH_PATTERN}*")
    print(f"Replacing with: {new_url}")
    print(f"In: {root}")
    print()

    replacements = search_and_replace(root, new_url)

    if not replacements:
        print("No occurrences found. The upstream URL pattern may have changed.")
        print("Check manually with:")
        print(f"  git grep -n -F '{SEARCH_PATTERN}'")
        sys.exit(1)

    total = 0
    for rel_path, count in replacements:
        print(f"  {rel_path}: {count} occurrence(s) replaced")
        total += count

    print()
    print(f"Total: {total} occurrence(s) in {len(replacements)} file(s)")
    print()
    print("Next steps:")
    print("  1. Review the changes: git diff")
    print("  2. Build the Cobalt APK following upstream docs")
    print("  3. Host the userscript at the specified URL with proper CORS headers")

if __name__ == '__main__':
    main()
