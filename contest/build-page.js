#!/usr/bin/env node
/**
 * 构建自包含页面：contest/page.template.html + contest/engine.js → contest/site/index.html
 *
 * 为什么内联：发布后的站点整站需要 sharecode 才能访问，外部 <script src> 请求一旦
 * 拿不到凭证返回 403，规则引擎就加载失败。单文件可以彻底规避这个问题，
 * 资料库页面也只接受单个 html 文件，因此统一用这份产物。
 *
 * 用法: node contest/build-page.js
 */
"use strict";
const fs = require("fs");
const path = require("path");

const dir = __dirname;
const tpl = fs.readFileSync(path.join(dir, "page.template.html"), "utf8");
const engine = fs.readFileSync(path.join(dir, "engine.js"), "utf8");

const tag = '<script src="engine.js" defer></script>';
if (!tpl.includes(tag)) {
  console.error("✗ 模板中未找到 engine.js 引用标签，结构可能已变更");
  process.exit(1);
}

const out = tpl.replace(tag, `<script>\n${engine}\n</script>`);
const dest = path.join(dir, "site", "index.html");
fs.writeFileSync(dest, out);
console.log(`✓ 已生成自包含页面: ${dest} (${(out.length / 1024).toFixed(1)} KB)`);
