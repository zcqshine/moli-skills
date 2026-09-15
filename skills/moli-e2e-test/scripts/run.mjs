/**
 * moli-e2e-test · 用例编排器（CLI）
 *
 * 用法：
 *   node run.mjs [spec.mjs | 目录 ...] [--base-url URL] [--endpoint URL]
 *                [--report-dir DIR] [--no-human] [--shots always|on-failure|off]
 *                [--timeout MS] [--list]
 *
 * 通常由 scripts/run.sh 调用（它负责确保 Moli 服务与依赖就绪）。
 * spec 文件需 default 导出一个注册函数：export default (session) => { ... }
 */
import path from 'node:path';
import fsp from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createSession, defaultConfig, SKILL_DIR } from './harness.mjs';
import { writeReport } from './report.mjs';

/* ---------- 参数解析 ---------- */
function parseArgs(argv) {
  const out = { specs: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--no-human') out.flags.human = false;
    else if (a === '--list') out.flags.list = true;
    else if (a.startsWith('--')) {
      const key = a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      out.flags[key] = argv[++i];
    } else out.specs.push(a);
  }
  return out;
}

async function discoverSpecs(inputs) {
  const files = [];
  for (const p of inputs) {
    const abs = path.resolve(p);
    let st;
    try {
      st = await fsp.stat(abs);
    } catch {
      console.error(`[moli-e2e] 找不到: ${p}`);
      process.exit(2);
    }
    if (st.isDirectory()) {
      const entries = await fsp.readdir(abs, { withFileTypes: true });
      for (const e of entries) {
        if (e.isFile() && /\.spec\.mjs$/.test(e.name)) files.push(path.join(abs, e.name));
      }
    } else {
      files.push(abs);
    }
  }
  return files;
}

/* ---------- 主流程 ---------- */
async function main() {
  const { specs: specInputs, flags } = parseArgs(process.argv.slice(2));

  const cfg = {
    ...defaultConfig,
    baseURL: flags.baseUrl ?? defaultConfig.baseURL,
    endpoint: flags.endpoint ?? defaultConfig.endpoint,
    reportDir: flags.reportDir ? path.resolve(flags.reportDir) : defaultConfig.reportDir,
    human: flags.human === false ? false : defaultConfig.human,
    screenshots: flags.shots ?? defaultConfig.screenshots,
    timeout: flags.timeout ? Number(flags.timeout) : defaultConfig.timeout,
  };

  let specFiles = specInputs.length
    ? await discoverSpecs(specInputs)
    : [path.join(SKILL_DIR, 'scripts', 'self-test.spec.mjs')];

  if (flags.list) {
    console.log(specFiles.map((f) => path.relative(process.cwd(), f)).join('\n'));
    return 0;
  }
  if (!specFiles.length) {
    console.error('[moli-e2e] 未找到任何 .spec.mjs 用例文件');
    return 2;
  }

  console.log(`[moli-e2e] 端点 ${cfg.endpoint}`);
  console.log(`[moli-e2e] 目标 ${cfg.baseURL || '(页面自包含)'}`);
  console.log(`[moli-e2e] 拟人 ${cfg.human ? '开启' : '关闭'} · 截图 ${cfg.screenshots} · 用例文件 ${specFiles.length} 个`);

  let browser = null;
  const specSummaries = [];
  const t0 = Date.now();

  for (const file of specFiles) {
    const rel = path.relative(process.cwd(), file);
    console.log(`\n══════ 用例文件: ${rel} ══════`);
    let mod;
    try {
      mod = await import(pathToFileURL(file).href);
    } catch (e) {
      console.error(`[moli-e2e] 加载失败: ${rel}\n${e.stack}`);
      specSummaries.push({
        spec: rel,
        total: 1,
        passed: 0,
        failed: 1,
        skipped: 0,
        durationMs: 0,
        results: [
          { group: '加载', name: '加载用例文件', status: 'failed', ms: 0, error: { message: String(e.message || e) }, shot: null, diag: null },
        ],
      });
      continue;
    }
    const register = mod.default || mod.register;
    if (typeof register !== 'function') {
      console.error(`[moli-e2e] ${rel} 未 default 导出注册函数`);
      continue;
    }

    const session = await createSession(cfg, browser);
    browser = session.browser;
    await register(session);
    const s = await session.run();
    await session.close();
    s.spec = rel;
    specSummaries.push(s);
  }

  if (browser) {
    try {
      await browser.close();
    } catch {
      /* ignore */
    }
  }

  const totals = {
    total: specSummaries.reduce((n, s) => n + s.total, 0),
    passed: specSummaries.reduce((n, s) => n + s.passed, 0),
    failed: specSummaries.reduce((n, s) => n + s.failed, 0),
    skipped: specSummaries.reduce((n, s) => n + s.skipped, 0),
  };
  const summary = {
    generatedAt: new Date().toISOString(),
    endpoint: cfg.endpoint,
    baseURL: cfg.baseURL,
    human: cfg.human,
    durationMs: Date.now() - t0,
    totals,
    specs: specSummaries,
  };

  const reportFile = await writeReport(summary, cfg);

  console.log('\n══════ 汇总 ══════');
  console.log(`用例 ${totals.total} · 通过 ${totals.passed} · 失败 ${totals.failed} · 跳过 ${totals.skipped} · 耗时 ${(summary.durationMs / 1000).toFixed(1)}s`);
  console.log(`报告: ${reportFile}`);

  return totals.failed > 0 ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error(`[moli-e2e] 运行异常: ${e && e.stack ? e.stack : e}`);
    process.exit(1);
  });
