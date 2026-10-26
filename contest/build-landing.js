#!/usr/bin/env node
/**
 * 把 contest/site/index.html + engine.js 打包成自包含单文件 contest/landing.html
 * 用途：资料库页面（只接受单个 html 文件）需要内联全部脚本。
 * 用法: node contest/build-landing.js
 */
"use strict";
const fs = require("fs");
const path = require("path");

const dir = __dirname;
const html = fs.readFileSync(path.join(dir, "site", "index.html"), "utf8");
const engine = fs.readFileSync(path.join(dir, "site", "engine.js"), "utf8");

const tag = '<script src="engine.js" defer></script>';
if (!html.includes(tag)) {
  console.error("✗ 未找到 engine.js 引用标签，index.html 结构可能已变更");
  process.exit(1);
}

const inlined = html.replace(tag, `<script>\n${engine}\n</script>`);
const out = path.join(dir, "landing.html");
fs.writeFileSync(out, inlined);
console.log(`✓ 已生成单文件版: ${out} (${(inlined.length / 1024).toFixed(1)} KB)`);
