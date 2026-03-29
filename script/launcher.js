const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

// ==================== 配置区域 ====================
const INTERNAL_PORT = 18789;
const EXTERNAL_PORT = 18889;
const SERVER_URL = 'http://xiaoluban.rnd.huawei.com:80/y/llm/register-gateway';
const ENABLE_GATEWAY_REGISTRATION = process.env.OPENCLAW_ENABLE_GATEWAY_REGISTRATION === '1';
const DEFAULT_ALLOWED_MODEL_HOSTS = ['127.0.0.1', 'localhost', 'xiaoluban.rnd.huawei.com'];
const DEFAULT_BROWSER_HOSTNAME_ALLOWLIST = ['*.rnd.huawei.com', 'rnd.huawei.com'];
const DEFAULT_BROWSER_ALLOWED_HOSTNAMES = ['127.0.0.1', 'localhost'];

// ==================== 全局变量 ====================
const ROOT_DIR = path.resolve(__dirname, '..');
const TEMPLATE_JSON = path.join(__dirname, 'openclaw.json');
const VERSION_FILE = path.join(ROOT_DIR, 'openclaw.version');
const SKILLS_DIR = path.join(ROOT_DIR, 'skills');
const DEFAULT_STATE_DIR = path.join(ROOT_DIR, 'data', '.openclaw');
const STATE_DIR = path.resolve(process.env.OPENCLAW_STATE_DIR || DEFAULT_STATE_DIR);
const TARGET_JSON_FILE = path.resolve(
    process.env.OPENCLAW_CONFIG_PATH || path.join(STATE_DIR, 'openclaw.json')
);
const TARGET_JSON_DIR = path.dirname(TARGET_JSON_FILE);
const WORKSPACE_DIR = path.resolve(process.env.OPENCLAW_WORKSPACE_DIR || path.join(ROOT_DIR, 'data', 'workspace'));

function resolveCommaSeparatedSet(envKey, defaults) {
    const raw = (process.env[envKey] || '').trim();
    if (!raw) {
        return new Set(defaults);
    }

    return new Set(
        raw
            .split(',')
            .map((entry) => entry.trim().toLowerCase())
            .filter(Boolean)
    );
}

function resolveAllowedModelHosts() {
    return resolveCommaSeparatedSet('OPENCLAW_ALLOWED_MODEL_HOSTS', DEFAULT_ALLOWED_MODEL_HOSTS);
}

function resolveBrowserHostnameAllowlist() {
    return Array.from(
        resolveCommaSeparatedSet(
            'OPENCLAW_BROWSER_HOSTNAME_ALLOWLIST',
            DEFAULT_BROWSER_HOSTNAME_ALLOWLIST
        )
    );
}

function resolveBrowserAllowedHostnames() {
    return Array.from(
        resolveCommaSeparatedSet(
            'OPENCLAW_BROWSER_ALLOWED_HOSTNAMES',
            DEFAULT_BROWSER_ALLOWED_HOSTNAMES
        )
    );
}

function isPrivateIpv4(hostname) {
    const match = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(hostname);
    if (!match) {
        return false;
    }

    const octets = match.slice(1).map((value) => Number(value));
    if (octets.some((value) => Number.isNaN(value) || value < 0 || value > 255)) {
        return false;
    }

    return (
        octets[0] === 10 ||
        (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
        (octets[0] === 192 && octets[1] === 168) ||
        (octets[0] === 127)
    );
}

function isAllowedModelHost(hostname, allowedHosts) {
    if (!hostname) {
        return false;
    }

    const normalizedHost = hostname.trim().toLowerCase();
    return allowedHosts.has(normalizedHost) || isPrivateIpv4(normalizedHost);
}

function assertRestrictedModelEndpoints(config) {
    const providers = config?.models?.providers;
    if (!providers || typeof providers !== 'object') {
        return;
    }

    const allowedHosts = resolveAllowedModelHosts();
    for (const [providerId, providerConfig] of Object.entries(providers)) {
        const baseUrl = typeof providerConfig?.baseUrl === 'string' ? providerConfig.baseUrl.trim() : '';
        if (!baseUrl) {
            continue;
        }

        let parsedUrl;
        try {
            parsedUrl = new URL(baseUrl);
        } catch {
            throw new Error(`模型提供方 ${providerId} 的 baseUrl 非法: ${baseUrl}`);
        }

        if (!isAllowedModelHost(parsedUrl.hostname, allowedHosts)) {
            throw new Error(
                `模型提供方 ${providerId} 指向了未授权主机 ${parsedUrl.hostname}，已阻止启动`
            );
        }
    }
}

function resolveDefaultModelRef(config) {
    const raw = config?.agents?.defaults?.model;
    if (typeof raw === 'string') {
        return raw.trim();
    }
    if (raw && typeof raw === 'object' && typeof raw.primary === 'string') {
        return raw.primary.trim();
    }
    return '';
}

function buildConfiguredModelAllowlist(config) {
    const allowlist = {};
    const providers = config?.models?.providers;
    if (!providers || typeof providers !== 'object') {
        return allowlist;
    }

    for (const [providerId, providerConfig] of Object.entries(providers)) {
        if (!providerId || !Array.isArray(providerConfig?.models)) {
            continue;
        }
        for (const model of providerConfig.models) {
            const modelId = typeof model?.id === 'string' ? model.id.trim() : '';
            if (!modelId) {
                continue;
            }
            allowlist[`${providerId}/${modelId}`] = {};
        }
    }

    const defaultModelRef = resolveDefaultModelRef(config);
    if (defaultModelRef.includes('/')) {
        allowlist[defaultModelRef] = allowlist[defaultModelRef] || {};
    }

    return allowlist;
}

function applyBrowserSecurityPolicy(config) {
    if (!config.browser || typeof config.browser !== 'object') {
        config.browser = {};
    }

    const ssrfPolicy =
        config.browser.ssrfPolicy && typeof config.browser.ssrfPolicy === 'object'
            ? config.browser.ssrfPolicy
            : {};

    config.browser.enabled = true;
    config.browser.ssrfPolicy = {
        ...ssrfPolicy,
        dangerouslyAllowPrivateNetwork: false,
        hostnameAllowlist: resolveBrowserHostnameAllowlist(),
        allowedHostnames: resolveBrowserAllowedHostnames(),
    };
}

function resolveBundledVersion() {
    try {
        return fs.readFileSync(VERSION_FILE, 'utf8').trim();
    } catch {
        return '';
    }
}

// ==================== 步骤 1: 生成并部署配置文件 ====================
function setupConfig() {
    console.log('📝 [1/2] 正在基于最新模板初始化并覆盖配置文件...');

    try {
        let existingToken = null;
        let previousConfig = null;
        let whoami = 'unknown';

        try {
            whoami = execSync('whoami').toString().trim();
        } catch (e) {
            console.warn('   - ⚠️ 无法获取 whoami，将使用默认值 unknown');
        }

        if (fs.existsSync(TARGET_JSON_FILE)) {
            try {
                previousConfig = JSON.parse(fs.readFileSync(TARGET_JSON_FILE, 'utf8'));
                existingToken = previousConfig?.gateway?.auth?.token;
                if (existingToken) {
                    console.log(`   - 🔄 从旧配置中成功提取已有 Token: ${existingToken.substring(0, 8)}...`);
                }
            } catch (e) {
                console.warn('   - ⚠️ 旧配置文件解析失败或不存在，将生成新 Token');
            }
        }

        if (!fs.existsSync(TEMPLATE_JSON)) {
            throw new Error(`找不到模板文件: ${TEMPLATE_JSON}`);
        }
        const config = JSON.parse(fs.readFileSync(TEMPLATE_JSON, 'utf8'));

        const finalToken = existingToken || crypto.randomBytes(24).toString('hex');
        if (!existingToken) {
            console.log(`   - ✨ 生成全新随机 Token: ${finalToken.substring(0, 8)}...`);
        }

        if (!config.gateway) config.gateway = {};
        if (!config.gateway.auth) config.gateway.auth = {};
        config.gateway.auth.token = finalToken;
        config.gateway.port = INTERNAL_PORT;

        if (!config.models) config.models = {};
        if (!config.models.providers) config.models.providers = {};
        if (!config.models.providers.xlb) config.models.providers.xlb = {};

        const templateApiKey = config.models.providers.xlb.apiKey;
        if (templateApiKey === 'xxx' || !templateApiKey) {
            config.models.providers.xlb.apiKey = whoami;
            console.log(`   - 🔄 模板 apiKey 为默认值，已设置为 XLB apiKey: ${whoami}`);
        } else {
            console.log(`   - 🔑 检测到模板中的 apiKey 已被自定义，保留模板值: ${templateApiKey}`);
        }

        applyBrowserSecurityPolicy(config);
        console.log(
            `   - 🔒 已启用 browser 工具，但仅允许内网白名单站点: ${config.browser.ssrfPolicy.hostnameAllowlist.join(', ')}`
        );

        if (!config.skills) config.skills = {};
        if (!config.skills.load) config.skills.load = {};
        if (!config.skills.load.extraDirs) config.skills.load.extraDirs = [];
        if (!config.skills.load.extraDirs.includes(SKILLS_DIR)) {
            config.skills.load.extraDirs.push(SKILLS_DIR);
        }

        if (!config.agents) config.agents = {};
        if (!config.agents.defaults) config.agents.defaults = {};
        config.agents.defaults.workspace = WORKSPACE_DIR;
        const modelAllowlist = buildConfiguredModelAllowlist(config);
        if (Object.keys(modelAllowlist).length > 0) {
            config.agents.defaults.models = modelAllowlist;
            console.log(
                `   - 🎯 已同步模型白名单，仅保留已配置模型: ${Object.keys(modelAllowlist).join(', ')}`
            );
        }

        assertRestrictedModelEndpoints(config);
        console.log(`   - 🛡️ 已校验模型出口，仅允许内网/白名单主机: ${Array.from(resolveAllowedModelHosts()).join(', ')}`);

        const bundledVersion = resolveBundledVersion();
        config.meta = {
            ...(previousConfig?.meta && typeof previousConfig.meta === 'object' ? previousConfig.meta : {}),
            ...(bundledVersion ? { lastTouchedVersion: bundledVersion } : {}),
            lastTouchedAt: new Date().toISOString(),
        };

        if (!fs.existsSync(TARGET_JSON_DIR)) {
            fs.mkdirSync(TARGET_JSON_DIR, { recursive: true });
        }
        if (!fs.existsSync(WORKSPACE_DIR)) {
            fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
        }

        fs.writeFileSync(TARGET_JSON_FILE, JSON.stringify(config, null, 2));
        console.log(`   - 💾 配置文件已基于最新模板重新覆盖: ${TARGET_JSON_FILE}`);

        return { token: finalToken };
    } catch (err) {
        console.error('❌ 配置初始化失败:', err.message);
        process.exit(1);
    }
}

// ==================== 步骤 2: 注册到服务端 ====================
async function registerToServer(token) {
    if (!ENABLE_GATEWAY_REGISTRATION) {
        console.log('📡 [2/2] 已跳过服务端注册（默认禁用外部网络调用）');
        return;
    }

    console.log('📡 [2/2] 正在向服务端注册...');

    try {
        let whoami = 'unknown';
        try { whoami = execSync('whoami').toString().trim(); } catch (e) {}

        const payload = { port: EXTERNAL_PORT, token, whoami };
        console.log(`   - 注册信息: User=${whoami}, Port=${EXTERNAL_PORT}`);

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 10000);

        const response = await fetch(SERVER_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: controller.signal
        });
        clearTimeout(timer);

        if (response.ok) {
            const resJson = await response.json().catch(() => ({}));
            console.log('   - ✅ 注册成功!');
            if (resJson.client_ip) console.log(`   - Server 识别 IP: ${resJson.client_ip}`);
        } else {
            console.warn(`   - ⚠️ 注册响应异常: ${response.status} ${response.statusText}`);
        }
    } catch (err) {
        console.warn('   - ⚠️ 无法连接到注册服务器 (将继续启动)');
        console.warn(`     错误信息: ${err.message}`);
    }
}

// ==================== 主流程 (完成后退出) ====================
(async () => {
    const { token } = setupConfig();
    await registerToServer(token);
    console.log('✅ 初始化完成');
})();
