import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(ROOT_DIR, 'harness.config.json');

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    console.error('❌ 缺少基座配置文件: harness.config.json');
    process.exit(1);
  }
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch (err) {
    console.error(`❌ harness.config.json 解析失败: ${err.message}`);
    process.exit(1);
  }
}

function ensureArtifactsDir(config) {
  fs.mkdirSync(path.join(ROOT_DIR, config.artifactsDir || 'artifacts'), {
    recursive: true,
  });
}

function runNodeScript(scriptName, extraArgs = []) {
  const res = spawnSync(
    process.execPath,
    [path.join(__dirname, scriptName), ...extraArgs],
    { cwd: ROOT_DIR, stdio: 'inherit' },
  );
  if (res.status !== 0) process.exit(res.status ?? 1);
}

function runSecretScan() {
  const res = spawnSync(
    'gitleaks',
    ['detect', '--source', '.', '--no-banner', '--redact'],
    { cwd: ROOT_DIR, stdio: 'inherit' },
  );
  if (res.error && res.error.code === 'ENOENT') {
    console.error('❌ 未检测到 gitleaks，请先安装。');
    process.exit(1);
  }
  if (res.status !== 0) process.exit(res.status ?? 1);
}

function runConfiguredCommand(config, key, { optional = false } = {}) {
  const cmd = (config.commands?.[key] ?? '').trim();
  if (!cmd) {
    if (optional) {
      console.log(`⚠️ harness.config.json 未配置 commands.${key}，已跳过`);
      return;
    }
    console.error(`❌ 请先在 harness.config.json 的 commands.${key} 中绑定真实命令`);
    process.exit(1);
  }
  console.log(`\n▶ [${key}] ${cmd}`);
  const res = spawnSync(cmd, { cwd: ROOT_DIR, stdio: 'inherit', shell: true });
  if (res.status !== 0) process.exit(res.status ?? 1);
}

const config = loadConfig();
const target = process.argv[2];
const extraArgs = process.argv.slice(3);

const TARGETS = {
  'harness-health': () => runNodeScript('check-harness-health.mjs'),
  'secret-scan': () => runSecretScan(),
  'anti-bypass': () => runNodeScript('check-gate-integrity.mjs'),
  'check-review': () => runNodeScript('check-review.mjs', extraArgs),
  'gate-harness': () => {
    TARGETS['harness-health']();
    TARGETS['secret-scan']();
    TARGETS['anti-bypass']();
    console.log('\n✅ gate-harness 全部通过');
  },
  lint: () => runConfiguredCommand(config, 'lint'),
  typecheck: () => runConfiguredCommand(config, 'typecheck'),
  'test-unit': () => {
    ensureArtifactsDir(config);
    runConfiguredCommand(config, 'testUnit');
  },
  'test-e2e': () => {
    ensureArtifactsDir(config);
    runConfiguredCommand(config, 'testE2e');
  },
  'license-check': () =>
    runConfiguredCommand(config, 'licenseCheck', { optional: true }),
  'docs-verify': () =>
    runConfiguredCommand(config, 'docsVerify', { optional: true }),
  'gate-mvp': () => {
    TARGETS['gate-harness']();
    TARGETS.lint();
    TARGETS.typecheck();
    TARGETS['test-unit']();
    console.log(`\n✅ gate-mvp 全部通过，证据已输出至 ${config.artifactsDir || 'artifacts'}/`);
  },
  'gate-all': () => {
    TARGETS['gate-mvp']();
    TARGETS['license-check']();
    TARGETS['test-e2e']();
    console.log(`\n✅ gate-all 全部通过，证据已输出至 ${config.artifactsDir || 'artifacts'}/`);
  },
};

if (!target || !Object.hasOwn(TARGETS, target)) {
  console.error('用法: node scripts/gate.mjs <target>\n可用: ' + Object.keys(TARGETS).join(', '));
  process.exit(1);
}

TARGETS[target]();
