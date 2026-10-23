const fs = require('fs');
const path = require('path');
const puppeteer = require('../tests/node_modules/puppeteer-core');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'docs', 'screenshots');

if (!fs.existsSync(OUT_DIR)) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

async function render() {
  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/chromium',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--force-color-profile=srgb'],
    defaultViewport: null
  });

  try {
    // 1. Popup Screenshot
    console.log('Rendering popup.png...');
    const pagePopup = await browser.newPage();
    await pagePopup.setViewport({ width: 360, height: 600, deviceScaleFactor: 2 });
    
    // Inject mock before script runs
    await pagePopup.evaluateOnNewDocument(() => {
      window.chrome = {
        runtime: {
          getManifest: () => ({ version: '2.12.3' }),
          sendMessage: (msg) => {
            if (msg.type === 'AX_PING') {
              return Promise.resolve({
                ok: true,
                info: { version: '2.12.3', platform: 'Linux', cwd: '/home/user/project' }
              });
            }
            return Promise.resolve({ ok: true });
          }
        },
        storage: {
          sync: {
            get: (keys, cb) => {
              const data = {
                serverUrl: 'http://127.0.0.1:8765',
                timeout: 30,
                requireConfirm: true,
                autoExecute: false,
                autoInsert: false,
                autoSend: false,
                autoDelay: 3
              };
              cb ? cb(data) : null;
              return Promise.resolve(data);
            },
            set: (items, cb) => { cb && cb(); return Promise.resolve(); }
          },
          local: {
            get: (keys, cb) => cb ? cb({}) : Promise.resolve({}),
            set: (items, cb) => cb && cb()
          }
        }
      };
    });

    await pagePopup.goto('file://' + path.join(ROOT, 'extension', 'popup.html'), { waitUntil: 'networkidle0' });
    await pagePopup.evaluate(() => {
      const st = document.getElementById('status');
      if (st) {
        st.className = 'status ok';
        st.textContent = 'Сервер v2.12.3 на связи (порт 8765)';
      }
      const ver = document.getElementById('ver');
      if (ver) ver.textContent = 'v2.12.3';
    });
    await new Promise(r => setTimeout(r, 400));
    await pagePopup.screenshot({
      path: path.join(OUT_DIR, 'popup.png'),
      clip: { x: 0, y: 0, width: 340, height: 580 }
    });
    await pagePopup.close();

    // 2. Chat Panel Screenshot (Dark AI Chat with attached Execution Panel)
    console.log('Rendering chat-panel.png...');
    const chatHtmlPath = path.join(ROOT, 'tools', '_mock_chat.html');
    const mockChatHtml = `<!DOCTYPE html>
<html lang="ru" data-ax-theme="dark">
<head>
<meta charset="utf-8">
<link rel="stylesheet" href="../extension/ax-ui.css">
<link rel="stylesheet" href="../extension/content.css">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: #18191e;
    color: #ececf1;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    padding: 32px 24px;
    display: flex;
    justify-content: center;
  }
  .chat-wrap {
    width: 100%;
    max-width: 820px;
    display: flex;
    flex-direction: column;
    gap: 24px;
  }
  .chat-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-bottom: 16px;
    border-bottom: 1px solid #2d2f39;
    color: #9aa0a6;
    font-size: 14px;
  }
  .chat-header b { color: #fff; font-size: 16px; }
  .msg {
    display: flex;
    gap: 16px;
  }
  .avatar {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: #343541;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 700;
    font-size: 14px;
    flex-shrink: 0;
  }
  .avatar.ai {
    background: linear-gradient(135deg, #10a37f, #0d8a6a);
    color: #fff;
  }
  .msg-body {
    flex: 1;
    line-height: 1.6;
    font-size: 15px;
  }
  .user-msg {
    background: #23252e;
    padding: 14px 18px;
    border-radius: 12px;
  }
  .code-container {
    margin-top: 12px;
    background: #0f1220;
    border: 1px solid #2b3040;
    border-radius: 8px;
    overflow: hidden;
  }
  .code-header {
    display: flex;
    justify-content: space-between;
    padding: 8px 14px;
    background: #151928;
    color: #8b949e;
    font-size: 12px;
    font-family: monospace;
  }
  .code-content {
    padding: 14px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 13.5px;
    color: #f0f6fc;
    line-height: 1.5;
  }
  /* Shadow DOM host simulation in demo */
  .ax-panel-demo {
    margin-top: 10px;
    background: var(--ax-surface);
    border: 1px solid var(--ax-border);
    border-radius: var(--ax-r-md);
    position: relative;
    overflow: hidden;
    box-shadow: var(--ax-shadow-2);
  }
  .ax-panel-demo::before {
    content: "";
    position: absolute;
    inset: 0 auto 0 0;
    width: 3px;
    background: linear-gradient(180deg, var(--ax-accent), var(--ax-accent-strong));
  }
</style>
</head>
<body class="ax-ui" data-ax-theme="dark">

<div class="chat-wrap">
  <div class="chat-header">
    <b>AI Chat · Проверка окружения</b>
    <span>GPT-4o / Claude 3.5 Sonnet</span>
  </div>

  <div class="msg">
    <div class="avatar">U</div>
    <div class="msg-body user-msg">
      Проверь статус репозитория, ветку и запусти автоматические тесты расширения.
    </div>
  </div>

  <div class="msg">
    <div class="avatar ai">AI</div>
    <div class="msg-body">
      Конечно! Вот команда для проверки текущего статуса git и запуска проверок дизайн-системы:
      
      <div class="code-container">
        <div class="code-header">
          <span>bash · execute</span>
          <span>Копировать код</span>
        </div>
        <div class="code-content">git status -s &amp;&amp; npm test</div>
      </div>

      <!-- Execution Panel Attached -->
      <div class="ax-exec-panel ax-panel-demo">
        <div class="ax-shadow-content">
          <div class="ax-exec-header">
            <span class="ax-exec-badge">
              <svg class="ax-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8Z"/></svg>
              EXECUTE SHELL
            </span>
            <div class="ax-runner-wrap">
              <span class="ax-runner-label">Среда:</span>
              <select class="ax-runner-select">
                <option value="shell" selected>shell (bash)</option>
                <option value="python">python</option>
                <option value="node">node</option>
              </select>
            </div>
            <button class="ax-btn ax-btn-run">
              <svg class="ax-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 3l14 9-14 9V3z"/></svg>
              Выполнить
            </button>
            <button class="ax-btn ax-btn-copy">
              <svg class="ax-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 9h10v10H9zM5 15V5h10"/></svg>
              Копировать
            </button>
          </div>

          <div class="ax-exec-cmd-preview">
            <span class="ax-preview-text">git status -s &amp;&amp; npm test</span>
            <span class="ax-preview-hint">клик — развернуть</span>
          </div>

          <div class="ax-exec-status ax-ok" style="display:flex;">
            ✓ Выполнено за 140 мс (exit code: 0)
          </div>

          <pre class="ax-exec-output">M  extension/content.css
M  extension/options.html
M  extension/popup.html
?? docs/screenshots/

[ui-system] Design system: 139 ok, 0 fail
[mcp] External tools &amp; protocols: 117 ok, 0 fail
Все 10 наборов тестов пройдены успешно!</pre>

          <div class="ax-exec-after" style="display:flex;">
            <button class="ax-btn ax-btn-insert">
              <svg class="ax-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
              Вставить вывод в чат
            </button>
            <button class="ax-btn ax-btn-copy-out">
              <svg class="ax-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 9h10v10H9zM5 15V5h10"/></svg>
              Копировать результат
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>

<div id="ax-server-dot" class="ax-online">
  Сервер на связи :8765
</div>

</body>
</html>`;

    fs.writeFileSync(chatHtmlPath, mockChatHtml, 'utf8');

    const pageChat = await browser.newPage();
    await pageChat.setViewport({ width: 1040, height: 740, deviceScaleFactor: 2 });
    await pageChat.goto('file://' + chatHtmlPath, { waitUntil: 'networkidle0' });
    await new Promise(r => setTimeout(r, 400));
    await pageChat.screenshot({
      path: path.join(OUT_DIR, 'chat-panel.png'),
      clip: { x: 40, y: 10, width: 960, height: 710 }
    });
    await pageChat.close();
    fs.unlinkSync(chatHtmlPath);

    // 3. Options Screenshot
    console.log('Rendering options.png...');
    const pageOptions = await browser.newPage();
    await pageOptions.setViewport({ width: 1200, height: 860, deviceScaleFactor: 2 });
    
    await pageOptions.evaluateOnNewDocument(() => {
      window.chrome = {
        runtime: {
          getManifest: () => ({ version: '2.12.3' }),
          sendMessage: (msg) => {
            if (msg.type === 'AX_PING') {
              return Promise.resolve({
                ok: true,
                info: { version: '2.12.3', platform: 'Linux', cwd: '/home/user/project' }
              });
            }
            return Promise.resolve({ ok: true });
          }
        },
        storage: {
          sync: {
            get: (keys, cb) => {
              const data = {
                serverUrl: 'http://127.0.0.1:8765',
                timeout: 30,
                defaultCwd: '~/projects',
                requireConfirm: true,
                autoExecute: false,
                autoInsert: true,
                autoSend: false,
                autoDelay: 3,
                uiPalette: 'indigo',
                uiRadius: 'round',
                uiBtnStyle: 'solid',
                uiDensity: 'compact'
              };
              cb ? cb(data) : null;
              return Promise.resolve(data);
            },
            set: (items, cb) => { cb && cb(); return Promise.resolve(); }
          },
          local: {
            get: (keys, cb) => cb ? cb({}) : Promise.resolve({}),
            set: (items, cb) => cb && cb()
          }
        }
      };
    });

    await pageOptions.goto('file://' + path.join(ROOT, 'extension', 'options.html'), { waitUntil: 'networkidle0' });
    await pageOptions.evaluate(() => {
      const st = document.getElementById('status');
      if (st) {
        st.className = 'status ok';
        st.textContent = 'Сервер v2.12.3 на связи · порт 8765 (Linux)';
      }
      const ver = document.getElementById('ver');
      if (ver) ver.textContent = '2.12.3';
    });
    await new Promise(r => setTimeout(r, 400));
    await pageOptions.screenshot({
      path: path.join(OUT_DIR, 'options.png'),
      clip: { x: 0, y: 0, width: 1200, height: 840 }
    });

    // 4. Appearance Tuning Screenshot
    console.log('Rendering appearance.png...');
    await pageOptions.evaluate(() => {
      const lookCard = document.getElementById('sec-look');
      if (lookCard) {
        lookCard.open = true;
        const more = document.getElementById('uiMore');
        if (more) more.hidden = false;
        const moreBtn = document.getElementById('uiMoreBtn');
        if (moreBtn) moreBtn.setAttribute('aria-expanded', 'true');
      }
      // Temporarily unstick topbar and actionbar for clean card screenshot
      const topbar = document.querySelector('.topbar');
      if (topbar) topbar.style.position = 'static';
      const actionbar = document.querySelector('.actionbar');
      if (actionbar) actionbar.style.position = 'static';
    });
    await new Promise(r => setTimeout(r, 400));
    const lookEl = await pageOptions.$('#sec-look');
    if (lookEl) {
      await lookEl.screenshot({
        path: path.join(OUT_DIR, 'appearance.png')
      });
    }
    await pageOptions.close();

    console.log('All screenshots rendered successfully into docs/screenshots/!');
  } finally {
    await browser.close();
  }
}

render().catch(err => {
  console.error('Error generating screenshots:', err);
  process.exit(1);
});
