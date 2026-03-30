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

function spawnDetached(command, args) {
    const child = spawn(command, args, {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
    });
    child.on('error', () => {});
    child.unref();
}

function openInBrowser(url) {
    if (process.platform === 'win32') {
        const safeUrl = url.replace(/"/g, '""');
        spawnDetached('cmd.exe', ['/d', '/s', '/c', `start "" "${safeUrl}"`]);
        return;
    }

    if (process.platform === 'darwin') {
        spawnDetached('open', [url]);
        return;
    }

    spawnDetached('xdg-open', [url]);
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

    openInBrowser(loginUrl);
    console.log('[启动] 已自动打开 OpenClaw 控制台');
}

main().catch((error) => {
    console.warn(`[警告] 未自动打开浏览器: ${error.message}`);
    process.exit(0);
});
