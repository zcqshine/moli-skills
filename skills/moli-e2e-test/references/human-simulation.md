# 拟人操作（Human Simulation）

为什么拟人：真实前端对「快速程序化输入」不友好——防抖/节流、`input`/`change`/`compositionend`
事件、受控组件状态、鼠标悬停才展开的菜单、滚动懒加载，都会让「瞬间填完再点」的脚本产生假阳性/假阴性。
拟人操作让测试更接近真人，暴露的问题也更真实。

## 开关与调速

| 环境变量 / 参数 | 默认 | 作用 |
|---|---|---|
| `MOLI_HUMAN=0` 或 `--no-human` | 开 | 关闭所有随机停顿（CI 提速） |
| `MOLI_SLOWMO` | 0 | 全局慢放（调试观察用） |
| `MOLI_SHOTS=always｜on-failure｜off` | on-failure | 截图策略 |

细粒度调速在 `createSession({ speed: {...} })`：`typeDelay` / `clickPause` / `afterClick` / `betweenActions`。

## 各类操作怎么做

- **输入 `human.type`**：先点击聚焦 → 清空 → **逐字符**输入，每字符随机停顿（模拟真人节奏），
  触发真实的 `keydown/keypress/input/keyup`，受控组件与防抖逻辑都能正常响应。
  输入 `\n` 会转成回车。
- **点击 `human.click`**：等待附着且可见 → 滚动进视口 → 鼠标**分步移动**到元素中心 → 悬停片刻 → 点击。
  零尺寸/被遮挡元素自动回退 force，避免 Moli 布局特性造成的假失败。
- **悬停 `human.hover`**：用于「hover 才出现」的菜单/操作列（如表格行内按钮）。
- **下拉 `human.select`**：原生 `<select>` 直接选值；Element Plus 的 `el-select` 见下。
- **勾选 `human.check/uncheck`**：复选框/单选框。
- **滚动 `human.scrollTo/dy`**：懒加载列表、长表单分段操作。

## 组件层面的拟人（Element Plus / AntD）

这些库的「选择」不是原生 select，需点击展开再选项：

```js
// Element Plus el-select
await t.human.click('.el-form-item:has(#status) .el-select');
await t.human.click('.el-select-dropdown__item:has-text("启用")');

// Element Plus el-date-picker：点击后再选日（或直接输入）
await t.human.click('.el-form-item:has(#date) .el-date-editor');
await t.human.type('.el-date-editor input', '2026-09-13');
await t.human.press('Enter');

// 表格行内操作（hover 才显示）
await t.human.hover('.el-table__row:has-text("示例客户")');
await t.human.click('.el-table__row:has-text("示例客户") .btn-edit');
```

## 反模式（不要这么做）

- 用固定 `sleep` 等加载：改用 `expect.visible` / `expect.toast` / `waitForFunction`（框架内已有轮询）。
- 用 `page.evaluate` 直接改 DOM 或赋值绕过交互：那是在测「你会不会写 JS」，不是测模块功能。
  仅当元素确实零尺寸且非业务交互时才用 force 回退。
- 所有用例都开拟人慢速：冒烟可选 `--no-human`；回归保留拟人以贴近真实。
- 依赖元素顺序（`nth-child`）：换库版本就碎。

## 何时关闭拟人

- CI 高频回归、用例量大：`--no-human` 显著提速，仍保留断言强度。
- 但**表单校验类**用例建议保留拟人：逐字符输入才能验证「实时校验/防抖」行为是否符合预期。
