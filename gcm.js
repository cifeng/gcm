#!/usr/bin/env node
/**
 * gcm — Git Commit Message 生成器
 * 读取指定项目的 git diff，喂给大模型，自动输出大厂标准的 commit log。
 *
 * 用法:
 *   node gcm.js [项目路径] [选项]
 *
 * 选项:
 *   --commit        生成后直接用推荐消息提交
 *   --unstaged      使用未暂存的变更 (默认: 暂存区; 若暂存区为空自动回退)
 *   --model <name>  覆盖模型名
 *   --lang <zh|en>  提交信息语言 (默认 zh)
 *   --no-body       只输出标题行, 不生成正文
 *   -h, --help      帮助
 *
 * 配置 (环境变量, 优先级高于配置文件):
 *   AI_COMMIT_API_KEY    API Key (必填)
 *   AI_COMMIT_BASE_URL   OpenAI 兼容接口地址, 默认 https://api.deepseek.com/v1
 *   AI_COMMIT_MODEL      模型名, 默认 deepseek-chat
 *
 * 配置文件: ~/.gcmrc.json 或项目根 .gcmrc.json
 *   { "apiKey": "...", "baseUrl": "...", "model": "..." }
 */

"use strict";

const { execFileSync, spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

/* ---------------- 参数解析 ---------------- */

function parseArgs(argv) {
  const opts = {
    project: process.cwd(),
    commit: false,
    unstaged: false,
    model: null,
    lang: "zh",
    noBody: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") opts.help = true;
    else if (a === "--commit") opts.commit = true;
    else if (a === "--unstaged") opts.unstaged = true;
    else if (a === "--no-body") opts.noBody = true;
    else if (a === "--model") opts.model = argv[++i] ?? die("缺少 --model 参数");
    else if (a === "--lang") {
      const v = argv[++i];
      if (v !== "zh" && v !== "en") die('--lang 只支持 zh 或 en');
      opts.lang = v;
    } else if (!a.startsWith("-")) opts.project = a;
    else die(`未知参数: ${a}`);
  }
  return opts;
}

function die(msg, code = 1) {
  console.error(`✗ ${msg}`);
  process.exit(code);
}

/* ---------------- 配置 ---------------- */

function loadConfig(opts) {
  let fileCfg = {};
  const candidates = [path.join(opts.project, ".gcmrc.json"), path.join(os.homedir(), ".gcmrc.json")];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) { fileCfg = JSON.parse(fs.readFileSync(p, "utf8")); break; }
    } catch (e) { die(`配置文件解析失败 ${p}: ${e.message}`); }
  }
  const cfg = {
    apiKey: process.env.AI_COMMIT_API_KEY || fileCfg.apiKey || "",
    baseUrl: (process.env.AI_COMMIT_BASE_URL || fileCfg.baseUrl || "https://api.deepseek.com/v1").replace(/\/+$/, ""),
    model: opts.model || process.env.AI_COMMIT_MODEL || fileCfg.model || "deepseek-chat",
  };
  if (!cfg.apiKey) {
    die(`缺少 API Key。请设置环境变量 AI_COMMIT_API_KEY，或在项目根/家目录创建 .gcmrc.json:\n` +
        `  { "apiKey": "sk-...", "baseUrl": "https://api.deepseek.com/v1", "model": "deepseek-chat" }`);
  }
  return cfg;
}

/* ---------------- Git 操作 ---------------- */

function git(repo, args) {
  try {
    return execFileSync("git", ["-C", repo, ...args], {
      encoding: "utf8", maxBuffer: 64 * 1024 * 1024, windowsHide: true,
    }).trim();
  } catch (e) {
    die(`git 执行失败: git ${args.join(" ")}\n${(e.stderr || e.message || "").toString().trim()}`);
  }
}

function isGitRepo(repo) {
  try {
    execFileSync("git", ["-C", repo, "rev-parse", "--is-inside-work-tree"],
      { encoding: "utf8", windowsHide: true });
    return true;
  } catch { return false; }
}

function collectDiff(repo, opts) {
  const staged = git(repo, ["diff", "--staged", "--no-color"]);
  let diff = staged, source = "暂存区 (staged)";

  if (!diff && !opts.unstaged) {
    diff = git(repo, ["diff", "--no-color"]);
    source = "工作区 (unstaged, 未暂存)";
    if (diff) console.error("ℹ 暂存区为空，已回退使用未暂存的工作区变更。");
  } else if (opts.unstaged) {
    diff = git(repo, ["diff", "--no-color"]);
    source = "工作区 (unstaged)";
  }

  const untracked = git(repo, ["ls-files", "--others", "--exclude-standard"])
    .split("\n").filter(Boolean);

  if (!diff && !untracked.length) {
    die("没有检测到任何变更：暂存区和工作区都是干净的。");
  }
  return { diff, untracked, source };
}

/* ---------------- Prompt ---------------- */

const TYPES_ZH = `feat(新功能) fix(修复bug) docs(文档) style(格式) refactor(重构) perf(性能) test(测试) build(构建) ci(集成) chore(杂项) revert(回滚)`;

function buildPrompt(ctx, opts) {
  const langRule = opts.lang === "zh"
    ? `标题使用中文（英文 type 前缀 + 可选英文/中文 scope + 中文描述），正文用中文。`
    : `标题和正文全部使用英文。`;

  const system = `你是一位资深工程师，为团队撰写符合 Conventional Commits (Angular 规范) 的高质量 commit message，这是大厂 (Google/阿里/字节等) 代码评审与 CHANGELOG 自动化的标准。

硬性要求:
1. 标题格式: <type>(<scope>): <subject>，scope 可省略；subject 为祈使句、不加句号、不超过 72 字符。
2. type 只能从这些里选: ${TYPES_ZH}。
3. 正文解释"为什么改"和"改了什么"，每行不超过 100 字符；如变更很小，正文可为空。
4. 基于真实 diff 概括，禁止编造 diff 中不存在的功能。
5. 如果 diff 涉及删除大量代码或敏感信息（密钥、token），正文必须提示。
${langRule}

输出格式 (严格遵守 JSON，不要输出任何其他内容):
{
  "recommended": { "title": "...", "body": "..." },
  "alternatives": [ { "title": "...", "body": "..." } ]
}
alternatives 给出 2 条不同角度/不同 type 的备选；body 为多行字符串，无正文则给空字符串。`;

  const diffBlock = ctx.diff
    ? `【git diff】\n${ctx.diff.slice(0, 12000)}${ctx.diff.length > 12000 ? "\n... (diff 过长已截断)" : ""}`
    : "【git diff】(空)";
  const untrackedBlock = ctx.untracked.length
    ? `【未跟踪的新文件】\n${ctx.untracked.slice(0, 100).join("\n")}\n(这些文件内容未入 diff，请在 message 中体现新增文件)`
    : "";

  const user = `仓库当前状态: 变更来源 = ${ctx.source}\n${diffBlock}\n${untrackedBlock}\n\n请生成 commit message。`;

  return { system, user };
}

/* ---------------- LLM 调用 ---------------- */

async function callLLM(cfg, prompt) {
  const url = `${cfg.baseUrl}/chat/completions`;
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({
        model: cfg.model,
        temperature: 0.3,
        messages: [
          { role: "system", content: prompt.system },
          { role: "user", content: prompt.user },
        ],
      }),
    });
  } catch (e) {
    die(`请求失败 (${url}): ${e.message}`);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    die(`API 返回 ${res.status}: ${text.slice(0, 500)}`);
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) die("API 未返回内容");

  // 容错: 剥掉 markdown 代码围栏再解析
  const cleaned = String(content).replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  let parsed;
  try { parsed = JSON.parse(cleaned); }
  catch {
    // 再容错: 截取第一个 { 到最后一个 }
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (!m) die(`无法解析模型输出:\n${cleaned.slice(0, 500)}`);
    parsed = JSON.parse(m[0]);
  }
  if (!parsed.recommended?.title) die("模型输出缺少 recommended.title");
  return parsed;
}

/* ---------------- 提交 ---------------- */

function gitCommit(repo, title, body) {
  const msg = body ? `${title}\n\n${body}` : title;
  return new Promise((resolve) => {
    const child = spawn("git", ["-C", repo, "commit", "-m", msg], { stdio: "inherit", windowsHide: true });
    child.on("exit", (code) => resolve(code));
  });
}

/* ---------------- 主流程 ---------------- */

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(fs.readFileSync(__filename, "utf8").match(/\/\*\*[\s\S]*?\*\//)[0]
      .replace(/^\/\*\*|\*\/$/g, "").split("\n").map(l => l.replace(/^\s*\*\s?/, "")).join("\n"));
    return;
  }

  const project = path.resolve(opts.project);
  if (!fs.existsSync(project)) die(`项目路径不存在: ${project}`);
  if (!isGitRepo(project)) die(`不是 git 仓库: ${project}`);

  console.error(`📁 项目: ${project}`);
  const ctx = collectDiff(project, opts);
  const stat = git(project, ["diff", "--stat", ctx.diff.includes("\ndiff --git") && opts.unstaged ? "" : "--cached"].filter(Boolean))
    .split("\n").filter(Boolean);
  console.error(`📊 变更来源: ${ctx.source}`);
  if (ctx.untracked.length) console.error(`📄 新文件: ${ctx.untracked.length} 个`);

  const cfg = loadConfig(opts);
  console.error(`🤖 调用模型 ${cfg.model} @ ${cfg.baseUrl} ...`);

  const prompt = buildPrompt(ctx, opts);
  const result = await callLLM(cfg, prompt);

  const rec = result.recommended;
  console.log("\n========== 推荐 commit message ==========\n");
  console.log(rec.title);
  if (rec.body) console.log(`\n${rec.body}`);
  console.log("\n==========================================\n");

  if (Array.isArray(result.alternatives) && result.alternatives.length) {
    console.log("备选方案:");
    result.alternatives.forEach((a, i) => {
      console.log(`  [${i + 1}] ${a.title}`);
      if (a.body) console.log(`      ${a.body.split("\n").join("\n      ")}`);
    });
    console.log("");
  }

  if (opts.commit) {
    const code = await gitCommit(project, rec.title, opts.noBody ? "" : (rec.body || ""));
    if (code === 0) console.log("✅ 已提交");
    else die("提交失败 (可能没有已暂存的变更，请先 git add)");
  } else {
    console.log(`💡 直接提交请加 --commit，或复制上面的信息手动 git commit。`);
  }
}

main().catch((e) => die(e.message || String(e)));
