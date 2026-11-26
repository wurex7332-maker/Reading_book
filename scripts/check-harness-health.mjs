import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(ROOT_DIR, 'harness.config.json');

let maxSkillChars = 7800;
let errors = 0;

function fail(message) {
  console.error(`❌ ${message}`);
  errors += 1;
}

console.log('🔍 Running Harness Health Check...');

const requiredFiles = [
  'AGENTS.md',
  'harness.config.json',
  'scripts/gate.mjs',
  'scripts/check-harness-health.mjs',
  'scripts/check-gate-integrity.mjs',
  'scripts/check-review.mjs',
  'docs/architecture/overview.md',
];

for (const rel of requiredFiles) {
  if (!fs.existsSync(path.join(ROOT_DIR, rel))) {
    fail(`缺少必需基座文件: ${rel}`);
  }
}

if (fs.existsSync(CONFIG_PATH)) {
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    if (typeof cfg.maxSkillChars === 'number' && cfg.maxSkillChars > 0) {
      maxSkillChars = cfg.maxSkillChars;
    }
  } catch (err) {
    fail(`harness.config.json 格式非法: ${err.message}`);
  }
}

const skillsRoot = path.join(ROOT_DIR, '.agents', 'skills');

function findNestedSkillFiles(dir, depth = 0, found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      findNestedSkillFiles(full, depth + 1, found);
    } else if (entry.isFile() && entry.name === 'SKILL.md' && depth >= 2) {
      found.push(path.relative(ROOT_DIR, full));
    }
  }
  return found;
}

if (!fs.existsSync(skillsRoot)) {
  fail('缺少技能目录: .agents/skills');
} else {
  const nested = findNestedSkillFiles(skillsRoot);
  if (nested.length > 0) {
    fail(`检测到多层嵌套的 SKILL.md:\n   ${nested.join('\n   ')}`);
  }

  const dirs = fs
    .readdirSync(skillsRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name));

  if (dirs.length === 0) {
    fail('.agents/skills/ 下至少应保留 1 个有效技能');
  }

  for (const dir of dirs) {
    const skillName = dir.name;
    const skillFile = path.join(skillsRoot, skillName, 'SKILL.md');
    const relSkillFile = `.agents/skills/${skillName}/SKILL.md`;

    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(skillName)) {
      fail(`技能目录名非 kebab-case: ${skillName}`);
    }

    if (!fs.existsSync(skillFile)) {
      fail(`技能目录缺少 SKILL.md: .agents/skills/${skillName}/`);
      continue;
    }

    const normalized = fs.readFileSync(skillFile, 'utf8').replace(/\r\n/g, '\n');
    const lines = normalized.split('\n');

    if (lines[0] !== '---') {
      fail(`${relSkillFile} 缺少 YAML frontmatter 起始分隔符 (---)`);
    } else {
      const closingIdx = lines.indexOf('---', 1);
      if (closingIdx === -1) {
        fail(`${relSkillFile} 缺少 YAML frontmatter 结束分隔符 (---)`);
      } else {
        const frontmatter = lines.slice(1, closingIdx);
        const hasName = frontmatter.some((l) =>
          new RegExp(`^name:\\s*${skillName}\\s*$`).test(l),
        );
        const hasDesc = frontmatter.some((l) => /^description:\s*.+/.test(l));
        if (!hasName) fail(`${relSkillFile} name 与目录名不匹配（期望: ${skillName}）`);
        if (!hasDesc) fail(`${relSkillFile} 缺少 description 字段`);
      }
    }

    const charCount = [...normalized].length;
    if (charCount > maxSkillChars) {
      fail(`${relSkillFile} 字符数超限 (${charCount} > ${maxSkillChars})`);
    } else {
      console.log(`  ✓ skill/${skillName} (${charCount}/${maxSkillChars} chars)`);
    }
  }
}

if (errors > 0) {
  console.error(`❌ Harness 健康度校验失败（共 ${errors} 项错误）`);
  process.exit(1);
}

console.log('✅ Harness 健康度校验通过。');
