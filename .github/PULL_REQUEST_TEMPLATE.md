## Что и почему

<!-- Коротко: что было сломано и почему решили именно так. -->

## Как проверяли

- [ ] `cd tests && npm ci && npm test`
- [ ] `python3 -m unittest discover -s tests -v`
- [ ] `python3 tools/check_versions.py` (если менялись версии, манифесты или доки)

## Чек-лист

- [ ] Поведение покрыто тестом в `tests/` (или объяснено, почему тест не нужен)
- [ ] Версия синхронна в `manifest.json` / `manifest.chrome.json` / `server.py` / `mcp_client.py`
- [ ] Есть `docs/releases/vX.Y.Z.md`, если это релиз
- [ ] В документации нет ссылок на архивы старых версий
- [ ] `firefox-addon.xpi` не правился руками (только `python3 tools/build_release.py`)
- [ ] В диффе нет личных путей, токенов и файлов из `.gitignore`

## Связанные issue

<!-- Fixes #… -->
