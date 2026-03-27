/**
 * 出站消息发送：POST callbackUrl { receiver, text }
 */

/**
 * 发送消息到 bot 的 callback URL。
 * 3 次指数退避重试。
 */
export async function sendWelinkMessage(
  callbackUrl: string,
  receiver: string,
  text: string,
): Promise<{ ok: boolean }> {
  const body = JSON.stringify({ receiver, text });
  const maxRetries = 3;
  const baseDelay = 300;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(callbackUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": String(Buffer.byteLength(body)),
        },
        body,
        signal: AbortSignal.timeout(30_000),
      });

      if (response.ok) {
        return { ok: true };
      }
    } catch {
      // 重试
    }

    if (attempt < maxRetries - 1) {
      await new Promise((resolve) => setTimeout(resolve, baseDelay * Math.pow(2, attempt)));
    }
  }

  return { ok: false };
}
