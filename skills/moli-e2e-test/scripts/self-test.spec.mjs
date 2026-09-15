/**
 * moli-e2e-test · 自检用例（内置示例表单，无需任何外部服务）
 *
 * 目的：既验证 harness 自身可用，又演示「正向功能 + 前端校验拦截 + 边界输入」
 * 三类典型用例的写法。真实项目里把 seed() 换成 t.human.goto('/你的页面') 即可。
 */

const FORM_HTML = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>用户注册 · 自检</title>
<style>
  body{font-family:-apple-system,"PingFang SC",sans-serif;margin:40px;color:#222;background:#fff}
  h1{font-size:20px}
  .form-item{margin:14px 0}
  .form-item label{display:block;font-size:13px;color:#555;margin-bottom:4px}
  input{width:300px;padding:8px 10px;border:1px solid #ccc;border-radius:6px;font-size:14px}
  .field-error{color:#c62828;font-size:12px;min-height:16px;display:block;margin-top:3px}
  .form-item.is-error input{border-color:#c62828;background:#fff5f5}
  button{margin-top:10px;padding:9px 22px;background:#274E13;color:#fff;border:0;border-radius:6px;cursor:pointer;font-size:14px}
  #ok{margin-top:14px;color:#2e7d32;font-weight:600}
  #ok.hidden{display:none}
</style></head>
<body>
  <h1>用户注册</h1>
  <form id="f" novalidate>
    <div class="form-item" id="fi-username">
      <label for="username">用户名 *</label>
      <input id="username" autocomplete="off"/>
      <span class="field-error" id="err-username"></span>
    </div>
    <div class="form-item" id="fi-email">
      <label for="email">邮箱 *</label>
      <input id="email" autocomplete="off"/>
      <span class="field-error" id="err-email"></span>
    </div>
    <div class="form-item" id="fi-phone">
      <label for="phone">手机号 *</label>
      <input id="phone" autocomplete="off"/>
      <span class="field-error" id="err-phone"></span>
    </div>
    <div class="form-item" id="fi-password">
      <label for="password">密码 *</label>
      <input id="password" type="password" autocomplete="off"/>
      <span class="field-error" id="err-password"></span>
    </div>
    <button id="submit" type="submit">注册</button>
  </form>
  <div id="ok" class="hidden"></div>
<script>
  var $ = function (id) { return document.getElementById(id); };
  var rules = {
    username: function (v) { return !v.trim() ? '请输入用户名' : (v.length < 3 ? '用户名至少 3 个字符' : ''); },
    email: function (v) { return !v.trim() ? '请输入邮箱' : (/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(v) ? '' : '邮箱格式不正确'); },
    phone: function (v) { return !v.trim() ? '请输入手机号' : (/^1[3-9]\\d{9}$/.test(v) ? '' : '手机号格式不正确'); },
    password: function (v) { return !v.trim() ? '请输入密码' : (v.length < 8 ? '密码至少 8 位' : ''); }
  };
  var fields = ['username', 'email', 'phone', 'password'];
  function validateField(name) {
    var msg = rules[name]($(name).value);
    $('err-' + name).textContent = msg;
    $('fi-' + name).classList.toggle('is-error', !!msg);
    return !msg;
  }
  fields.forEach(function (n) { $(n).addEventListener('input', function () { validateField(n); }); });
  $('f').addEventListener('submit', function (e) {
    e.preventDefault();                       // 前端拦截：不提交
    $('ok').classList.add('hidden');
    if (fields.map(validateField).every(Boolean)) {
      $('ok').textContent = '注册成功：' + $('username').value;   // 以 textContent 写入，天然防注入
      $('ok').classList.remove('hidden');
    }
  });
</script>
</body></html>`;

const VALID = {
  username: 'zhangsan',
  email: 'zhangsan@example.com',
  phone: '13800138000',
  password: 'Passw0rd!',
};

export default function register(session) {
  const seed = (t) => t.page.setContent(FORM_HTML);
  const fillValid = async (t) => {
    await t.human.type('#username', VALID.username);
    await t.human.type('#email', VALID.email);
    await t.human.type('#phone', VALID.phone);
    await t.human.type('#password', VALID.password);
  };

  session.describe('用户注册表单 · 功能与边界', () => {
    session.it('空表单提交：应被前端拦截，并提示全部必填项', async (t) => {
      await seed(t);
      await t.step('点击提交（空表单）');
      await t.expect.blocked(() => t.human.click('#submit'), { settle: 400 });
      await t.expect.fieldError('#fi-username', '请输入用户名');
      await t.expect.fieldError('#fi-email', '请输入邮箱');
      await t.expect.fieldError('#fi-phone', '请输入手机号');
      await t.expect.fieldError('#fi-password', '请输入密码');
      await t.expect.hidden('#ok', '非法提交不应出现成功提示');
    });

    session.it('邮箱格式非法：应被拦截并提示格式错误', async (t) => {
      await seed(t);
      await t.human.type('#username', VALID.username);
      await t.human.type('#email', 'not-an-email');
      await t.human.type('#phone', VALID.phone);
      await t.human.type('#password', VALID.password);
      await t.expect.blocked(() => t.human.click('#submit'), { settle: 400 });
      await t.expect.fieldError('#fi-email', '邮箱格式不正确');
      await t.expect.hidden('#ok');
    });

    session.it('手机号格式非法：应被拦截并提示格式错误', async (t) => {
      await seed(t);
      await t.human.type('#username', VALID.username);
      await t.human.type('#email', VALID.email);
      await t.human.type('#phone', '12345');
      await t.human.type('#password', VALID.password);
      await t.expect.blocked(() => t.human.click('#submit'), { settle: 400 });
      await t.expect.fieldError('#fi-phone', '手机号格式不正确');
      await t.expect.hidden('#ok');
    });

    session.it('密码过短（长度边界）：应被拦截', async (t) => {
      await seed(t);
      await t.human.type('#username', VALID.username);
      await t.human.type('#email', VALID.email);
      await t.human.type('#phone', VALID.phone);
      await t.human.type('#password', '1234567'); // 7 位，差 1 位
      await t.expect.blocked(() => t.human.click('#submit'), { settle: 400 });
      await t.expect.fieldError('#fi-password', '密码至少 8 位');
      await t.expect.hidden('#ok');
    });

    session.it('用户名边界（2 字符 < 最小 3）：应被拦截', async (t) => {
      await seed(t);
      await t.human.type('#username', 'ab');
      await t.human.type('#email', VALID.email);
      await t.human.type('#phone', VALID.phone);
      await t.human.type('#password', VALID.password);
      await t.expect.blocked(() => t.human.click('#submit'), { settle: 400 });
      await t.expect.fieldError('#fi-username', '用户名至少 3 个字符');
    });

    session.it('修正非法输入后，错误提示应实时消失', async (t) => {
      await seed(t);
      await t.human.type('#username', 'ab');
      await t.expect.fieldError('#fi-username', '用户名至少 3 个字符');
      await t.step('补足到 3 个字符');
      await t.human.type('#username', 'abc');
      await t.expect.noFieldError('#fi-username');
    });

    session.it('特殊字符与超长输入：应作为纯文本处理、不注入、不崩溃', async (t) => {
      await seed(t);
      const xss = '<script>alert(1)</script>恶意输入';
      await t.step('向用户名键入脚本片段');
      await t.human.type('#username', xss);
      await t.expect.value('#username', xss); // 值原样保留，未被截断
      await t.expect.text('h1', '用户注册'); // 页面结构未被注入破坏

      await t.human.type('#email', VALID.email);
      await t.human.type('#phone', VALID.phone);
      await t.human.type('#password', VALID.password);
      await t.human.click('#submit');
      await t.expect.visible('#ok');
      // 成功文案把原始字符串当文本呈现（而非执行），证明无 XSS 注入
      await t.expect.contains('#ok', xss);
      await t.expect.text('h1', '用户注册');

      await t.step('超长输入（60 字符）应完整保留且页面不崩溃');
      await t.page.fill('#username', 'a'.repeat(60));
      await t.expect.value('#username', 'a'.repeat(60));
      await t.expect.text('h1', '用户注册');
    });

    session.it('合法数据：应提交成功并显示结果', async (t) => {
      await seed(t);
      await fillValid(t);
      await t.human.click('#submit');
      await t.expect.visible('#ok');
      await t.expect.text('#ok', '注册成功：' + VALID.username);
      await t.expect.noFieldError('#fi-username');
      await t.expect.noFieldError('#fi-email');
      await t.expect.noFieldError('#fi-phone');
      await t.expect.noFieldError('#fi-password');
    });
  });
}
