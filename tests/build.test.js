import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const MODULES = ['index.html', 'styles.css', 'main.js', 'reader.js', 'storage.js'];
const SCRIPT_MODULES = ['main.js', 'reader.js', 'storage.js'];

const distFile = (name) => new URL(`../dist/${name}`, import.meta.url);
const srcFile = (name) => new URL(`../src/${name}`, import.meta.url);

test('[AC-10] dist 包含全部本地阅读模块，且与 src 源码逐字节一致', async () => {
  for (const name of MODULES) {
    const [built, source] = await Promise.all([readFile(distFile(name), 'utf8'), readFile(srcFile(name), 'utf8')]);
    assert.equal(built.length > 0, true, `dist/${name} 不得为空`);
    assert.equal(built, source, `dist/${name} 必须与 src/${name} 完全一致，构建产物即被测代码`);
  }
});

test('[AC-10] 构建产物的模块引用可解析到 dist 内的实际文件', async () => {
  const html = await readFile(distFile('index.html'), 'utf8');
  const entry = /<script[^>]*src="([^"]+)"/.exec(html);
  assert.ok(entry, 'index.html 必须声明模块入口');
  const entryName = entry[1].replace(/^\.\//, '');
  assert.equal(MODULES.includes(entryName), true, `入口 ${entryName} 必须存在于 dist`);

  for (const name of SCRIPT_MODULES) {
    const source = await readFile(distFile(name), 'utf8');
    const specifiers = [...source.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1]);
    for (const specifier of specifiers) {
      assert.equal(specifier.startsWith('./'), true, `${name} 只允许相对模块引用，实际为 ${specifier}`);
      const target = specifier.replace(/^\.\//, '');
      assert.equal(MODULES.includes(target), true, `${name} 引用的 ${target} 必须存在于 dist`);
    }
  }
});

test('[AC-10] 构建产物导出的存储与读取接口可加载且完整', async () => {
  const storage = await import(new URL('../dist/storage.js', import.meta.url).href);
  const expectedStorage = [
    'openLibrary', 'saveBook', 'listBooks', 'getBook', 'removeBook',
    'saveProgress', 'getProgress', 'saveBookmark', 'listBookmarks', 'deleteBookmark',
    'getReaderSettings', 'saveReaderSettings', 'getDeviceId', 'normalizeReaderSettings',
  ];
  for (const name of expectedStorage) {
    assert.equal(typeof storage[name], 'function', `dist/storage.js 缺少可调用导出 ${name}`);
  }

  const reader = await import(new URL('../dist/reader.js', import.meta.url).href);
  for (const name of ['readTextBook', 'parseChapters', 'calculateProgress', 'getReadingBlockOffsets', 'calculateReadingOffset']) {
    assert.equal(typeof reader[name], 'function', `dist/reader.js 缺少可调用导出 ${name}`);
  }
  assert.equal(typeof reader.ReaderError, 'function');
});

test('[AC-1] [AC-2] 构建产物的阅读模块可真实解码、校验并生成目录', async () => {
  const reader = await import(new URL('../dist/reader.js', import.meta.url).href);

  const utf8 = await reader.readTextBook(new File(['第一章 开始\n正文\n第二章 继续\n尾声'], '构建样本.txt'));
  assert.equal(utf8.title, '构建样本');
  assert.equal(utf8.encoding, 'utf-8');
  assert.deepEqual(utf8.chapters.map((chapter) => chapter.title), ['第一章 开始', '第二章 继续']);
  assert.equal(utf8.chapters[1].offset, utf8.text.indexOf('第二章'));

  const gbk = await reader.readTextBook(new File([new Uint8Array([0xc4, 0xe3, 0xba, 0xc3])], '编码.txt'));
  assert.equal(gbk.text, '你好');
  assert.equal(gbk.encoding, 'gbk');

  await assert.rejects(
    reader.readTextBook(new File(['x'], '构建样本.pdf')),
    (error) => error instanceof reader.ReaderError && error.code === 'UNSUPPORTED_FILE_TYPE' && error.message === '请选择 TXT 文件。',
  );
  await assert.rejects(
    reader.readTextBook(new File([' \n'], '空.txt')),
    (error) => error.code === 'EMPTY_BOOK',
  );
});
