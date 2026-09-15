/**
 * 示例用例模板：登录模块（Vue3 + Element Plus）
 *
 * 用法（复制到你的项目里改选择器即可）：
 *   moli-e2e-test/scripts/run.sh ./login.spec.mjs --base-url http://localhost:3000
 *
 * 要点：
 *   - baseURL 由 --base-url 传入，页面用相对路径 t.human.goto('/login')
 *   - Element Plus 的字段错误文案在 .el-form-item__error，字段项是 .el-form-item
 *   - 登录成功通常表现为路由跳转（assert url）或全局 message（assert toast）
 */
export default function register(session) {
  const noBase = !session.cfg.baseURL;

  session.describe('登录模块', () => {
    session.it(
      '空用户名 / 空密码：应被前端校验拦截',
      async (t) => {
        await t.human.goto('/login');
        await t.expect.blocked(() => t.human.click('button[type="submit"]'), { settle: 600 });
        // Element Plus：错误文案定位到具体表单项
        await t.expect.fieldError('.el-form-item:has(#username)', '请输入用户名');
        await t.expect.fieldError('.el-form-item:has(#password)', '请输入密码');
        await t.expect.url(/\/login/); // 未跳转
      },
      { skip: noBase, skipReason: '未提供 --base-url，示例跳过' },
    );

    session.it(
      '密码错误：应提示失败且不进入系统',
      async (t) => {
        await t.human.goto('/login');
        await t.human.type('#username', 'admin');
        await t.human.type('#password', 'wrong-password-123');
        await t.human.click('button[type="submit"]');
        // 全局提示（Element Plus Message）
        await t.expect.toast(/密码|账号|失败|错误/);
        await t.expect.url(/\/login/);
      },
      { skip: noBase, skipReason: '未提供 --base-url，示例跳过' },
    );

    session.it(
      '用户名边界：超长（256+）应被拦截',
      async (t) => {
        await t.human.goto('/login');
        await t.human.type('#username', 'a'.repeat(260));
        await t.human.type('#password', 'Passw0rd!');
        await t.expect.blocked(() => t.human.click('button[type="submit"]'), { settle: 600 });
        await t.expect.url(/\/login/);
      },
      { skip: noBase, skipReason: '未提供 --base-url，示例跳过' },
    );

    session.it(
      '合法账号：应登录成功并跳转首页',
      async (t) => {
        await t.human.goto('/login');
        await t.human.type('#username', process.env.E2E_USER || 'admin');
        await t.human.type('#password', process.env.E2E_PASS || 'admin123');
        await t.human.click('button[type="submit"]');
        await t.expect.url(/\/(dashboard|index|home)/);
      },
      { skip: noBase, skipReason: '未提供 --base-url，示例跳过' },
    );
  });
}
