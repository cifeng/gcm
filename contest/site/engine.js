/**
 * gcm 在线版规则引擎 —— 仅凭 git diff 文本推断规范 commit message。
 * 纯函数、零依赖、ES5 写法；浏览器下挂到 window.GCMEngine，Node 下可 require 测试。
 *
 * 定位：在线体验的"快稿引擎"。它只做 diff 统计与符号识别，不读业务上下文；
 * 本地 CLI / MCP 版由 AI 理解意图，措辞更准（页面上已如实说明）。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.GCMEngine = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var TYPE_VERB = {
    feat: "新增", fix: "修复", docs: "补充", style: "调整格式", refactor: "重构",
    perf: "优化", test: "补充测试", build: "调整构建配置", ci: "调整流水线",
    chore: "调整", revert: "回滚"
  };

  var DOC_RE = /\.(md|mdx|txt|rst|adoc)$/i;
  var TEST_RE = /(^|\/)(test|tests|__tests__|spec)\/|\.(test|spec)\.[a-z]+$/i;
  var CI_RE = /^\.github\/|^\.gitlab-ci|(^|\/)(Dockerfile|docker-compose)/i;
  var BUILD_RE = /(^|\/)(package\.json|package-lock\.json|yarn\.lock|pnpm-lock\.yaml|tsconfig[^/]*\.json|\.eslintrc[^/]*|vite\.config\.[jt]s|webpack\.config\.[jt]s)$/i;
  var FIX_HINT = /\b(throw new|catch\s*\(|validate|validator|guard|fallback|bug|fix|修复|断言|校验)\b/i;
  // 只认"声明级"符号：函数 / 类 / 接口优先，const/let 次之
  var SYMBOL_HIGH = /^\+\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function|class|def|interface|struct)\s+([A-Za-z_$][\w$]*)/;
  var SYMBOL_MID = /^\+\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::|=[^=])/;
  var SYMBOL_NOISE = ["next", "prev", "res", "req", "err", "e", "i", "j", "k", "tmp", "temp", "data",
    "val", "value", "obj", "item", "items", "list", "map", "set", "fn", "cb", "ctx", "opts", "cur",
    "acc", "ret", "out", "result", "args", "params", "self", "this"];

  function parseDiff(text) {
    var lines = String(text || "").split(/\r?\n/);
    var files = [];
    var cur = null;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var head = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
      if (head) {
        cur = { path: head[2], add: 0, del: 0, isNew: false, isDeleted: false, symbols: [] };
        files.push(cur);
        continue;
      }
      if (!cur) continue;
      if (/^new file mode/.test(line)) cur.isNew = true;
      if (/^deleted file mode/.test(line)) cur.isDeleted = true;
      if (/^\+(?!\+\+)/.test(line)) {
        cur.add++;
        var s = line.match(SYMBOL_HIGH);
        var kind = s ? 2 : 0;
        if (!s) { s = line.match(SYMBOL_MID); kind = 1; }
        if (s) {
          var name = s[1];
          if (name.length > 2 && SYMBOL_NOISE.indexOf(name) < 0 && cur.symbols.indexOf(name) < 0) {
            cur.symbols.push(name);
            cur.symbolRank = Math.max(cur.symbolRank || 0, kind);
          }
        }
      } else if (/^-(?!--)/.test(line)) {
        cur.del++;
      }
    }
    return files;
  }

  function every(files, re) {
    for (var i = 0; i < files.length; i++) if (!re.test(files[i].path)) return false;
    return files.length > 0;
  }
  function some(files, re) {
    for (var i = 0; i < files.length; i++) if (re.test(files[i].path)) return true;
    return false;
  }

  function inferType(files, rawText) {
    if (!files.length) return "chore";
    if (every(files, DOC_RE)) return "docs";
    if (every(files, TEST_RE)) return "test";
    if (every(files, CI_RE)) return "ci";
    if (every(files, BUILD_RE)) return "build";

    var allNew = true, allDeleted = true, added = 0, removed = 0, syms = 0;
    for (var i = 0; i < files.length; i++) {
      if (!files[i].isNew) allNew = false;
      if (!files[i].isDeleted) allDeleted = false;
      added += files[i].add;
      removed += files[i].del;
      syms += files[i].symbols.length;
    }
    if (allDeleted) return "refactor";
    if (FIX_HINT.test(rawText)) return "fix";
    if (allNew) return "feat";
    if (syms > 0 && added >= removed) return "feat";
    if (removed > added * 1.5) return "refactor";
    return "refactor";
  }

  function inferScope(files) {
    if (!files.length) return "";
    var counts = {}, order = [];
    for (var i = 0; i < files.length; i++) {
      var parts = files[i].path.split("/");
      var key;
      if ((parts[0] === "src" || parts[0] === "packages" || parts[0] === "app") && parts.length > 2) {
        key = parts[1];
      } else if (parts.length > 1) {
        key = parts[0];
      } else {
        key = parts[0].replace(/\.[^.]+$/, "");
      }
      if (!counts[key]) { counts[key] = 0; order.push(key); }
      counts[key]++;
    }
    var best = order[0], bestN = 0;
    for (var k = 0; k < order.length; k++) {
      if (counts[order[k]] > bestN) { bestN = counts[order[k]]; best = order[k]; }
    }
    // 只有主 scope 覆盖半数以上文件时才写上，避免多模块改动硬安一个 scope
    return bestN * 2 >= files.length ? best : "";
  }

  function pickSymbol(files) {
    var best = "", bestRank = -1;
    for (var i = 0; i < files.length; i++) {
      if (!files[i].symbols.length) continue;
      var rank = files[i].symbolRank || 0;
      if (rank > bestRank) { bestRank = rank; best = files[i].symbols[0]; }
    }
    return best;
  }

  function shortPath(p) {
    var parts = p.split("/");
    return parts.length > 2 ? "…/" + parts.slice(-2).join("/") : p;
  }

  function makeSubject(type, files, scope, sym) {
    var n = files.length;
    var base = (files[0] ? files[0].path.split("/").pop() : "").replace(/\.[^.]+$/, "");
    switch (type) {
      case "feat": return sym ? "新增 " + sym + " 功能" : "新增 " + base + " 相关功能";
      case "fix": return sym ? "修复 " + sym + " 逻辑缺陷" : "修复 " + (scope || base) + " 逻辑缺陷";
      case "docs": return n > 1 ? "补充 " + n + " 份文档" : "补充 " + base + " 文档";
      case "test": return "补充 " + (scope ? scope + " " : "") + "单元测试";
      case "refactor": return sym ? "重构 " + sym + " 实现" : "重构 " + (scope || base) + " 模块实现";
      case "perf": return "优化 " + (scope || base) + " 性能";
      case "build": return "调整构建与依赖配置";
      case "ci": return "调整持续集成配置";
      case "style": return "统一 " + (scope || base) + " 代码风格";
      default: return "调整 " + (scope || base) + " 相关实现";
    }
  }

  function clip(s, max) {
    if (s.length <= max) return s;
    return s.slice(0, max - 1) + "…";
  }

  function makeBody(type, files, rawText) {
    var added = 0, removed = 0, i;
    for (i = 0; i < files.length; i++) { added += files[i].add; removed += files[i].del; }
    var lines = ["共改动 " + files.length + " 个文件（+" + added + " / -" + removed + "）：", ""];
    var shown = files.slice(0, 6);
    for (i = 0; i < shown.length; i++) {
      var f = shown[i];
      var tag = f.isNew ? "新增文件" : f.isDeleted ? "删除文件" : "修改";
      lines.push("- " + f.path + "（" + tag + "，+" + f.add + "/-" + f.del + "）" +
        (f.symbols.length ? " 涉及 " + f.symbols.slice(0, 3).join("、") : ""));
    }
    if (files.length > shown.length) lines.push("- 其余 " + (files.length - shown.length) + " 个文件同理");
    lines.push("");
    lines.push("说明：本条由在线规则引擎根据 diff 统计生成，仅做快稿；");
    lines.push("本地 CLI / MCP 版由 AI 读取改动语义，理由与措辞更贴合实际。");
    return lines.join("\n");
  }

  function build(type, files, scope, sym, rawText) {
    var head = type + (scope ? "(" + scope + ")" : "") + ": " + clip(makeSubject(type, files, scope, sym), 60);
    return { title: head, body: makeBody(type, files, scope, sym, rawText) };
  }

  /**
   * 主入口：输入 git diff 文本，输出 {ok, source, candidates:[{title, body}]}
   */
  function generate(rawText) {
    var text = String(rawText || "").trim();
    if (!text) return { ok: false, error: "先粘贴一段 git diff 输出（可以是 git diff / git diff --staged 的结果）" };
    var files = parseDiff(text);
    if (!files.length) {
      return { ok: false, error: "没识别到 diff 内容：请粘贴包含 “diff --git” 行的 git diff 输出" };
    }

    var type = inferType(files, text);
    var scope = inferScope(files);
    if (type === "docs" && /^docs?$/i.test(scope)) scope = "";
    var sym = pickSymbol(files);
    var main = build(type, files, scope, sym, text);

    var altType = type === "feat" ? "refactor" : type === "fix" ? "refactor" : "chore";
    var raw = [main, build(altType, files, scope, sym, text), build(type, files, "", sym, text)];

    // 去重：标题相同只保留第一条（本体在前）
    var seen = {}, candidates = [];
    for (var i = 0; i < raw.length; i++) {
      if (seen[raw[i].title]) continue;
      seen[raw[i].title] = 1;
      candidates.push(raw[i]);
    }

    return {
      ok: true,
      source: "在线规则引擎（快稿）",
      stats: {
        files: files.length,
        added: files.reduce(function (a, f) { return a + f.add; }, 0),
        removed: files.reduce(function (a, f) { return a + f.del; }, 0)
      },
      candidates: candidates
    };
  }

  return { generate: generate, parseDiff: parseDiff, inferType: inferType, inferScope: inferScope };
});
