/**
 * Welink Channel Plugin for OpenClaw.
 *
 * 基于 Synology Chat 插件模式，使用 webhook 入站 + HTTP POST 出站。
 */

import {
  DEFAULT_ACCOUNT_ID,
  setAccountEnabledInConfigSection,
  buildChannelConfigSchema,
} from "openclaw/plugin-sdk/core";
import { resolveSenderCommandAuthorizationWithRuntime } from "openclaw/plugin-sdk/command-auth";
import { registerPluginHttpRoute } from "openclaw/plugin-sdk/plugin-runtime";
import { z } from "zod";
import { listWelinkAccountIds, resolveWelinkAccount } from "./accounts.js";
import { sendWelinkMessage } from "./send.js";
import { getWelinkRuntime } from "./runtime.js";
import type { ResolvedWelinkAccount } from "./types.js";
import { createWelinkWebhookHandler } from "./webhook-handler.js";

const CHANNEL_ID = "welink";
const WelinkAccountSchema = z
  .object({
    enabled: z.boolean().optional(),
    callbackUrl: z.string().trim().optional(),
    token: z.string().trim().optional(),
    webhookPath: z.string().trim().optional(),
    dmPolicy: z.enum(["open", "disabled"]).optional(),
    blockStreaming: z.boolean().optional(),
  })
  .passthrough();

const WelinkConfigSchema = buildChannelConfigSchema(
  WelinkAccountSchema.extend({
    accounts: z.record(z.string(), WelinkAccountSchema).optional(),
  }).passthrough(),
);

const activeRoutesByAccount = new Map<
  string,
  {
    path: string;
    unregister: () => void;
  }
>();
const activeRouteOwnersByPath = new Map<string, string>();

function waitUntilAbort(signal?: AbortSignal, onAbort?: () => void): Promise<void> {
  return new Promise((resolve) => {
    const complete = () => {
      onAbort?.();
      resolve();
    };
    if (!signal) return;
    if (signal.aborted) {
      complete();
      return;
    }
    signal.addEventListener("abort", complete, { once: true });
  });
}

function isWelinkSenderAllowed(senderId: string, allowFrom: string[]): boolean {
  const normalizedSenderId = senderId.trim().toLowerCase();
  return allowFrom.some((entry) => entry.trim().toLowerCase() === normalizedSenderId);
}

async function resolveWelinkCommandAuthorized(params: {
  cfg: any;
  account: ResolvedWelinkAccount;
  senderId: string;
  rawBody: string;
}): Promise<boolean | undefined> {
  const runtime = getWelinkRuntime();
  const pairingStore = runtime.channel.pairing;
  const commandRuntime = runtime.channel.commands;

  const { commandAuthorized } = await resolveSenderCommandAuthorizationWithRuntime({
    runtime: {
      shouldComputeCommandAuthorized: commandRuntime.shouldComputeCommandAuthorized,
      resolveCommandAuthorizedFromAuthorizers:
        commandRuntime.resolveCommandAuthorizedFromAuthorizers,
    },
    cfg: params.cfg,
    rawBody: params.rawBody,
    isGroup: false,
    dmPolicy: params.account.dmPolicy,
    configuredAllowFrom: [],
    senderId: params.senderId,
    isSenderAllowed: isWelinkSenderAllowed,
    readAllowFromStore: () =>
      pairingStore.readAllowFromStore({
        channel: CHANNEL_ID,
        accountId: params.account.accountId,
      }),
  });

  return commandAuthorized;
}

export function createWelinkPlugin() {
  return {
    id: CHANNEL_ID,

    meta: {
      id: CHANNEL_ID,
      label: "Welink",
      selectionLabel: "Welink (Webhook)",
      detailLabel: "Welink (Webhook)",
      docsPath: "/channels/welink",
      blurb: "Connect Welink bot to OpenClaw",
      order: 100,
    },

    capabilities: {
      chatTypes: ["direct" as const],
      media: false,
      threads: false,
      reactions: false,
      edit: false,
      unsend: false,
      reply: false,
      effects: false,
      blockStreaming: true,
    },

    reload: { configPrefixes: [`channels.${CHANNEL_ID}`] },

    configSchema: WelinkConfigSchema,

    config: {
      listAccountIds: (cfg: any) => listWelinkAccountIds(cfg),

      resolveAccount: (cfg: any, accountId?: string | null) =>
        resolveWelinkAccount(cfg, accountId),

      defaultAccountId: (_cfg: any) => DEFAULT_ACCOUNT_ID,

      setAccountEnabled: ({ cfg, accountId, enabled }: any) => {
        const channelConfig = cfg?.channels?.[CHANNEL_ID] ?? {};
        if (accountId === DEFAULT_ACCOUNT_ID) {
          return {
            ...cfg,
            channels: {
              ...cfg.channels,
              [CHANNEL_ID]: { ...channelConfig, enabled },
            },
          };
        }
        return setAccountEnabledInConfigSection({
          cfg,
          sectionKey: `channels.${CHANNEL_ID}`,
          accountId,
          enabled,
        });
      },
    },

    security: {
      resolveDmPolicy: ({
        cfg,
        accountId,
        account,
      }: {
        cfg: any;
        accountId?: string | null;
        account: ResolvedWelinkAccount;
      }) => {
        const resolvedAccountId = accountId ?? account.accountId ?? DEFAULT_ACCOUNT_ID;
        const channelCfg = (cfg as any).channels?.welink;
        const useAccountPath = Boolean(channelCfg?.accounts?.[resolvedAccountId]);
        const basePath = useAccountPath
          ? `channels.welink.accounts.${resolvedAccountId}.`
          : "channels.welink.";
        return {
          policy: account.dmPolicy ?? "open",
          allowFrom: [],
          policyPath: `${basePath}dmPolicy`,
          allowFromPath: basePath,
          approveHint: "openclaw pairing approve welink <code>",
        };
      },
      collectWarnings: ({ account }: { account: ResolvedWelinkAccount }) => {
        const warnings: string[] = [];
        if (!account.token) {
          warnings.push(
            "- Welink: token is not configured. The webhook will reject all requests.",
          );
        }
        if (!account.callbackUrl) {
          warnings.push(
            "- Welink: callbackUrl is not configured. Cannot send replies to the bot.",
          );
        }
        return warnings;
      },
    },

    messaging: {
      normalizeTarget: (target: string) => {
        const trimmed = target.trim();
        if (!trimmed) return undefined;
        return trimmed.replace(/^welink:/i, "").trim();
      },
      targetResolver: {
        looksLikeId: (id: string) => {
          const trimmed = id?.trim();
          if (!trimmed) return false;
          return trimmed.length > 0;
        },
        hint: "<senderId>",
      },
    },

    directory: {
      self: async () => null,
      listPeers: async () => [],
      listGroups: async () => [],
    },

    outbound: {
      deliveryMode: "gateway" as const,
      textChunkLimit: 4000,

      sendText: async ({ to, text, accountId, cfg }: any) => {
        const account = resolveWelinkAccount(cfg ?? {}, accountId);

        if (!account.callbackUrl) {
          throw new Error("Welink callbackUrl not configured");
        }

        const result = await sendWelinkMessage(account.callbackUrl, to, text);
        if (!result.ok) {
          throw new Error("Failed to send message to Welink bot");
        }
        return { channel: CHANNEL_ID, messageId: `wl-${Date.now()}`, chatId: to };
      },
    },

    setup: {
      applyAccountConfig: ({ cfg, accountId, input }: any) => {
        const channelConfig = cfg?.channels?.[CHANNEL_ID] ?? {};
        if (accountId === DEFAULT_ACCOUNT_ID) {
          return {
            ...cfg,
            channels: {
              ...cfg.channels,
              [CHANNEL_ID]: {
                ...channelConfig,
                enabled: true,
                ...(input.token ? { token: input.token } : {}),
                ...(input.callbackUrl ? { callbackUrl: input.callbackUrl } : {}),
                ...(input.webhookPath ? { webhookPath: input.webhookPath } : {}),
              },
            },
          };
        }
        return {
          ...cfg,
          channels: {
            ...cfg.channels,
            [CHANNEL_ID]: {
              ...channelConfig,
              enabled: true,
              accounts: {
                ...channelConfig.accounts,
                [accountId]: {
                  ...channelConfig.accounts?.[accountId],
                  enabled: true,
                  ...(input.token ? { token: input.token } : {}),
                  ...(input.callbackUrl ? { callbackUrl: input.callbackUrl } : {}),
                  ...(input.webhookPath ? { webhookPath: input.webhookPath } : {}),
                },
              },
            },
          },
        };
      },
      validateInput: ({ input }: any) => {
        const token = input?.token?.trim?.() ?? "";
        const callbackUrl = input?.callbackUrl?.trim?.() ?? "";
        const envToken = process.env.WELINK_TOKEN?.trim() ?? "";
        const envCallbackUrl = process.env.WELINK_CALLBACK_URL?.trim() ?? "";

        if (!token && !envToken) {
          return "Welink requires --token (or set WELINK_TOKEN env var).";
        }
        if (!callbackUrl && !envCallbackUrl) {
          return "Welink requires --callback-url (or set WELINK_CALLBACK_URL env var).";
        }
        return null;
      },
    },

    gateway: {
      startAccount: async (ctx: any) => {
        const { cfg, accountId, log } = ctx;
        const account = resolveWelinkAccount(cfg, accountId);

        if (!account.enabled) {
          log?.info?.(`Welink account ${accountId} is disabled, skipping`);
          return waitUntilAbort(ctx.abortSignal);
        }

        if (!account.token || !account.callbackUrl) {
          log?.warn?.(
            `Welink account ${accountId} not fully configured (missing token or callbackUrl)`,
          );
          return waitUntilAbort(ctx.abortSignal);
        }

        log?.info?.(
          `Starting Welink channel (account: ${accountId}, path: ${account.webhookPath})`,
        );

        const handler = createWelinkWebhookHandler({
          account,
          deliver: async (msg) => {
            const rt = getWelinkRuntime();
            const currentCfg = await rt.config.loadConfig();
            const commandAuthorized = await resolveWelinkCommandAuthorized({
              cfg: currentCfg,
              account,
              senderId: msg.from,
              rawBody: msg.body,
            }).catch((error) => {
              log?.warn?.(
                `Failed to resolve command authorization for ${msg.from}: ${error instanceof Error ? error.message : String(error)}`,
              );
              return false;
            });

            const msgCtx = rt.channel.reply.finalizeInboundContext({
              Body: msg.body,
              RawBody: msg.body,
              CommandBody: msg.body,
              From: `welink:${msg.from}`,
              To: `welink:${msg.from}`,
              SessionKey: msg.sessionKey,
              AccountId: account.accountId,
              OriginatingChannel: CHANNEL_ID,
              OriginatingTo: `welink:${msg.from}`,
              ChatType: msg.chatType,
              SenderName: msg.from,
              SenderId: msg.from,
              Provider: CHANNEL_ID,
              Surface: CHANNEL_ID,
              ConversationLabel: msg.from,
              Timestamp: Date.now(),
              CommandAuthorized: commandAuthorized,
            });

            await rt.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
              ctx: msgCtx,
              cfg: currentCfg,
              dispatcherOptions: {
                deliver: async (payload: { text?: string; body?: string }) => {
                  const text = payload?.text ?? payload?.body;
                  if (text) {
                    await sendWelinkMessage(account.callbackUrl, msg.from, text);
                  }
                },
                onReplyStart: () => {
                  log?.info?.(`Agent reply started for ${msg.from}`);
                },
              },
            });

            return undefined;
          },
          log,
        });

        const accountKey = account.accountId;
        const routePath = account.webhookPath;
        const previousRoute = activeRoutesByAccount.get(accountKey);
        if (previousRoute) {
          log?.info?.(`Deregistering stale route for ${accountKey}: ${previousRoute.path}`);
          previousRoute.unregister();
          activeRoutesByAccount.delete(accountKey);
          if (activeRouteOwnersByPath.get(previousRoute.path) === accountKey) {
            activeRouteOwnersByPath.delete(previousRoute.path);
          }
        }

        const existingOwner = activeRouteOwnersByPath.get(routePath);
        if (existingOwner && existingOwner !== accountKey) {
          log?.error?.(
            `Welink route conflict: ${routePath} is already owned by account ${existingOwner}. Configure a unique webhookPath for ${accountKey}.`,
          );
          return waitUntilAbort(ctx.abortSignal);
        }

        const unregister = registerPluginHttpRoute({
          path: routePath,
          auth: "plugin",
          replaceExisting: true,
          pluginId: CHANNEL_ID,
          accountId: account.accountId,
          log: (msg: string) => log?.info?.(msg),
          handler,
        });
        activeRoutesByAccount.set(accountKey, { path: routePath, unregister });
        activeRouteOwnersByPath.set(routePath, accountKey);

        log?.info?.(`Registered HTTP route: ${routePath}`);

        return waitUntilAbort(ctx.abortSignal, () => {
          log?.info?.(`Stopping Welink channel (account: ${accountId})`);
          if (typeof unregister === "function") {
            unregister();
          }
          const currentRoute = activeRoutesByAccount.get(accountKey);
          if (currentRoute?.path === routePath) {
            activeRoutesByAccount.delete(accountKey);
          }
          if (activeRouteOwnersByPath.get(routePath) === accountKey) {
            activeRouteOwnersByPath.delete(routePath);
          }
        });
      },

      stopAccount: async (ctx: any) => {
        ctx.log?.info?.(`Welink account ${ctx.accountId} stopped`);
      },
    },
  };
}
