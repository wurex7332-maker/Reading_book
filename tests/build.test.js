import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

test('[AC-10] 构建产物包含全部本地阅读模块且引用可解析', async () => {
  const files = await Promise.all(['index.html','styles.css','main.js','reader.js','storage.js'].map((name) => readFile(new URL(`../dist/${name}`, import.meta.url), 'utf8')));
  assert.match(files[0], /src="\.\/main\.js"/); assert.match(files[2], /from '\.\/reader\.js'/); assert.match(files[2], /from '\.\/storage\.js'/);
});

test('[AC-3] [AC-7] 构建产物包含书架移除与按书书签的原子存储路径', async () => {
  const source = await readFile(new URL('../dist/storage.js', import.meta.url), 'utf8');
  assert.match(source, /\['books', 'progress', 'bookmarks'\]/); assert.match(source, /index\('bookId'\)/); assert.match(source, /deleteBookmark/);
});

test('[AC-4] [AC-5] [AC-6] [AC-8] 阅读界面提供翻屏、设置、续读和持久化入口', async () => {
  const [html, main] = await Promise.all([readFile(new URL('../dist/index.html', import.meta.url), 'utf8'), readFile(new URL('../dist/main.js', import.meta.url), 'utf8')]);
  for (const id of ['previous-page','next-page','font-size','line-height','theme','toggle-bookmark']) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(html, /class="visually-hidden" type="file"/);
  assert.match(main, /PageDown/); assert.match(main, /visibilitychange/); assert.match(main, /pagehide/); assert.match(main, /textContent/); assert.doesNotMatch(main, /innerHTML/);
});
