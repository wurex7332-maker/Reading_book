import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calculateProgress, calculateReadingOffset, getReadingBlockOffsets, parseChapters, readTextBook, ReaderError } from '../src/reader.js';
import { normalizeReaderSettings } from '../src/storage.js';

test('[AC-1] 导入 UTF-8、BOM UTF-8 与 GBK 并生成稳定书籍标识', async () => {
  const utf8 = await readTextBook(new File(['第一章\n正文'], '故事.TXT'));
  const bom = await readTextBook(new File([new Uint8Array([0xef, 0xbb, 0xbf]), '正文'], '书.txt'));
  const gbk = await readTextBook(new File([new Uint8Array([0xc4, 0xe3, 0xba, 0xc3])], '问候.txt'));
  assert.equal(utf8.title, '故事'); assert.equal(utf8.encoding, 'utf-8'); assert.equal(utf8.bookId, `book:${utf8.contentHash}`); assert.equal(utf8.contentHash.length, 64);
  assert.equal(bom.text, '正文'); assert.equal(gbk.text, '你好'); assert.equal(gbk.encoding, 'gbk');
  assert.equal((await readTextBook(new File(['第一章\n正文'], '另一个名字.txt'))).bookId, utf8.bookId);
});

test('[AC-1] 非 TXT、超限、空白、损坏读取返回稳定错误码', async () => {
  const cases = [
    [new File(['x'], 'book.pdf'), 'UNSUPPORTED_FILE_TYPE', '请选择 TXT 文件。'],
    [new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'book.txt'), 'FILE_TOO_LARGE', '请选择不超过 5 MB 的 TXT 文件。'],
    [new File([' \n'], 'book.txt'), 'EMPTY_BOOK', '文件没有可阅读的内容。'],
    [new File([new Uint8Array([0x81])], 'book.txt'), 'UNSUPPORTED_ENCODING', '无法识别文本编码，仅支持 UTF-8 或 GBK。'],
    [{ name:'book.txt', size:1, arrayBuffer:async () => { throw new Error('broken'); } }, 'FILE_READ_FAILED', '无法读取文件，请重新选择。'],
  ];
  for (const [file, code, message] of cases) {
    await assert.rejects(
      readTextBook(file),
      (error) => error instanceof ReaderError && error.code === code && error.message === message,
    );
  }
});

test('[AC-2] 章节标题和空行分段生成精确且有上限的目录', () => {
  const text = '序言\n\n第一章 开始\n正文\n第12回\n内容\n第二卷 标题\n尾声';
  const chapters = parseChapters(text);
  assert.deepEqual(chapters.map(({ title, offset }) => ({ title, offset })), [
    { title:'第一章 开始', offset:text.indexOf('第一章') }, { title:'第12回', offset:text.indexOf('第12回') }, { title:'第二卷 标题', offset:text.indexOf('第二卷') },
  ]);
  const sections = parseChapters(`  ${'首段标题'.repeat(12)}\r\n正文\r\n\r\n\r\n第二段`);
  assert.equal([...sections[0].title].length, 30); assert.equal(sections.length, 2); assert.ok(parseChapters(Array.from({ length:600 }, (_, index) => `段落${index}`).join('\n\n')).length <= 500);
});

test('[AC-2] 阅读分块保留第一章之前的序言和全部正文', () => {
  const text = '序言内容\n\n第一章 开始\n正文\n第二章 继续\n尾声';
  const chapters = parseChapters(text);
  const offsets = getReadingBlockOffsets(chapters, text.length);
  const rendered = offsets
    .map((offset, index) => text.slice(offset, offsets[index + 1] ?? text.length))
    .join('');

  assert.equal(offsets[0], 0);
  assert.equal(rendered, text);
});

test('[AC-5] 损坏或越界排版设置会被钳制并回退主题', () => {
  assert.deepEqual(normalizeReaderSettings({ fontSize:99, lineHeight:0, theme:'unknown' }), { fontSize:32, lineHeight:1.4, theme:'day' });
  assert.deepEqual(normalizeReaderSettings(null), { fontSize:18, lineHeight:1.8, theme:'day' });
});

test('[AC-6] 阅读进度四舍五入并限制在有效范围', () => {
  assert.equal(calculateProgress(49, 100), 49); assert.equal(calculateProgress(999, 100), 100); assert.equal(calculateProgress(-1, 100), 0); assert.equal(calculateProgress(3, 0), 0);
  assert.equal(calculateReadingOffset(1000, 2000, 250, 1000), 1500);
  assert.equal(calculateReadingOffset(1000, 2000, -100, 1000), 1000);
  assert.equal(calculateReadingOffset(1000, 2000, 5000, 1000), 3000);
});

test('[AC-9] 接近 5 MB 的确定性文本线性解析且正文保持完整', async () => {
  const paragraph = '这是用于性能验证的固定段落。'.repeat(20); const text = Array.from({ length:5000 }, (_, index) => `${paragraph}${index}`).join('\n\n');
  const book = await readTextBook(new File([text], '大部头.txt'));
  assert.equal(book.text.length, text.length); assert.equal(book.chapters.length, 500);
});
