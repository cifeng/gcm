# workbuddy.md — 用 WorkBuddy 开发 gcm 的完整过程

> 本文件用于证明：gcm（AI Commit 工坊）从需求到上线全程由 **WorkBuddy** 完成，包含 AI 生成代码、MCP 服务开发、页面生成与发布。

## 一、项目信息

- **作品名**：gcm · AI Commit 工坊
- **一句话**：读项目 git diff，AI 自动写出大厂标准 commit log，零 API Key 也能用
- **在线体验页**：https://workbuddy.link/p/qCYggAf2IbsZGZ8H6d3c11
- **公开仓库**：https://github.com/cifeng9528/gcm （MIT）
- **形态**：MCP Server（零成本模式）+ 本地网页版 + 命令行

## 二、开发对话时间线（真实交互，按轮次还原）

### 第 1 轮｜需求提出

> 用户：帮我做一个小工具，就是读取指定项目的 git 然后通过 git diff 拿到修改的内容，然后喂给 AI 自动输出大厂标准的 commit log

WorkBuddy 的判断与动作：
1. 确认技术形态——`git diff` 必须在本地执行，纯网页做不了，因此定为**零依赖 Node.js CLI**
2. 设计三条链路：读取 git → 组装 prompt → 调模型 → 输出 + 可选提交
3. 产出 `gcm.js`（单文件、无依赖），并搭建 `demo-repo` 测试仓库 + `test-mock-server.js` 本地 mock 模型
4. 端到端验证：生成、`--commit` 提交（commit `00ca6eb`）、暂存区为空自动回退、未跟踪新文件识别

关键设计决策（由 AI 主动提出）：
- 规范的 type 白名单 + 标题 72 字符 + 正文 100 字符行宽
- 一次给 3 条候选（1 推荐 + 2 备选），避免单向输出无法选择
- diff 过长自动截断到 12000 字符，兼顾成本与准确性

### 第 2 轮｜用户反馈：太复杂

> 用户：太复杂了 做个一键启动+点点点 的功能 尽量让用户少输入或者不输入

WorkBuddy 的动作：
1. 新增本地网页版：`server.js`（原生 http，仅监听 127.0.0.1:7788）+ `index.html` + `start.bat`
2. 交互压到三步：填一次 Key（永久记住）→ 选项目（最近项目卡片）→ 点生成 → 点提交
3. 自动状态探测：分支 / 暂存数 / 未暂存数 / 新文件数，暂存区为空时自动建议"自动暂存"
4. 用 mock 模型跑通 config / inspect / generate / commit 四个接口

### 第 3 轮｜用户反馈：不想花钱

> 用户：直接使用 workBuddy 的 ai 能力 如果不支持直接做一个 mcp 就是不花钱 白嫖

WorkBuddy 的动作：
1. 判断：本地工具无法直接借用宿主 AI，**MCP 是正解**——工具只负责取 diff，推理交给 WorkBuddy
2. 手写零依赖 MCP stdio 服务 `mcp-server.js`（JSON-RPC 2.0，未用 SDK）
3. 暴露 3 个工具：`get_changes` / `commit` / `stage_all`
4. 自测并修复一个真实 bug：stdin 关闭时异步任务未完成即退出（引入 pending 计数）
5. 注册进 `~/.workbuddy/mcp.json`（server 名 `gcm`）

### 第 4 轮｜用户问：能上架大赛吗

> 用户：可以的 这个能上架 程序员节应用创作大赛吗

WorkBuddy 的判断：题材契合、工程完整，但缺"评委能直接点开的作品"与"开发过程证明"。于是：
1. 生成作品体验页 `contest/landing.html`（含真实可交互的 **Commit 规范体检器**）
2. 过质量门禁 `lint_page_quality.py`（PASS，仅 1 条 ES6 兼容性 WARN）
3. 导入资料库并发布 → 在线链接
4. 补齐 `workbuddy.md`、`README`、`mcp-config.example.json`、演示脚本

## 三、WorkBuddy 参与的具体环节

| 环节 | 参与方式 |
|---|---|
| 需求拆解与技术选型 | 会话内完成：判断 CLI/网页/MCP 三种形态的边界 |
| 代码编写 | `gcm.js` / `server.js` / `mcp-server.js` / `index.html` 全部由 WorkBuddy 生成 |
| 测试与调试 | 自动搭建 demo 仓库与 mock 模型，跑通全链路；自行定位并修复 MCP 退出时序 bug |
| 环境配置 | 自动写入并维护 `~/.workbuddy/mcp.json` |
| 作品页 | 页面文案、视觉、交互（规范体检器逻辑）由 WorkBuddy 生成，经质量门禁后发布 |
| 文档 | README / workbuddy.md / 演示脚本由 WorkBuddy 撰写 |

## 四、可复现的最小验证步骤

```bash
# 1. 生成 commit message（需 API Key）
node gcm.js ./demo-repo

# 2. 网页版
start.bat            # 自动打开 http://localhost:7788

# 3. MCP 模式（零成本，需在 WorkBuddy 信任 gcm 服务）
#    对话中说：“帮我给 ./demo-repo 生成 commit 并提交”
```

## 五、说明

- 本项目未使用任何第三方代码库，全部为零依赖原生实现
- 页面的「Commit 规范体检器」为纯前端规则计算，不上传任何文本
- 模型调用默认走 DeepSeek 兼容接口，可一键切换 Kimi / 通义 / GLM / OpenAI；MCP 模式完全不需要 Key
