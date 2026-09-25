/**
 * 选择器诊断器（零依赖，只读 DOM，不修改任何状态）
 *
 * 解决的问题：断言/等待超时只报「等不到 X」，使用者无法区分下面四种情况，
 * 只能反复 dump 手工排查：
 *   ① 选择器含 Playwright 私有语法（querySelectorAll 直接抛 DOMException）
 *   ② 元素根本不在 DOM（未 goto / 未渲染 / 选择器写错）
 *   ③ 在 DOM 但被某个祖先以 display:none / visibility:hidden / opacity:0 隐藏
 *      （折叠的 el-sub-menu、未展开的下拉、v-show 关闭的抽屉，都属此类）
 *   ④ 在 DOM 且可见，但没有一个元素的文本匹配传入的 text
 *
 * 用法：断言失败信息里已自动带上诊断；也可在 spec 里手动调用：
 *   import { diagnoseSelector } from '<skill目录>/scripts/selector-doctor.mjs'
 *   throw new Error(await diagnoseSelector(t.page, '#submit', { fnName: '自定义' }))
 */

/* ------------------------------------------------------------------ *
 * Playwright 私有语法检测
 * 这些写法只能用于 page.locator()，传进 evaluate 里的 querySelectorAll 会抛
 * DOMException（且各浏览器报错文案不一，很难一眼看出根因）。
 * ------------------------------------------------------------------ */
const PW_SYNTAX_RULES = [
  {
    re: /:has-text\s*\(/i,
    bad: ':has-text()',
    fix: "文本不要写进选择器，改走第二个参数：domClick(t, '.el-select-dropdown__item', '选项文案')",
  },
  {
    re: /:text\s*\(/i,
    bad: ':text()',
    fix: '同上：选择器只写纯 CSS，文本用独立参数传入',
  },
  {
    re: /:visible\b/i,
    bad: ':visible',
    fix: '本模块的查询本身已过滤不可见元素，直接删掉 :visible',
  },
  {
    re: /(^|[\s,>+~(])text\s*=/i,
    bad: 'text= 引擎前缀',
    fix: '改用纯 CSS 定位元素，文本用独立参数传入',
  },
  {
    re: /(^|[\s,>+~(])(css|xpath|nth|role|data-testid)\s*=/i,
    bad: 'Playwright 引擎前缀',
    fix: '只传纯 CSS，例如 #submit / .el-button--primary / [data-testid="save"]',
  },
  {
    re: /^\s*\/\//,
    bad: 'XPath',
    fix: '改用 CSS 选择器（本模块只支持 CSS）',
  },
  {
    re: />>/,
    bad: '>> 链式选择器',
    fix: '改写成单条 CSS，或拆成两次调用（父级定位 → 子级定位）',
  },
];

/**
 * 检查选择器是否含 Playwright 私有语法。
 * @returns {null | {bad: string, fix: string}} 合法返回 null
 */
export function checkSelectorSyntax(sel) {
  if (typeof sel !== 'string') return null;
  for (const r of PW_SYNTAX_RULES) {
    if (r.re.test(sel)) return { bad: r.bad, fix: r.fix };
  }
  return null;
}

/** 供 overlay-helpers 等做前置校验：非法即抛，错误信息自带改法 */
export function assertPureCss(sel, fnName, text = undefined) {
  const issue = checkSelectorSyntax(sel);
  if (!issue) return;
  const lines = [
    `[${fnName}] sel 只接受纯 CSS 选择器，但检测到 Playwright 私有语法：${issue.bad}`,
    `  收到: ${JSON.stringify(sel)}`,
    `  改法: ${issue.fix}`,
  ];
  if (text !== undefined) {
    lines.push(`  提示: 本函数的第二个参数已经承担文本过滤，无需写进选择器。`);
  }
  lines.push('  原因: :has-text()/:text()/:visible 等只能在 page.locator() 里用，');
  lines.push('        传进 page.evaluate 里的 querySelectorAll 会抛 DOMException。');
  throw new Error(lines.join('\n'));
}

/* ------------------------------------------------------------------ *
 * 页面内探测（在浏览器上下文执行）
 * ------------------------------------------------------------------ */
const PROBE = ([s, tx]) => {
  const brief = (el) => {
    if (!el || el.nodeType !== 1) return '?';
    let out = el.tagName.toLowerCase();
    if (el.id) out += '#' + el.id;
    const cls = (el.getAttribute('class') || '')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 3);
    if (cls.length) out += '.' + cls.join('.');
    return out;
  };
  let els;
  try {
    els = [...document.querySelectorAll(s)];
  } catch (e) {
    return { parseError: String((e && e.message) || e) };
  }
  const out = { total: els.length, shown: [], hidden: [], texts: [], textsAll: [], collapsedAncestor: null };
  for (const el of els.slice(0, 20)) {
    let n = el;
    let hide = null;
    while (n && n.nodeType === 1) {
      const cs = getComputedStyle(n);
      if (cs.display === 'none') {
        hide = { why: 'display:none', by: brief(n) };
        break;
      }
      if (cs.visibility === 'hidden' || cs.visibility === 'collapse') {
        hide = { why: 'visibility:' + cs.visibility, by: brief(n) };
        break;
      }
      if (Number(cs.opacity) === 0) {
        hide = { why: 'opacity:0', by: brief(n) };
        break;
      }
      n = n.parentElement;
    }
    const txt = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    out.textsAll.push(txt);
    if (hide) {
      out.hidden.push({ el: brief(el), why: hide.why, by: hide.by });
      if (!out.collapsedAncestor && /sub-menu|menu--collapse|dropdown-menu|el-collapse|drawer|dialog/.test(hide.by)) {
        out.collapsedAncestor = hide.by;
      }
    } else {
      out.shown.push(brief(el));
      out.texts.push(txt);
    }
  }
  return out;
};

/**
 * 生成一段「为什么找不到」的可读诊断。永不抛异常（自身出错也会返回说明文本）。
 *
 * @param {import('playwright').Page} page
 * @param {string} sel        选择器（或 locator 的字符串形式，仅用于展示）
 * @param {object} [opts]
 * @param {string|null} [opts.text]  传入的文本过滤参数（诊断「可见但文本不匹配」时用）
 * @param {string} [opts.fnName]     调用方名字，如 'expect.visible' / 'ov.domClick'
 * @param {boolean} [opts.probe=true] 是否真的进页面探测（定位器对象无法探测时传 false）
 * @returns {Promise<string>}
 */
export async function diagnoseSelector(page, sel, { text = null, fnName = '', probe = true } = {}) {
  const tag = fnName ? `[${fnName}] ` : '';

  const issue = checkSelectorSyntax(sel);
  if (issue) {
    return [
      `${tag}选择器诊断: ${sel}`,
      `  · 语法非法：${issue.bad} 是 Playwright 私有语法，querySelectorAll 不接受`,
      `  · 改法：${issue.fix}`,
    ].join('\n');
  }

  let url = '';
  try {
    url = page.url();
  } catch {
    /* ignore */
  }
  const blankNote = () =>
    !url || url === 'about:blank'
      ? ['  · ⚠ 当前页面是 about:blank：本框架每个用例都会新建页面，用例开头必须自行 t.human.goto(...)（或 t.page.setContent(...)）']
      : [];

  if (!probe) {
    return [
      `${tag}选择器诊断: ${sel}`,
      `  · 当前 URL: ${url || '(未知)'}`,
      '  · 该目标为定位器对象，无法用 querySelectorAll 探测；请改用纯 CSS 字符串以获得完整诊断',
      ...blankNote(),
    ].join('\n');
  }

  let r;
  try {
    r = await page.evaluate(PROBE, [String(sel), text == null ? null : String(text)]);
  } catch (e) {
    return [
      `${tag}选择器诊断: ${sel}`,
      `  · 页面内查询执行失败: ${(e && e.message) || e}`,
      `  · 当前 URL: ${url || '(未知)'}`,
      ...blankNote(),
    ].join('\n');
  }

  const lines = [`${tag}选择器诊断: ${sel}`, `  · 当前 URL: ${url || '(未知)'}`];

  if (r.parseError) {
    lines.push(`  · 选择器被浏览器拒绝: ${r.parseError}`);
    lines.push('  · 常见原因：含 Playwright 私有伪类（:has-text / :text / :visible），或 CSS 语法不完整');
    return lines.join('\n');
  }

  if (r.total === 0) {
    lines.push('  · 匹配 0 个元素 → 元素根本不在 DOM');
    lines.push('  · 排查顺序：① 是否已 goto（见下）② 选择器与实际 DOM 是否一致 ③ 是否异步渲染未完成');
    lines.push(...blankNote());
    return lines.join('\n');
  }

  if (r.shown.length === 0) {
    const h = r.hidden[0];
    lines.push(`  · 匹配 ${r.total} 个元素，但全部不可见（仍在 DOM 中）`);
    if (h) lines.push(`  · 最近隐藏原因: ${h.by} 的 ${h.why}（目标元素: ${h.el}）`);
    if (r.collapsedAncestor)
      lines.push(`  · 疑似折叠/未展开容器（${r.collapsedAncestor}）：菜单或下拉需先展开再操作`);
    lines.push('  · 对照：Playwright 的 :visible / isVisible() 在此场景也会判定为不可见');
    return lines.join('\n');
  }

  if (text != null) {
    lines.push(`  · 匹配 ${r.total} 个元素、其中 ${r.shown.length} 个可见，但没有一个的文本包含 "${text}"`);
    lines.push(`  · 可见候选的实际文本: ${JSON.stringify(r.texts.slice(0, 8))}`);
    return lines.join('\n');
  }

  lines.push(
    `  · 匹配 ${r.total} 个元素，可见 ${r.shown.length} 个${r.hidden.length ? `，另 ${r.hidden.length} 个被隐藏` : ''}`,
  );
  if (r.hidden.length) lines.push(`  · 隐藏示例: ${r.hidden[0].by} 的 ${r.hidden[0].why}`);
  return lines.join('\n');
}

/** 把诊断追加到错误信息尾部（失败时用；诊断自身异常不影响原错误） */
export async function withDiagnosis(err, page, sel, opts = {}) {
  const base = err && err.message ? err.message : String(err);
  try {
    const d = await diagnoseSelector(page, sel, opts);
    return new Error(`${base}\n${d}`);
  } catch {
    return err instanceof Error ? err : new Error(base);
  }
}
