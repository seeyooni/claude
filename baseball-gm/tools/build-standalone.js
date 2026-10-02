#!/usr/bin/env node
/**
 * 단일 HTML 빌드 — index.html 의 <script src="gm-*.js"> 를 모두 인라인해서
 * 파일 하나만으로 실행되는 dist/kbo-gm.html 을 만든다. (게임 내 '단일 index.html 다운로드'와 같은 결과)
 *
 *   node tools/build-standalone.js [출력 경로]
 */
"use strict";
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const out = path.resolve(process.argv[2] || path.join(root, "dist", "kbo-gm.html"));
let html = fs.readFileSync(path.join(root, "index.html"), "utf8");
let count = 0;
html = html.replace(/<script src="(gm-[\w-]+\.js)"><\/script>/g, (_, file) => {
  const code = fs.readFileSync(path.join(root, file), "utf8").replace(/<\/script/gi, "<\\/script");
  count += 1;
  return `<script>/* ${file} */\n${code}\n</script>`;
});
if (/<script src="gm-/.test(html)) throw new Error("인라인하지 못한 모듈 스크립트가 남아 있습니다.");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log(`${count}개 모듈 인라인 → ${path.relative(process.cwd(), out)} (${(fs.statSync(out).size / 1024).toFixed(0)} KB)`);
