import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readTextBook } from '../src/reader.js';

test('[AC-1] 读取 UTF-8 文本并保留换行', async () => {
  const file = new File(['第一章\n初次见面'], '故事.TXT');
  const book = await readTextBook(file);
  assert.deepEqual(book, { title: '故事', text: '第一章\n初次见面' });
});

test('[AC-1] 拒绝非 TXT 和空白文件', async () => {
  await assert.rejects(readTextBook(new File(['data'], 'book.pdf')), /选择 TXT 文件/);
  await assert.rejects(readTextBook(new File([' \n'], 'book.txt')), /文件没有可阅读的内容/);
});

test('[AC-1] 提示用户转换无法解码的文件', async () => {
  const file = new File([new Uint8Array([0xff])], 'book.txt');
  await assert.rejects(readTextBook(file), /请将文件另存为 UTF-8 编码/);
});
