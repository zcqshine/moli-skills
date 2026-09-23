/**
 * moli-e2e-test · 用例编排器（CLI）
 *
 * 用法：
 *   node run.mjs [spec.mjs | 目录 ...] [--base-url URL] [--endpoint URL]
 *                [--e2e-dir DIR] [--report-dir DIR] [--shots-dir DIR]
 *                [--no-human] [--shots always|on-failure|off]
 *                [--timeout MS] [--list]
 *
 * 产物默认收在项目的 e2e/ 下：e2e/reports（报告）、e2e/screenshots（截图）。
 * 用例建议放在 e2e/specs/；无参数且 e2e/specs 下有用例时自动运行它们。
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
      const eq = a.indexOf('=');
      const rawKey = eq === -1 ? a.slice(2) : a.slice(2, eq);
      const key = rawKey.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      if (eq !== -1) {
        out.flags[key] = a.slice(eq + 1);
      } else {
        // 下一个参数是另一个 flag（或以 -- 开头）时不吞它作为值
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith('--')) {
          out.flags[key] = next;
          i++;
        } else {
          out.flags[key] = '';
        }
      }
    } else out.specs.push(a);
  }
  return out;
}

const SKIP_DIRS = new Set(['node_modules', '.git', '.cache', 'dist', 'build', 'coverage']);

/** 递归收集 *.spec.mjs（跳过依赖/隐藏/构建目录） */
async function walkDir(dir, files) {
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
      await walkDir(path.join(dir, e.name), files);
    } else if (e.isFile() && /\.spec\.mjs$/.test(e.name)) {
      files.push(path.join(dir, e.name));
    }
  }
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
    if (st.isDirectory()) await walkDir(abs, files);
    else files.push(abs);
  }
  return files;
}

/* ---------- 主流程 ---------- */
async function main() {
  const { specs: specInputs, flags } = parseArgs(process.argv.slice(2));

  const e2eDir = flags.e2eDir ? path.resolve(flags.e2eDir) : defaultConfig.e2eDir;
  const cfg = {
    ...defaultConfig,
    e2eDir,
    baseURL: flags.baseUrl || defaultConfig.baseURL,
    endpoint: flags.endpoint || defaultConfig.endpoint,
    // 显式 flag > 由 --e2e-dir 派生 > 环境变量/默认（保持一致，不再压掉 REPORT_DIR/SHOTS_DIR）
    reportDir: flags.reportDir
      ? path.resolve(flags.reportDir)
      : flags.e2eDir
        ? path.join(e2eDir, 'reports')
        : defaultConfig.reportDir,
    screenshotDir: flags.shotsDir
      ? path.resolve(flags.shotsDir)
      : flags.e2eDir
        ? path.join(e2eDir, 'screenshots')
        : defaultConfig.screenshotDir,
    human: flags.human === false ? false : defaultConfig.human,
    screenshots: flags.shots || defaultConfig.screenshots,
    timeout: flags.timeout ? Number(flags.timeout) : defaultConfig.timeout,
  };
  if (!Number.isFinite(cfg.timeout) || cfg.timeout <= 0) cfg.timeout = defaultConfig.timeout;

  let specFiles;
  if (specInputs.length) {
    specFiles = await discoverSpecs(specInputs);
  } else {
    // 无参数时：若项目根 e2e/specs 下有用例，自动跑它们；否则跑内置自检
    const auto = path.join(e2eDir, 'specs');
    let autoFiles = [];
    try {
      const st = await fsp.stat(auto);
      if (st.isDirectory()) autoFiles = await discoverSpecs([auto]);
    } catch {
      /* 目录不存在 */
    }
    specFiles = autoFiles.length
      ? autoFiles
      : [path.join(SKILL_DIR, 'scripts', 'self-test.spec.mjs')];
  }

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

  const failedSummary = (rel, where, msg) => ({
    spec: rel,
    total: 1,
    passed: 0,
    failed: 1,
    skipped: 0,
    durationMs: 0,
    results: [
      { group: where, name: `执行用例文件`, status: 'failed', ms: 0, error: { message: String(msg) }, shot: null, diag: null, steps: [] },
    ],
  });

  try {
    for (const file of specFiles) {
      const rel = path.relative(process.cwd(), file);
      console.log(`\n══════ 用例文件: ${rel} ══════`);
      let mod;
      try {
        mod = await import(pathToFileURL(file).href);
      } catch (e) {
        console.error(`[moli-e2e] 加载失败: ${rel}\n${e && e.stack ? e.stack : e}`);
        specSummaries.push(failedSummary(rel, '加载', (e && e.message) || e));
        continue;
      }
      const register = mod.default || mod.register;
      if (typeof register !== 'function') {
        console.error(`[moli-e2e] ${rel} 未 default 导出注册函数`);
        specSummaries.push(failedSummary(rel, '注册', 'spec 未 default 导出注册函数'));
        continue;
      }

      // 单个 spec 的注册/执行异常必须隔离：否则后续不跑、报告不生成、浏览器不关
      let session = null;
      try {
        session = await createSession(cfg, browser);
        browser = session.browser;
        await register(session);
        const s = await session.run();
        await session.close();
        session = null;
        s.spec = rel;
        specSummaries.push(s);
      } catch (e) {
        console.error(`[moli-e2e] 运行异常: ${rel}\n${e && e.stack ? e.stack : e}`);
        if (session) {
          try {
            await session.close();
          } catch {
            /* ignore */
          }
        }
        specSummaries.push(failedSummary(rel, '运行', (e && e.message) || e));
      }
    }
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {
        /* ignore */
      }
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
