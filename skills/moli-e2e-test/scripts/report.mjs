/**
 * moli-e2e-test · HTML 报告生成
 * 生成自包含（截图以内联 base64 嵌入）的单文件报告，便于归档与分享。
 */
import fsp from 'node:fs/promises';
import path from 'node:path';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function imgTag(file, baseDir) {
  if (!file) return '';
  const abs = path.isAbsolute(file) ? file : path.resolve(baseDir || process.cwd(), file);
  try {
    const buf = await fsp.readFile(abs);
    return `<a class="shot" href="#" onclick="return false"><img src="data:image/png;base64,${buf.toString(
      'base64',
    )}" alt="screenshot"/></a>`;
  } catch {
    return '';
  }
}

function badge(status) {
  const map = {
    passed: ['通过', 'b-pass'],
    failed: ['失败', 'b-fail'],
    skipped: ['跳过', 'b-skip'],
  };
  const [label, cls] = map[status] || ['未知', 'b-skip'];
  return `<span class="badge ${cls}">${label}</span>`;
}

function diagBlock(diag) {
  if (!diag) return '';
  const parts = [];
  if (diag.consoleErrors?.length)
    parts.push(`<div class="diag"><b>控制台错误 (${diag.consoleErrors.length})</b><pre>${esc(diag.consoleErrors.join('\n'))}</pre></div>`);
  if (diag.pageErrors?.length)
    parts.push(`<div class="diag"><b>页面异常 (${diag.pageErrors.length})</b><pre>${esc(diag.pageErrors.join('\n'))}</pre></div>`);
  if (diag.failedRequests?.length)
    parts.push(`<div class="diag"><b>失败请求 (${diag.failedRequests.length})</b><pre>${esc(diag.failedRequests.join('\n'))}</pre></div>`);
  return parts.join('');
}

/**
 * @param {object} summary run.mjs 聚合后的结果
 * @param {object} cfg
 * @returns {Promise<string>} 报告文件路径
 */
export async function writeReport(summary, cfg = {}) {
  const dir = cfg.reportDir || summary.reportDir || path.resolve(process.cwd(), 'e2e', 'reports');
  await fsp.mkdir(dir, { recursive: true });

  const totals = summary.totals || {
    total: summary.total || 0,
    passed: summary.passed || 0,
    failed: summary.failed || 0,
    skipped: summary.skipped || 0,
  };
  // 全部跳过时通过率无意义，显示 "-" 而非 100%（避免「其实一条没跑」被误读为环境已验证）
  const execTotal = totals.total - (totals.skipped || 0);
  const passRate = execTotal > 0 ? Math.round((totals.passed / execTotal) * 100) + '%' : '-';
  const durSec = ((summary.durationMs || 0) / 1000).toFixed(1);
  const shotBase = cfg.e2eDir || cfg.reportDir;

  const specSections = [];
  for (const spec of summary.specs || []) {
    const rows = [];
    let lastGroup = null;
    for (const r of spec.results || []) {
      if (r.group && r.group !== lastGroup) {
        rows.push(`<tr class="group"><td colspan="4">${esc(r.group)}</td></tr>`);
        lastGroup = r.group;
      }
      const detail = [];
      if (r.error?.message) detail.push(`<div class="err">${esc(r.error.message)}</div>`);
      if (r.diag) detail.push(diagBlock(r.diag));
      if (r.shot) detail.push(await imgTag(r.shot, shotBase));
      rows.push(`<tr class="case ${r.status}">
        <td class="st">${badge(r.status)}</td>
        <td class="nm">${esc(r.name)}</td>
        <td class="ms">${r.ms}ms</td>
        <td class="dt">${detail.join('')}</td>
      </tr>`);
    }
    specSections.push(`
      <section class="spec">
        <h2>${esc(spec.spec || 'spec')} <span class="muted">${spec.passed}/${spec.total - (spec.skipped || 0)} 通过 · ${((spec.durationMs || 0) / 1000).toFixed(1)}s</span></h2>
        <table>
          <thead><tr><th>状态</th><th>用例</th><th>耗时</th><th>详情</th></tr></thead>
          <tbody>${rows.join('')}</tbody>
        </table>
      </section>`);
  }

  const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Moli E2E 测试报告 · ${esc(summary.generatedAt || '')}</title>
<style>
  :root{ --green:#274E13; --pass:#2e7d32; --fail:#c62828; --skip:#8a8a8a; --bg:#f5f7f4; --card:#fff; --line:#e2e6df; --ink:#1f2a1a; }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;line-height:1.5}
  header{background:linear-gradient(135deg,#274E13,#3f7a1f);color:#fff;padding:28px 32px}
  header h1{margin:0 0 6px;font-size:22px;letter-spacing:.5px}
  header .meta{font-size:13px;opacity:.9}
  .cards{display:flex;gap:16px;flex-wrap:wrap;padding:20px 32px 0}
  .card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px 20px;min-width:120px;box-shadow:0 1px 3px rgba(39,78,19,.06)}
  .card .n{font-size:26px;font-weight:700}
  .card .l{font-size:12px;color:#66705f;margin-top:2px}
  .card.pass .n{color:var(--pass)} .card.fail .n{color:var(--fail)} .card.rate .n{color:var(--green)}
  main{padding:8px 32px 48px}
  .spec{background:var(--card);border:1px solid var(--line);border-radius:12px;margin-top:20px;overflow:hidden}
  .spec h2{margin:0;padding:14px 18px;font-size:15px;background:#eef2ea;border-bottom:1px solid var(--line)}
  .spec h2 .muted{font-weight:400;color:#66705f;font-size:12px;margin-left:8px}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th{text-align:left;padding:9px 14px;background:#f7f9f5;color:#55604d;font-weight:600;border-bottom:1px solid var(--line)}
  td{padding:9px 14px;border-bottom:1px solid #f0f2ee;vertical-align:top}
  tr.group td{background:#fafbf9;font-weight:600;color:var(--green);font-size:12px;letter-spacing:.3px}
  td.st{width:66px} td.ms{width:74px;color:#7a8471;font-variant-numeric:tabular-nums}
  td.dt{color:#4a5443}
  .badge{display:inline-block;padding:2px 9px;border-radius:999px;font-size:12px;color:#fff}
  .b-pass{background:var(--pass)} .b-fail{background:var(--fail)} .b-skip{background:var(--skip)}
  .err{color:var(--fail);margin-bottom:6px}
  .diag{background:#fff8f8;border:1px solid #f2d7d7;border-radius:8px;padding:8px 10px;margin:6px 0;font-size:12px}
  .diag b{color:#8a3b3b}
  .diag pre{margin:4px 0 0;white-space:pre-wrap;word-break:break-word;color:#5a4a4a}
  .shot img{max-width:520px;border:1px solid var(--line);border-radius:8px;margin-top:6px;display:block}
  footer{padding:18px 32px;color:#8a947f;font-size:12px}
</style>
</head>
<body>
<header>
  <h1>Moli E2E 网页自动化测试报告</h1>
  <div class="meta">生成时间 ${esc(summary.generatedAt || '')} · 端点 ${esc(summary.endpoint || '')} · 目标 ${esc(
    summary.baseURL || '(页面自包含)',
  )} · 拟人模式 ${summary.human ? '开启' : '关闭'} · 总耗时 ${durSec}s</div>
</header>
<div class="cards">
  <div class="card"><div class="n">${totals.total}</div><div class="l">用例总数</div></div>
  <div class="card pass"><div class="n">${totals.passed}</div><div class="l">通过</div></div>
  <div class="card fail"><div class="n">${totals.failed}</div><div class="l">失败</div></div>
  <div class="card"><div class="n">${totals.skipped || 0}</div><div class="l">跳过</div></div>
  <div class="card rate"><div class="n">${passRate}</div><div class="l">通过率</div></div>
</div>
<main>${specSections.join('')}</main>
<footer>由 moli-e2e-test skill 生成 · Moli 无头浏览器 + Playwright CDP</footer>
</body>
</html>`;

  const reportFile = path.join(dir, 'report.html');
  await fsp.writeFile(reportFile, html, 'utf8');
  await fsp.writeFile(path.join(dir, 'report.json'), JSON.stringify(summary, null, 2), 'utf8');
  return reportFile;
}
