import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

test('[AC-2] 构建产物保留页面入口和可用的 TXT 读取模块', async () => {
  const html = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
  const script = html.match(/<script type="module" src="\.\/(.+?)"><\/script>/)?.[1];
  assert.ok(script);
  const source = await readFile(new URL(`../dist/${script}`, import.meta.url), 'utf8');
  assert.match(source, /from '\.\/reader\.js'/);
  const { readTextBook } = await import('../dist/reader.js');
  const book = await readTextBook(new File(['第一页'], '测试.txt'));
  assert.deepEqual(book, { title: '测试', text: '第一页' });
});
