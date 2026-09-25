---
name: moli-e2e-test
description: 用 Moli 无头浏览器做网页 E2E 自动化测试：拟人操作覆盖功能、前端校验拦截非法/边界输入、弹窗抽屉下拉浮层交互，一键运行产出 HTML 报告。适用于网页/E2E/端到端/功能/回归测试、表单校验、非法与边界输入验证、UI 交互验证。
---

# 用 Moli 做网页自动化测试

把这个 skill 当作一套**开箱可用的网页测试能力**：它用 Moli 无头浏览器（经 CDP）驱动
真实页面，用拟人操作模拟真人点击/输入，验证模块功能与前端校验，一键产出报告。

**核心事实**：Moli 替代的是浏览器引擎，不是测试框架。Playwright 照常用，只把 Chromium
换成 Moli 的 CDP 端点——省内存、可无 GPU、适合 CI 小机器。即使调用方没有点名 Moli 也适用。

## 前置条件

- **Node.js ≥ 20**（`playwright` 1.63 的 `engines` 要求；`run.sh` 会自动挑选可用版本）。
- **`moli`**：缺失时 `run.sh` 会自动安装（默认锚定版本 `v1.1.9`，可用环境变量 `MOLI_VERSION=latest`
  或指定 tag 覆盖；也可传 `MOLI_INSTALLER_SHA256` 校验安装脚本）。
- **playwright**：首次运行会 `npm install playwright`（跳过浏览器下载——Moli 即浏览器），需要网络。

## 何时用 

- 功能/E2E：导航、填表、点击、DOM 断言、表单校验、写操作成功反馈
- 前端校验与边界：必填、格式、长度/数值临界、特殊字符、防重提交
- 结构/内容校验、Agent 评测；CI 资源受限环境

## 何时不用

- 像素级视觉回归（软件光栅化，非 Chrome 像素一致）→ 用真实 Chromium 做基线
- WebGL / 高保真 Canvas / 媒体播放 → 用真实 Chromium

## 目录约定（重要）

**所有 e2e 相关产物统一收在被测项目的 `e2e/` 根目录下，不在项目根散落**（不再生成根级
`moli-reports/`）。首次使用先在被测项目根执行脚手架：

```bash
# 在被测项目根目录执行，自动生成 e2e/ 骨架（目录名可用 --e2e-dir 指定）
bash <skill目录>/scripts/run.sh init
```

生成结构：

```
<被测项目>/
└── e2e/
    ├── specs/        用例（*.spec.mjs）        ← 你的测试脚本/用例放这里（init 放一份 README 说明）
    ├── reports/      测试报告（report.html / report.json）
    └── screenshots/  截图（失败/全量，依 --shots）
```

- 报告默认落在 `e2e/reports/`、截图默认落在 `e2e/screenshots/`；可用 `--e2e-dir` 整体迁移，
  或分别用 `--report-dir` / `--shots-dir` 单独覆盖。
- `e2e/reports/` 与 `e2e/screenshots/` 是运行产物，建议写进项目 `.gitignore`（保留 `e2e/specs/`）。
- 请在**被测项目根**运行 `run.sh`；在子目录运行会提示产物错位风险。

## 工作流

### 1. 读文档与接口定义，明确「模块功能 + 预期行为」

先收集：PRD / `design.md` / 接口定义（OpenAPI、路由、DTO 校验规则）/ 页面组件源码 /
既有缺陷记录。逐模块列出功能点，并为每点写一句**可判定的预期**（能落到断言）。

详见 [references/authoring-scenarios.md](references/authoring-scenarios.md)（含收集清单、
功能点→预期→用例的拆解方法与覆盖矩阵）。

### 2. 按「正向 / 反向 / 边界 / 交互」设计拟人用例

每个功能点至少覆盖：合法走通、非法被拦、临界值、修正后状态联动。
非法输入刻意覆盖空值、格式错、超长/超短、特殊字符与注入串。

详见 [references/validation-testing.md](references/validation-testing.md)（非法输入清单、
「被拦截」的四维断言、前后端校验不一致的识别）与
[references/human-simulation.md](references/human-simulation.md)（拟人操作技法与调速）。

### 3. 写 spec（只写用例，框架从本 skill 引入）

放到被测项目的 `e2e/specs/` 下，默认导出注册函数：

> ⚠ **每个用例开头都要自己 `await t.human.goto('/路径')`**：harness 在每例内部
> `context.newPage()`——登录态经 context 共享，但**页面不继承**，新页面从 `about:blank`
> 开始。忘了 goto 会表现为「所有断言都找不到元素」，框架已加守卫会直接提示。

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
      await t.human.type('#name', '示例客户');
      await t.human.type('#phone', '13800138000');
      await t.human.click('button[type=submit]');
      await t.expect.toast(/成功/);
      await t.expect.url(/\/crm\/customer/);
    });
  });
}
```

`t` 提供：`t.human`（goto/type/click/hover/select/check/uncheck/clear/press/scroll/scrollTo，拟人）、
`t.expect`（visible/hidden/text/contains/value/count/url/fieldError/noFieldError/toast/blocked/ok/fail，
断言内部已轮询到超时）、`t.step`/`t.log`、`t.page`（裸 Playwright）、`t.isShown`（布局无关的可见性）、
`t.screenshot(name)`；`session.baseURL` 可直接读目标地址（等价 `session.cfg.baseURL`）。

**涉及弹窗/抽屉/下拉等浮层交互时，勿手写坐标点击，直接引入
`scripts/overlay-helpers.mjs`（见「关键注意」）；正式编排前先跑最小探针验证原语。**

### 4. 一键运行

首次使用先 `init` 建骨架（见「目录约定」）。之后：

```bash
# 跑内置自检（无需任何外部服务，验证环境；显式指定最稳妥）
bash <skill目录>/scripts/run.sh <skill目录>/scripts/self-test.spec.mjs

# 跑你的用例（放在 e2e/specs/）
bash <skill目录>/scripts/run.sh ./e2e/specs/crm-customer.spec.mjs --base-url http://localhost:3000

# 整个目录 + 回归提速（产物默认落在 e2e/reports、e2e/screenshots）
bash <skill目录>/scripts/run.sh ./e2e/specs --base-url http://localhost:3000 --no-human
```

`run.sh` 会自动：解析 Node≥20 → 确保 Moli CDP 服务（`:9222`）→ 按需安装 playwright →
运行用例 → 生成 HTML 报告 → 以非零退出码反映失败（可直接进 CI）。

- **无参数**：若 `e2e/specs/` 下有用例就跑它们，否则跑内置自检。
- **给目录**（如 `./e2e` 或 `./e2e/specs`）：递归收集目录下所有 `*.spec.mjs`（跳过
  `node_modules` 等），无匹配则报错退出。
- 报告与截图的默认目录永远在被测项目的 `e2e/` 下。

常用参数：`--base-url` `--endpoint` `--e2e-dir` `--report-dir` `--shots-dir`
`--no-human`（关拟人提速）`--shots always|on-failure|off` `--timeout` `--list`。

### 5. 读报告，收敛用例

打开 `e2e/reports/report.html`：汇总卡（通过率/耗时）+ 每个用例状态 + 失败详情
（错误信息、选择器诊断、页面 URL、控制台错误、失败请求、失败截图）。据此区分「功能缺陷」与
「用例假设过期」，补充回归用例，形成可重复执行的资产。同目录另有 `report.json` 供 CI 解析。

## 目录结构

```
moli-e2e-test/
├── SKILL.md                       # 本文件
├── package.json                   # 依赖：playwright（不下载浏览器）
├── scripts/
│   ├── run.sh                     # 一键入口
│   ├── run.mjs                    # 用例编排 + 报告聚合
│   ├── harness.mjs                # 拟人操作 / 断言 / 诊断
│   ├── overlay-helpers.mjs        # Overlay DOM 级交互助手（浮层实测坑规避）
│   ├── selector-doctor.mjs        # 选择器诊断器（失败时回答「为什么找不到」）
│   ├── report.mjs                 # HTML/JSON 报告
│   └── self-test.spec.mjs         # 环境自检（内置示例表单 + 自诊断能力回归）
├── examples/login.spec.mjs        # 登录模块模板（改选择器即可用）
└── references/                    # 用例设计 / 拟人 / 校验 / 选择器 / 排障
```

> 上面是 **skill 自身**的目录。运行时它不会在被测项目根散落文件：报告与截图按上文
> 「目录约定」统一写到被测项目的 `e2e/reports` 与 `e2e/screenshots`。

## 关键注意（实测坑）

- **Moli 布局特性**：无显式尺寸的元素（如仅含文本的 `div`）可能返回 0×0 包围盒，
  使原生 `isVisible()/click()` 误判。**用 `t.expect.*` 与 `t.isShown`**，勿用裸 `isVisible()`。
  详见 [references/ui-selectors.md](references/ui-selectors.md)。
- **Overlay 浮层（dialog/drawer/dropdown popper/select 选项/message-box/toast）在 Moli 下几乎
  全是 0×0**：坐标点击、`:visible` 伪类、hit-test 全部失效，拟人点击会打偏到 (0,0) 或别的元素。
  **一律用 DOM 级交互**：直接 `import * as ov from '<skill目录>/scripts/overlay-helpers.mjs'`
  （domClick / rowClick / domType / buttonDisabled / expectToast / hoverDropdown）。
  hover 型 el-dropdown 打开须 `ov.hoverDropdown`（mouseenter 打在 `.el-tooltip__trigger` 上）。
  同文件的「Overlay 实战手册」小节有完整范例。
- **`:has-text()` / `:text()` / `:visible` 是 Playwright 私有伪类**：只能用于 locator；
  传进 `page.evaluate` 里的 `querySelectorAll` 会抛 `DOMException`。evaluate 场景用纯 CSS +
  单独的文本过滤参数。`ov.*` 已做**前置拦截**：误用时立刻抛出带改法的错误
  （例：`ov.domClick` 收到 `text=xxx` → 提示「sel 只接受纯 CSS，文本走第二个参数」），
  不会等到超时才报一个难懂的 DOMException。
- **每个用例都是新页面**（`context.newPage()`）：登录态经 context 共享，但页面不继承，
  每例开头必须自行 `t.human.goto(...)`。忘了时失败信息会提示 about:blank 根因，
  且**不再产出误导性的全白截图**。
- **失败信息自带选择器诊断**：断言/等待失败时，错误里会直接给出「当前 URL + 匹配几个元素 +
  是根本不在 DOM / 被哪个祖先以什么方式隐藏 / 可见候选的实际文本」，不需要再手工 dump。
  诊断实现见 `scripts/selector-doctor.mjs`（也可在自定义断言里手动调用）。
- **首跑前先写最小探针**：新页面/新组件集，先用裸 Playwright 脚本逐个验证交互原语
  （点击、选项、输入、toast 读取）在 Moli 下确实生效，再全量编排 spec——否则会把
  「用例假设不成立」误判成「功能缺陷」，白跑多轮。
- **共享 CDP 浏览器会攒残留 page**：自写探针脚本结束只 `browser.close()` 不会关 page，
  累积若干后新导航超时假死。脚本收尾必须 `page.close()`；排障用
  `curl -s localhost:9222/json/list` 数 targets，`/json/close/<id>` 清理。
- **服务要常驻**：短命 shell 里 `moli serve &` 会被回收导致后续 502。
  `run.sh` 已处理；手工起服务时用 `nohup ... &`。
- **`--layout`**：截图、坐标点击、PDF 需要。`run.sh` 仅在**自己启动服务**时带上；若你已手工
  `moli serve`（不带 `--layout`），须自行加 `--layout` 重启，否则截图/坐标点击会静默失效。
- **别用固定 `sleep`**：等待交给 `t.expect.*` 的轮询（已内置）。
- **文案断言归一化空白**：框架已做 trim+折叠空格；自写断言也要。

更多排障见 [references/e2e-patterns.md](references/e2e-patterns.md)。
