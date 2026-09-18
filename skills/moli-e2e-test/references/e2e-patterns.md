# Moli E2E Patterns

本文件聚焦**运行与排障**（适配矩阵、CI、故障表）。
用例怎么写见：[authoring-scenarios.md](authoring-scenarios.md) ·
拟人操作见 [human-simulation.md](human-simulation.md) ·
校验/边界见 [validation-testing.md](validation-testing.md) ·
选择器与 Moli 布局见 [ui-selectors.md](ui-selectors.md)。

## Assertion patterns

| Target | Pattern |
|---|---|
| Title | `expect(await page.title()).toBe(x)` |
| Visibility | `await expect(page.locator(sel)).toBeVisible()` |
| Text after action | `const t = (await page.locator(sel).textContent())?.trim()` |
| Count | `await expect(page.locator(sel)).toHaveCount(n)` |
| URL after redirect | `expect(page.url()).toBe(finalUrl)` |
| Attribute / class | `await expect(page.locator(sel)).toHaveAttribute(k, v)` |
| Input value | `await expect(page.locator(sel)).toHaveValue(v)` |
| Enabled / disabled | `await expect(page.locator(sel)).toBeEnabled()` |

Always normalize text on both expected and actual sides. `textContent()`
preserves incidental whitespace; an untrimmed expectation causes false
failures that look like engine bugs.

## Waits — never sleep

```js
// selector appears
await page.waitForSelector("main article", { state: "visible" });
// condition becomes true
await page.waitForFunction(() => document.querySelectorAll(".row").length > 5);
// network settles
await page.waitForLoadState("networkidle");
// navigation
await page.waitForURL(/success/);
```

Fixed `sleep`/`waitForTimeout` is only acceptable for deliberate animation
settling, never as a substitute for a state wait.

For CLI-only checks, Moli's own wait flags are the equivalent:

```bash
moli fetch --wait-until done|networkidle|domstable "URL"
moli fetch --wait-selector "main article" "URL"
```

## Test skeleton

本 skill 已提供框架，用例只需注册、无需自建骨架：

```js
// my.spec.mjs —— 用 scripts/run.sh 运行
import { chromium } from "playwright"; // 仅当需要裸 API 时才直接引入

export default function register(session) {
  session.describe('模块名', () => {
    session.it('场景：应 <预期>', async (t) => {
      await t.human.goto('/path');
      await t.human.type('#field', '值');
      await t.human.click('button[type=submit]');
      await t.expect.toast(/成功/);
    });
  });
}
```

`t` 提供 `human`（拟人操作）、`expect`（断言）、`step/log`（步骤）、`page`（裸 Playwright 页面）。

## CI setup

一键脚本已封装全部前置步骤（探测 Node≥18、起 Moli 服务、按需装 playwright、跑用例、出报告、非零退出码）：

```bash
# 回归（快）：关拟人
/path/to/moli-e2e-test/scripts/run.sh ./e2e --base-url "$E2E_BASE_URL" --no-human \
  --report-dir ./artifacts/moli-e2e
[ $? -eq 0 ] || exit 1
```

内部等价于：

```bash
moli --version                                            # fail fast
moli serve --layout &                                     # 常驻服务（短命 shell 里勿用裸 &）
until curl -sf http://127.0.0.1:9222/json/version; do sleep 0.5; done
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install playwright # 不下载浏览器，Moli 即浏览器
bash scripts/run.sh ./e2e --base-url ...                  # 跑用例
```

Pin the Moli version in CI. The installer always pulls `latest`, so an
unpinned job silently changes engine between runs.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `502 Bad Gateway` / `Connection refused` on connect | server died or not started | restart as persistent bg process; probe `/json/version` first |
| `ERR_MODULE_NOT_FOUND: playwright` | script outside `node_modules` tree; ESM ignores `NODE_PATH` | move script into the dir containing `node_modules`, or import by absolute path |
| `This does not look like a DevTools server` | endpoint not up, or wrong path | verify `/json/version` returns `webSocketDebuggerUrl` |
| Click hits wrong element / no geometry | layout disabled | restart with `moli serve --layout` |
| Screenshot looks wrong or empty | rendering is on-demand only | `--layout` required for screenshots/PDF |
| Action silently no-ops | unsupported CDP domain or Canvas/WebGL dependency | treat as unsupported; use Chromium |
| Text assertion off by whitespace | untrimmed expectation | trim both sides |
| `isVisible()` 为 false 但元素明明显示了 | Moli 对无显式尺寸元素返回 0×0 包围盒 | 用 `t.expect.visible` / `t.isShown`（布局无关），勿用裸 `isVisible()` |
| `click` 超时提示 element not visible | 同上，零尺寸 | 框架已自动回退 force；或改用带尺寸的元素/父容器 |
| 浮层（dialog/drawer/dropdown popper）里的元素 `:visible` 永远匹配不到、点击打偏 | teleport 浮层在 Moli 下 0×0，坐标即 (0,0) | 用 `scripts/overlay-helpers.mjs` 的 DOM 级 `domClick/rowClick/domType/expectToast`（见 ui-selectors.md「Overlay 实战手册」） |
| `page.evaluate: DOMException` | 把 `:has-text()` / `:text()` / `:visible` 等 Playwright 私有伪类传进了 evaluate 里的 `querySelectorAll` | evaluate 只用纯 CSS，文本过滤作为参数在 JS 里做 |
| hover 型 el-dropdown 怎么都打不开 | `mouseenter` 打在了 `.el-dropdown` 根元素上 | 打在 `.el-tooltip__trigger` 上且 `bubbles:false`；用 `ov.hoverDropdown` |
| 勾选框点不到（NOEL / 不可见） | el-checkbox 原生 input 是 `opacity:0`，被可见性过滤挡掉 | 点 `.el-checkbox` label 包裹层 |
| 表格操作列点击报「hit-test intercept」（点到分页/别的元素） | 横向滚动表格区 scrollIntoView 后坐标过期 | 行内交互改 `ov.rowClick` DOM 级 |
| 浏览器突然导航/请求超时，但服务 curl 都正常 | 共享 CDP 浏览器攒了残留 page（探针只 `browser.close()` 不关 page） | `curl -s :9222/json/list` 数 targets，逐个 `/json/close/<id>` 清理；探针脚本收尾必须 `page.close()` |
| 首轮大面积失败，分不清功能缺陷还是用例问题 | 用例假设（选择器/交互）未经真实验证 | **探针先行**：先用最小裸 Playwright 脚本逐个验证交互原语，再全量编排 spec |

## Fit / boundary matrix

| Test type | Moli | Notes |
|---|---|---|
| Functional E2E (click/fill/navigate) | Yes | real V8 + CSS + Fetch/XHR/WebSocket |
| DOM / state assertions | Yes | structure-first, no render needed |
| Form validation flows | Yes | |
| Content extraction / RAG | Yes | prefer `moli fetch`, no server needed |
| Screenshot capture | Yes | requires `--layout` |
| PDF generation | Yes | requires `--layout` |
| Pixel-perfect visual regression | No | not byte-identical to Chrome |
| WebGL / high-fidelity Canvas | No | unsupported |
| Media playback | No | unsupported |
| Full Chrome protocol parity edge cases | No | selected CDP coverage only |

## Server options

- `--layout` — real geometry, coordinate input, screenshots, PDF, screencast.
  Required for anything visual or coordinate-based.
- `--resource` — load all optional visual/media resources; only when needed.
- `--profile-dir` — persist cookies/storage across runs.
- Unique port per parallel isolated run.

## Client equivalents

Puppeteer:

```js
const browser = await puppeteer.connect({ browserWSEndpoint: wsUrl });
```

Raw CDP: use the `webSocketDebuggerUrl` from `/json/version`
(`ws://127.0.0.1:9222/devtools/browser/moli-browser`).

WebDriver Classic and WebDriver BiDi are exposed by the same endpoint, so no
separate driver binary is required.
