/**
 * Welink 入站 webhook 处理器。
 * 接收 bot POST 的 JSON { token, sender, text }，验证后交给 AI agent 处理。
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { validateToken } from "./security.js";
import type { WelinkInboundPayload, ResolvedWelinkAccount } from "./types.js";

type BodyReadResult =
  | { ok: true; body: string }
  | { ok: false; statusCode: number; error: string };

/** 读取请求 body */
async function readBody(req: IncomingMessage): Promise<BodyReadResult> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const maxBytes = 1_048_576; // 1MB

    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        resolve({ ok: false, statusCode: 413, error: "Request body too large" });
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      resolve({ ok: true, body: Buffer.concat(chunks).toString("utf8") });
    });

    req.on("error", () => {
      resolve({ ok: false, statusCode: 400, error: "Failed to read request body" });
    });

    setTimeout(() => {
      resolve({ ok: false, statusCode: 408, error: "Request timeout" });
      req.destroy();
    }, 30_000);
  });
}

/** 解析入站 payload */
function parsePayload(body: string): WelinkInboundPayload | null {
  try {
    const parsed = JSON.parse(body);
    if (!parsed || typeof parsed !== "object") return null;

    const token = (parsed.token ?? "").toString().trim();
    const sender = (parsed.sender ?? "").toString().trim();
    const text = (parsed.text ?? "").toString().trim();

    if (!token || !sender || !text) return null;

    return { token, sender, text };
  } catch {
    return null;
  }
}

function respondJson(res: ServerResponse, statusCode: number, body: Record<string, unknown>) {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function respondNoContent(res: ServerResponse) {
  res.writeHead(204);
  res.end();
}

export interface WebhookHandlerDeps {
  account: ResolvedWelinkAccount;
  deliver: (msg: {
    body: string;
    from: string;
    provider: string;
    chatType: string;
    sessionKey: string;
    accountId: string;
  }) => Promise<void>;
  log?: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
}

/**
 * 创建 Welink webhook HTTP handler。
 *
 * 流程：
 * 1. 解析 JSON { token, sender, text }
 * 2. 验证 token (constant-time)
 * 3. 立即返回 204
 * 4. 异步调用 AI agent，回调 bot
 */
export function createWelinkWebhookHandler(deps: WebhookHandlerDeps) {
  const { account, deliver, log } = deps;

  return async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== "POST") {
      respondJson(res, 405, { error: "Method not allowed" });
      return;
    }

    const bodyResult = await readBody(req);
    if (bodyResult.ok === false) {
      respondJson(res, bodyResult.statusCode, { error: bodyResult.error });
      return;
    }

    const payload = parsePayload(bodyResult.body);
    if (!payload) {
      respondJson(res, 400, { error: "Missing required fields (token, sender, text)" });
      return;
    }

    if (!validateToken(payload.token, account.token)) {
      log?.warn(`Invalid token from ${req.socket?.remoteAddress}`);
      respondJson(res, 401, { error: "Invalid token" });
      return;
    }

    if (account.dmPolicy === "disabled") {
      respondJson(res, 403, { error: "Channel is disabled" });
      return;
    }

    const preview = payload.text.length > 100 ? `${payload.text.slice(0, 100)}...` : payload.text;
    log?.info(`Message from ${payload.sender}: ${preview}`);

    // 立即 ACK
    respondNoContent(res);

    // 异步处理
    try {
      const sessionKey = `welink:${account.accountId}:${payload.sender}`;
      const deliverPromise = deliver({
        body: payload.text,
        from: payload.sender,
        provider: "welink",
        chatType: "direct",
        sessionKey,
        accountId: account.accountId,
      });

      const timeoutPromise = new Promise<null>((_, reject) =>
        setTimeout(() => reject(new Error("Agent response timeout (120s)")), 120_000),
      );

      await Promise.race([deliverPromise, timeoutPromise]);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      log?.error(`Failed to process message from ${payload.sender}: ${errMsg}`);
    }
  };
}
