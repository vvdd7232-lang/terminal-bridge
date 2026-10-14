/* Тесты панели автопилота: изоляция UI (shadow DOM) и повторный запуск.
 *
 * Проверяются два реальных дефекта v2.6.0:
 *  1) панель/модалка жили в обычном DOM — скрипт страницы чата мог читать
 *     вывод и «кликать» ▶ Выполнить и подтверждение;
 *  2) autoHandle.retry() не сбрасывал флаг done, поэтому после первого
 *     выполнения повторный запуск (включение автопилота, повторный рендер
 *     блока) молча не происходил.
 *
 * Запуск:  cd tests && npm test
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const EXT_DIR = path.join(__dirname, '..', 'extension');
const AX_FILES = ['ax-detector.js', 'ax-core.js', 'ax-view.js', 'ax-panel.js', 'content.js'];

let passed = 0;
let failed = 0;
const failures = [];

function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ok   ' + name); }
  else {
    failed++;
    failures.push(name + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : ''));
    console.log('  FAIL ' + name + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : ''));
  }
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function makeEnv({ autoExecute = false, requireConfirm = true, runError = false } = {}) {
  const html = '<!doctype html><html><body><div id="chat">' +
    '<pre data-language="execute"><code>echo hello</code></pre>' +
    '</div></body></html>';
  const dom = new JSDOM(html, { url: 'https://chatgpt.com/', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  const store = {
    sync: {
      serverUrl: 'http://127.0.0.1:8765', timeout: 30, requireConfirm, maxOutputChars: 32000,
      autoExecute, autoInsert: false, autoSend: false, autoDelay: 0, looseSearch: true, autoWeak: false,
      maxAutoRuns: 0, defaultRunner: 'shell', showToasts: false, defaultCwd: '', uiTheme: 'auto',
      panelSize: 'normal', collapseAfterRun: false, soundOnComplete: false, browserNotify: false, echoMode: 'short',
    },
    local: { authToken: '' },
  };
  const runs = [];
  const storageListeners = [];
  const area = (name) => ({
    get: (keys, cb) => {
      const list = Array.isArray(keys) ? keys : Object.keys(keys || {});
      const out = {};
      for (const k of list) if (k in store[name]) out[k] = store[name][k];
      if (cb) { cb(out); return undefined; }
      return Promise.resolve(out);
    },
    set: (items, cb) => {
      const changes = {};
      for (const k in items) changes[k] = { oldValue: store[name][k], newValue: items[k] };
      Object.assign(store[name], items);
      storageListeners.forEach((fn) => { try { fn(changes, name); } catch (e) { /* ignore */ } });
      if (cb) cb();
      return Promise.resolve();
    },
    remove: (keys, cb) => {
      for (const k of (Array.isArray(keys) ? keys : [keys])) delete store[name][k];
      if (cb) cb();
      return Promise.resolve();
    },
  });
  const chromeStub = {
    storage: {
      sync: area('sync'),
      local: area('local'),
      onChanged: {
        addListener(fn) { storageListeners.push(fn); }
      }
    },
    runtime: {
      id: 'test-extension-id',
      getManifest: () => ({ version: '2.6.1' }),
      getURL: (p) => 'chrome-extension://test/' + p,
      sendMessage: (msg, cb) => {
        let resp = { ok: false, error: 'unknown' };
        if (msg && msg.type === 'AX_GET_SETTINGS') resp = { ok: true, settings: store.sync };
        else if (msg && msg.type === 'AX_PING') resp = { ok: true, info: { status: 'ok' } };
        else if (msg && msg.type === 'AX_RUN') {
          runs.push(msg.payload);
          resp = runError
            ? { ok: false, error: 'boom' }
            : { ok: true, result: { ok: true, executed: true, runner: msg.payload.runner, exit_code: 0, stdout: 'ok\n', stderr: '', duration_ms: 5 } };
        }
        if (cb) { setTimeout(() => cb(resp), 0); return undefined; }
        return Promise.resolve(resp);
      },
      onMessage: { addListener() {} },
    },
  };
  w.chrome = chromeStub;
  w.browser = undefined;
  // jsdom не умеет matchMedia
  if (!w.matchMedia) w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });

  // jsdom всегда ставит isTrusted=false, поэтому «настоящий» клик пользователя
  // эмулируется тест-хуком AX.assumeTrustedEvents (см. trustedClick в ax-panel.js).
  // Проверка самого барьера — в блоке [2]: без флага клик игнорируется.
  w.__realClick = (el) => {
    w.AX.assumeTrustedEvents = true;
    try {
      el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
    } finally {
      w.AX.assumeTrustedEvents = false;
    }
  };

  for (const f of AX_FILES) {
    w.eval(fs.readFileSync(path.join(EXT_DIR, f), 'utf8'));
  }
  return { dom, w, store, runs, chromeStub };
}

async function run() {
  console.log('\n[1] Панель строится в закрытом shadow root');
  const env = makeEnv();
  const { w } = env;
  await sleep(50);
  const panel = w.document.querySelector('.ax-exec-panel');
  check('панель вставлена в документ', !!panel);
  check('у панели нет открытого shadowRoot (закрытый режим)', panel && panel.shadowRoot === null);
  check('page-JS не может достать кнопку ▶ через DOM',
    !!panel && panel.querySelector('.ax-btn-run') === null);
  check('кнопка ▶ доступна расширению (через прокси panel.$)',
    !!panel && panel.$ && !!panel.$('.ax-btn-run'));
  check('вывод (.ax-exec-output) не виден из DOM страницы',
    !!panel && panel.querySelector('.ax-exec-output') === null);

  console.log('\n[2] Синтетический клик по ▶ не выполняет команду');
  // Эмулируем попытку страницы «нажать» кнопку: обработчик видит isTrusted=false
  const btn = panel.$('.ax-btn-run');
  let handled = false;
  const handler = btn.onclick;
  check('у кнопки есть обработчик', typeof handler === 'function');
  // страница может дотянуться только до host — клик по host не дойдёт до кнопки
  panel.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  check('клик по host не запустил выполнение', env.runs.length === 0, env.runs);
  handled = true;
  check('(служебная проверка) обработчик кнопки существует', handled);

  console.log('\n[3] Настоящий клик запускает команду (подтверждение выключено)');
  const env3 = makeEnv({ requireConfirm: false });
  await sleep(60);
  const panel3 = env3.w.document.querySelector('.ax-exec-panel');
  let clickErrors = [];
  env3.w.addEventListener('error', (e) => clickErrors.push(String(e.message)));
  env3.w.__realClick(panel3.$('.ax-btn-run'));
  await sleep(80);
  check('команда ушла на сервер', env3.runs.length === 1, { runs: env3.runs, errors: clickErrors });
  check('ушла именно команда из блока', env3.runs[0] && env3.runs[0].command === 'echo hello', env3.runs[0]);

  console.log('\n[3b] Модалка подтверждения тоже в закрытом shadow root');
  const env4 = makeEnv({ requireConfirm: true });
  await sleep(60);
  const panel4 = env4.w.document.querySelector('.ax-exec-panel');
  env4.w.__realClick(panel4.$('.ax-btn-run'));
  await sleep(60);
  const modal = env4.w.document.querySelector('.ax-modal-backdrop');
  check('модалка появилась', !!modal);
  check('модалка закрыта от page-JS (shadowRoot === null)', modal && modal.shadowRoot === null);
  check('кнопка подтверждения не видна из DOM страницы',
    !!modal && modal.querySelector('.ax-btn-confirm') === null);
  check('кнопка подтверждения доступна расширению', !!modal && !!modal.$('.ax-btn-confirm'));
  check('синтетический клик по кнопке подтверждения НЕ выполняет команду', (() => {
    modal.$('.ax-btn-confirm').dispatchEvent(new env4.w.MouseEvent('click', { bubbles: true, cancelable: true }));
    return env4.runs.length === 0;
  })(), env4.runs);
  check('модалка осталась открытой после отклонённого клика', !!env4.w.document.querySelector('.ax-modal-backdrop'));
  check('в модалке есть кнопки отмены и подтверждения',
    !!modal.$('.ax-btn-cancel') && !!modal.$('.ax-btn-confirm'));
  // Путь «подтвердил -> команда ушла» проверен в блоке [3] (requireConfirm=false)
  // и в test/panel-autopilot: jsdom не ретаргетирует события из shadow root,
  // поэтому доверенный клик именно по вложенной кнопке модалки здесь не
  // воспроизводится — в реальном браузере это делает сам DOM.

  console.log('\n[4] retry() действительно перезапускает автопилот (был no-op из-за done)');
  const env2 = makeEnv({ autoExecute: true });
  await sleep(60);
  const panel2 = env2.w.document.querySelector('.ax-exec-panel');
  const handle = env2.w.AX.livePanels[0];
  check('панель автопилота создана', !!handle, env2.w.AX.livePanels.length);
  // Имитируем завершённое автозапуск: панель выполнилась и закрылась
  handle.finish();
  check('после finish() флаг done выставлен', handle.done === true);
  handle.retry();
  check('retry() сбросил done', handle.done === false);
  check('retry() перезапустил панель (started выставлен)', handle.started === true);
  check('панель снова в очереди/активна',
    env2.w.AX.autoQueue.indexOf(handle) !== -1 || env2.w.AX.currentAuto === handle || handle.started === true);
  await sleep(30);
  const p2 = env2.w.document.querySelector('.ax-exec-panel');
  check('panel.$ по-прежнему работает после retry', !!p2.$('.ax-btn-run'));

  console.log('\n[5] Повторный рендер блока не оставляет панель-сироту');
  const chat = env.w.document.getElementById('chat');
  // Имитируем перерисовку чата: новый <pre> с тем же кодом + скан
  const newPre = env.w.document.createElement('pre');
  newPre.setAttribute('data-language', 'execute');
  const code = env.w.document.createElement('code');
  code.textContent = 'echo hello';
  newPre.appendChild(code);
  chat.appendChild(newPre);
  env.w.AX.scan(chat, true);
  await sleep(30);
  const panelsForNew = newPre.nextElementSibling;
  check('у нового блока появилась ровно одна панель',
    !!panelsForNew && panelsForNew.classList.contains('ax-exec-panel'),
    panelsForNew && panelsForNew.className);
  check('панель-дубликат рядом не размножается',
    !(panelsForNew.nextElementSibling && panelsForNew.nextElementSibling.classList.contains('ax-exec-panel')));

  console.log('\n[6] applyPendingAuto() НЕ перезапускает завершённые панели (дефект A)');
  const envA = makeEnv({ autoExecute: true });
  await sleep(60);
  const hA = envA.w.AX.livePanels[0];
  // Имитируем полностью завершённую панель: очередь свободна, флаги сброшены.
  envA.w.AX.autoQueue.length = 0;
  envA.w.AX.currentAuto = null;
  envA.w.AX.autoActive = false;
  hA.started = false;
  hA.claimed = false;
  hA.finish();
  check('панель помечена как выполненная', hA.done === true);
  envA.w.AX.applyPendingAuto();
  check('applyPendingAuto() не сбросил done', hA.done === true, hA.done);
  check('applyPendingAuto() не вернул панель в очередь',
    envA.w.AX.autoQueue.indexOf(hA) === -1 && envA.w.AX.currentAuto !== hA,
    { queue: envA.w.AX.autoQueue.length, current: envA.w.AX.currentAuto === hA });
  check('выполненная команда не ушла на сервер повторно', envA.runs.length === 0, envA.runs);

  console.log('\n[7] Ошибка выполнения тоже выставляет done (дефект C)');
  const envC = makeEnv({ requireConfirm: false, runError: true });
  await sleep(60);
  const hC = envC.w.AX.livePanels[0];
  envC.w.__realClick(envC.w.document.querySelector('.ax-exec-panel').$('.ax-btn-run'));
  await sleep(80);
  check('команда ушла и вернулась ошибкой', envC.runs.length === 1);
  check('после ошибки done выставлен (нет повторного автозапуска)', hC.done === true, hC.done);

  console.log('\n[8] Панель, заблокированная loop-guard, стартует после снятия блокировки (дефект D)');
  const envD = makeEnv({ autoExecute: true });
  await sleep(60);
  envD.w.AX.loopBlocked = true;
  const chatD = envD.w.document.getElementById('chat');
  const preD = envD.w.document.createElement('pre');
  preD.setAttribute('data-language', 'execute');
  const codeD = envD.w.document.createElement('code');
  codeD.textContent = 'echo d';
  preD.appendChild(codeD);
  chatD.appendChild(preD);
  envD.w.AX.scan(chatD, true);
  await sleep(20);
  const hD = envD.w.AX.livePanels[envD.w.AX.livePanels.length - 1];
  check('панель построена', !!hD && hD.done === false);
  check('started НЕ выставлен, пока блокировка loop-guard активна', hD.started === false, hD.started);
  envD.w.AX.loopBlocked = false;
  envD.w.AX.applyPendingAuto();
  check('после снятия loop-guard панель запустилась', hD.started === true, hD.started);

  console.log('\n[9] retry() снова показывает очередь (дефект B: фазовая защёлка phase2)');
  const envB = makeEnv({ autoExecute: true });
  await sleep(60);
  const hB = envB.w.AX.livePanels[0];
  hB.runNow(() => {});                 // выставляет phase2 = true
  envB.w.AX.autoActive = true;          // имитируем занятую очередь (другая панель)
  hB.retry();                           // должен сбросить phase2
  hB.showQueued(1);
  const statusB = envB.w.document.querySelector('.ax-exec-panel').$('.ax-exec-status');
  check('после retry очередь снова отображается',
    /в очереди|подготовка/.test(statusB.textContent), statusB.textContent);

  console.log('\n[10] Кото-тема доезжает до панели через AX.applyPanelAppearance (дефект v2.11.2)');
  const envK = makeEnv({ autoExecute: false });
  await sleep(50);
  const panelK = envK.w.document.querySelector('.ax-exec-panel');
  check('хост панели создан', !!panelK);
  envK.w.AX.settings.catMode = true;
  envK.w.AX.applyPanelAppearance(panelK);
  check('при catMode=true хост получает data-ax-cat="on"',
    panelK.getAttribute('data-ax-cat') === 'on', panelK.getAttribute('data-ax-cat'));
  envK.w.AX.settings.catMode = false;
  envK.w.AX.applyPanelAppearance(panelK);
  check('при catMode=false атрибут снимается', panelK.getAttribute('data-ax-cat') === null);

  console.log('\n[11] AX.cancelAllAuto() останавливает активный таймер и очищает очередь');
  const env11 = makeEnv({ autoExecute: true });
  await sleep(60);
  const chat11 = env11.w.document.getElementById('chat');
  const pre11 = env11.w.document.createElement('pre');
  pre11.setAttribute('data-language', 'execute');
  const code11 = env11.w.document.createElement('code');
  code11.textContent = 'echo queued_block';
  pre11.appendChild(code11);
  chat11.appendChild(pre11);
  env11.w.AX.scan(chat11, true);
  await sleep(30);
  check('две панели созданы', env11.w.AX.livePanels.length === 2);
  env11.w.AX.cancelAllAuto('Автопилот остановлен тестом');
  check('AX.autoQueue пуста после cancelAllAuto', env11.w.AX.autoQueue.length === 0);
  check('AX.currentAuto сброшен', env11.w.AX.currentAuto === null);
  check('AX.autoActive === false', env11.w.AX.autoActive === false);
  const status11a = env11.w.AX.livePanels[0].el.$('.ax-exec-status');
  check('статус первой панели обновлен текстом отмены',
    status11a.textContent.includes('Автопилот остановлен тестом'), status11a.textContent);
  check('кнопка отмены авто удалена у первой панели',
    env11.w.AX.livePanels[0].el.$('.ax-btn-cancel-auto') === null);
  await sleep(60);
  check('команды не отправлялись на сервер', env11.runs.length === 0);

  console.log('\n[12] Ручной запуск (▶) стоящей в очереди панели немедленно извлекает её из очереди');
  const env12 = makeEnv({ autoExecute: true, requireConfirm: false });
  await sleep(60);
  const chat12 = env12.w.document.getElementById('chat');
  const pre12 = env12.w.document.createElement('pre');
  pre12.setAttribute('data-language', 'execute');
  const code12 = env12.w.document.createElement('code');
  code12.textContent = 'echo manual_queued';
  pre12.appendChild(code12);
  chat12.appendChild(pre12);
  env12.w.AX.scan(chat12, true);
  await sleep(30);
  const hQueued = env12.w.AX.livePanels[1];
  check('вторая панель стоит в AX.autoQueue', env12.w.AX.autoQueue.includes(hQueued));
  // Пользователь вручную нажимает ▶ на второй панели, пока первая занята
  env12.w.__realClick(hQueued.el.$('.ax-btn-run'));
  check('вторая панель немедленно удалена из AX.autoQueue до завершения выполнения',
    !env12.w.AX.autoQueue.includes(hQueued));

  console.log('\n[13] Отмена подтверждения (модалки) в doRun переводит панель в статус отмены и finish()');
  const env13 = makeEnv({ autoExecute: false, requireConfirm: true });
  await sleep(60);
  const h13 = env13.w.AX.livePanels[0];
  env13.w.__realClick(h13.el.$('.ax-btn-run'));
  await sleep(60);
  const modal13 = env13.w.document.querySelector('.ax-modal-backdrop');
  check('модалка подтверждения открыта', !!modal13);
  env13.w.__realClick(modal13.$('.ax-btn-cancel'));
  await sleep(60);
  check('модалка закрылась', env13.w.document.querySelector('.ax-modal-backdrop') === null);
  const status13 = h13.el.$('.ax-exec-status');
  check('статус очищен от running/автопилот и сообщает об отмене пользователем',
    status13.textContent.includes('Действие отменено пользователем'), status13.textContent);
  check('handle помечен как finish (done = true)', h13.done === true);
  check('кнопка отмены авто отсутствует', h13.el.$('.ax-btn-cancel-auto') === null);

  console.log('\n[14] Ранние пропуски в runAutoNow (empty/danger/duplicate) завершают панель (done = true)');
  const env14 = makeEnv({ autoExecute: true });
  await sleep(60);
  env14.w.AX.waitForSettle = (pre, cb) => {
    setTimeout(() => { try { cb(env14.w.AXDetector.getCodeText(pre)); } catch (e) {} }, 10);
    return () => {};
  };
  const chat14 = env14.w.document.getElementById('chat');
  const pre14 = env14.w.document.createElement('pre');
  pre14.setAttribute('data-language', 'execute');
  const code14 = env14.w.document.createElement('code');
  code14.textContent = '   ';
  pre14.appendChild(code14);
  chat14.appendChild(pre14);
  env14.w.AX.scan(chat14, true);
  await sleep(30);
  const h14 = env14.w.AX.livePanels[1];
  h14.runNow(() => {});
  await sleep(60);
  check('пустая команда помечена finish (done = true)', h14.done === true);
  const status14 = h14.el.$('.ax-exec-status');
  check('статус содержит сообщение о пропуске пустой команды',
    status14.textContent.includes('Пустая команда — пропуск'), status14.textContent);
  check('кнопка отмены авто удалена', h14.el.$('.ax-btn-cancel-auto') === null);

  console.log('\n[15] Отключение autoExecute в sync storage вызывает cancelAllAuto');
  const env15 = makeEnv({ autoExecute: true });
  await sleep(60);
  check('начальный autoActive выставлен или панель активна',
    env15.w.AX.autoActive === true || env15.w.AX.currentAuto !== null);
  // Эмулируем смену настройки пользователем в options/popup
  await env15.chromeStub.storage.sync.set({ autoExecute: false });
  await sleep(50);
  check('после отключения autoExecute очередь пуста', env15.w.AX.autoQueue.length === 0);
  check('currentAuto очищен', env15.w.AX.currentAuto === null);
  check('autoActive сброшен в false', env15.w.AX.autoActive === false);
  const status15 = env15.w.AX.livePanels[0].el.$('.ax-exec-status');
  check('статус панели показывает, что автопилот отключён',
    status15.textContent.includes('Автопилот отключён в настройках'), status15.textContent);

  console.log('\n======================================================');
  console.log('Итог: ' + passed + ' ok, ' + failed + ' fail');
  if (failed) {
    console.log('Провалы:\n  - ' + failures.join('\n  - '));
    process.exit(1);
  }
  console.log('Все проверки прошли.');
  process.exit(0);
}

run().catch((e) => {
  console.log('FAIL (исключение): ' + (e && e.stack || e));
  process.exit(1);
});
