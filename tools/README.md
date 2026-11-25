# Инструменты разработки

Каноническая цепочка релиза — **Python-скрипты** (они собрали все релизы начиная
с 2.12.x и умеют всё: артефакты, скриншоты, заметки). PowerShell-скрипты оставлены
для работы на Windows без Python в PATH, но обязаны давать тот же результат.

## Релиз

| Шаг | Команда | Что делает |
|---|---|---|
| 1 | `python3 tools/check_versions.py` | проверяет, что версии и артефакты не разъехались (то же гоняет CI) |
| 2 | `python3 tools/build_release.py` | собирает `dist/terminal-bridge-<версия>-{chrome.zip,firefox.xpi,server.zip,screenshots.zip}` и обновляет `firefox-addon.xpi` в корне |
| 3 | `python3 tools/publish_release.py` | пушит тег, создаёт/обновляет GitHub Release и загружает ассеты из `dist/` (нужен `GITHUB_TOKEN` или аргумент с токеном) |

Версия берётся из `extension/manifest.json` — править её в скриптах не нужно.

### Windows-эквиваленты

| Скрипт | Аналог | Примечание |
|---|---|---|
| `build-release.ps1` | `build_release.py` | те же имена архивов: `terminal-bridge-<версия>-*` |
| `verify-artifacts.ps1` | `check_versions.py` (частично) | read-only проверка содержимого собранных архивов |
| `publish-release.ps1` | `publish_release.py` | тег берётся из манифеста (`-Tag` перекрывает), заголовок релиза — из первой строки `docs/releases/<тег>.md` |

> ⚠️ Скрипты долго жили со старым именем проекта и собирали `ai-execute-runner-*`,
> из-за чего `verify-artifacts.ps1` падал на свежем `dist/`. Имена синхронизированы,
> но если правите сборку — правьте **обе** реализации и сверяйте имена файлов.

## Проверки и полигоны

| Скрипт | Назначение |
|---|---|
| `smoke.ps1` | smoke-прогон в настоящем Chrome/Edge: манифест, файлы, исполнение скриптов расширения на фикстуре `fixtures/chat.html`, `@import` стилей в shadow root |
| `shot.ps1` | скриншоты страниц расширения в headless-браузере → `tools/shots/` (в git не коммитится) |
| `generate_screenshots.js` | генерация `docs/screenshots/*.png` для README/релизов |
| `panel-preview.html` | статический полигон панели без установки расширения |
| `fixtures/chat.html` | имитация чата для smoke-проверок |

## Тесты

Тесты живут в `tests/` (не здесь), потому что используют общий `npm`-проект с jsdom:

```bash
cd tests && npm ci && npm run test:all
```
