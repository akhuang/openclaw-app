const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const DEFAULT_PORT = 18789;
const DEFAULT_TIMEOUT_MS = Number(process.env.OPENCLAW_DASHBOARD_OPEN_TIMEOUT_MS || 30000);
const POLL_INTERVAL_MS = 500;
const REQUEST_TIMEOUT_MS = 1500;
const DEFAULT_STATE_DIR = path.join(ROOT_DIR, 'data', '.openclaw');
const CONFIG_PATH = path.resolve(
    process.env.OPENCLAW_CONFIG_PATH || path.join(DEFAULT_STATE_DIR, 'openclaw.json')
);

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function readConfig() {
    if (!fs.existsSync(CONFIG_PATH)) {
        throw new Error(`找不到 OpenClaw 配置文件: ${CONFIG_PATH}`);
    }

    try {
        return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    } catch (error) {
        throw new Error(`OpenClaw 配置文件解析失败: ${error.message}`);
    }
}

function normalizeBasePath(value) {
    const raw = typeof value === 'string' ? value.trim() : '';
    if (!raw || raw === '/') {
        return '/';
    }

    let basePath = raw.startsWith('/') ? raw : `/${raw}`;
    if (!basePath.endsWith('/')) {
        basePath = `${basePath}/`;
    }
    return basePath;
}

function resolveDashboardConfig(config) {
    const configuredPort = Number(config?.gateway?.port);
    const port =
        Number.isInteger(configuredPort) && configuredPort > 0 && configuredPort <= 65535
            ? configuredPort
            : DEFAULT_PORT;

    const envToken = (process.env.OPENCLAW_GATEWAY_TOKEN || '').trim();
    const configToken =
        typeof config?.gateway?.auth?.token === 'string' ? config.gateway.auth.token.trim() : '';
    const token = envToken || configToken;

    const basePath = normalizeBasePath(config?.gateway?.controlUi?.basePath);

    return { port, token, basePath };
}

function buildDashboardUrl({ port, token, basePath }) {
    const cleanUrl = `http://127.0.0.1:${port}${basePath}`;
    if (!token) {
        return cleanUrl;
    }

    const fragment = new URLSearchParams({ token }).toString();
    return `${cleanUrl}#${fragment}`;
}

async function isGatewayReady(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
        const response = await fetch(url, {
            method: 'GET',
            redirect: 'manual',
            signal: controller.signal,
            headers: {
                'cache-control': 'no-cache',
            },
        });

        return response.status >= 200 && response.status < 500;
    } catch {
        return false;
    } finally {
        clearTimeout(timer);
    }
}

async function waitForGateway(cleanUrl, timeoutMs) {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
        if (await isGatewayReady(cleanUrl)) {
            return;
        }

        await sleep(POLL_INTERVAL_MS);
    }

    throw new Error(
        `等待 Gateway 就绪超时 (${Math.round(timeoutMs / 1000)} 秒): ${cleanUrl}`
    );
}

function spawnAndWait(command, args) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            detached: false,
            shell: false,
            stdio: 'ignore',
            windowsHide: true,
        });

        let settled = false;

        child.once('error', (error) => {
            if (settled) {
                return;
            }
            settled = true;
            reject(error);
        });

        child.once('exit', (code, signal) => {
            if (settled) {
                return;
            }
            settled = true;

            if (code === 0) {
                resolve();
                return;
            }

            if (signal) {
                reject(new Error(`${command} 被信号终止: ${signal}`));
                return;
            }

            reject(new Error(`${command} 退出码 ${String(code)}`));
        });
    });
}

function escapePowerShellString(value) {
    return `'${String(value).replace(/'/g, "''")}'`;
}

async function openInBrowser(url) {
    const attempts =
        process.platform === 'win32'
            ? [
                  {
                      label: 'cmd start',
                      command: 'cmd.exe',
                      args: ['/d', '/s', '/c', `start "" "${url.replace(/"/g, '""')}"`],
                  },
                  {
                      label: 'powershell Start-Process',
                      command: 'powershell.exe',
                      args: [
                          '-NoProfile',
                          '-NonInteractive',
                          '-Command',
                          `Start-Process ${escapePowerShellString(url)}`,
                      ],
                  },
                  {
                      label: 'explorer',
                      command: 'explorer.exe',
                      args: [url],
                  },
              ]
            : process.platform === 'darwin'
              ? [
                    {
                        label: 'open',
                        command: 'open',
                        args: [url],
                    },
                ]
              : [
                    {
                        label: 'xdg-open',
                        command: 'xdg-open',
                        args: [url],
                    },
                    {
                        label: 'gio open',
                        command: 'gio',
                        args: ['open', url],
                    },
                ];

    const errors = [];
    for (const attempt of attempts) {
        try {
            await spawnAndWait(attempt.command, attempt.args);
            return attempt.label;
        } catch (error) {
            errors.push(`${attempt.label}: ${error.message}`);
        }
    }

    throw new Error(errors.join(' | '));
}

async function main() {
    const config = readConfig();
    const dashboard = resolveDashboardConfig(config);
    const cleanUrl = `http://127.0.0.1:${dashboard.port}${dashboard.basePath}`;
    const loginUrl = buildDashboardUrl(dashboard);

    console.log(`[启动] 等待 OpenClaw Gateway 就绪: ${cleanUrl}`);
    await waitForGateway(cleanUrl, DEFAULT_TIMEOUT_MS);

    if (!dashboard.token) {
        console.warn('[警告] 未在配置中解析到 gateway.auth.token，将打开未附带 token 的地址');
    }

    const launcher = await openInBrowser(loginUrl);
    console.log(`[启动] 已请求系统打开 OpenClaw 控制台: ${loginUrl} (${launcher})`);
}

main().catch((error) => {
    let message = error.message;
    if (!message && typeof error === 'object' && error) {
        message = String(error);
    }
    console.warn(`[警告] 未自动打开浏览器: ${message}`);
    try {
        const config = readConfig();
        const dashboard = resolveDashboardConfig(config);
        console.warn(`[警告] 请手动打开: ${buildDashboardUrl(dashboard)}`);
    } catch {}
    process.exit(0);
});
