# 选择器与 Moli 布局注意（Selectors & Moli Layout）

## 选择器优先级（越靠前越稳）

1. `#id`
2. `[data-testid="..."]`（最推荐：与实现解耦）
3. `[name="..."]`、`[aria-label="..."]`、`[placeholder="..."]`
4. 可见文本 / 按钮文案：`button:has-text("保存")`、`:text("新增成功")`
5. 语义角色：`page.getByRole('button', { name: '保存' })`（Playwright 原生）
6. 组件类名（Element Plus / AntD），配合 `:has()` 限定范围
7. 最后才用：`nth-child`、深层 CSS 链、依赖兄弟顺序

**限定到就近容器**，避免全局匹配到多个同名元素：

```js
'.el-form-item:has(#email)'            // 字段项
'.el-dialog:has-text("新增客户") input' // 弹窗内输入
'.el-drawer .el-form-item:has(#name)'   // 抽屉内（详情用抽屉模式）
'.el-table__row:has-text("示例客户")'   // 表格某行
```

## 常见组件选择器

| 组件 | Element Plus | Ant Design Vue |
|---|---|---|
| 输入框 | `.el-input__inner`（或用 `#id`） | `.ant-input` |
| 下拉 | `.el-select` / 选项 `.el-select-dropdown__item` | `.ant-select` / `.ant-select-item-option` |
| 日期 | `.el-date-editor input` | `.ant-picker input` |
| 按钮 | `.el-button`（主按钮 `.el-button--primary`） | `.ant-btn-primary` |
| 弹窗 | `.el-dialog` | `.ant-modal` |
| 抽屉 | `.el-drawer` | `.ant-drawer` |
| 提示条 | `.el-message` / `.el-notification` | `.ant-message` / `.ant-notification` |
| 表格行 | `.el-table__row` | `.ant-table-row` |

> Element Plus 的 link 按钮是 `.is-link`（不是已废弃的 `.el-button--link`）。

## Moli 布局特性（实测，务必知道）

Moli 是「结构优先、按需渲染」的引擎，默认布局较简化。实测发现：

- **无显式尺寸的元素可能返回 0×0 包围盒**，即使它已经 `display:block` 且有文本。
  例如仅有文本的 `<div id="ok">`，其 `getBoundingClientRect()` 恒为 `{w:0,h:0}`。
- 后果：Playwright 原生的 `locator.isVisible()` **会误判为不可见**，`locator.click()`
  也可能因「不可见」而超时。
- 有显式尺寸的元素（如 `input{width:300px}`、带 padding 的按钮）不受影响。

**本框架的应对（已内置，直接受益）**：

- `expect.visible / hidden` 改用「计算样式 + 祖先链」（`checkVisibility`）判定，
  不依赖包围盒 → 规避该问题。
- `human.click / type` 在原生点击失败时自动回退 `force`。
- 因此用例里**优先用 `t.expect.*` 而不是裸 `locator.isVisible()`**。

**若你在用例里绕不开原生 API**，用 `t.isShown(sel)`（布局无关）替代 `isVisible()`。

## Overlay 实战手册（dialog / drawer / dropdown / select / message-box / toast）

实测结论：**teleport 到 body 的浮层在 Moli 下几乎全部 0×0**（连带的后果——`:visible`
匹配不到、坐标点击打偏到 (0,0) 或被别的元素拦截 hit-test、`human.click` 的 force 回退
也点不中）。唯一可靠路径是 **DOM 级 `el.click()` + CSS 可见性轮询**，已封装为
`scripts/overlay-helpers.mjs`，spec 里按绝对路径引入：

```js
import * as ov from '/path/to/moli-e2e-test/scripts/overlay-helpers.mjs'

// 表格行内按钮（横向滚动区拟人点击会打偏，一律 rowClick）
await ov.rowClick(t, '客户A', 'button', '更多')
// dropdown 菜单项 / select 选项（popper 0×0）
await ov.domClick(t, '.el-dropdown-menu__item', '释放到公海')
await ov.domClick(t, '.el-dialog .el-select__wrapper')       // 展开
await ov.domClick(t, '.el-select-dropdown__item', '选项文本') // 选择
// 浮层内输入（v-model 可感知）与禁用态断言
await ov.domType(t, '.el-dialog textarea', '备注内容')
await t.expect.ok((await ov.buttonDisabled(t, '.el-dialog button', '提交')) === false)
// toast（也是 teleport 浮层）与出现/消失轮询
await ov.expectToast(t, /成功/)
await ov.waitForGone(t, '.el-drawer')
```

各库的具体坑（均实测）：

- **hover 型 el-dropdown**：`human.hover` 需几何，0×0 下无效；且向 `.el-dropdown`
  根元素 dispatch `mouseenter` **不生效**——必须打在 `.el-tooltip__trigger`（内层按钮）
  上且 `bubbles: false`。用 `ov.hoverDropdown(t, '.el-drawer .el-dropdown')`。
- **el-checkbox**：原生 `input` 是 `opacity:0`（视觉隐藏），会被 CSS 可见性过滤挡掉；
  点 `.el-checkbox` label 包裹层（浏览器 label 激活行为会转发给 input）。
- **el-select 触发点**：点 `.el-select__wrapper`（内层），点 `.el-select` 根可能不触发。
- **el-message-box 确认按钮**：`.el-message-box` 是浮层 → `ov.domClick(t, '.el-message-box button', '确定')`。
- **伪选择器禁令**：`:has-text()` / `:text()` / `:visible` 只能出现在 Playwright locator
  （`t.human.*`、`t.page.locator`、`t.expect.count`）里；出现在 `page.evaluate` 的
  `querySelectorAll` 里直接抛 `DOMException`。ov.* 的 sel 参数只收纯 CSS，文本用第二参数。

## 其它稳健性建议

- 断言文案时，框架已做空白归一化（`trim` + 折叠连续空格）；自己写断言也要归一化，否则尾随空格会造成假失败。
- 别用固定 `sleep`；等元素/条件。
- 页面地址用相对路径 + `--base-url`，避免硬编码环境域名。
- 卡片/表格里的空态、加载态也可断言（`.el-table__empty-text`、`.el-loading-mask`）。
