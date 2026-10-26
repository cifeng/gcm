#!/usr/bin/env node
/**
 * gcm MCP Server — 挂进 WorkBuddy 后，AI 直接用自带能力生成大厂标准 commit log，全程免 API Key。
 *
 * 提供三个工具:
 *   get_changes  读取项目 git 变更（diff + 新文件 + 分支状态），返回给 AI 分析
 *   commit       用指定 commit message 提交
 *   stage_all    git add -A 暂存全部变更
 *
 * 协议: MCP stdio（逐行 JSON-RPC 2.0），零依赖。
 */
"use strict";

const { execFile } = require("child_process");
const path = require("path");
const fs = require("fs");

const DIFF_LIMIT = 15000;

/* ---------------- git 工具函数 ---------------- */

function git(repo, args) {
  return new Promise((resolve, reject) => {
    execFile("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => err ? reject(new Error((stderr || err.message).toString().trim())) : resolve(stdout.trim()));
  });
}

async function getChanges({ projectPath, includeUnstaged }) {
  const repo = path.resolve(projectPath || "");
  if (!fs.existsSync(repo)) throw new Error(`路径不存在: ${repo}`);
  try { await git(repo, ["rev-parse", "--is-inside-work-tree"]); }
  catch { throw new Error(`不是 git 仓库: ${repo}`); }

  const branch = await git(repo, ["rev-parse", "--abbrev-ref", "HEAD"]).catch(() => "?");
  let diff = await git(repo, ["diff", "--staged", "--no-color"]).catch(() => "");
  let source = "暂存区 (staged)";
  if (!diff && includeUnstaged !== false) {
    diff = await git(repo, ["diff", "--no-color"]).catch(() => "");
    source = "工作区 (unstaged)";
  }
  const untracked = (await git(repo, ["ls-files", "--others", "--exclude-standard"]).catch(() => "")).split("\n").filter(Boolean);
  const stat = await git(repo, ["diff", source === "暂存区 (staged)" ? "--cached" : "--no-color", "--stat"]).catch(() => "");

  if (!diff && !untracked.length) return `仓库是干净的，没有任何变更，无需提交。\n分支: ${branch}`;

  const parts = [
    `仓库分支: ${branch}`,
    `变更来源: ${source}`,
    stat ? `变更统计:\n${stat}` : "",
    untracked.length ? `未跟踪的新文件:\n${untracked.slice(0, 100).join("\n")}` : "",
    `【git diff】\n${diff.slice(0, DIFF_LIMIT)}${diff.length > DIFF_LIMIT ? "\n... (diff 过长已截断)" : ""}`,
    "",
    `请基于以上变更，按 Conventional Commits (Angular 规范) 生成大厂标准 commit message：`,
    `1. 标题格式 <type>(<scope>): <subject>，type 限 feat/fix/docs/style/refactor/perf/test/build/ci/chore/revert，subject 祈使句不加句号、≤72 字符。`,
    `2. 正文说明"为什么改 + 改了什么"，每行 ≤100 字符，变更很小可为空。禁止编造 diff 中不存在的功能。`,
    `3. 若涉及大量删除或疑似密钥/敏感信息，必须在正文提示。`,
    `4. 生成 1 条推荐 + 2 条不同角度备选，交给用户选择，然后用 commit 工具提交（需用户确认）。`,
  ].filter(Boolean);
  return parts.join("\n");
}

async function stageAll({ projectPath }) {
  const repo = path.resolve(projectPath || "");
  if (!fs.existsSync(repo)) throw new Error(`路径不存在: ${repo}`);
  await git(repo, ["add", "-A"]);
  return "已执行 git add -A，全部变更已暂存。";
}

async function commit({ projectPath, title, body }) {
  const repo = path.resolve(projectPath || "");
  if (!title || !String(title).trim()) throw new Error("缺少 commit message 标题");
  if (!fs.existsSync(repo)) throw new Error(`路径不存在: ${repo}`);
  const title_ = String(title).trim();
  const body_ = String(body || "").trim();
  const msg = body_ ? `${title_}\n\n${body_}` : title_;
  await new Promise((resolve, reject) => {
    execFile("git", ["-C", repo, "commit", "-m", msg], { encoding: "utf8", windowsHide: true },
      (err, stdout, stderr) => err ? reject(new Error((stderr || err.message).trim())) : resolve(stdout));
  });
  const hash = await git(repo, ["rev-parse", "--short", "HEAD"]).catch(() => "?");
  return `提交成功 ${hash}: ${title_}`;
}

/* ---------------- MCP 协议 ---------------- */

const TOOLS = [
  {
    name: "get_changes",
    description: "读取指定项目的 git 变更（分支、diff、新文件），并返回大厂标准 commit message 的生成要求。用于 AI 生成 commit log。",
    inputSchema: {
      type: "object",
      properties: {
        projectPath: { type: "string", description: "git 项目路径" },
        includeUnstaged: { type: "boolean", description: "暂存区为空时是否回退读工作区变更，默认 true" },
      },
      required: ["projectPath"],
    },
  },
  {
    name: "commit",
    description: "用给定的 commit message 提交指定项目的暂存区变更。",
    inputSchema: {
      type: "object",
      properties: {
        projectPath: { type: "string", description: "git 项目路径" },
        title: { type: "string", description: "commit 标题，如 feat(auth): 支持手机号登录" },
        body: { type: "string", description: "commit 正文，可为空" },
      },
      required: ["projectPath", "title"],
    },
  },
  {
    name: "stage_all",
    description: "在指定项目执行 git add -A，暂存全部变更（含新文件）。",
    inputSchema: {
      type: "object",
      properties: { projectPath: { type: "string", description: "git 项目路径" } },
      required: ["projectPath"],
    },
  },
];

const HANDLERS = { get_changes: getChanges, commit, stage_all: stageAll };

function reply(id, result) {
  if (id === undefined) return; // notification，不回复
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
}

function replyError(id, code, message) {
  if (id === undefined) return;
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }) + "\n");
}

let buffer = "";
let pending = 0;
let stdinClosed = false;

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let idx;
  while ((idx = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (line) handleMessage(line);
  }
});
process.stdin.on("end", () => {
  stdinClosed = true;
  if (pending === 0) process.exit(0);
});

function maybeExit() {
  if (stdinClosed && pending === 0) process.exit(0);
}

function handleMessage(line) {
  let msg;
  try { msg = JSON.parse(line); } catch { return replyError(null, -32700, "Parse error"); }
  const { id, method, params } = msg;

  switch (method) {
    case "initialize":
      return reply(id, {
        protocolVersion: params?.protocolVersion || "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "gcm", version: "1.0.0" },
      });
    case "ping":
      return reply(id, {});
    case "tools/list":
      return reply(id, { tools: TOOLS });
    case "tools/call": {
      const name = params?.name;
      const args = params?.arguments || {};
      const handler = HANDLERS[name];
      if (!handler) return replyError(id, -32602, `未知工具: ${name}`);
      pending++;
      handler(args)
        .then((text) => reply(id, { content: [{ type: "text", text }], isError: false }))
        .catch((e) => reply(id, { content: [{ type: "text", text: `执行失败: ${e.message}` }], isError: true }))
        .finally(() => { pending--; maybeExit(); });
      return;
    }
    case "notifications/initialized":
    case "notifications/cancelled":
      return; // notification，忽略
    default:
      if (id !== undefined) replyError(id, -32601, `方法不存在: ${method}`);
  }
}
