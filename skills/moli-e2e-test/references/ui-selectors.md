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

## 其它稳健性建议

- 断言文案时，框架已做空白归一化（`trim` + 折叠连续空格）；自己写断言也要归一化，否则尾随空格会造成假失败。
- 别用固定 `sleep`；等元素/条件。
- 页面地址用相对路径 + `--base-url`，避免硬编码环境域名。
- 卡片/表格里的空态、加载态也可断言（`.el-table__empty-text`、`.el-loading-mask`）。
