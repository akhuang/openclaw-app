/**
 * 账号解析：从 channels.welink 读取配置，
 * 合并 per-account 覆盖，fallback 到环境变量。
 */

import type { WelinkChannelConfig, ResolvedWelinkAccount } from "./types.js";

function getChannelConfig(cfg: any): WelinkChannelConfig | undefined {
  return cfg?.channels?.welink;
}

function defaultWebhookPathForAccount(accountId: string): string {
  return `/webhook/welink/${encodeURIComponent(accountId || "default")}`;
}

function normalizeWebhookPath(path: string | undefined, accountId: string): string {
  const trimmed = path?.trim() ?? "";
  if (!trimmed) {
    return defaultWebhookPathForAccount(accountId);
  }

  const withLeadingSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  if (withLeadingSlash === "/") {
    return defaultWebhookPathForAccount(accountId);
  }
  return withLeadingSlash.replace(/\/+$/, "");
}

/**
 * 列出所有已配置的 account ID。
 */
export function listWelinkAccountIds(cfg: any): string[] {
  const channelCfg = getChannelConfig(cfg);
  if (!channelCfg) return [];

  const ids = new Set<string>();

  const hasBaseToken = channelCfg.token || process.env.WELINK_TOKEN;
  if (hasBaseToken) {
    ids.add("default");
  }

  if (channelCfg.accounts) {
    for (const id of Object.keys(channelCfg.accounts)) {
      ids.add(id);
    }
  }

  return Array.from(ids);
}

/**
 * 解析指定 account，应用默认值。
 * 三层 fallback: account override > base config > env vars
 */
export function resolveWelinkAccount(
  cfg: any,
  accountId?: string | null,
): ResolvedWelinkAccount {
  const channelCfg = getChannelConfig(cfg) ?? {};
  const id = accountId || "default";
  const accountOverride = channelCfg.accounts?.[id] ?? {};

  const envToken = process.env.WELINK_TOKEN ?? "";
  const envCallbackUrl = process.env.WELINK_CALLBACK_URL ?? "";

  return {
    accountId: id,
    enabled: accountOverride.enabled ?? channelCfg.enabled ?? true,
    callbackUrl: accountOverride.callbackUrl ?? channelCfg.callbackUrl ?? envCallbackUrl,
    token: accountOverride.token ?? channelCfg.token ?? envToken,
    webhookPath: normalizeWebhookPath(
      accountOverride.webhookPath ?? channelCfg.webhookPath,
      id,
    ),
    dmPolicy: accountOverride.dmPolicy ?? channelCfg.dmPolicy ?? "open",
    blockStreaming: accountOverride.blockStreaming ?? channelCfg.blockStreaming ?? true,
  };
}

export function resolveDefaultWelinkAccountId(_cfg: any): string {
  return "default";
}
