/**
 * Overlay DOM 级交互助手（Moli + Element Plus/AntD 实测沉淀）
 *
 * 背景：Moli 下 teleport 到 body 的浮层（dialog/drawer/dropdown popper/select
 * dropdown/message-box/toast）包围盒常为 0×0，Playwright 的坐标点击、`:visible`
 * 伪类、hit-test 全部失效；拟人点击在横向滚动表格区也会因坐标过期打偏。
 * 本模块用「el.click() + CSS 可见性轮询」替代，不依赖几何。
 *
 * 用法（spec 内按绝对路径引入，run.sh 的 ESM 解析不认 NODE_PATH）：
 *   import * as ov from '<skill目录>/scripts/overlay-helpers.mjs'
 *   await ov.domClick(t, '.el-dropdown-menu__item', '释放到公海')
 *
 * 约定：
 * - 所有函数第一参数是用例上下文 t（需要 t.page）。
 * - sel 只允许**纯 CSS 选择器**：`:has-text()` / `:visible` / `:text()` 是
 *   Playwright 私有伪类，传进 querySelectorAll 会抛 DOMException。文本过滤一律走第二参数 text。
 * - 误用时**前置拦截并给出改法**；超时错误自动附「选择器诊断」（不在 DOM / 被谁隐藏 /
 *   文本不匹配 / 当前 URL），不需要再手工 dump。
 *
 * 注意：page.evaluate 的函数体是序列化后在页面里执行的，**不能引用本模块作用域的变量**
 * （如把 shown 判定抽成常量再引用会拿到 undefined）。因此每个 evaluate 内部各自内联。
 */

import { assertPureCss, checkSelectorSyntax, diagnoseSelector } from './selector-doctor.mjs'

export { diagnoseSelector, checkSelectorSyntax }

const TIMEOUT = 8000

/**
 * 统一 evaluate 包装：兜底把 DOMException（选择器非法 / 页面已关闭等）
 * 转成含函数名与选择器的可读错误。语法问题已在各函数入口前置拦截。
 */
async function evl(t, fn, arg, { name, sel }) {
  try {
    return await t.page.evaluate(fn, arg)
  } catch (e) {
    const msg = String((e && e.message) || e)
    if (/DOMException|not a valid selector|Failed to execute|is not a valid selector/i.test(msg)) {
      const issue = checkSelectorSyntax(sel)
      throw new Error(
        [
          `[${name}] 页面内查询被拒绝（可能是选择器非法）: ${sel}`,
          `  · 原始错误: ${msg}`,
          issue
            ? `  · 命中私有语法: ${issue.bad} → ${issue.fix}`
            : '  · 排查：sel 必须是纯 CSS；`text=` / `:has-text()` / `:visible` 等都不可用',
        ].join('\n'),
      )
    }
    throw e
  }
}

/** 超时错误的统一出口：拼上选择器诊断（诊断自身失败不影响原错误） */
async function timeoutError(t, sel, text, { name, prefix, probe = true }) {
  const head = `${prefix}: ${sel}${text ? ` (含文本 "${text}")` : ''}`
  try {
    const d = await diagnoseSelector(t.page, sel, { text, fnName: name, probe })
    return new Error(`${head}\n${d}`)
  } catch {
    return new Error(head)
  }
}

export async function shownCount(t, sel, text = null) {
  assertPureCss(sel, 'ov.shownCount', text)
  return evl(
    t,
    ([s, tx]) => {
      const shown = (el) => {
        let n = el
        while (n && n.nodeType === 1) {
          const cs = getComputedStyle(n)
          if (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse') return false
          if (Number(cs.opacity) === 0) return false
          n = n.parentElement
        }
        return true
      }
      const els = [...document.querySelectorAll(s)].filter(shown)
      return tx ? els.filter((e) => e.textContent.replace(/\s+/g, ' ').includes(tx)).length : els.length
    },
    [sel, text],
    { name: 'ov.shownCount', sel },
  )
}

export async function waitForShown(t, sel, text = null, { timeout = TIMEOUT } = {}) {
  assertPureCss(sel, 'ov.waitForShown', text)
  const deadline = Date.now() + timeout
  for (;;) {
    if ((await shownCount(t, sel, text)) > 0) return
    if (Date.now() >= deadline)
      throw await timeoutError(t, sel, text, { name: 'ov.waitForShown', prefix: '等待出现超时' })
    await t.page.waitForTimeout(150)
  }
}

export async function waitForGone(t, sel, text = null, { timeout = TIMEOUT } = {}) {
  assertPureCss(sel, 'ov.waitForGone', text)
  const deadline = Date.now() + timeout
  for (;;) {
    if ((await shownCount(t, sel, text)) === 0) return
    if (Date.now() >= deadline)
      throw await timeoutError(t, sel, text, { name: 'ov.waitForGone', prefix: '等待消失超时（元素仍可见）' })
    await t.page.waitForTimeout(150)
  }
}

/** DOM 级点击：轮询到「CSS 可见且文本匹配」的第一个元素后 el.click() */
export async function domClick(t, sel, text = null, { timeout = TIMEOUT } = {}) {
  assertPureCss(sel, 'ov.domClick', text)
  await waitForShown(t, sel, text, { timeout })
  const r = await evl(
    t,
    ([s, tx]) => {
      const shown = (el) => {
        let n = el
        while (n && n.nodeType === 1) {
          const cs = getComputedStyle(n)
          if (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse') return false
          if (Number(cs.opacity) === 0) return false
          n = n.parentElement
        }
        return true
      }
      const els = [...document.querySelectorAll(s)].filter(shown)
      const f = tx ? els.filter((e) => e.textContent.replace(/\s+/g, ' ').includes(tx)) : els
      if (!f.length) return 'NOMATCH'
      f[0].click()
      return 'OK'
    },
    [sel, text],
    { name: 'ov.domClick', sel },
  )
  if (r !== 'OK')
    throw await timeoutError(t, sel, text, { name: 'ov.domClick', prefix: `domClick 未命中 (${r})` })
}

/** 表格行内 DOM 级点击：先按 rowText 定位行，再在行内点 sel（可选按钮文本 btnText） */
export async function rowClick(t, rowText, sel, btnText = null, { timeout = TIMEOUT, rowSel = 'tr.el-table__row' } = {}) {
  assertPureCss(sel, 'ov.rowClick(行内)', btnText)
  assertPureCss(rowSel, 'ov.rowClick(行)', rowText)
  const deadline = Date.now() + timeout
  let last = ''
  for (;;) {
    const r = await evl(
      t,
      ([rt, s, bt, rs]) => {
        const shown = (el) => {
          let n = el
          while (n && n.nodeType === 1) {
            const cs = getComputedStyle(n)
            if (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse') return false
            if (Number(cs.opacity) === 0) return false
            n = n.parentElement
          }
          return true
        }
        const norm = (x) => x.textContent.replace(/\s+/g, ' ')
        const row = [...document.querySelectorAll(rs)].find((x) => shown(x) && norm(x).includes(rt))
        if (!row) return 'NOROW'
        const cands = [...row.querySelectorAll(s)].filter(shown)
        const f = bt ? cands.filter((e) => norm(e).includes(bt)) : cands
        if (!f.length) return 'NOEL'
        f[0].click()
        return 'OK'
      },
      [rowText, sel, btnText, rowSel],
      { name: 'ov.rowClick', sel },
    )
    if (r === 'OK') return
    last = r
    if (Date.now() >= deadline) {
      let hint
      if (last === 'NOROW') {
        hint = await diagnoseSelector(t.page, rowSel, { text: rowText, fnName: 'ov.rowClick(行)' })
      } else {
        hint = [
          `[ov.rowClick(行内)] 命中行内未找到可见元素: ${sel}${btnText ? ` (文本 "${btnText}")` : ''}`,
          '  · 行已定位成功，问题在行内选择器：请核对按钮/链接的实际 class 与文本',
          '  · 若该控件是浮层菜单（如下拉），需先展开再调用 ov.domClick',
        ].join('\n')
      }
      throw new Error(`rowClick 失败 ${last}: row="${rowText}" sel=${sel} text=${btnText ?? ''}\n${hint}`)
    }
    await t.page.waitForTimeout(200)
  }
}

/** 受控输入：native setter + input 事件（v-model 可感知；0×0 元素也可用） */
export async function domType(t, sel, value, { timeout = TIMEOUT } = {}) {
  assertPureCss(sel, 'ov.domType')
  await waitForShown(t, sel, null, { timeout })
  await evl(
    t,
    ([s, v]) => {
      const shown = (el) => {
        let n = el
        while (n && n.nodeType === 1) {
          const cs = getComputedStyle(n)
          if (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse') return false
          if (Number(cs.opacity) === 0) return false
          n = n.parentElement
        }
        return true
      }
      const el = [...document.querySelectorAll(s)].filter(shown)[0]
      if (!el) throw new Error('domType 目标不存在或不可见: ' + s)
      const proto = el.constructor && el.constructor.prototype
      const desc = proto ? Object.getOwnPropertyDescriptor(proto, 'value') : null
      if (desc && desc.set) {
        desc.set.call(el, v) // 受控组件（v-model 等）需 native setter 才能感知
      } else {
        el.value = v // 回退：contenteditable / 自定义元素等
      }
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
    },
    [sel, value],
    { name: 'ov.domType', sel },
  )
}

/** 按钮禁用态读取（浮层内按钮的 disabled 判定，不依赖几何）；元素不存在返回 null */
export async function buttonDisabled(t, sel, text = null) {
  assertPureCss(sel, 'ov.buttonDisabled', text)
  return evl(
    t,
    ([s, tx]) => {
      const shown = (el) => {
        let n = el
        while (n && n.nodeType === 1) {
          const cs = getComputedStyle(n)
          if (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse') return false
          if (Number(cs.opacity) === 0) return false
          n = n.parentElement
        }
        return true
      }
      const els = [...document.querySelectorAll(s)].filter(shown)
      const f = tx ? els.filter((e) => e.textContent.replace(/\s+/g, ' ').includes(tx)) : els
      return f.length ? !!f[0].disabled : null
    },
    [sel, text],
    { name: 'ov.buttonDisabled', sel },
  )
}

/** toast 断言：轮询常见提示条（含 message-box / role=alert）的 textContent；pattern 支持字符串或正则 */
export async function expectToast(
  t,
  pattern,
  {
    timeout = TIMEOUT,
    sel = '.el-message, .el-message-box, .el-notification, .ant-message-notice, .ant-message, .van-toast, [role="alert"]',
  } = {},
) {
  assertPureCss(sel, 'ov.expectToast')
  const match = (x) => (pattern instanceof RegExp ? pattern.test(x) : x.includes(String(pattern)))
  const deadline = Date.now() + timeout
  let texts = []
  for (;;) {
    texts = await evl(
      t,
      (s) => [...document.querySelectorAll(s)].map((m) => m.textContent.replace(/\s+/g, ' ').trim()),
      sel,
      { name: 'ov.expectToast', sel },
    )
    const hit = texts.find(match)
    if (hit) return hit
    if (Date.now() >= deadline) {
      // 一个 toast 容器都没找到时，附诊断（多半是 UI 库选择器不符）
      const hint = texts.length
        ? ''
        : '\n' + (await diagnoseSelector(t.page, sel, { fnName: 'ov.expectToast' }))
      throw new Error(`toast 未匹配 ${pattern}，实际: ${JSON.stringify(texts)}${hint}`)
    }
    await t.page.waitForTimeout(200)
  }
}

/**
 * 打开 trigger="hover" 的 el-dropdown / el-tooltip：
 * mouseenter 必须打在 .el-tooltip__trigger（通常是内层按钮）上，
 * 打在 .el-dropdown 根元素上无效；bubbles 必须为 false。
 */
export async function hoverDropdown(t, containerSel, { timeout = TIMEOUT } = {}) {
  assertPureCss(containerSel, 'ov.hoverDropdown')
  const deadline = Date.now() + timeout
  let r = ''
  for (;;) {
    r = await evl(
      t,
      (s) => {
        const el = document.querySelector(s)
        if (!el) return 'NOCONTAINER'
        const trig = el.matches('.el-tooltip__trigger') ? el : el.querySelector('.el-tooltip__trigger') || el
        trig.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }))
        trig.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }))
        return 'OK'
      },
      containerSel,
      { name: 'ov.hoverDropdown', sel: containerSel },
    )
    if (r === 'OK') return
    if (Date.now() >= deadline) {
      throw await timeoutError(t, containerSel, null, {
        name: 'ov.hoverDropdown',
        prefix: `hoverDropdown 失败 (${r})`,
      })
    }
    await t.page.waitForTimeout(200)
  }
}
