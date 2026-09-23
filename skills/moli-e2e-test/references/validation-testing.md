# 前端校验与边界测试（Validation & Boundary Testing）

目标：证明**非法输入被前端成功拦截**、**合法输入被正确接受**，两者都不能有偏差。
前端漏拦（非法输入被放行）与误拦（合法输入被拒）都是缺陷。

## 断言「被拦截」的四个维度

一次非法提交，应从多个角度确认「确实没放行」：

| 维度 | 断言 | 方法 |
|---|---|---|
| 不出错文案 | 字段出现校验错误文案 | `expect.fieldError(item, '文案')` |
| 错误态 | 字段呈错误样式（`.is-error`） | `fieldError` 已含 `.is-error` 兜底 |
| 无副作用 | URL 未跳转 | `expect.blocked(() => click(submit))` |
| 无成功反馈 | 无成功 toast / 无成功区块 | `expect.hidden('#ok')` / 断言无 toast |

> 只断言「出现了错误文案」还不够——有些实现会「既显示错误又照常提交」。**必须同时断言无副作用**。

## 合法输入的断言

| 维度 | 断言 |
|---|---|
| 提交成功 | `expect.toast(/成功/)` 或 `expect.url(/列表页/)` |
| 数据落库可见 | 列表出现该记录 / 详情字段一致 |
| 错误已清除 | `expect.noFieldError(item)` |

## 非法输入清单（按字段类型）

**通用**

- 空 / 全空格 / 仅换行
- 首尾空格（应被 trim 或按规则处理）
- 超长（`'a'.repeat(max+1)`）、极短（`min-1`）—— 临界值上下各测一个
- 特殊字符：`<script>alert(1)</script>`、`` '"`&<> ``、`\0`、emoji、中文全角
- 注入串：`' OR 1=1 --`、`${7*7}`、`{{7*7}}`
- 复制粘贴超长文本、连续快速提交（防重）

**按类型**

| 字段 | 非法样例 | 边界 |
|---|---|---|
| 邮箱 | `a@`、`@b.com`、`a b@c.com`、无 `@` | 超长 local part |
| 手机号 | `12345`、`23800138000`、`1380013800a` | 11 位、`1[3-9]` 开头 |
| 身份证 | 位数错、校验位错、含字母 | 18 位 |
| 整数/金额 | `-1`、`0`、`abc`、`1e9`、超 int 上限、两位以上小数 | `min`、`max`、`min-1`、`max+1` |
| 日期 | `2026-13-01`、`2026-02-30`、早于范围 | 起止边界日 |
| 必填下拉 | 不选、选后清空 | — |
| 密码 | 全数字、全字母、无特殊字符、含空格 | 最小/最大长度 |
| 文件上传 | 错误类型、超大、0 字节 | 大小上下限 |

## 交互类校验（易漏）

- **实时校验**：边输入边校验时，错误应在满足规则后**即时消失**（`expect.noFieldError`）。
- **防抖**：快速连续输入后只应触发一次校验请求；可配合网络或文案断言。
- **失焦校验**：离开字段后才出错误（`blur` 触发）。
- **二次提交**：提交中按钮进入 loading/禁用，重复点击不产生第二条数据。
- **联动校验**：A 字段变化应触发 B 字段重校验（如「确认密码」）。
- **错误定位**：滚动到首个错误字段（断言该字段可见）。

## 校验文案定位

| UI 库 | 字段项 | 错误文案 |
|---|---|---|
| Element Plus | `.el-form-item`（错误时加 `.is-error`） | `.el-form-item__error` |
| Ant Design Vue | `.ant-form-item`（`.ant-form-item-has-error`） | `.ant-form-item-explain-error` |
| 原生/自研 | 自定义容器 | 常见类名：`.field-error` / `.error-message` / `[data-error]` |

框架 `expect.fieldError` 已内置上述选择器，并支持**文案断言**：`expect.fieldError(sel, '请输入用户名')`
或正则 `expect.fieldError(sel, /最多|长度/)`（文案随版本变化时用正则更稳）。

## 示例：一个完整的校验拦截用例

```js
session.it('邮箱格式非法：应被拦截且不产生副作用', async (t) => {
  await t.human.goto('/user/create');
  await t.human.type('#name', '张三');
  await t.human.type('#email', 'not-an-email');   // 非法输入
  await t.human.type('#phone', '13800138000');
  // 同时断言：无跳转
  await t.expect.blocked(() => t.human.click('button[type=submit]'), { settle: 600 });
  // 断言：错误文案 + 错误态
  await t.expect.fieldError('.el-form-item:has(#email)', '邮箱格式不正确');
  // 断言：无成功反馈
  await t.expect.hidden('.el-message--success');
});
```

## 前后端校验不一致 = 缺陷

对比后端 DTO/注解规则（见 `authoring-scenarios.md` 的收集来源）：
- 后端有、前端无 → 前端漏拦，用户可提交脏数据（体验/性能问题）
- 前端有、后端无 → 绕过前端即脏数据入库（安全问题，**必须报缺陷**）

把「前端已拦但请求仍发出」作为反向用例：断言非法提交后**没有产生写请求**（可结合失败请求/网络诊断或列表条数不变）。
