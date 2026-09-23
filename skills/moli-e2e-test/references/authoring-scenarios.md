# 从文档推导测试用例（Authoring Scenarios）

目标：把「模块该做什么」变成「可执行、可判定的用例」。这一步做扎实，后面只是跑。

## 1. 先收集输入（按优先级）

| 来源 | 取什么 |
|---|---|
| PRD / 需求文档 | 功能清单、业务规则、异常场景 |
| `design.md` | 交互与视觉规范、状态与反馈（成功/失败/加载） |
| 接口定义（OpenAPI/Swagger/路由表/控制器） | 入参字段、类型、必填、长度/范围/正则、状态码、错误码 |
| 后端校验规则（DTO/VO/注解） | 与前端校验是否一致（常发现「前端漏拦」） |
| 页面组件（Vue/React 源码） | 表单字段、校验规则、按钮、弹窗、抽屉、列表 |
| 既有测试/缺陷记录 | 历史回归点、易错边界 |

> 没有文档时：直接读页面源码 + 抓一次网络请求，反推字段与校验规则；把推断结果写进 spec 注释，标注「待确认」。

## 2. 提取「模块 → 功能点 → 预期行为」

对每个模块，逐条列出功能点，并为每个功能点写一句**可判定的预期**：

```
模块：CRM 客户管理
功能点：新增客户
  预期：
   - 必填项（客户名称）为空时不可提交，字段下方出现「请输入客户名称」
   - 手机号格式非法时不可提交，提示「手机号格式不正确」
   - 合法数据提交成功后，列表新增该客户，并出现「新增成功」提示
   - 客户名称 50 字边界：49 通过 / 50 通过 / 51 拦截
```

**可判定**是关键：预期必须能落到一个断言（文案、元素状态、URL、请求、列表条数）。

## 3. 每个功能点拆三类用例（覆盖矩阵）

| 类别 | 说明 | 例（新增客户） |
|---|---|---|
| 正向 | 合法输入走通主流程 | 填全合法 → 提交成功 |
| 反向 | 非法输入应被拦截 | 必填为空、格式错、类型错 |
| 边界 | 临界值与极端值 | 长度 49/50/51、数值 0/-1/max、空白、超长、特殊字符 |
| 交互 | 状态联动与反馈 | 修正后错误消失、二次提交防重、按钮禁用/加载态 |
| 权限（如有） | 角色可见/可操作差异 | 只读角色不可编辑 |

## 4. 映射到页面元素

为每个字段/操作确定稳定选择器（见 `ui-selectors.md`）：

- 优先：`#id`、`[name=]`、`aria-label`、`data-testid`、占位符、可见文本
- 避免：`nth-child`、深层 CSS 链、依赖顺序的结构选择器
- Element Plus：字段项 `.el-form-item`，错误文案 `.el-form-item__error`

## 5. 生成 spec 文件

放在被测项目里（如 `e2e/`），**只写用例、不写框架**——框架从 skill 引入：

```js
export default function register(session) {
  session.describe('CRM · 新增客户', () => {
    const open = (t) => t.human.goto('/crm/customer/create');

    session.it('必填客户名称为空：应被拦截', async (t) => {
      await open(t);
      await t.expect.blocked(() => t.human.click('button[type=submit]'));
      await t.expect.fieldError('.el-form-item:has(#name)', '请输入客户名称');
    });

    session.it('客户名称 50 字边界：应通过', async (t) => {
      await open(t);
      await t.human.type('#name', '测'.repeat(50));
      await t.expect.noFieldError('.el-form-item:has(#name)');
    });

    session.it('客户名称 51 字边界：应被拦截', async (t) => {
      await open(t);
      await t.human.type('#name', '测'.repeat(51));
      await t.expect.fieldError('.el-form-item:has(#name)', /最多|长度|50/);
    });

    session.it('合法数据：提交成功并回到列表', async (t) => {
      await open(t);
      await t.human.type('#name', '示例客户');
      await t.human.type('#phone', '13800138000');
      await t.human.click('button[type=submit]');
      await t.expect.toast(/成功/);
      await t.expect.url(/\/crm\/customer(\?|$)/);
    });
  });
}
```

命名规范：`<动作或字段> <边界/场景>：应 <预期>`，让报告一眼能读。

## 6. 运行与收敛

```bash
bash <skill目录>/scripts/run.sh ./e2e/specs/crm-customer.spec.mjs --base-url http://localhost:3000
```

读 `e2e/reports/report.html`：
- **失败**：看截图 + 控制台错误 + 失败请求定位是「功能缺陷」还是「用例假设过期」
- **通过**：检查是否真覆盖了边界；只有一个正向用例不算覆盖
- 把回归点补成用例，形成可重复执行的资产

## 7. 覆盖自检清单

- [ ] 每个模块至少 1 个正向用例
- [ ] 每个必填字段有「为空」反向用例
- [ ] 每个有格式/长度/范围的字段有边界用例（临界值上下各一）
- [ ] 有「修正后错误消失」的交互用例
- [ ] 有「非法提交不产生副作用」的拦截用例（URL/列表无变化）
- [ ] 关键写操作有成功提示或列表/路由变化的断言

> 与 design.md 对齐：用例断言的状态与反馈（提示文案、抽屉/弹窗、加载态）应与设计规范一致，不一致即为缺陷。
