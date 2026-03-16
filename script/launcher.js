const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execSync } = require('child_process');

// ==================== 配置区域 ====================
const INTERNAL_PORT = 18789;
const EXTERNAL_PORT = 18889;
const SERVER_URL = 'http://xiaoluban.rnd.huawei.com:80/y/llm/register-gateway';
const REGISTER_TIMEOUT_MS = 10000;

// ==================== 路径 ====================
const ROOT_DIR = path.resolve(__dirname, '..');
const TEMPLATE_JSON = path.join(__dirname, 'openclaw.json');
const SKILLS_DIR = path.join(ROOT_DIR, 'skills');
const TARGET_JSON_DIR = path.join(os.homedir(), '.openclaw');
const TARGET_JSON_FILE = path.join(TARGET_JSON_DIR, 'openclaw.json');
const BACKUP_JSON_FILE = path.join(TARGET_JSON_DIR, 'openclaw.json.bak');

// ==================== 全局 ====================
let WHOAMI = 'unknown';

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

async function fetchWithTimeout(url, options, timeoutMs = REGISTER_TIMEOUT_MS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

// ==================== 步骤 1: 生成并部署配置文件 ====================
function setupConfig() {
    log('step', '[1/2] 基于模板初始化配置文件...');

    try {
        let existingToken = null;

        if (fs.existsSync(TARGET_JSON_FILE)) {
            try {
                const oldConfig = JSON.parse(fs.readFileSync(TARGET_JSON_FILE, 'utf8'));
                existingToken = oldConfig?.gateway?.auth?.token;
                if (existingToken) {
                    log('info', `从旧配置提取已有 Token: ${existingToken.substring(0, 8)}...`);
                }
                fs.copyFileSync(TARGET_JSON_FILE, BACKUP_JSON_FILE);
                log('info', `旧配置已备份: ${BACKUP_JSON_FILE}`);
            } catch (e) {
                log('warn', '旧配置文件解析失败，将生成新 Token');
            }
        }

        if (!fs.existsSync(TEMPLATE_JSON)) {
            throw new Error(`找不到模板文件: ${TEMPLATE_JSON}`);
        }

        let config;
        try {
            config = JSON.parse(fs.readFileSync(TEMPLATE_JSON, 'utf8'));
        } catch (e) {
            throw new Error(`模板 JSON 格式错误: ${e.message}`);
        }

        const finalToken = existingToken || crypto.randomBytes(24).toString('hex');
        if (!existingToken) {
            log('info', `生成新 Token: ${finalToken.substring(0, 8)}...`);
        }

        if (!config.gateway) config.gateway = {};
        if (!config.gateway.auth) config.gateway.auth = {};
        config.gateway.auth.token = finalToken;
        config.gateway.port = INTERNAL_PORT;

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

        if (!config.browser) config.browser = {};
        config.browser.enabled = true;

        if (!config.skills) config.skills = {};
        if (!config.skills.load) config.skills.load = {};
        if (!config.skills.load.extraDirs) config.skills.load.extraDirs = [];
        if (!config.skills.load.extraDirs.includes(SKILLS_DIR)) {
            config.skills.load.extraDirs.push(SKILLS_DIR);
        }

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
    log('step', '[2/2] 向服务端注册...');

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

// ==================== 主流程 ====================
(async () => {
    getWhoami();
    const { token } = setupConfig();
    await registerToServer(token);
    log('ok', '初始化完成，准备启动 Gateway...');
})();
