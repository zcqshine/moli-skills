# moli-skills

> Agent skills for [Moli](https://github.com/lexmount/moli) — a lightweight Rust headless browser. Fetch, search, and run real end-to-end web tests with a fraction of Chrome's memory.

四个围绕 **Moli 无头浏览器** 的 Agent Skill：抓取、搜索、CDP 服务、以及**网页 E2E 自动化测试**。
每个 skill 都是标准 `SKILL.md` 格式，能被任何支持 skill 的 Agent 框架（Codex / Claude Code / OpenCode / WorkBuddy 等）直接加载。

---

## 目录

- [为什么用 Moli](#为什么用-moli)
- [Skill 一览](#skill-一览)
- [安装 Moli（macOS）](#安装-molimacos)
- [Skill 如何调用 Moli](#skill-如何调用-moli)
- [快速开始：跑一次网页 E2E 测试](#快速开始跑一次网页-e2e-测试)
- [安装 Skill 到你的 Agent](#安装-skill-到你的-agent)
- [实测数据](#实测数据)
- [已知坑](#已知坑)
- [许可与来源](#许可与来源)

---

## 为什么用 Moli

Moli 不是 Chromium 的套壳，而是自研的浏览器引擎（嵌入 V8 + CSS 层叠 + Fetch/WebSocket + 存储）。
核心设计是 **结构优先、按需渲染**：默认不布局不绘制，直接读运行时里的 DOM 与样式状态；
只有显式加 `--layout` 才计算 layout 并软件光栅化出 PNG / PDF。

结果就是这个量级的差别（项目自测，192 个混合 URL）：

| 引擎 | 中位 RSS |
|---|---|
| **Moli** | **73 MiB** |
| Chrome Headless | 773 MiB |

一个数量级的差距。2GB 的小 VPS 上 Chrome 会被 OOM killer 随机干掉，Moli 能稳定跑。
对 CI 小机器、批量抓取、Agent 评测环境都很友好。

> Moli 替代的是**浏览器引擎**，不是**测试框架**。Playwright / Puppeteer 照常用，只是把 Chromium 换成 Moli 的 CDP 端点。

## Skill 一览

| Skill | 用途 | 走哪条通路 |
|---|---|---|
| **`moli-webfetch`** | 抓取/爬取/截图网页：正文转 Markdown、JSON（含 status / redirect_chain / network trace）、语义树、PNG、PDF | `moli fetch`（一次性 CLI） |
| **`moli-websearch`** | 关键词搜索 + 反向图片搜索，并行多引擎兜底（Google / Bing / Brave / 百度 / 搜狗 / Naver …） | `moli fetch`（一次性 CLI） |
| **`moli-cdp-server`** | 起 Moli 的 CDP 服务并接 Playwright / Puppeteer / 原生 CDP 客户端 | `moli serve`（常驻服务） |
| **`moli-e2e-test`** | **网页 E2E 自动化测试**：拟人化操作跑功能用例、前端校验拦截非法输入、边界场景，一键出 HTML 报告 | `moli serve` + Playwright over CDP |

前三个来自上游 [lexmount/moli](https://github.com/lexmount/moli) 的 `skills/` 目录；
`moli-e2e-test` 是本仓库自研，含完整测试框架（harness / 报告 / 一键运行器 / 5 份参考文档）。

---

## 安装 Moli（macOS）

### 1. 安装二进制

```bash
curl --proto '=https' --tlsv1.2 -fsSL \
  https://github.com/lexmount/moli/releases/latest/download/moli-installer.sh | sh
```

Apple Silicon 上会安装 `aarch64-apple-darwin` 原生包，默认落到 `~/.local/bin/moli`。

### 2. 配 PATH（macOS 用 zsh）

```bash
echo 'export PATH="$PATH:$HOME/.local/bin"' >> ~/.zshrc
source ~/.zshrc
```

### 3. 验证

```bash
moli --version
# moli 1.1.5
```

跑一条真实抓取验证链路可用：

```bash
moli fetch --dump markdown --wait-until done "https://example.com"
```

### 生产环境建议锁版本

installer 永远拉 `latest`，重建时可能静默换引擎。要可复现就固定 tarball：

```bash
# 以 v1.1.5 / Apple Silicon 为例
curl -LO https://github.com/lexmount/moli/releases/download/v1.1.5/moli-aarch64-apple-darwin.tar.gz
tar -xzf moli-aarch64-apple-darwin.tar.gz -C ~/.local/bin/
chmod +x ~/.local/bin/moli
```

> Intel Mac 用 `x86_64-apple-darwin`；Linux 用 `x86_64-unknown-linux-gnu`。

### 让服务常驻（可选，macOS 用 launchd）

`moli serve` 需要长驻。临时用 `nohup`；要开机自启+崩溃自拉，写一个 LaunchAgent：

```xml
<!-- ~/Library/LaunchAgents/com.example.moli.plist -->
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.example.moli</string>
  <key>ProgramArguments</key>
  <array>
    <string>/Users/你/.local/bin/moli</string>
    <string>serve</string>
    <string>--layout</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/tmp/moli_serve.log</string>
  <key>StandardErrorPath</key><string>/tmp/moli_serve.log</string>
</dict>
</plist>
```

```bash
launchctl load  ~/Library/LaunchAgents/com.example.moli.plist   # 启用
launchctl unload ~/Library/LaunchAgents/com.example.moli.plist  # 停用
```

> 注意：`launchctl` 需要在你自己的真实终端里执行。某些沙箱化环境（如 Agent 的运行沙箱）拿不到用户 launchd 域，会报 `Load failed: 5: Input/output error`。

---

## Skill 如何调用 Moli

两条通路，按「要不要常驻浏览器」分：

### 通路 A：一次性 CLI（抓取 / 搜索类 skill）

Agent 直接 `exec` 一行，跑完即退，无需任何服务：

```bash
# 正文转 Markdown（结构优先，不渲染——文本任务永远别加 --layout）
moli fetch --dump markdown --wait-until done "https://example.com"

# 动态页：等网络静默 / DOM 稳定
moli fetch --dump markdown --wait-until networkidle "https://example.com/app"
moli fetch --dump markdown --wait-until domstable  "https://example.com/feed"

# 等具体选择器出现（比 sleep 稳）
moli fetch --dump markdown --wait-selector "main article" "https://example.com/news"

# 机器友好：status / final_url / redirect_chain / network trace
moli fetch --dump json "https://example.com"

# 需要像素才加 --layout
moli fetch --layout --dump screenshot "https://example.com" > viewport.png
moli fetch --layout --dump pdf "https://example.com" > page.pdf
```

**关键省资源点**：默认不布局不绘制，只有 `--layout` 才出几何/截图/PDF。文本类任务别加。

### 通路 B：常驻 CDP 端点（浏览器自动化类 skill）

```bash
moli serve            # 纯 DOM/JS 工作负载，监听 127.0.0.1:9222
moli serve --layout   # 需要真实坐标、截图、PDF、screencast 时加
```

Playwright 直接连上去——**不启动第二个浏览器，没有 ChromeDriver**：

```js
import { chromium } from "playwright";

const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const context = browser.contexts()[0];
const page = context.pages()[0] ?? await context.newPage();

await page.goto("https://example.com");
console.log(await page.locator("body").innerText());

await browser.close();
```

同一端点同时讲 CDP / WebDriver Classic / WebDriver BiDi。
代理、UA、cookie、隐私策略都传给 `moli serve`，**别传给不存在的子浏览器进程**。
并行隔离跑用不同端口（`moli serve --port 9333`）。

---

## 快速开始：跑一次网页 E2E 测试

`moli-e2e-test` 自带一键运行器，会自动：解析 Node≥18 → 确保 Moli CDP 服务在跑 → 按需装 playwright（跳过浏览器下载）→ 跑用例 → 出 HTML 报告 → 以退出码反映失败。

### 先跑内置自检（不需要任何外部服务）

```bash
cd skills/moli-e2e-test
bash scripts/run.sh
```

输出 8 条用例结果，报告落在 `moli-reports/report.html`。

### 跑你自己模块的用例

写一个 spec（只写用例，框架从 skill 引入）：

```js
export default function register(session) {
  session.describe('CRM · 新增客户', () => {
    session.it('必填客户名称为空：应被拦截', async (t) => {
      await t.human.goto('/crm/customer/create');
      await t.expect.blocked(() => t.human.click('button[type=submit]'));
      await t.expect.fieldError('.el-form-item:has(#name)', '请输入客户名称');
    });

    session.it('合法数据：提交成功并回到列表', async (t) => {
      await t.human.goto('/crm/customer/create');
      await t.human.type('#name', '示例客户');       // 逐字输入 + 抖动延迟，模拟真人
      await t.human.type('#phone', '13800138000');
      await t.human.click('button[type=submit]');     // 移动鼠标到中心再点击
      await t.expect.toast(/成功/);
      await t.expect.url(/\/crm\/customer/);
    });
  });
}
```

```bash
# 跑单个 spec
bash scripts/run.sh ./e2e/crm-customer.spec.mjs --base-url http://localhost:3000

# 跑整个目录，关拟人提速（适合回归）
bash scripts/run.sh ./e2e --base-url http://localhost:3000 --no-human --report-dir ./artifacts
```

`t` 提供的能力：

- `t.human` — `type` / `click` / `hover` / `select` / `check` / `press` / `scroll`，拟人化（逐字输入、鼠标轨迹、滚动渐进）
- `t.expect` — `visible` / `hidden` / `text` / `value` / `count` / `url` / `fieldError` / `noFieldError` / `toast` / `blocked` / `ok`
- `t.step` / `t.log` — 分步与日志
- `t.page` — 裸 Playwright 页面对象，能力不够时直接下钻
- `t.isShown` — 布局无关的可见性判定（见[已知坑](#已知坑)）

常用参数：`--base-url` `--endpoint` `--report-dir` `--no-human` `--shots always|on-failure|off` `--timeout` `--list`

---

## 安装 Skill 到你的 Agent

skill 就是目录 + `SKILL.md`，复制到 Agent 的 skills 路径即可：

```bash
# 常见位置
~/.workbuddy/skills/     # WorkBuddy
~/.claude/skills/        # Claude Code
~/.agents/skills/        # 通用 agent 目录

cp -R skills/* ~/.workbuddy/skills/
```

`skills/*/agents/openai.yaml` 是给 OpenAI Codex 的 agent 定义，其它框架忽略即可。

---

## 实测数据

`moli-e2e-test` 内置自检（8 条用例，覆盖空表单拦截、邮箱格式、手机号格式、密码过短、
用户名长度边界、修正后错误消失、特殊字符与超长、XSS 不注入）：

```
PASS | 空表单提交应被拦截
PASS | 邮箱格式非法应被拦截
PASS | 手机号格式非法应被拦截
PASS | 密码过短应被拦截
PASS | 用户名长度边界
PASS | 修正非法输入后错误提示应实时消失
PASS | 特殊字符与超长输入：不应注入脚本、不应崩溃
PASS | 合法数据：应提交成功并显示结果
汇总: 8/8 通过 · 32.6s
```

`moli serve --layout` + Playwright `connectOverCDP` 全绿，报告见
[`skills/moli-e2e-test/moli-reports/report.html`](skills/moli-e2e-test/)。

---

## 已知坑

实测踩到的，都写进 skill 了：

| 坑 | 现象 | 对策 |
|---|---|---|
| **Moli 布局特性** | 无显式尺寸的元素（如只含文本的 `div`）返回 **0×0 包围盒**，Playwright 原生 `isVisible()` / `click()` 误判为不可见 | 用 `t.expect.*` / `t.isShown`（基于计算样式 + 祖先链），别用裸 `isVisible()`；harness 对零尺寸元素已在点击/输入时加 force 回退 |
| **服务被回收** | 短命 shell 里 `moli serve &` 会在命令返回后被杀，后续连接 502 | 用 `nohup ... &` 或 launchd；`run.sh` 已自动处理 |
| **ESM 不认 NODE_PATH** | ESM 脚本 `import "playwright"` 从脚本所在目录向上找 `node_modules`，`NODE_PATH` 无效 | 脚本放在 `node_modules` 所在目录内运行（`run.sh` 已处理） |
| **断言空白** | `textContent()` 保留无意义空白，造成假 FAIL | 断言两侧都 trim（框架已做归一化） |
| **别用固定 sleep** | 页面加载时间不可控 | 用 `expect.visible` / `waitForFunction`（框架内置轮询） |
| **别忘 `--layout`** | 不加就没有几何/截图/PDF | 涉及坐标点击、截图必须加 |

**不适合的场景**：像素级视觉回归（软件光栅化，不等同 Chrome 像素）、WebGL / 高保真 Canvas / 媒体播放。这些用真实 Chromium 做基线。

---

## 许可与来源

本项目采用 **Apache-2.0**。

- `moli-e2e-test` 为自研（Apache-2.0）。
- `moli-webfetch` / `moli-cdp-server` / `moli-websearch` 复制自 [lexmount/moli](https://github.com/lexmount/moli) 的 `skills/` 目录；上游为 **Apache-2.0 OR MIT** 双协议，本项目按 Apache-2.0 分发。
- Moli 本身为 Lexmount 开源项目（Apache-2.0 OR MIT）。
