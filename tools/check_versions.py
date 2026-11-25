#!/usr/bin/env python3
"""Проверка согласованности версий и артефактов TerminalBridge.

Запуск из любой папки:
    python3 tools/check_versions.py

Что проверяется (каждый пункт — реальная поломка, которая уже случалась):
  1. Версия в extension/manifest.json (единственный источник правды) совпадает
     с manifest.chrome.json, server/server.py и server/mcp_client.py.
  2. Для текущей версии есть заметки релиза docs/releases/vX.Y.Z.md.
  3. README и подсказки в tools/ не ссылаются на архивы других версий
     (раньше README предлагал скачать 2.12.2 при актуальной 2.12.5).
  4. firefox-addon.xpi в корне собран из текущего кода и имеет текущую версию
     (иначе «установка в один клик» ставит старую сборку).
  5. Все файлы, на которые ссылаются манифесты, существуют в extension/,
     и манифесты Chrome и Firefox не разъехались по общим полям.

Код возврата: 0 — всё согласовано, 1 — есть расхождения.
Только стандартная библиотека, Python 3.8+.
"""

import json
import os
import re
import sys
import zipfile

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
EXT_DIR = os.path.join(ROOT, 'extension')
SERVER_DIR = os.path.join(ROOT, 'server')

problems = []
checks = 0


def ok(msg):
    global checks
    checks += 1
    print('  [ok]   ' + msg)


def fail(msg):
    global checks
    checks += 1
    problems.append(msg)
    print('  [FAIL] ' + msg)


def read(path):
    with open(path, 'r', encoding='utf-8') as f:
        return f.read()


def main():
    manifest_path = os.path.join(EXT_DIR, 'manifest.json')
    chrome_path = os.path.join(EXT_DIR, 'manifest.chrome.json')

    print('==> источники версии')
    manifest = json.loads(read(manifest_path))
    chrome = json.loads(read(chrome_path))
    version = manifest['version']
    print('  текущая версия: ' + version)

    if chrome.get('version') == version:
        ok('extension/manifest.chrome.json = ' + version)
    else:
        fail('extension/manifest.chrome.json = %s, а manifest.json = %s'
             % (chrome.get('version'), version))

    server_src = read(os.path.join(SERVER_DIR, 'server.py'))
    m = re.search(r"(?m)^VERSION\s*=\s*'([^']+)'", server_src)
    if not m:
        fail("в server/server.py не найдена строка VERSION = '...'")
    elif m.group(1) == version:
        ok('server/server.py = ' + version)
    else:
        fail('server/server.py = %s, а manifest.json = %s' % (m.group(1), version))

    client_src = read(os.path.join(SERVER_DIR, 'mcp_client.py'))
    m = re.search(r"CLIENT_INFO\s*=\s*\{.*?'version'\s*:\s*'([^']+)'",
                  client_src, re.DOTALL)
    if not m:
        fail("в server/mcp_client.py не найден CLIENT_INFO с полем 'version'")
    elif m.group(1) == version:
        ok('server/mcp_client.py CLIENT_INFO = ' + version)
    else:
        fail('server/mcp_client.py CLIENT_INFO = %s, а manifest.json = %s'
             % (m.group(1), version))

    print('==> заметки релиза')
    notes_path = os.path.join(ROOT, 'docs', 'releases', 'v%s.md' % version)
    if os.path.isfile(notes_path):
        ok('docs/releases/v%s.md на месте' % version)
    else:
        fail('нет заметок релиза docs/releases/v%s.md' % version)

    print('==> упоминания версий в документации')
    # Жёстко зашитая версия в имени архива — источник прошлогоднего бага:
    # README «предлагал» скачать 2.12.2, когда релиз был 2.12.5.
    artifact_re = re.compile(r'terminal-bridge-(\d+\.\d+\.\d+)-(chrome\.zip|firefox\.xpi|server\.zip|screenshots\.zip)')
    for rel_path in ('README.md', 'TROUBLESHOOTING.md', 'CONTRIBUTING.md',
                     'tools/README.md', 'docs/mcp-servers.md'):
        path = os.path.join(ROOT, rel_path)
        if not os.path.isfile(path):
            continue
        text = read(path)
        found = sorted(set(artifact_re.findall(text)))
        stale = sorted({v for v, _ in found if v != version})
        if stale:
            fail('%s ссылается на архивы версий %s (актуальна %s)'
                 % (rel_path, ', '.join(stale), version))
        elif found:
            ok('%s: имена архивов актуальны' % rel_path)

    # Демо-версии в полигонах и скриншот-скриптах: они не влияют на работу,
    # но на скриншотах для README видно расхождение с реальным релизом.
    demo_re = re.compile(r"(?:version['\"]?\s*[:=]\s*['\"]|версия\s+)(\d+\.\d+\.\d+)")
    for rel_path in ('tools/panel-preview.html', 'tools/shot.ps1'):
        path = os.path.join(ROOT, rel_path)
        if not os.path.isfile(path):
            continue
        stale = sorted({v for v in demo_re.findall(read(path)) if v != version})
        if stale:
            fail('%s: демо-версия %s вместо %s' % (rel_path, ', '.join(stale), version))

    print('==> корневой firefox-addon.xpi')
    xpi_path = os.path.join(ROOT, 'firefox-addon.xpi')
    expected = set()
    for root_dir, dirs, files in os.walk(EXT_DIR):
        dirs[:] = [d for d in dirs if d not in ('__pycache__', 'node_modules')]
        for name in files:
            rel = os.path.relpath(os.path.join(root_dir, name), EXT_DIR)
            rel = rel.replace('\\', '/')
            if rel != 'manifest.chrome.json':
                expected.add(rel)
    if not os.path.isfile(xpi_path):
        fail('нет firefox-addon.xpi в корне (соберите: python3 tools/build_release.py)')
    else:
        try:
            with zipfile.ZipFile(xpi_path) as z:
                names = {n for n in z.namelist() if not n.endswith('/')}
                xpi_manifest = json.loads(z.read('manifest.json').decode('utf-8'))
        except (zipfile.BadZipFile, KeyError) as e:
            fail('firefox-addon.xpi не читается как расширение: %s' % e)
        else:
            if xpi_manifest.get('version') == version:
                ok('firefox-addon.xpi версии ' + version)
            else:
                fail('firefox-addon.xpi версии %s, а manifest.json = %s (пересоберите)'
                     % (xpi_manifest.get('version'), version))
            missing = sorted(expected - names)
            extra = sorted(names - expected)
            if missing:
                fail('в firefox-addon.xpi нет файлов: %s' % ', '.join(missing))
            elif extra:
                fail('в firefox-addon.xpi лишние файлы: %s' % ', '.join(extra))
            else:
                ok('состав firefox-addon.xpi совпадает с extension/')

    print('==> целостность манифестов')
    referenced = set()
    for script in manifest.get('content_scripts', []):
        referenced.update(script.get('js', []))
        referenced.update(script.get('css', []))
    for res in manifest.get('web_accessible_resources', []):
        referenced.update(res.get('resources', []))
    referenced.update((manifest.get('icons') or {}).values())
    action = manifest.get('action') or {}
    if action.get('default_popup'):
        referenced.add(action['default_popup'])
    options = manifest.get('options_ui') or {}
    if options.get('page'):
        referenced.add(options['page'])
    background = manifest.get('background') or {}
    referenced.update(background.get('scripts', []))
    if background.get('service_worker'):
        referenced.add(background['service_worker'])
    if chrome.get('background', {}).get('service_worker'):
        referenced.add(chrome['background']['service_worker'])

    missing = sorted(n for n in referenced
                     if not os.path.isfile(os.path.join(EXT_DIR, n)))
    if missing:
        fail('манифест ссылается на отсутствующие файлы: %s' % ', '.join(missing))
    else:
        ok('все %d файлов из манифестов существуют' % len(referenced))

    drift = [key for key in ('name', 'version', 'permissions', 'host_permissions',
                             'content_scripts', 'icons')
             if manifest.get(key) != chrome.get(key)]
    if drift:
        fail('manifest.json и manifest.chrome.json разошлись в полях: %s'
             % ', '.join(drift))
    else:
        ok('общие поля манифестов совпадают')

    print('')
    if problems:
        print('ИТОГО: %d проверок, проблем — %d' % (checks, len(problems)))
        for p in problems:
            print('  - ' + p)
        return 1
    print('ИТОГО: %d проверок, всё согласовано (версия %s)' % (checks, version))
    return 0


if __name__ == '__main__':
    sys.exit(main())
