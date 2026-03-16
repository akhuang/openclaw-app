const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn, execSync, exec } = require('child_process');
const net = require('net');

// ==================== 配置区域 ====================
const INTERNAL_PORT = 18789; // OpenClaw 实际运行的端口 (本机)
const EXTERNAL_PORT = 18889; // 小鲁班访问的端口 (代理)

const SERVER_URL = 'http://xiaoluban.rnd.huawei.com:80/y/llm/register-gateway';
const REGISTER_TIMEOUT_MS = 10000; // 注册请求超时

const ALLOWED_IPS = [
    '10.29.152.70',
    '7.223.180.126',
];

// OpenClaw 端口就绪检测
const READY_CHECK_INTERVAL_MS = 500;
const READY_CHECK_MAX_WAIT_MS = 60000;

// 子进程重启
const MAX_RESTART_COUNT = 3;
const RESTART_COOLDOWN_MS = 5000;

// ==================== 路径 ====================
const ROOT_DIR = path.resolve(__dirname, '..');
const NODE_EXE = path.join(ROOT_DIR, 'bin', 'node.exe');
const OPENCLAW_ENTRY = path.join(ROOT_DIR, 'app', 'node_modules', 'openclaw', 'openclaw.mjs');
const TEMPLATE_JSON = path.join(__dirname, 'openclaw.json');
const SKILLS_DIR = path.join(ROOT_DIR, 'skills');
const TARGET_JSON_DIR = path.join(os.homedir(), '.openclaw');
const TARGET_JSON_FILE = path.join(TARGET_JSON_DIR, 'openclaw.json');
const BACKUP_JSON_FILE = path.join(TARGET_JSON_DIR, 'openclaw.json.bak');

// ==================== 全局状态 ====================
let WHOAMI = 'unknown';
let openclawProcess = null;
let restartCount = 0;
let lastRestartTime = 0;

// ==================== 工具函数 ====================
function log(level, msg) {
    const ts = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    const icons = { info: 'ℹ️', ok: '✅', warn: '⚠️', error: '❌', step: '📌' };
    console.log(`[${ts}] ${icons[level] || ''} ${msg}`);
}

function getWhoami() {
    try {
        WHOAMI = execSync('whoami', { timeout: 5000 }).toString().trim();
    } catch {
        log('warn', '无法获取 whoami，使用默认值 unknown');
    }
}

/** 检测端口是否被占用 */
function isPortInUse(port) {
    return new Promise((resolve) => {
        const server = net.createServer();
        server.once('error', () => resolve(true));
        server.once('listening', () => { server.close(); resolve(false); });
        server.listen(port, '127.0.0.1');
    });
}

/** 等待端口就绪 (有服务在监听) */
function waitForPort(port, maxWaitMs = READY_CHECK_MAX_WAIT_MS) {
    const start = Date.now();
    return new Promise((resolve, reject) => {
        function check() {
            if (Date.now() - start > maxWaitMs) {
                return reject(new Error(`端口 ${port} 在 ${maxWaitMs / 1000}s 内未就绪`));
            }
            const sock = new net.Socket();
            sock.setTimeout(READY_CHECK_INTERVAL_MS);
            sock.once('connect', () => { sock.destroy(); resolve(); });
            sock.once('error', () => { sock.destroy(); setTimeout(check, READY_CHECK_INTERVAL_MS); });
            sock.once('timeout', () => { sock.destroy(); setTimeout(check, READY_CHECK_INTERVAL_MS); });
            sock.connect(port, '127.0.0.1');
        }
        check();
    });
}

/** 带 timeout 的 fetch */
async function fetchWithTimeout(url, options, timeoutMs = REGISTER_TIMEOUT_MS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

/** 规范化 IP 地址，统一处理 IPv4/IPv6 */
function normalizeIP(addr) {
    if (!addr) return '';
    // IPv4-mapped IPv6: ::ffff:10.0.0.1
    if (addr.startsWith('::ffff:')) return addr.substring(7);
    // IPv6 loopback
    if (addr === '::1') return '127.0.0.1';
    return addr;
}

// ==================== 步骤 1: 生成并部署配置文件 ====================
function setupConfig() {
    log('step', '[1/4] 基于模板初始化配置文件...');

    try {
        let existingToken = null;

        // 1. 从旧配置提取 Token
        if (fs.existsSync(TARGET_JSON_FILE)) {
            try {
                const oldConfig = JSON.parse(fs.readFileSync(TARGET_JSON_FILE, 'utf8'));
                existingToken = oldConfig?.gateway?.auth?.token;
                if (existingToken) {
                    log('info', `从旧配置提取已有 Token: ${existingToken.substring(0, 8)}...`);
                }
                // 覆盖前备份
                fs.copyFileSync(TARGET_JSON_FILE, BACKUP_JSON_FILE);
                log('info', `旧配置已备份: ${BACKUP_JSON_FILE}`);
            } catch (e) {
                log('warn', '旧配置文件解析失败，将生成新 Token');
            }
        }

        // 2. 读取模板
        if (!fs.existsSync(TEMPLATE_JSON)) {
            throw new Error(`找不到模板文件: ${TEMPLATE_JSON}`);
        }

        let templateRaw = fs.readFileSync(TEMPLATE_JSON, 'utf8');
        let config;
        try {
            config = JSON.parse(templateRaw);
        } catch (e) {
            throw new Error(`模板 JSON 格式错误: ${e.message}`);
        }

        // 3. Token
        const finalToken = existingToken || crypto.randomBytes(24).toString('hex');
        if (!existingToken) {
            log('info', `生成新 Token: ${finalToken.substring(0, 8)}...`);
        }

        // 4. 注入配置
        if (!config.gateway) config.gateway = {};
        if (!config.gateway.auth) config.gateway.auth = {};
        config.gateway.auth.token = finalToken;
        config.gateway.port = INTERNAL_PORT;

        // LLM provider apiKey
        if (!config.models) config.models = {};
        if (!config.models.providers) config.models.providers = {};
        if (!config.models.providers.xlb) config.models.providers.xlb = {};

        const templateApiKey = config.models.providers.xlb.apiKey;
        if (!templateApiKey || templateApiKey === 'xxx') {
            config.models.providers.xlb.apiKey = WHOAMI;
            log('info', `apiKey 设置为: ${WHOAMI}`);
        } else {
            log('info', `apiKey 保留模板值: ${templateApiKey}`);
        }

        // 5. 注入 browser 配置 (用于 intranet-analyzer skill)
        if (!config.browser) {
            config.browser = {
                enabled: true,
                defaultProfile: 'user',
                evaluateEnabled: true,
                profiles: {
                    user: { cdpPort: 9222 }
                }
            };
        }

        // 6. 注入 skills 加载路径
        if (!config.skills) config.skills = {};
        if (!config.skills.load) config.skills.load = {};
        if (!config.skills.load.extraDirs) config.skills.load.extraDirs = [];
        if (!config.skills.load.extraDirs.includes(SKILLS_DIR)) {
            config.skills.load.extraDirs.push(SKILLS_DIR);
        }

        // 7. 写入
        if (!fs.existsSync(TARGET_JSON_DIR)) {
            fs.mkdirSync(TARGET_JSON_DIR, { recursive: true });
        }
        fs.writeFileSync(TARGET_JSON_FILE, JSON.stringify(config, null, 2));
        log('ok', `配置已写入: ${TARGET_JSON_FILE}`);

        return { token: finalToken };
    } catch (err) {
        log('error', `配置初始化失败: ${err.message}`);
        process.exit(1);
    }
}

// ==================== 步骤 2: 注册到服务端 ====================
async function registerToServer(token) {
    log('step', '[2/4] 向服务端注册...');

    try {
        const payload = {
            port: EXTERNAL_PORT,
            token: token,
            whoami: WHOAMI,
        };

        log('info', `注册信息: User=${WHOAMI}, Port=${EXTERNAL_PORT}`);

        const response = await fetchWithTimeout(SERVER_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });

        if (response.ok) {
            const resJson = await response.json().catch(() => ({}));
            log('ok', '注册成功!');
            if (resJson.client_ip) log('info', `Server 识别 IP: ${resJson.client_ip}`);
        } else {
            log('warn', `注册响应异常: ${response.status} ${response.statusText}`);
        }
    } catch (err) {
        if (err.name === 'AbortError') {
            log('warn', `注册请求超时 (${REGISTER_TIMEOUT_MS / 1000}s)，跳过`);
        } else {
            log('warn', `无法连接注册服务器，跳过: ${err.message}`);
        }
    }
}

// ==================== 步骤 3: 启动 OpenClaw ====================
function startOpenClaw() {
    log('step', '[3/4] 启动 OpenClaw Gateway...');

    function launch() {
        const child = spawn(
            NODE_EXE,
            ['--max-old-space-size=8192', OPENCLAW_ENTRY, 'gateway', '--port', INTERNAL_PORT.toString()],
            { stdio: 'inherit', cwd: ROOT_DIR }
        );

        child.on('error', (err) => {
            log('error', `OpenClaw 启动失败: ${err.message}`);
            process.exit(1);
        });

        child.on('exit', (code, signal) => {
            if (signal === 'SIGTERM' || signal === 'SIGINT') {
                // 正常关闭
                return;
            }

            const now = Date.now();
            // 重置计数器（如果距离上次重启超过冷却期）
            if (now - lastRestartTime > RESTART_COOLDOWN_MS * MAX_RESTART_COUNT) {
                restartCount = 0;
            }

            if (restartCount < MAX_RESTART_COUNT) {
                restartCount++;
                lastRestartTime = now;
                log('warn', `OpenClaw 异常退出 (code=${code})，${RESTART_COOLDOWN_MS / 1000}s 后重启 (${restartCount}/${MAX_RESTART_COUNT})...`);
                setTimeout(launch, RESTART_COOLDOWN_MS);
            } else {
                log('error', `OpenClaw 连续崩溃 ${MAX_RESTART_COUNT} 次，放弃重启`);
                process.exit(1);
            }
        });

        openclawProcess = child;
    }

    launch();
}

// ==================== 步骤 4: 启动端口转发代理 ====================
function startProxy(token) {
    log('step', '[4/4] 启动安全代理...');
    log('info', `代理转发: 0.0.0.0:${EXTERNAL_PORT} -> 127.0.0.1:${INTERNAL_PORT}`);
    log('info', `白名单 IP: ${ALLOWED_IPS.join(', ')}`);

    const PROXY_SOCKET_TIMEOUT_MS = 30000;

    const server = net.createServer((clientSocket) => {
        const remoteAddr = normalizeIP(clientSocket.remoteAddress);

        if (!ALLOWED_IPS.includes(remoteAddr)) {
            log('warn', `拦截未授权 IP: ${remoteAddr}`);
            clientSocket.destroy();
            return;
        }

        const serviceSocket = new net.Socket();
        serviceSocket.setTimeout(PROXY_SOCKET_TIMEOUT_MS);

        serviceSocket.connect(INTERNAL_PORT, '127.0.0.1', () => {
            clientSocket.pipe(serviceSocket);
            serviceSocket.pipe(clientSocket);
        });

        function cleanup() {
            clientSocket.destroy();
            serviceSocket.destroy();
        }

        serviceSocket.on('error', cleanup);
        serviceSocket.on('timeout', cleanup);
        clientSocket.on('error', cleanup);
        clientSocket.on('close', cleanup);
    });

    server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            log('error', `代理端口 ${EXTERNAL_PORT} 已被占用，请检查是否有其他实例在运行`);
        } else {
            log('error', `代理启动失败: ${err.message}`);
        }
        // 代理挂了不影响本地使用，不 exit
    });

    server.listen(EXTERNAL_PORT, '0.0.0.0', () => {
        const localUrl = `http://127.0.0.1:${INTERNAL_PORT}`;
        log('ok', '====================================');
        log('ok', `服务已就绪!`);
        log('ok', `本地访问: ${localUrl}`);
        log('ok', `小鲁班代理端口: ${EXTERNAL_PORT}`);
        log('ok', '====================================');

        // 打开浏览器 (不在 URL 里放 token)
        if (process.platform === 'win32') {
            exec(`start ${localUrl}`);
        }
    });
}

// ==================== 清理 ====================
function setupCleanup() {
    let cleaning = false;
    function cleanup() {
        if (cleaning) return;
        cleaning = true;
        log('info', '正在关闭...');
        if (openclawProcess && !openclawProcess.killed) {
            openclawProcess.kill('SIGTERM');
        }
        // 给子进程 2 秒优雅退出
        setTimeout(() => process.exit(0), 2000);
    }
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
    process.on('uncaughtException', (err) => {
        log('error', `未捕获异常: ${err.message}`);
        cleanup();
    });
}

// ==================== 主流程 ====================
(async () => {
    setupCleanup();

    // 获取用户名 (全局只调一次)
    getWhoami();

    // 1. 检查端口是否被占用
    const [internalInUse, externalInUse] = await Promise.all([
        isPortInUse(INTERNAL_PORT),
        isPortInUse(EXTERNAL_PORT),
    ]);

    if (internalInUse) {
        log('error', `端口 ${INTERNAL_PORT} 已被占用。可能已有 OpenClaw 实例在运行。`);
        log('info', `可访问 http://127.0.0.1:${INTERNAL_PORT}`);
        if (process.platform === 'win32') {
            exec(`start http://127.0.0.1:${INTERNAL_PORT}`);
        }
        process.exit(0);
    }

    if (externalInUse) {
        log('warn', `代理端口 ${EXTERNAL_PORT} 已被占用，代理功能将不可用，本地服务正常启动`);
    }

    // 2. 配置
    const { token } = setupConfig();

    // 3. 注册 (不阻塞太久，有 timeout)
    await registerToServer(token);

    // 4. 启动 OpenClaw
    startOpenClaw();

    // 5. 等待 OpenClaw 端口就绪后再启动代理
    log('info', `等待 OpenClaw 端口 ${INTERNAL_PORT} 就绪...`);
    try {
        await waitForPort(INTERNAL_PORT);
        log('ok', 'OpenClaw 已就绪');
        if (!externalInUse) {
            startProxy(token);
        }
    } catch (err) {
        log('error', err.message);
        log('warn', '代理未启动，但 OpenClaw 进程仍在运行，请检查日志');
    }
})();
