import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(ROOT_DIR, 'harness.config.json');

function git(args) {
  return spawnSync('git', args, {
    cwd: ROOT_DIR,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
}

function globToRegExp(glob) {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '__DOUBLE_STAR__')
    .replace(/\*/g, '[^/]*')
    .replace(/__DOUBLE_STAR__/g, '.*');
  return new RegExp(`^${escaped}$`);
}

function matchesAny(filePath, patterns) {
  const normalized = filePath.replace(/\\/g, '/');
  return patterns.some((p) => globToRegExp(p).test(normalized));
}

if (git(['rev-parse', '--is-inside-work-tree']).status !== 0) {
  console.log('[anti-bypass] 当前目录尚未初始化 Git 仓库，跳过 diff 比对。');
  process.exit(0);
}

let baseRef = null;
for (const candidate of ['origin/main', 'main', 'HEAD~1']) {
  if (git(['rev-parse', '--verify', candidate]).status === 0) {
    baseRef = candidate;
    break;
  }
}

if (!baseRef) {
  console.log('[anti-bypass] 初始仓库尚无历史提交，跳过 diff 比对。');
  process.exit(0);
}

let excludes = [
  'scripts/check-gate-integrity.mjs',
  '*.md',
  '.agents/**',
  'docs/**',
  '**/types/generated/**',
];
let protectedPaths = [
  'AGENTS.md',
  'harness.config.json',
  'scripts/**',
  '.github/workflows/**',
];

if (fs.existsSync(CONFIG_PATH)) {
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    if (Array.isArray(cfg.antiBypassExclude) && cfg.antiBypassExclude.length > 0) {
      excludes = cfg.antiBypassExclude;
    }
    if (Array.isArray(cfg.protectedPaths) && cfg.protectedPaths.length > 0) {
      protectedPaths = cfg.protectedPaths;
    }
  } catch {
    // validated by check-harness-health.mjs
  }
}

const changedTracked = (git(['diff', '--name-only', baseRef]).stdout || '')
  .split(/\r?\n/)
  .map((s) => s.trim())
  .filter(Boolean);

const untracked = (git(['ls-files', '--others', '--exclude-standard']).stdout || '')
  .split(/\r?\n/)
  .map((s) => s.trim())
  .filter(Boolean);

const touchedProtected = [...new Set([...changedTracked, ...untracked])].filter(
  (file) => matchesAny(file, protectedPaths),
);

if (touchedProtected.length > 0) {
  if (process.env.ALLOW_HARNESS_EDIT === '1') {
    console.log(
      `⚠️ [anti-tamper] ALLOW_HARNESS_EDIT=1 已开启，放行受保护基座文件变更: ${touchedProtected.join(', ')}`,
    );
  } else {
    console.error('❌ [anti-tamper] 检测到未经授权修改门禁基座文件，已阻断：');
    for (const f of touchedProtected) {
      console.error(`  - ${f}`);
    }
    console.error(
      '\n严禁 Agent 修改门禁脚本、配置或 CI。人工维护请执行：ALLOW_HARNESS_EDIT=1 node scripts/gate.mjs gate-harness',
    );
    process.exit(1);
  }
}

const diffRes = git([
  'diff',
  '-U0',
  baseRef,
  '--',
  '.',
  ...excludes.map((pattern) => `:(exclude)${pattern}`),
]);

if (diffRes.status !== 0) {
  console.error(`❌ [anti-bypass] git diff 执行失败:\n${diffRes.stderr}`);
  process.exit(1);
}

const FORBIDDEN_PATTERN =
  /(@ts-ignore|@ts-nocheck|@ts-expect-error|eslint-disable|istanbul ignore|c8 ignore|v8 ignore|# noqa|# type: ignore|\.(only|skip)\(|xit\(|xdescribe\(|@pytest\.mark\.skip)/;

const violations = [];
let currentFile = '(unknown)';

for (const line of (diffRes.stdout || '').split(/\r?\n/)) {
  if (line.startsWith('+++ b/')) {
    currentFile = line.slice(6);
    continue;
  }
  if (line.startsWith('+') && !line.startsWith('+++')) {
    const addedContent = line.slice(1);
    if (FORBIDDEN_PATTERN.test(addedContent)) {
      violations.push({ file: currentFile, line: addedContent.trim() });
    }
  }
}

if (violations.length > 0) {
  console.error('❌ [anti-bypass] 检测到疑似绕过门禁的新增代码，已阻断：');
  for (const v of violations) {
    console.error(`  - ${v.file}: ${v.line}`);
  }
  console.error('\n请修复根因，禁止使用忽略指令或跳过测试。');
  process.exit(1);
}

console.log('✅ [anti-bypass] 未检测到基座篡改或绕过门禁行为。');
