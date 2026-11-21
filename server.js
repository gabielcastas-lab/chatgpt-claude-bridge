import express from "express";
import { timingSafeEqual } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(express.json({ limit: "1mb" }));

const PORT = Number(process.env.PORT || 3000);
const AUTH_TOKEN = process.env.MCP_AUTH_TOKEN;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const DEFAULT_MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-5";
const ALLOWED_MODELS = new Set([
  "claude-sonnet-4-5",
  "claude-haiku-4-5",
  "claude-opus-5"
]);

if (!AUTH_TOKEN || AUTH_TOKEN.length < 32) {
  throw new Error("MCP_AUTH_TOKEN must be set to a random value of at least 32 characters.");
}
if (!ANTHROPIC_API_KEY) {
  throw new Error("ANTHROPIC_API_KEY is not configured. Add it in your host's secret environment variables.");
}
if (!ALLOWED_MODELS.has(DEFAULT_MODEL)) {
  throw new Error("CLAUDE_MODEL is not in the server's allowed model list.");
}

const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
const requestCounts = new Map();
const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 30;

function safeTokenMatch(candidate, expected) {
  if (typeof candidate !== "string") return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function authenticate(req, res, next) {
  const header = req.get("authorization") || "";
  const candidate = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!safeTokenMatch(candidate, AUTH_TOKEN)) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

function rateLimit(req, res, next) {
  const now = Date.now();
  for (const [ip, entry] of requestCounts) {
    if (now - entry.start >= WINDOW_MS) requestCounts.delete(ip);
  }
  const key = req.ip || "unknown";
  const current = requestCounts.get(key);
  if (!current || now - current.start >= WINDOW_MS) {
    requestCounts.set(key, { start: now, count: 1 });
    return next();
  }
  if (current.count >= MAX_REQUESTS_PER_WINDOW) {
    return res.status(429).json({ error: "Rate limit exceeded. Try again in a minute." });
  }
  current.count += 1;
  next();
}

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "chatgpt-claude-bridge",
    anthropicConfigured: Boolean(ANTHROPIC_API_KEY),
    authConfigured: Boolean(AUTH_TOKEN)
  });
});

app.post("/mcp", authenticate, rateLimit, async (req, res) => {
  const server = new McpServer({
    name: "chatgpt-claude-bridge",
    version: "1.0.0"
  });

  server.registerTool(
    "ask_claude",
    {
      title: "Ask Claude",
      description: "Send a prompt to Claude through the Anthropic Messages API and return its answer.",
      inputSchema: {
        prompt: z.string().trim().min(1).max(20000).describe("The question or task for Claude."),
        model: z.enum(["claude-sonnet-4-5", "claude-haiku-4-5", "claude-opus-4-5"]).optional().describe("Optional Claude model."),
        max_tokens: z.number().int().min(1).max(4096).optional().describe("Maximum response tokens; defaults to 1200.")
      }
    },
    async ({ prompt, model, max_tokens }) => {
      try {
        const selectedModel = model || DEFAULT_MODEL;
        const response = await anthropic.messages.create({
          model: selectedModel,
          max_tokens: max_tokens || 1200,
          messages: [{ role: "user", content: prompt }]
        });
        const answer = response.content
          .filter((item) => item.type === "text")
          .map((item) => item.text)
          .join("\n");
        return {
          content: [{ type: "text", text: answer || "Claude returned no text." }],
          structuredContent: {
            model: response.model,
            stop_reason: response.stop_reason,
            usage: response.usage
          }
        };
      } catch (error) {
        const message = error?.status === 429
          ? "Anthropic rate limit reached. Try again later."
          : error?.status === 401
            ? "Anthropic rejected the API key. Check the ANTHROPIC_API_KEY secret."
            : "Claude request failed. Check the server logs for the request ID.";
        console.error("ask_claude failed:", {
          status: error?.status,
          requestId: error?.request_id,
          message: error?.message
        });
        return {
          isError: true,
          content: [{ type: "text", text: message }]
        };
      }
    }
  );

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined
  });

  res.on("close", () => {
    void transport.close();
    void server.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("MCP request failed:", error?.message || error);
    if (!res.headersSent) res.status(500).json({ error: "MCP request failed" });
  }
});

app.all("/mcp", (_req, res) => {
  res.set("Allow", "POST");
  res.status(405).json({ error: "Use POST for MCP requests." });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`ChatGPT + Claude Bridge listening on port ${PORT}`);
});
