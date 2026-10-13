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
- **`moli`**：缺失时 `run.sh` 会自动安装（默认锚定版本 `v1.1.12`，可用环境变量 `MOLI_VERSION=latest`
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

## 高危动作闸门（🔴 命中即停，先向用户确认）

用例会**真实驱动被测系统**——不是模拟、不是 dry-run。下列动作动手前必须先向用户确认，命中任一条就停下来说清情况，不要自行执行。

| 🔴 触发条件 | 为什么危险 | 正确做法 |
|---|---|---|
| `--base-url` 不是 `localhost` / `127.0.0.1` / 内网测试域（含生产、预发、公网域名） | 用例里的写操作会落在真实业务数据上 | 停下，把目标地址回给用户确认；未确认前只跑 `--list` 或纯只读用例 |
| 用例含新增 / 修改 / 删除 / 提交 / 支付 / 发送 等写操作 | 产生脏数据，可能触发下游通知、回调、审计留痕 | 先确认「环境可写 + 数据可清理 + 有可用测试账号」，再执行 |
| `--shots always`，或要把产物写到被测仓库以外的位置 | 磁盘与数据侧副作用，报告可能被误提交 | 先确认产物目录、体量上限与清理责任方 |
| 准备删除 `e2e/reports` / `e2e/screenshots` / `node_modules` 或被测数据库记录 | 不可逆 | 先列出将删除的**具体路径**，经用户确认后再删 |
| 要把用例接进 CI 或定时任务并对**共享环境**执行 | 影响他人，失败会阻塞流水线 | 先确认环境归属与失败告警接收方 |

**唯一免确认的例外**：目标为 `localhost` / `127.0.0.1` / 内网测试域名，且用例全部是只读断言。

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

🔴 **执行前先过一遍「高危动作闸门」**（目标环境是否可写、用例是否含写操作）。首次使用先 `init` 建骨架（见「目录约定」）。之后：

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

## 失败 → 处置（if-then 速查）

用例失败先在此表定位。表里没有的，查 [references/e2e-patterns.md](references/e2e-patterns.md) 的 **Troubleshooting 表（20 条症状速查）**。

| 症状（如果…） | 一线修复 | 仍失败兜底 |
|---|---|---|
| 断言全部「元素不存在」，且 `page.url()` 是 `about:blank` | 用例开头补 `await t.human.goto('/路径')` | 检查 `--base-url` 是否漏传或指错端口 |
| 浮层（dialog / drawer / dropdown）里点不中、`:visible` 匹配不到 | 改用 `ov.domClick` / `ov.domType` / `ov.expectToast` 等 DOM 级 API | 先 `t.page.screenshot()` 重建冻结树再试；仍失败读报错里的 `selector-doctor` 诊断行 |
| 所有可见元素都是 100×20 的假几何 | serve 未带 `--layout`，重启时加上 | 确认 `run.sh` 没在复用你手工起的无 `--layout` 服务 |
| 截图前元素 0×0、截图后正常 | 冻结树过期：**先测量再截图** | 排障顺序固定为「读断言 → 看诊断器 → 最后才截图」 |
| `page.evaluate` 抛 `DOMException` | sel 去掉 `:has-text()` / `:visible`，文本走第二参数 | 直接换 `ov.*`（已做前置拦截，报错里带改法） |
| 导航超时但 `curl :9222` 正常 | 共享 CDP 攒了残留 page：`curl -s :9222/json/list` 数 targets，逐个 `/json/close/<id>` | 探针脚本收尾补 `page.close()`；仍不行就重启 serve |
| hover 型 el-dropdown 怎么都打不开 | 用 `ov.hoverDropdown`（mouseenter 打在 `.el-tooltip__trigger`） | 确认没把选择器写成 `.el-dropdown` 根元素 |
| 首轮大面积失败，分不清是功能缺陷还是用例写错 | **探针先行**：先用最小裸 Playwright 脚本逐个验证交互原语 | 原语确认可用后再全量编排，否则会把「用例假设不成立」误判成「功能缺陷」 |

**原则：先读诊断再猜。** 断言失败的报错已自带「当前 URL + 匹配几个元素 + 隐藏原因 + 可见候选文本」，照它分类，不要手工 dump DOM。

## 关键注意（实测坑）

- **Moli Layout 冻结树机制（实测 + 官方文档确认，决定哪些读数可信）**：Moli 不主动 layout。
  默认 `LayoutPolicy::Mock`（几何是假值）；`--layout` 启用 OnDemand：首次几何读数触发冷启动
  并**冻结**布局快照，此后 DOM 变更**不会**自动重建——
  - DOM 变更后 `getBoundingClientRect` 返回**旧值**；快照里不存在的新元素（刚打开的弹窗、
    后插入的节点）→ **0×0**（overlay 全 0×0 的根因）；
  - **innerText 在 DOM 变更后返回空字符串**（不是旧值）——文本断言必须用 textContent
    （框架 `t.expect.text` 已用 textContent）；
  - `checkVisibility` / `getComputedStyle` 走 style 计算，**不依赖 layout**，始终可靠
    （`t.isShown` / `t.expect.*` 基于此——「不过冻结树的都可信」）；
  - **截图会重建并替换冻结树**：「截图前 0×0、截图后正常」的根因。注意诊断截图有副作用
    （把过期布局「修好」），排障时**先测量再截图**；
  - 见到「所有可见元素都是 100×20」= serve 忘带 `--layout`（Mock 模式）。
  **用 `t.expect.*` 与 `t.isShown`**（不经过冻结树）；坐标/hit-test 类操作前若 DOM 变过，
  先 `t.page.screenshot()` 重建再做。诊断器已能自动识别这两种异常（见 `selector-doctor.mjs`）。
  详见 [references/ui-selectors.md](references/ui-selectors.md)。
- **Overlay 浮层（dialog/drawer/dropdown popper/select 选项/message-box/toast）在 Moli 下几乎
  全是 0×0**——根因即上面的冻结树机制：浮层是 DOM 变更后新出现的元素，不在布局快照里。
  坐标点击、`:visible` 伪类、hit-test 全部失效，拟人点击会打偏到 (0,0) 或别的元素。
  **一律用 DOM 级交互**：直接 `import * as ov from '<skill目录>/scripts/overlay-helpers.mjs'`
  （domClick / rowClick / domType / buttonDisabled / expectToast / hoverDropdown /
  waitForShown / waitForGone / shownCount）。
  hover 型 el-dropdown 打开须 `ov.hoverDropdown`（mouseenter 打在 `.el-tooltip__trigger` 上）。
  完整范例见 [references/ui-selectors.md](references/ui-selectors.md) 的「Overlay 实战手册」小节。
- **`:has-text()` / `:text()` / `:visible` 是 Playwright 私有伪类**：只能用于 locator；
  传进 `page.evaluate` 里的 `querySelectorAll` 会抛 `DOMException`。evaluate 场景用纯 CSS +
  单独的文本过滤参数。`ov.*` 已做**前置拦截**：误用时立刻抛出带改法的错误
  （例：`ov.domClick` 收到 `text=xxx` → 提示「sel 只接受纯 CSS，文本走第二个参数」），
  不会等到超时才报一个难懂的 DOMException。
- **每个用例都是新页面**（`context.newPage()`）：登录态经 context 共享，但页面不继承，
  每例开头必须自行 `t.human.goto(...)`。忘了时失败信息会提示 about:blank 根因，
  且**不再产出误导性的全白截图**。
- **失败信息自带选择器诊断**：断言/等待失败时，错误里会直接给出「当前 URL + 匹配几个元素 +
  是根本不在 DOM / 被哪个祖先以什么方式隐藏 / 可见候选的实际文本 / 包围盒异常（冻结树过期
  或 Mock 模式）」，不需要再手工 dump。诊断实现见 `scripts/selector-doctor.mjs`
  （也可在自定义断言里手动调用）。
- **首跑前先写最小探针**：新页面/新组件集，先用裸 Playwright 脚本逐个验证交互原语
  （点击、选项、输入、toast 读取）在 Moli 下确实生效，再全量编排 spec——否则会把
  「用例假设不成立」误判成「功能缺陷」，白跑多轮。
- **共享 CDP 浏览器会攒残留 page**：自写探针脚本结束只 `browser.close()` 不会关 page，
  累积若干后新导航超时假死。脚本收尾必须 `page.close()`；排障用
  `curl -s localhost:9222/json/list` 数 targets，`/json/close/<id>` 清理。
- **服务要常驻**：短命 shell 里 `moli serve &` 会被回收导致后续 502。
  `run.sh` 已处理；手工起服务时用 `nohup ... &`。
- **`--layout`**：截图、坐标点击、PDF 需要。`run.sh` 仅在**自己启动服务**时带上；若你已手工
  `moli serve`（不带 `--layout`），须自行加 `--layout` 重启——否则截图直接报错
  `renderer layout is disabled`，所有元素几何是 100×20 的确定性假值（诊断器会提示）。
- **别用固定 `sleep`**：等待交给 `t.expect.*` 的轮询（已内置）。
- **文案断言归一化空白**：框架已做 trim+折叠空格；自写断言也要。

更多排障见 [references/e2e-patterns.md](references/e2e-patterns.md)。
