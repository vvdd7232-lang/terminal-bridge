#!/usr/bin/env python3
"""Build release artifacts for AI Execute Runner in dist/."""

import json
import os
import re
import shutil
import zipfile

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
EXT_DIR = os.path.join(ROOT, 'extension')
SERVER_DIR = os.path.join(ROOT, 'server')
DIST_DIR = os.path.join(ROOT, 'dist')

with open(os.path.join(EXT_DIR, 'manifest.json'), 'r', encoding='utf-8') as f:
    VERSION = json.load(f)['version']

print(f"==> Building release artifacts for v{VERSION}")

# Clean and recreate dist/
if os.path.exists(DIST_DIR):
    shutil.rmtree(DIST_DIR)
os.makedirs(DIST_DIR, exist_ok=True)

EXCLUDE_DIRS = {'__pycache__', 'node_modules', '.git'}
EXCLUDE_EXACT = {'_preview_panel.html', 'mcp_servers.local.json'}
EXCLUDE_EXTS = {'.pyc', '.pyo', '.bak'}


def should_skip(name):
    if name in EXCLUDE_EXACT or name in EXCLUDE_DIRS:
        return True
    _, ext = os.path.splitext(name)
    if ext in EXCLUDE_EXTS or name.startswith('.'):
        return True
    return False


def zip_dir(src_dir, zip_path, prefix='', replace_files=None, exclude_names=None):
    replace_files = replace_files or {}
    exclude_names = exclude_names or set()
    with zipfile.ZipFile(zip_path, 'w', compression=zipfile.ZIP_DEFLATED) as zf:
        for root, dirs, files in os.walk(src_dir):
            dirs[:] = [d for d in dirs if not should_skip(d) and d not in exclude_names]
            for file in sorted(files):
                if should_skip(file) or file in exclude_names:
                    continue
                full_path = os.path.join(root, file)
                rel_path = os.path.relpath(full_path, src_dir).replace('\\', '/')
                if rel_path in replace_files:
                    continue
                arcname = (f"{prefix}/{rel_path}" if prefix else rel_path).strip('/')
                zf.write(full_path, arcname)
        for rel_target, full_source in replace_files.items():
            arcname = (f"{prefix}/{rel_target}" if prefix else rel_target).strip('/')
            zf.write(full_source, arcname)


# 1. Firefox .xpi
firefox_xpi = os.path.join(DIST_DIR, f"terminal-bridge-{VERSION}-firefox.xpi")
print(f"==> Packaging Firefox: {os.path.basename(firefox_xpi)}")
zip_dir(EXT_DIR, firefox_xpi, exclude_names={'manifest.chrome.json'})

# 2. Chrome .zip (with manifest.chrome.json as manifest.json)
chrome_zip = os.path.join(DIST_DIR, f"terminal-bridge-{VERSION}-chrome.zip")
print(f"==> Packaging Chrome: {os.path.basename(chrome_zip)}")
zip_dir(
    EXT_DIR,
    chrome_zip,
    replace_files={'manifest.json': os.path.join(EXT_DIR, 'manifest.chrome.json')},
    exclude_names={'manifest.chrome.json'}
)

# 3. Root firefox-addon.xpi (for 1-click install in about:debugging)
root_xpi = os.path.join(ROOT, 'firefox-addon.xpi')
print(f"==> Updating root {os.path.basename(root_xpi)}")
shutil.copyfile(firefox_xpi, root_xpi)

# 4. Server .zip (with server/ folder at archive root)
server_zip = os.path.join(DIST_DIR, f"terminal-bridge-{VERSION}-server.zip")
print(f"==> Packaging Server: {os.path.basename(server_zip)}")
zip_dir(SERVER_DIR, server_zip, prefix='server', exclude_names={'mcp_servers.local.json', 'whitelist.txt'})

# 5. Release notes copy
notes_src = os.path.join(ROOT, 'docs', 'releases', f"v{VERSION}.md")
notes_dst = os.path.join(DIST_DIR, f"v{VERSION}-notes.md")
if os.path.isfile(notes_src):
    shutil.copyfile(notes_src, notes_dst)
    print(f"==> Copied release notes to {os.path.basename(notes_dst)}")

# 6. Screenshots archive and individual images
screenshots_dir = os.path.join(ROOT, 'docs', 'screenshots')
if os.path.isdir(screenshots_dir):
    screenshots_zip = os.path.join(DIST_DIR, f"terminal-bridge-{VERSION}-screenshots.zip")
    print(f"==> Packaging Screenshots: {os.path.basename(screenshots_zip)}")
    zip_dir(screenshots_dir, screenshots_zip)
    for s_name in sorted(os.listdir(screenshots_dir)):
        if s_name.endswith('.png'):
            shutil.copyfile(os.path.join(screenshots_dir, s_name), os.path.join(DIST_DIR, s_name))

print("\n==> Dist artifacts created successfully:")
for name in sorted(os.listdir(DIST_DIR)):
    size = os.path.getsize(os.path.join(DIST_DIR, name))
    print(f"    {name:<46} {size:>8} B")
