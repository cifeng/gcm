// 本地 mock LLM 服务，仅用于端到端测试 gcm.js
const http = require("http");
const body = { id: "mock", choices: [{ message: { role: "assistant", content: JSON.stringify({
  recommended: { title: "fix(calc): 增加操作数类型校验防止隐式类型错误", body: "calc 函数原先直接相加，传入非数字时会产生隐式拼接或 NaN。\n新增类型检查并抛出 TypeError，将错误暴露在调用方早期。" },
  alternatives: [
    { title: "refactor(calc): 校验入参类型并补充文档字符串", body: "" },
    { title: "feat(calc): 严格模式入参检查", body: "" }
  ]
}) } }] };
http.createServer((req, res) => {
  let chunks = [];
  req.on("data", c => chunks.push(c));
  req.on("end", () => {
    console.log("MOCK 收到请求:", req.url);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  });
}).listen(8123, () => console.log("mock up on 8123"));
