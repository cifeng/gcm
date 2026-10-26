# gcm · AI Commit 工坊

**读项目 git diff，AI 自动写出大厂标准 commit log。MCP 模式零 API Key、零成本。**

- 🌐 **在线体验（不用安装）**：<https://workbuddy.link/p/qCYggAf2IbsZGZ8H6d3c11> — 内含可交互的 Commit 规范体检器
- 📦 **源码仓库**：<https://github.com/cifeng/gcm>
- 🧩 **形态**：MCP Server（零成本） / 本地网页版（点点点） / 命令行
- 📄 **开发过程**：[workbuddy.md](./workbuddy.md)　🎬 **录屏脚本**：[contest/demo-script.md](./contest/demo-script.md)

## 快速开始

```bash
git clone https://github.com/cifeng/gcm.git
cd gcm
```

无需 `npm install`（零依赖，只需 Node.js ≥ 18）。然后选一种用法：MCP 模式（免费，见下）／双击 `start.bat` 开网页版／终端跑 `node gcm.js D:/code/your-project`。

## 解决什么问题

| 痛点 | 现状 | gcm 的做法 |
|---|---|---|
| 提交信息随手写 | `update`、`fix bug`，三个月后无法回溯 | 从真实 diff 提炼 `type(scope): subject` + 原因说明 |
| 规范靠人盯 | review 时反复纠正措辞 | 内置 Angular 规范校验，类型/长度/行宽自动约束 |
| 接 AI 要成本 | 每家模型都要 Key、要充值 | MCP 模式直接用 WorkBuddy 自带能力，**零 Key 零费用** |
| 多一步就懒得用 | 装环境、记命令 | 双击 `start.bat` 或对话一句话，三步完成 |

## 目标用户

- **个人开发者**：提交前 3 秒生成规范 message，side project 的历史记录也能当文档看
- **团队 / 开源维护者**：统一规范不靠人盯，CHANGELOG 与 semantic-release 可直接消费
- **CI 场景**：作为 MCP 工具挂进流程，提交前自动生成候选文案

## 三种用法概览

| 方式 | 花钱吗 | 适合场景 |
|---|---|---|
| ① MCP 接入 WorkBuddy | **完全免费**（用 WorkBuddy 自带 AI） | 在 WorkBuddy 对话里直接说"帮我提交 xxx 项目" |
| ② 网页版（点点点） | 需要一个 API Key（GLM-4-Flash 等有免费额度） | 日常开发，双击 start.bat 打开网页操作 |
| ③ 命令行 gcm.js | 同上 | 脚本化 / 终端党 |

---

## ① MCP 模式（免费，推荐）

已注册到 `~/.workbuddy/mcp.json`（server 名 `gcm`）。首次使用需在 WorkBuddy 连接器管理页对 `gcm` 点一次「信任」。

之后在对话里直接说：

> 帮我给 D:/code/my-project 生成 commit message 并提交

WorkBuddy 会调用 `get_changes` 拿 diff → 用自带 AI 生成大厂标准 message → 给你确认 → `commit` 工具提交。全程无 API Key。

提供 3 个工具：`get_changes`（读变更+返回规范要求）、`commit`（提交）、`stage_all`（git add -A）。

## ② 网页版（一键启动 + 点点点）

双击 **`start.bat`** → 浏览器自动打开 `http://localhost:7788`：

1. 填一次 API Key（页面顶部设置，保存后永久记住，之后不用再输）
2. 输入项目路径（或点最近项目卡片）——自动显示分支/暂存/新文件状态
3. 点 **✨ 生成** → 三条候选卡片，点一条 → **✅ 用这条提交** 或 **📋 复制**
4. 可勾选"自动暂存全部变更"，连 `git add` 都省了

服务只监听 127.0.0.1，零依赖。

## ③ 命令行版

```bash
# 配置一次（任选环境变量或 ~/.gcmrc.json）
export AI_COMMIT_API_KEY=sk-xxxx
export AI_COMMIT_BASE_URL=https://api.deepseek.com/v1
export AI_COMMIT_MODEL=deepseek-chat

node gcm.js D:/code/my-project            # 输出推荐 + 2 条备选
node gcm.js D:/code/my-project --commit   # 直接提交
node gcm.js . --lang en --no-body         # 英文 / 只要标题
```

常见服务商 `baseUrl`：

| 服务商 | baseUrl | 免费 model |
|---|---|---|
| 智谱 GLM | `https://open.bigmodel.cn/api/paas/v4` | `glm-4-flash`（免费） |
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat` |
| Kimi | `https://api.moonshot.cn/v1` | `moonshot-v1-8k` |
| 通义千问 | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-plus` |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` |

## 输出规范

- 标题 `<type>(<scope>): <subject>`，type 限 `feat/fix/docs/style/refactor/perf/test/build/ci/chore/revert`
- subject 祈使句、不加句号、≤ 72 字符；正文讲"为什么改 + 改了什么"
- 每次给 1 条推荐 + 2 条备选；diff 含疑似密钥/大量删除时会提示

## 文件说明

| 文件 | 说明 |
|---|---|
| `mcp-server.js` | MCP server（免费模式，接入 WorkBuddy AI） |
| `server.js` + `index.html` | 网页版（一键启动、点点点） |
| `start.bat` | 双击启动网页版 |
| `gcm.js` | 命令行版（单文件零依赖） |
| `mcp-config.example.json` | MCP 配置示例（脱敏） |
| `workbuddy.md` | 用 WorkBuddy 开发的完整过程记录 |
| `contest/landing.html` | 作品体验页（已发布为在线链接） |
| `contest/demo-script.md` | 3 分钟录屏脚本 |
| `test-mock-server.js` | 本地 mock LLM（联调用） |
| `demo-repo/` | 测试示例仓库 |
