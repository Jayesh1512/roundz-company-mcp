"use strict";

const { spawn } = require("node:child_process");
const path = require("node:path");

const child = spawn(process.execPath, [path.join(__dirname, "server.js")], {
  stdio: ["pipe", "pipe", "inherit"],
});

const messages = [
  {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "smoke-test", version: "1.0.0" },
    },
  },
  { jsonrpc: "2.0", method: "notifications/initialized", params: {} },
  { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
  {
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: {
      name: "get_company_interview_details",
      arguments: { company_name: "Google" },
    },
  },
];

let output = "";
child.stdout.on("data", (chunk) => {
  output += chunk.toString("utf8");
});

child.on("exit", (code) => {
  if (code !== 0) process.exit(code);
});

for (const message of messages) {
  child.stdin.write(JSON.stringify(message) + "\n");
}

setTimeout(() => {
  child.kill();
  const responses = output
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));

  const toolResponse = responses.find((response) => response.id === 3);
  if (!toolResponse || toolResponse.error) {
    console.error(output);
    process.exit(1);
  }

  const text = toolResponse.result.content[0].text;
  if (!text.includes('"found": true') || !text.includes('"name": "Google"')) {
    console.error(output);
    process.exit(1);
  }

  console.log("Smoke test passed.");
  console.log(text);
}, 2500);
