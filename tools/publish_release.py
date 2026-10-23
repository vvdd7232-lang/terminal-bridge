#!/usr/bin/env python3
"""Publish GitHub Release for AI Execute Runner."""

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

REPO = 'vvdd7232-lang/terminal-bridge'
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
DIST_DIR = os.path.join(ROOT, 'dist')

# Read version from manifest
with open(os.path.join(ROOT, 'extension', 'manifest.json'), 'r', encoding='utf-8') as f:
    VERSION = json.load(f)['version']

TAG = f"v{VERSION}"


def get_token():
    token = os.environ.get('GITHUB_TOKEN') or os.environ.get('GH_TOKEN')
    if token:
        return token.strip()
    if len(sys.argv) > 1 and sys.argv[1].strip():
        return sys.argv[1].strip()
    return None


def api_request(url, method='GET', data=None, headers=None, token=None):
    req_headers = {
        'User-Agent': 'ai-execute-runner-publisher',
        'Accept': 'application/vnd.github+json',
    }
    if token:
        req_headers['Authorization'] = f"Bearer {token}"
    if headers:
        req_headers.update(headers)

    body = None
    if data is not None:
        if isinstance(data, (dict, list)):
            body = json.dumps(data).encode('utf-8')
            req_headers['Content-Type'] = 'application/json; charset=utf-8'
        elif isinstance(data, bytes):
            body = data

    req = urllib.request.Request(url, data=body, headers=req_headers, method=method)
    with urllib.request.urlopen(req) as resp:
        content = resp.read()
        if 'application/json' in resp.headers.get('Content-Type', ''):
            return json.loads(content.decode('utf-8'))
        return content


def publish():
    token = get_token()
    if not token:
        print("ERROR: GitHub token not found.")
        print("Usage: python3 tools/publish_release.py <GITHUB_TOKEN>")
        print("   or: GITHUB_TOKEN=... python3 tools/publish_release.py")
        sys.exit(1)

    print(f"==> Publishing {TAG} to {REPO}...")

    # Load release notes
    notes_path = os.path.join(DIST_DIR, f"{TAG}-notes.md")
    if not os.path.isfile(notes_path):
        notes_path = os.path.join(ROOT, 'docs', 'releases', f"{TAG}.md")

    body_text = f"Релиз {TAG}"
    release_name = TAG
    if os.path.isfile(notes_path):
        with open(notes_path, 'r', encoding='utf-8') as f:
            body_text = f.read()
        first_line = body_text.strip().split('\n')[0].lstrip('#').strip()
        if first_line:
            release_name = first_line

    # Push git commits and tags if possible
    try:
        import subprocess
        remote_url = f"https://x-access-token:{token}@github.com/{REPO}.git"
        print("==> Pushing commits and tags to GitHub...")
        subprocess.run(['git', 'push', remote_url, 'main', '--tags'], check=True, cwd=ROOT)
        print("==> Git push successful.")
    except Exception as e:
        print(f"==> Git push warning: {e}")

    # Check existing release
    release_id = None
    try:
        existing = api_request(f"https://api.github.com/repos/{REPO}/releases/tags/{TAG}", token=token)
        release_id = existing.get('id')
        print(f"==> Release {TAG} already exists (id {release_id}), updating...")
        patch_payload = {'name': release_name, 'body': body_text}
        api_request(f"https://api.github.com/repos/{REPO}/releases/{release_id}", method='PATCH', data=patch_payload, token=token)
    except urllib.error.HTTPError as e:
        if e.code == 404:
            print(f"==> Creating new release {TAG}...")
            post_payload = {
                'tag_name': TAG,
                'name': release_name,
                'body': body_text,
                'draft': False,
                'prerelease': False,
            }
            rel = api_request(f"https://api.github.com/repos/{REPO}/releases", method='POST', data=post_payload, token=token)
            release_id = rel['id']
        else:
            raise

    # Upload assets from dist/
    print("==> Checking uploaded assets...")
    existing_assets = {}
    try:
        assets_list = api_request(f"https://api.github.com/repos/{REPO}/releases/{release_id}/assets", token=token)
        for a in assets_list:
            existing_assets[a['name']] = a['id']
    except Exception as e:
        print(f"    Warning checking assets: {e}")

    for file_name in sorted(os.listdir(DIST_DIR)):
        if not (file_name.endswith('.zip') or file_name.endswith('.xpi') or file_name.endswith('.png')):
            continue
        full_path = os.path.join(DIST_DIR, file_name)
        if file_name in existing_assets:
            print(f"  = {file_name} already uploaded")
            continue

        print(f"  + Uploading {file_name} ({os.path.getsize(full_path)} B)...")
        with open(full_path, 'rb') as f:
            raw_bytes = f.read()

        enc_name = urllib.parse.quote(file_name)
        upload_url = f"https://uploads.github.com/repos/{REPO}/releases/{release_id}/assets?name={enc_name}"
        content_type = 'image/png' if file_name.endswith('.png') else 'application/octet-stream'
        try:
            api_request(upload_url, method='POST', data=raw_bytes,
                        headers={'Content-Type': content_type}, token=token)
            print(f"    Uploaded {file_name} successfully.")
        except Exception as e:
            print(f"    Error uploading {file_name}: {e}")

    print(f"\n==> Done! Release page: https://github.com/{REPO}/releases/tag/{TAG}")


if __name__ == '__main__':
    publish()
