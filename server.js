#!/usr/bin/env node
/**
 * gcm GUI 服务端 — 一键启动的本地网页版 commit 生成器
 * 用法: 双击 start.bat 或 `node server.js`，浏览器自动打开 http://localhost:7788
 * 仅监听 127.0.0.1，零依赖。
 */
"use strict";

const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");

const PORT = 7788;
const ROOT = __dirname;
const CONFIG_FILE = path.join(ROOT, "gcm-config.json");
const DEFAULT_BASE_URL = "https://api.deepseek.com/v1";
const DEFAULT_MODEL = "deepseek-chat";

/* ---------------- 配置 ---------------- */

function loadConfig() {
  let cfg = { apiKey: "", baseUrl: DEFAULT_BASE_URL, model: DEFAULT_MODEL, recents: [] };
  for (const p of [CONFIG_FILE, path.join(os.homedir(), ".gcmrc.json")]) {
    try {
      if (fs.existsSync(p)) { cfg = { ...cfg, ...JSON.parse(fs.readFileSync(p, "utf8")) }; break; }
    } catch { /* 忽略坏配置 */ }
  }
  if (!cfg.baseUrl) cfg.baseUrl = DEFAULT_BASE_URL;
  if (!cfg.model) cfg.model = DEFAULT_MODEL;
  if (!Array.isArray(cfg.recents)) cfg.recents = [];
  return cfg;
}

function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
}

/* ---------------- 工具函数 ---------------- */

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => { data += c; if (data.length > 30 * 1024 * 1024) reject(new Error("请求过大")); });
    req.on("end", () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
    req.on("error", reject);
  });
}

function git(repo, args) {
  return new Promise((resolve, reject) => {
    execFile("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => {
        if (err) reject(new Error((stderr || err.message || "").toString().trim()));
        else resolve(stdout.trim());
      });
  });
}

async function isGitRepo(repo) {
  try { await git(repo, ["rev-parse", "--is-inside-work-tree"]); return true; } catch { return false; }
}

/* ---------------- Prompt（与 CLI 版一致的规范） ---------------- */

const TYPES = `feat(新功能) fix(修复bug) docs(文档) style(格式) refactor(重构) perf(性能) test(测试) build(构建) ci(集成) chore(杂项) revert(回滚)`;

function buildPrompt(ctx, lang) {
  const langRule = lang === "zh"
    ? `标题使用中文（英文 type 前缀 + 可选 scope + 中文描述），正文用中文。`
    : `标题和正文全部使用英文。`;
  const system = `你是一位资深工程师，为团队撰写符合 Conventional Commits (Angular 规范) 的高质量 commit message，这是大厂代码评审与 CHANGELOG 自动化的标准。

硬性要求:
1. 标题格式: <type>(<scope>): <subject>，scope 可省略；subject 为祈使句、不加句号、不超过 72 字符。
2. type 只能从这些里选: ${TYPES}。
3. 正文解释"为什么改"和"改了什么"，每行不超过 100 字符；如变更很小，正文可为空。
4. 基于真实 diff 概括，禁止编造 diff 中不存在的功能。
5. 如果 diff 涉及删除大量代码或敏感信息（密钥、token），正文必须提示。
${langRule}

输出格式 (严格遵守 JSON，不要输出任何其他内容):
{ "recommended": { "title": "...", "body": "..." }, "alternatives": [ { "title": "...", "body": "..." } ] }
alternatives 给出 2 条不同角度/不同 type 的备选；body 无正文则给空字符串。`;

  const diffBlock = ctx.diff
    ? `【git diff】\n${ctx.diff.slice(0, 12000)}${ctx.diff.length > 12000 ? "\n... (diff 过长已截断)" : ""}`
    : "【git diff】(空)";
  const untrackedBlock = ctx.untracked.length
    ? `【未跟踪的新文件】\n${ctx.untracked.slice(0, 100).join("\n")}`
    : "";
  return {
    system,
    user: `仓库当前状态: 变更来源 = ${ctx.source}\n${diffBlock}\n${untrackedBlock}\n\n请生成 commit message。`,
  };
}

async function callLLM(cfg, prompt) {
  const url = `${cfg.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({
      model: cfg.model, temperature: 0.3,
      messages: [{ role: "system", content: prompt.system }, { role: "user", content: prompt.user }],
    }),
  });
  if (!res.ok) throw new Error(`API 返回 ${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}`);
  const data = await res.json();
  const content = String(data?.choices?.[0]?.message?.content || "");
  const cleaned = content.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  let parsed;
  try { parsed = JSON.parse(cleaned); }
  catch {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (!m) throw new Error(`无法解析模型输出: ${cleaned.slice(0, 200)}`);
    parsed = JSON.parse(m[0]);
  }
  if (!parsed.recommended?.title) throw new Error("模型输出缺少 recommended.title");
  return parsed;
}

/* ---------------- API 处理 ---------------- */

async function handleInspect(body, res, cfg) {
  const repo = path.resolve(body.path || "");
  if (!fs.existsSync(repo)) return json(res, 200, { ok: false, error: "路径不存在" });
  if (!(await isGitRepo(repo))) return json(res, 200, { ok: false, error: "不是 git 仓库" });
  const branch = await git(repo, ["rev-parse", "--abbrev-ref", "HEAD"]).catch(() => "?");
  const staged = (await git(repo, ["diff", "--staged", "--stat"]).catch(() => "")).split("\n").filter(Boolean).length;
  const unstaged = (await git(repo, ["diff", "--stat"]).catch(() => "")).split("\n").filter(Boolean).length;
  const untracked = (await git(repo, ["ls-files", "--others", "--exclude-standard"]).catch(() => "")).split("\n").filter(Boolean);
  json(res, 200, { ok: true, path: repo, branch, staged, unstaged, untracked: untracked.length });
}

async function handleGenerate(req, res, cfg) {
  const body = await readBody(req);
  const repo = path.resolve(body.path || "");
  const lang = body.lang === "en" ? "en" : "zh";

  if (!cfg.apiKey) return json(res, 200, { ok: false, error: "尚未配置 API Key，请在页面顶部「设置」里填一次，之后不用再输。" });
  if (!fs.existsSync(repo)) return json(res, 200, { ok: false, error: "路径不存在" });
  if (!(await isGitRepo(repo))) return json(res, 200, { ok: false, error: "不是 git 仓库" });

  if (body.addAll) await git(repo, ["add", "-A"]);

  let diff = await git(repo, ["diff", "--staged", "--no-color"]).catch(() => "");
  let source = "暂存区";
  if (!diff && !body.addAll) {
    diff = await git(repo, ["diff", "--no-color"]).catch(() => "");
    source = "工作区（未暂存）";
  }
  const untracked = body.addAll ? [] : (await git(repo, ["ls-files", "--others", "--exclude-standard"]).catch(() => "")).split("\n").filter(Boolean);
  if (!diff && !untracked.length) return json(res, 200, { ok: false, error: "没有检测到任何变更，仓库是干净的。" });

  const result = await callLLM(cfg, buildPrompt({ diff, untracked, source }, lang));
  cfg.recents = [repo, ...cfg.recents.filter((r) => r !== repo)].slice(0, 8);
  saveConfig(cfg);
  json(res, 200, { ok: true, source, untrackedCount: untracked.length, ...result });
}

async function handleCommit(req, res, cfg) {
  const body = await readBody(req);
  const repo = path.resolve(body.path || "");
  const title = String(body.title || "").trim();
  const commitBody = String(body.body || "").trim();
  if (!title) return json(res, 200, { ok: false, error: "缺少 commit message" });
  if (!fs.existsSync(repo)) return json(res, 200, { ok: false, error: "路径不存在" });

  const msg = commitBody ? `${title}\n\n${commitBody}` : title;
  await new Promise((resolve, reject) => {
    execFile("git", ["-C", repo, "commit", "-m", msg], { encoding: "utf8", windowsHide: true },
      (err, stdout, stderr) => err ? reject(new Error((stderr || err.message).trim())) : resolve(stdout));
  });
  const hash = await git(repo, ["rev-parse", "--short", "HEAD"]).catch(() => "?");
  json(res, 200, { ok: true, hash });
}

/* ---------------- 路由 ---------------- */

const server = http.createServer(async (req, res) => {
  const cfg = loadConfig();
  try {
    if (req.method === "GET" && (req.url === "/" || req.url.startsWith("/index"))) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(fs.readFileSync(path.join(ROOT, "index.html")));
      return;
    }
    if (req.method === "GET" && req.url === "/api/config") {
      return json(res, 200, { ok: true, baseUrl: cfg.baseUrl, model: cfg.model, hasKey: !!cfg.apiKey, recents: cfg.recents });
    }
    if (req.method === "POST" && req.url === "/api/config") {
      const body = await readBody(req);
      if (body.apiKey !== undefined && body.apiKey !== "") cfg.apiKey = body.apiKey.trim();
      if (body.baseUrl) cfg.baseUrl = body.baseUrl.trim();
      if (body.model) cfg.model = body.model.trim();
      saveConfig(cfg);
      return json(res, 200, { ok: true });
    }
    if (req.method === "POST" && req.url === "/api/inspect") return await handleInspect(await readBody(req), res, cfg);
    if (req.method === "POST" && req.url === "/api/generate") return await handleGenerate(req, res, cfg);
    if (req.method === "POST" && req.url === "/api/commit") return await handleCommit(req, res, cfg);
    if (req.method === "POST" && req.url === "/api/stage") {
      const body = await readBody(req);
      const repo = path.resolve(body.path || "");
      await git(repo, ["add", "-A"]);
      return json(res, 200, { ok: true });
    }
    json(res, 404, { ok: false, error: "not found" });
  } catch (e) {
    json(res, 200, { ok: false, error: e.message || String(e) });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`gcm GUI 已启动: http://localhost:${PORT}`);
  // 自动打开浏览器
  const url = `http://localhost:${PORT}`;
  const cmd = process.platform === "win32" ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  execFile(cmd, args, { windowsHide: true }, () => {});
});
