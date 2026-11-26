import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(ROOT_DIR, 'harness.config.json');

let artifactsDir = 'artifacts';
if (fs.existsSync(CONFIG_PATH)) {
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    if (cfg.artifactsDir) artifactsDir = cfg.artifactsDir;
  } catch {
    // ignore
  }
}

const customPath = process.argv[2];
const reviewPath = customPath
  ? path.resolve(ROOT_DIR, customPath)
  : path.join(ROOT_DIR, artifactsDir, 'review.md');

if (!fs.existsSync(reviewPath)) {
  console.error(`❌ [check-review] 缺少独立评审报告: ${path.relative(ROOT_DIR, reviewPath)}`);
  process.exit(1);
}

const raw = fs.readFileSync(reviewPath, 'utf8').replace(/\r\n/g, '\n').trim();
if (raw.length < 60) {
  console.error('❌ [check-review] 评审报告内容过短，疑似未执行有效审查。');
  process.exit(1);
}

const verdictLines = raw
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => /^VERDICT:\s*(PASS|BLOCK)$/.test(line));

if (verdictLines.length === 0) {
  console.error('❌ [check-review] 评审报告缺少标准裁决行（VERDICT: PASS 或 VERDICT: BLOCK）。');
  process.exit(1);
}

const hasBlock = verdictLines.some((line) => line === 'VERDICT: BLOCK');
const finalVerdict = verdictLines[verdictLines.length - 1];

if (hasBlock || finalVerdict !== 'VERDICT: PASS') {
  console.error(`❌ [check-review] 独立评审未通过（裁决: ${finalVerdict}），请打回修复。`);
  process.exit(1);
}

console.log(`✅ [check-review] 独立评审裁决通过 (${path.relative(ROOT_DIR, reviewPath)} -> VERDICT: PASS)。`);
