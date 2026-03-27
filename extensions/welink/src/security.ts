/**
 * 安全模块：token 验证（constant-time 比较）
 */

import * as crypto from "node:crypto";

/**
 * 使用 constant-time 比较验证 webhook token。
 * 通过 HMAC 归一化长度后再比较，防止时序攻击。
 */
export function validateToken(received: string, expected: string): boolean {
  if (!received || !expected) return false;

  const key = "openclaw-token-cmp";
  const a = crypto.createHmac("sha256", key).update(received).digest();
  const b = crypto.createHmac("sha256", key).update(expected).digest();

  return crypto.timingSafeEqual(a, b);
}
