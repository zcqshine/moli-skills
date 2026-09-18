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
 */

const TIMEOUT = 8000

export async function shownCount(t, sel, text = null) {
  return t.page.evaluate(([s, tx]) => {
    const shown = (el) => {
      let n = el
      while (n && n.nodeType === 1) {
        const cs = getComputedStyle(n)
        if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false
        n = n.parentElement
      }
      return true
    }
    const els = [...document.querySelectorAll(s)].filter(shown)
    return tx ? els.filter((e) => e.textContent.replace(/\s+/g, ' ').includes(tx)).length : els.length
  }, [sel, text])
}

export async function waitForShown(t, sel, text = null, { timeout = TIMEOUT } = {}) {
  const deadline = Date.now() + timeout
  for (;;) {
    if ((await shownCount(t, sel, text)) > 0) return
    if (Date.now() >= deadline) throw new Error(`等待出现超时: ${sel}${text ? ` (含文本 "${text}")` : ''}`)
    await t.page.waitForTimeout(150)
  }
}

export async function waitForGone(t, sel, text = null, { timeout = TIMEOUT } = {}) {
  const deadline = Date.now() + timeout
  for (;;) {
    if ((await shownCount(t, sel, text)) === 0) return
    if (Date.now() >= deadline) throw new Error(`等待消失超时: ${sel}${text ? ` (含文本 "${text}")` : ''}`)
    await t.page.waitForTimeout(150)
  }
}

/** DOM 级点击：轮询到「CSS 可见且文本匹配」的第一个元素后 el.click() */
export async function domClick(t, sel, text = null, { timeout = TIMEOUT } = {}) {
  await waitForShown(t, sel, text, { timeout })
  const r = await t.page.evaluate(([s, tx]) => {
    const shown = (el) => {
      let n = el
      while (n && n.nodeType === 1) {
        const cs = getComputedStyle(n)
        if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false
        n = n.parentElement
      }
      return true
    }
    const els = [...document.querySelectorAll(s)].filter(shown)
    const f = tx ? els.filter((e) => e.textContent.replace(/\s+/g, ' ').includes(tx)) : els
    if (!f.length) return 'NOMATCH'
    f[0].click()
    return 'OK'
  }, [sel, text])
  if (r !== 'OK') throw new Error(`domClick 失败 ${r}: ${sel} ${text ?? ''}`)
}

/** 表格行内 DOM 级点击：先按 rowText 定位行，再在行内点 sel（可选按钮文本 btnText） */
export async function rowClick(t, rowText, sel, btnText = null, { timeout = TIMEOUT, rowSel = 'tr.el-table__row' } = {}) {
  const deadline = Date.now() + timeout
  for (;;) {
    const r = await t.page.evaluate(([rt, s, bt, rs]) => {
      const shown = (el) => {
        let n = el
        while (n && n.nodeType === 1) {
          const cs = getComputedStyle(n)
          if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false
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
    }, [rowText, sel, btnText, rowSel])
    if (r === 'OK') return
    if (Date.now() >= deadline) throw new Error(`rowClick 失败 ${r}: row="${rowText}" sel=${sel} text=${btnText ?? ''}`)
    await t.page.waitForTimeout(200)
  }
}

/** 受控输入：native setter + input 事件（v-model 可感知；0×0 元素也可用） */
export async function domType(t, sel, value, { timeout = TIMEOUT } = {}) {
  await waitForShown(t, sel, null, { timeout })
  await t.page.evaluate(([s, v]) => {
    const shown = (el) => {
      let n = el
      while (n && n.nodeType === 1) {
        const cs = getComputedStyle(n)
        if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false
        n = n.parentElement
      }
      return true
    }
    const el = [...document.querySelectorAll(s)].filter(shown)[0]
    const setter = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set
    setter.call(el, v)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }, [sel, value])
}

/** 按钮禁用态读取（浮层内按钮的 disabled 判定，不依赖几何）；元素不存在返回 null */
export async function buttonDisabled(t, sel, text = null) {
  return t.page.evaluate(([s, tx]) => {
    const shown = (el) => {
      let n = el
      while (n && n.nodeType === 1) {
        const cs = getComputedStyle(n)
        if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false
        n = n.parentElement
      }
      return true
    }
    const els = [...document.querySelectorAll(s)].filter(shown)
    const f = tx ? els.filter((e) => e.textContent.replace(/\s+/g, ' ').includes(tx)) : els
    return f.length ? !!f[0].disabled : null
  }, [sel, text])
}

/** toast 断言：轮询 .el-message/.el-notification 的 textContent（toast 也是 teleport 浮层） */
export async function expectToast(t, pattern, { timeout = TIMEOUT, sel = '.el-message, .el-notification' } = {}) {
  const deadline = Date.now() + timeout
  for (;;) {
    const texts = await t.page.evaluate((s) => {
      return [...document.querySelectorAll(s)].map((m) => m.textContent.replace(/\s+/g, ' ').trim())
    }, sel)
    const hit = texts.find((x) => pattern.test(x))
    if (hit) return hit
    if (Date.now() >= deadline) throw new Error(`toast 未匹配 ${pattern}，实际: ${JSON.stringify(texts)}`)
    await t.page.waitForTimeout(200)
  }
}

/**
 * 打开 trigger="hover" 的 el-dropdown / el-tooltip：
 * mouseenter 必须打在 .el-tooltip__trigger（通常是内层按钮）上，
 * 打在 .el-dropdown 根元素上无效；bubbles 必须为 false。
 */
export async function hoverDropdown(t, containerSel) {
  const r = await t.page.evaluate((s) => {
    const el = document.querySelector(s)
    if (!el) return 'NOCONTAINER'
    const trig = el.matches('.el-tooltip__trigger') ? el : el.querySelector('.el-tooltip__trigger') || el
    trig.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }))
    trig.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }))
    return 'OK'
  }, containerSel)
  if (r !== 'OK') throw new Error(`hoverDropdown 失败 ${r}: ${containerSel}`)
}
