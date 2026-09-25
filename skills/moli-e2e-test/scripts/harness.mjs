/**
 * moli-e2e-test · 人类化网页自动化测试框架（harness）
 *
 * 通过 CDP 连接 Moli 无头浏览器，提供：
 *   - 拟人操作：带逐字抖动的输入、移动鼠标后点击、悬停、滚动、下拉选择
 *   - 断言：可见/隐藏、文本、值、数量、URL、字段校验错误、提交拦截、成功提示
 *   - 诊断：控制台错误、页面异常、失败请求（用于发现静默失败）
 *   - 报告：失败自动截图，交由 report.mjs 汇总
 *
 * 设计原则：Moli 替代浏览器引擎，不替代测试框架。Playwright 照常用，
 * 只把 Chromium 换成 Moli 的 CDP 端点。
 *
 * Moli 布局特性（实测）：对「无显式尺寸」的元素（如仅有文本的块级 div），
 * Moli 可能返回 0×0 包围盒，使 Playwright 原生 isVisible()/click() 误判。
 * 因此本 harness 的可见性判定改用「计算样式 + 祖先链」（不依赖包围盒），
 * 点击/输入在遇到不可点击时回退 force。详见 references/ui-selectors.md。
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';
import fsp from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { diagnoseSelector } from './selector-doctor.mjs';

export { diagnoseSelector };

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const SKILL_DIR = path.resolve(__dirname, '..');

/* ------------------------------------------------------------------ *
 * 依赖解析：从多个候选目录定位 playwright
 * （ESM 的 bare import 不认 NODE_PATH，故显式用 require.resolve 搜索）
 * ------------------------------------------------------------------ */
function resolvePlaywright() {
  const extra = (process.env.MOLI_PW_PATHS || '')
    .split(path.delimiter)
    .filter(Boolean);
  const dirs = [SKILL_DIR, path.join(os.homedir(), '.moli-e2e'), ...extra];
  for (const d of dirs) {
    try {
      return require.resolve('playwright', { paths: [d] });
    } catch {
      /* 继续找下一个 */
    }
  }
  return null;
}

const PW = resolvePlaywright();
if (!PW) {
  console.error('[moli-e2e] 未找到 playwright。请先运行 scripts/run.sh（会自动安装），');
  console.error(`[moli-e2e] 或在 ${SKILL_DIR} 下执行：PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install`);
  process.exit(2);
}
const { chromium } = require(PW); // 用 resolvePlaywright() 解析出的路径，而非 bare specifier

/* ------------------------------------------------------------------ *
 * 工具
 * ------------------------------------------------------------------ */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rnd = ([a, b]) => a + Math.floor(Math.random() * (b - a + 1));
const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const asLocator = (page, t) => (typeof t === 'string' ? page.locator(t) : t);
const desc = (t) =>
  typeof t === 'string' ? t : t && typeof t.toString === 'function' ? t.toString() : String(t);
const sanitize = (s) => String(s).replace(/[^\w\u4e00-\u9fa5.-]+/g, '_').slice(0, 60);

/**
 * 页面是否「真正空白」：URL 为 about:blank **且** body 无子元素。
 * （用 t.page.setContent() 注入过内容的页面 URL 也是 about:blank，但 body 非空，故不算空白。）
 */
async function isBlankPage(page) {
  try {
    if (page.url() !== 'about:blank') return false;
    return !(await page.evaluate(() => !!(document.body && document.body.childElementCount > 0)));
  } catch {
    return false;
  }
}

/**
 * 空白页失败提示。根因：本框架每个用例都会 context.newPage()
 * （登录态经 context 共享，但页面不继承），用例不自己 goto 就会在空白页上断言。
 */
export function blankPageHint(url) {
  if (url && url !== 'about:blank') return '';
  return [
    '【提示】每个用例都会新建页面（newPage）：登录态经 context 共享，但页面不会继承。',
    '        用例开头需自行调用 await t.human.goto(路径)（或 t.page.setContent(html)）。',
    `        当前页面仍是 about:blank，断言实际是在空白页上执行的。`,
  ].join('\n');
}

/** 常见 UI 库的字段级错误文案选择器 */
const ERROR_SEL =
  '.el-form-item__error, .ant-form-item-explain-error, .field-error, .error-message, .invalid-feedback, .form-error, [data-error]';

/**
 * 布局无关的「是否显示」判定：检查元素及祖先的 display/visibility/opacity，
 * 不依赖包围盒大小（规避 Moli 零尺寸布局特性）。元素不存在则返回 false。
 */
async function isShown(loc) {
  // 纯手写祖先链判定：不依赖 checkVisibility（其选项可能被引擎忽略），确定性更好
  return loc
    .evaluate((el) => {
      if (!el || el.nodeType !== 1) return false;
      let node = el;
      while (node && node.nodeType === 1) {
        const cs = getComputedStyle(node);
        if (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse') return false;
        if (Number(cs.opacity) === 0) return false;
        node = node.parentElement;
      }
      return true;
    })
    .catch(() => false);
}

/** 轮询等待元素处于显示/隐藏状态（多匹配时：want=true 只要有一个显示即可） */
async function waitShown(loc, want, timeout) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const count = await loc.count().catch(() => 0);
    if (count > 0) {
      const n = Math.min(count, 20);
      let anyShown = false;
      for (let i = 0; i < n; i++) {
        if (await isShown(loc.nth(i))) { anyShown = true; break; }
      }
      if (anyShown === want) return true;
    } else if (!want) {
      return true; // 元素不存在也算「隐藏」
    }
    if (Date.now() >= deadline) return false;
    await sleep(100);
  }
}

export const defaultConfig = {
  endpoint: process.env.MOLI_CDP || 'http://127.0.0.1:9222',
  baseURL: process.env.BASE_URL || '',
  // 统一根目录：所有 e2e 产物（用例 / 报告 / 截图）都收在项目的 e2e/ 下，不在根目录散落
  e2eDir: process.env.E2E_DIR || path.resolve(process.cwd(), 'e2e'),
  reportDir: process.env.REPORT_DIR || path.resolve(process.cwd(), 'e2e', 'reports'),
  screenshotDir: process.env.SHOTS_DIR || path.resolve(process.cwd(), 'e2e', 'screenshots'),
  human: process.env.MOLI_HUMAN !== '0', // 拟人模式默认开
  screenshots: process.env.MOLI_SHOTS || 'on-failure', // always | on-failure | off
  timeout: Number(process.env.MOLI_TIMEOUT || 15000),
  speed: {
    typeDelay: [25, 80], // 每个字符的随机停顿(ms)
    clickPause: [50, 140], // 悬停到点击之间的停顿
    afterClick: [120, 300], // 点击后的反应停顿
    betweenActions: [60, 180], // 两个动作之间的停顿
  },
};

/* ------------------------------------------------------------------ *
 * 会话
 * ------------------------------------------------------------------ */
export async function createSession(userCfg = {}, sharedBrowser = null) {
  const cfg = {
    ...defaultConfig,
    ...userCfg,
    speed: { ...defaultConfig.speed, ...(userCfg.speed || {}) },
  };
  if (!/^https?:\/\//i.test(cfg.endpoint)) cfg.endpoint = 'http://' + cfg.endpoint;

  const browser = sharedBrowser || (await chromium.connectOverCDP(cfg.endpoint));

  let context = null;
  try {
    context = await browser.newContext();
  } catch {
    /* 部分端点不支持新建上下文 */
  }
  if (!context) context = browser.contexts()[0] || null;
  if (!context) throw new Error('[moli-e2e] 无法创建浏览器上下文（端点无可用 context）');

  const tests = [];
  let currentGroup = '';

  const session = {
    cfg,
    browser,
    context,
    tests,

    get baseURL() {
      return cfg.baseURL;
    },

    /** 分组：session.describe('登录模块', () => { session.it(...) }) */
    describe(name, define) {
      const prev = currentGroup;
      currentGroup = name;
      define();
      currentGroup = prev;
      return session;
    },

    /** 注册用例：session.it(name, async (t) => {...}, { skip }) */
    it(name, fn, opts = {}) {
      tests.push({ name, fn, group: currentGroup, skip: !!opts.skip, skipReason: opts.skipReason });
      return session;
    },

    /** 别名 */
    test(name, fn, opts) {
      return session.it(name, fn, opts);
    },

    /** 相对 baseURL 补全绝对地址 */
    abs(u) {
      if (typeof u !== 'string') return u;
      if (/^[a-z][a-z0-9+.-]*:\/\//i.test(u) || u.startsWith('data:') || u.startsWith('file:') || u.startsWith('about:'))
        return u;
      if (!cfg.baseURL) return u;
      return cfg.baseURL.replace(/\/+$/, '') + '/' + u.replace(/^\/+/, '');
    },

    async screenshot(page, name) {
      const dir = cfg.screenshotDir;
      const file = path.join(dir, `${sanitize(name)}-${Date.now()}.png`);
      try {
        await fsp.mkdir(dir, { recursive: true }); // mkdir 纳入 try：承诺「失败返回 null」
        await page.screenshot({ path: file, fullPage: true });
        // 返回相对 e2eDir 的路径，报告 JSON 里不泄漏机器绝对路径
        return cfg.e2eDir ? path.relative(cfg.e2eDir, file) : file;
      } catch {
        return null;
      }
    },

    async run() {
      const results = [];
      const t0 = Date.now();
      for (const test of tests) {
        const label = `${test.group ? test.group + ' › ' : ''}${test.name}`;
        process.stdout.write(`\n▶ ${label}\n`);
        if (test.skip) {
          results.push({
            group: test.group,
            name: test.name,
            status: 'skipped',
            ms: 0,
            error: test.skipReason ? { message: test.skipReason } : null,
            shot: null,
            diag: emptyDiag(),
            url: null,
            steps: [],
          });
          process.stdout.write(`  ⏭ SKIP${test.skipReason ? '  (' + test.skipReason + ')' : ''}\n`);
          continue;
        }
        const r = await runTest(session, test);
        results.push(r);
        const ok = r.status === 'passed';
        process.stdout.write(`  ${ok ? '✅ PASS' : '❌ FAIL'}  (${r.ms}ms)\n`);
        if (!ok) {
          // 错误信息可能多行（含选择器诊断），续行缩进以保持可读
          process.stdout.write(`     ↳ ${r.error.message.split('\n').join('\n       ')}\n`);
          if (r.url) process.stdout.write(`     页面: ${r.url}\n`);
          if (r.shot) process.stdout.write(`     截图: ${r.shot}\n`);
          if (r.diag.consoleErrors.length)
            process.stdout.write(`     控制台错误: ${r.diag.consoleErrors[0]}\n`);
          if (r.diag.pageErrors.length)
            process.stdout.write(`     页面异常: ${r.diag.pageErrors[0]}\n`);
          if (r.diag.failedRequests.length)
            process.stdout.write(`     失败请求: ${r.diag.failedRequests[0]}\n`);
        }
      }
      return {
        endpoint: cfg.endpoint,
        baseURL: cfg.baseURL,
        human: cfg.human,
        startedAt: new Date(t0).toISOString(),
        durationMs: Date.now() - t0,
        total: results.length,
        passed: results.filter((r) => r.status === 'passed').length,
        failed: results.filter((r) => r.status === 'failed').length,
        skipped: results.filter((r) => r.status === 'skipped').length,
        results,
      };
    },

    /** 关闭上下文，保留与端点的连接（供多 spec 复用） */
    async close() {
      try {
        await context.close();
      } catch {
        /* ignore */
      }
    },

    /** 彻底断开与端点的连接 */
    async disconnect() {
      await session.close();
      try {
        await browser.close();
      } catch {
        /* ignore */
      }
    },
  };

  return session;
}

const emptyDiag = () => ({ consoleErrors: [], pageErrors: [], failedRequests: [] });

/* ------------------------------------------------------------------ *
 * 单个用例执行
 * ------------------------------------------------------------------ */
async function runTest(session, test) {
  const { cfg } = session;
  const page = await session.context.newPage();
  page.setDefaultTimeout(cfg.timeout);

  const diag = emptyDiag();
  page.on('console', (m) => {
    if (m.type() === 'error') diag.consoleErrors.push(norm(m.text()));
  });
  page.on('pageerror', (e) => diag.pageErrors.push(norm(e && e.message ? e.message : e)));
  page.on('requestfailed', (r) =>
    diag.failedRequests.push(`${r.method()} ${r.url()} :: ${(r.failure() || {}).errorText || ''}`),
  );

  const t = buildContext(session, page);
  const started = Date.now();
  let status = 'passed';
  let error = null;
  let shot = null;
  let blank = false;
  try {
    await test.fn(t);
  } catch (e) {
    status = 'failed';
    // 空白页守卫：不自己 goto 的用例会在 about:blank 上断言，必须把根因说清楚
    blank = await isBlankPage(page);
    const raw = norm(e && e.message ? e.message : e);
    error = {
      message: blank ? `${raw}\n${blankPageHint(page.url())}` : raw,
      stack: e && e.stack,
    };
    // 空白页截图必然全白，误导性强，直接不产出
    if (cfg.screenshots !== 'off' && !blank)
      shot = await session.screenshot(page, `${test.group || 'test'}-${test.name}`);
  }
  if (status === 'passed' && cfg.screenshots === 'always') {
    shot = await session.screenshot(page, `${test.group || 'test'}-${test.name}`);
  }
  const ms = Date.now() - started;
  const url = page.url();
  await page.close().catch(() => {});
  return { group: test.group, name: test.name, status, ms, error, shot, diag, url, steps: t._steps };
}

/* ------------------------------------------------------------------ *
 * 用例上下文：t.page / t.human / t.expect / t.step
 * ------------------------------------------------------------------ */
function buildContext(session, page) {
  const cfg = session.cfg;
  const speed = cfg.speed;
  const _steps = [];
  const pause = async (range) => {
    if (cfg.human) await sleep(rnd(range));
  };
  const abs = (u) => session.abs(u);

  /**
   * 失败诊断：把「为什么找不到」拼进错误信息。
   * 字符串选择器可进页面探测；Locator 对象只能展示其字符串形式（probe=false）。
   */
  const diagFor = async (target, { fnName, text = null } = {}) => {
    const s = typeof target === 'string' ? target : null;
    return diagnoseSelector(page, s || desc(target), { fnName, text, probe: !!s });
  };
  const withDiag = async (msg, target, opts) => `${msg}\n${await diagFor(target, opts)}`;

  /* ---- 底层：稳健聚焦/点击（规避 Moli 零尺寸布局） ---- */
  const prepare = async (target) => {
    const loc = asLocator(page, target).first();
    await loc.waitFor({ state: 'attached', timeout: cfg.timeout });
    if (!(await isShown(loc)))
      throw new Error(await withDiag(`目标不可见: ${desc(target)}`, target, { fnName: 'human(准备元素)' }));
    await loc.scrollIntoViewIfNeeded().catch(() => {});
    return loc;
  };
  const rawClick = async (loc) => {
    const box = await loc.boundingBox().catch(() => null);
    if (box && box.width && box.height) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: rnd([6, 14]) }).catch(() => {});
    }
    await sleep(rnd(speed.clickPause));
    await loc.hover({ timeout: 2000 }).catch(() => {});
    try {
      await loc.click({ timeout: 3000 });
    } catch {
      // 零尺寸/被遮挡时回退：跳过可操作性检查
      await loc.click({ force: true });
    }
  };

  /* ---- 拟人操作 ---- */
  const human = {
    async goto(url, opts = {}) {
      await page.goto(abs(url), { waitUntil: 'domcontentloaded', ...opts });
      await pause(speed.betweenActions);
      return page;
    },
    async type(target, text) {
      const loc = await prepare(target);
      await rawClick(loc);
      await loc.fill('', { force: true }).catch(() => {});
      for (const ch of String(text)) {
        if (ch === '\n') await page.keyboard.press('Enter');
        else await page.keyboard.type(ch);
        await sleep(rnd(speed.typeDelay));
      }
      await pause(speed.betweenActions);
    },
    async click(target) {
      const loc = await prepare(target);
      await rawClick(loc);
      await pause(speed.afterClick);
    },
    async hover(target) {
      const loc = await prepare(target);
      await loc.hover({ timeout: 3000 }).catch(async () => loc.hover({ force: true }).catch(() => {}));
      await pause(speed.betweenActions);
    },
    async select(target, value) {
      const loc = await prepare(target);
      await loc.selectOption(value).catch(async () => loc.selectOption(value, { force: true }));
      await pause(speed.betweenActions);
    },
    async check(target) {
      const loc = await prepare(target);
      await loc.check({ force: true }).catch(() => {});
      await pause(speed.betweenActions);
    },
    async uncheck(target) {
      const loc = await prepare(target);
      await loc.uncheck({ force: true }).catch(() => {});
      await pause(speed.betweenActions);
    },
    async clear(target) {
      const loc = asLocator(page, target).first();
      await loc.fill('', { force: true }).catch(() => {});
      await pause(speed.betweenActions);
    },
    async press(key) {
      await page.keyboard.press(key);
      await pause(speed.betweenActions);
    },
    async scroll(dy) {
      await page.mouse.wheel(0, dy);
      await pause(speed.betweenActions);
    },
    async scrollTo(target) {
      await asLocator(page, target).first().scrollIntoViewIfNeeded().catch(() => {});
      await pause(speed.betweenActions);
    },
  };

  /* ---- 断言 ---- */
  const expect = {
    async ok(cond, msg) {
      if (!cond) throw new Error(msg || '断言失败');
    },
    async fail(msg) {
      throw new Error(msg || '显式失败');
    },
    /** 可见（布局无关，规避 Moli 零尺寸布局） */
    async visible(target, msg) {
      const loc = asLocator(page, target);
      if (!(await waitShown(loc, true, cfg.timeout)))
        throw new Error(
          await withDiag(msg || `预期元素可见，但未出现: ${desc(target)}`, target, { fnName: 'expect.visible' }),
        );
    },
    /** 隐藏/不存在 */
    async hidden(target, msg) {
      const loc = asLocator(page, target);
      if (!(await waitShown(loc, false, cfg.timeout)))
        throw new Error(
          await withDiag(msg || `预期元素隐藏，但一直可见: ${desc(target)}`, target, { fnName: 'expect.hidden' }),
        );
    },
    /** 文本断言（轮询到匹配或超时） */
    async text(target, expected, { exact = true } = {}) {
      const loc = asLocator(page, target).first();
      const match = (actual) =>
        expected instanceof RegExp ? expected.test(actual) : exact ? actual === norm(expected) : actual.includes(norm(expected));
      const deadline = Date.now() + cfg.timeout;
      let actual = '';
      for (;;) {
        await loc.waitFor({ state: 'attached', timeout: 1000 }).catch(() => {});
        actual = norm(await loc.textContent().catch(() => ''));
        if (match(actual)) return actual;
        if (Date.now() >= deadline) break;
        await sleep(120);
      }
      throw new Error(
        await withDiag(
          `文本不匹配: 实际="${actual}" 期望${expected instanceof RegExp ? '匹配' : exact ? '==' : '包含'}"${expected}"`,
          target,
          { fnName: 'expect.text', text: typeof expected === 'string' ? expected : null },
        ),
      );
    },
    async contains(target, expected) {
      return expect.text(target, expected, { exact: false });
    },
    /** 值断言（轮询） */
    async value(target, expected) {
      const loc = asLocator(page, target).first();
      const deadline = Date.now() + cfg.timeout;
      let actual = '';
      for (;;) {
        actual = await loc.inputValue().catch(async () => norm(await loc.textContent().catch(() => '')));
        if (norm(actual) === norm(expected)) return actual;
        if (Date.now() >= deadline) break;
        await sleep(120);
      }
      throw new Error(await withDiag(`值不匹配: 实际="${actual}" 期望="${expected}"`, target, { fnName: 'expect.value' }));
    },
    /** 数量断言（轮询） */
    async count(target, n) {
      const loc = asLocator(page, target);
      const deadline = Date.now() + cfg.timeout;
      let c = await loc.count().catch(() => 0);
      for (;;) {
        if (c === n) return c;
        if (Date.now() >= deadline) break;
        await sleep(120);
        c = await loc.count().catch(() => 0);
      }
      throw new Error(
        await withDiag(`数量不匹配: 实际=${c} 期望=${n} (${desc(target)})`, target, { fnName: 'expect.count' }),
      );
    },
    /** URL 断言（轮询，兼容 SPA 异步路由） */
    async url(pattern) {
      const deadline = Date.now() + cfg.timeout;
      let u = page.url();
      for (;;) {
        u = page.url();
        const good = pattern instanceof RegExp ? pattern.test(u) : u.includes(String(pattern));
        if (good) return u;
        if (Date.now() >= deadline) break;
        await sleep(120);
      }
      throw new Error(`URL 不匹配: 实际="${u}" 期望~${pattern}`);
    },

    /** 断言某字段出现前端校验错误（可选断言文案） */
    async fieldError(formItem, message) {
      const item = asLocator(page, formItem).first();
      await item.waitFor({ state: 'attached', timeout: cfg.timeout }).catch(() => {});
      const errLoc = item.locator(ERROR_SEL);
      let txt = '';
      const n = await errLoc.count().catch(() => 0);
      for (let i = 0; i < n; i++) {
        const v = norm(await errLoc.nth(i).textContent().catch(() => ''));
        if (v) {
          txt = v;
          break;
        }
      }
      if (!txt) {
        const cls = (await item.getAttribute('class').catch(() => '')) || '';
        if (!/is-error|has-error|ant-form-item-has-error|error/.test(cls)) {
          throw new Error(
            await withDiag(
              `预期字段出现校验错误，但未见错误文案或错误态: ${desc(formItem)}`,
              formItem,
              { fnName: 'expect.fieldError' },
            ),
          );
        }
      }
      if (message != null) {
        const good = message instanceof RegExp ? message.test(txt) : txt.includes(norm(message));
        if (!good) throw new Error(`校验文案不匹配: 实际="${txt}" 期望包含"${message}"`);
      }
      return txt;
    },

    /** 断言某字段无校验错误（仅非空文案才算错误，规避占位空 span） */
    async noFieldError(formItem, msg) {
      const item = asLocator(page, formItem).first();
      const cls = (await item.getAttribute('class').catch(() => '')) || '';
      if (/is-error|has-error|ant-form-item-has-error/.test(cls))
        throw new Error(msg || `预期无校验错误，但字段处于错误态: ${desc(formItem)}`);
      const errLoc = item.locator(ERROR_SEL);
      const n = await errLoc.count().catch(() => 0);
      for (let i = 0; i < n; i++) {
        const v = norm(await errLoc.nth(i).textContent().catch(() => ''));
        if (v) throw new Error(msg || `预期无校验错误，但出现文案: "${v}" (${desc(formItem)})`);
      }
    },

    /** 等待并断言提示条（Element Plus el-message / AntD message / 通用 role=alert） */
    async toast(pattern, { timeout } = {}) {
      const sel =
        '.el-message, .el-message-box, .el-notification, .ant-message-notice, .ant-message, .van-toast, [role="alert"]';
      const loc = page.locator(sel).first();
      const deadline = (timeout || cfg.timeout);
      await loc.waitFor({ state: 'attached', timeout: deadline }).catch(() => {});
      // 文案可能异步填充，轮询取文本
      const t0 = Date.now();
      let txt = '';
      while (Date.now() - t0 < deadline) {
        txt = norm(await loc.textContent().catch(() => ''));
        if (txt) break;
        await sleep(100);
      }
      if (!txt)
        throw new Error(
          await withDiag('预期出现提示条(toast/message)，但未捕获到任何提示文案', sel, { fnName: 'expect.toast' }),
        );
      const good = pattern instanceof RegExp ? pattern.test(txt) : txt.includes(String(pattern));
      if (!good) throw new Error(`提示文案不匹配: 实际="${txt}" 期望包含"${pattern}"`);
      return txt;
    },

    /** 断言某操作被前端拦截（URL 不发生跳转） */
    async blocked(action, { settle = 500 } = {}) {
      const before = page.url();
      await action();
      await sleep(settle);
      const after = page.url();
      if (after !== before)
        throw new Error(`预期操作被前端拦截（URL 不变），但发生了跳转: ${before} → ${after}`);
    },
  };

  /* ---- 记录步骤（进报告） ---- */
  const step = (name) => {
    _steps.push({ name, at: Date.now() });
    return t;
  };
  const log = (msg) => {
    _steps.push({ name: String(msg), at: Date.now() });
    return t;
  };

  const t = {
    page,
    human,
    expect,
    step,
    log,
    abs,
    config: cfg,
    _steps,
    screenshot: (name) => session.screenshot(page, name || 'manual'),
    sleep,
    /** 是否显示（布局无关），供高级用例直接调用 */
    isShown: (target) => isShown(asLocator(page, target).first()),
  };
  return t;
}
