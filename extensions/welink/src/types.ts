/**
 * Welink channel plugin 类型定义
 */

type WelinkConfigFields = {
  enabled?: boolean;
  callbackUrl?: string;
  token?: string;
  webhookPath?: string;
  dmPolicy?: "open" | "disabled";
  blockStreaming?: boolean;
};

/** 原始 channel 配置 channels.welink */
export interface WelinkChannelConfig extends WelinkConfigFields {
  accounts?: Record<string, WelinkAccountRaw>;
}

/** 原始 per-account 配置 */
export interface WelinkAccountRaw extends WelinkConfigFields {}

/** 完全解析后的 account 配置 */
export interface ResolvedWelinkAccount {
  accountId: string;
  enabled: boolean;
  callbackUrl: string;
  token: string;
  webhookPath: string;
  dmPolicy: "open" | "disabled";
  blockStreaming: boolean;
}

/** Bot 发送到 webhook 的入站消息 */
export interface WelinkInboundPayload {
  token: string;
  sender: string;
  text: string;
}
