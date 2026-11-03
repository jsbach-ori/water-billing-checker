// 静的チェック（38件とは別に数える）：外部通信がないこと（受け入れ基準6）、CLAUDE.md の決まり、公開の準備
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RATE_SOURCES } from '../js/settings.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => readFileSync(join(root, rel), 'utf8');
const list = dir => readdirSync(join(root, dir)).filter(f => f.endsWith('.js')).map(f => `${dir}/${f}`);
const appFiles = [...list('js'), ...list('data')];
const allFiles = [...appFiles, 'index.html', 'css/style.css'];

// 出典の2つのURLだけは、利用者がクリックしたときに開くリンクとして許可する
const ALLOWED_URLS = new Set(RATE_SOURCES.map(s => s.url));

describe('外部通信がない（受け入れ基準6）', () => {
  test('通信に使うAPIを使っていない', () => {
    const banned = /\bfetch\s*\(|XMLHttpRequest|sendBeacon|new\s+WebSocket|EventSource|importScripts|navigator\.serviceWorker/;
    for (const f of appFiles) assert.doesNotMatch(read(f), banned, f);
  });

  test('外部URLは出典の2つだけ（コメントの出典を含む）', () => {
    for (const f of allFiles) {
      for (const url of read(f).match(/(?:https?:)?\/\/[\w.-]+\.[a-z]{2,}[^\s"'`)<>]*/gi) ?? []) {
        assert.ok(ALLOWED_URLS.has(url), `${f}: ${url}`);
      }
    }
  });

  test('HTMLは同じフォルダのファイルだけを読み込む（CDN・外部フォントなし）', () => {
    const html = read('index.html');
    const refs = [...html.matchAll(/\b(?:src|href)="([^"]+)"/g)].map(m => m[1]);
    assert.ok(refs.length > 0);
    for (const ref of refs) assert.match(ref, /^(?!\/|[a-z]+:)[\w./-]+$/i, ref);
  });

  test('CSSは外部のファイル・フォントを読み込まない', () => {
    const css = read('css/style.css');
    assert.doesNotMatch(css, /@import|url\(|@font-face/);
  });

  test('import は相対パスだけ（GitHub Pages のサブフォルダでも動く）', () => {
    for (const f of appFiles) {
      for (const m of read(f).matchAll(/^\s*(?:import|export)\b[^'"]*?from\s+['"]([^'"]+)['"]/gm)) {
        assert.match(m[1], /^\.\.?\//, `${f}: ${m[1]}`);
      }
    }
  });
});

describe('CLAUDE.md の決まり', () => {
  test('localStorage を読み書きするのは store.js だけ', () => {
    for (const f of appFiles) {
      if (f === 'js/store.js') continue;
      assert.doesNotMatch(read(f), /localStorage/, f);
    }
  });

  test('金額の計算に「* 1.1」を使わない', () => {
    for (const f of appFiles) assert.doesNotMatch(read(f), /\*\s*1\.1\b/, f);
  });

  test('初期データは架空（住所は「〇〇区」、お客様番号は 000000000x）', () => {
    const src = read('data/sample.js');
    for (const m of src.matchAll(/address: '([^']*)'/g)) assert.match(m[1], /〇〇区/);
    for (const m of src.matchAll(/customerNo: '([^']*)'/g)) assert.match(m[1], /^0{9}\d$/);
  });
});

describe('公開の準備', () => {
  test('.nojekyll と README.md がある', () => {
    assert.ok(existsSync(join(root, '.nojekyll')));
    assert.ok(existsSync(join(root, 'README.md')));
  });
});
