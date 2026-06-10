const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { execSync } = require('child_process');
const { envFlag, loadEnv } = require('./dotenv');

loadEnv();

// ==================== 配置区域 ====================
const INTERNAL_PORT = 18789;
const EXTERNAL_PORT = 18889;
const SERVER_URL = 'http://xiaoluban.rnd.huawei.com:80/y/llm/register-gateway';
const ENABLE_GATEWAY_REGISTRATION = process.env.OPENCLAW_ENABLE_GATEWAY_REGISTRATION === '1';
const DEFAULT_ALLOWED_MODEL_HOSTS = ['127.0.0.1', 'localhost', 'xiaoluban.rnd.huawei.com'];
const DEFAULT_BROWSER_HOSTNAME_ALLOWLIST = ['*.huawei.com', 'huawei.com'];
const DEFAULT_BROWSER_ALLOWED_HOSTNAMES = ['127.0.0.1', 'localhost'];

// ==================== 全局变量 ====================
const ROOT_DIR = path.resolve(__dirname, '..');
const TEMPLATE_JSON = path.join(__dirname, 'openclaw.json');
const VERSION_FILE = path.join(ROOT_DIR, 'openclaw.version');
const SKILLS_DIR = path.join(ROOT_DIR, 'skills');
const OPENCLAW_PACKAGE_DIRS = [
    path.join(ROOT_DIR, 'runtime', 'npm-global', 'lib', 'node_modules', 'openclaw'),
    path.join(ROOT_DIR, 'runtime', 'npm-global', 'node_modules', 'openclaw'),
];
const DISABLED_BUNDLED_SKILLS_SENTINEL = '__openclaw_app_disable_bundled_skills__';
const DEFAULT_STATE_DIR = path.join(ROOT_DIR, 'data', '.openclaw');
const STATE_DIR = path.resolve(process.env.OPENCLAW_STATE_DIR || DEFAULT_STATE_DIR);
const TARGET_JSON_FILE = path.resolve(
    process.env.OPENCLAW_CONFIG_PATH || path.join(STATE_DIR, 'openclaw.json')
);
const TARGET_JSON_DIR = path.dirname(TARGET_JSON_FILE);
const WORKSPACE_DIR = path.resolve(process.env.OPENCLAW_WORKSPACE_DIR || path.join(ROOT_DIR, 'data', 'workspace'));
const PRESERVE_CONFIG = envFlag('OPENCLAW_PRESERVE_CONFIG', true);
const DISABLE_WELINK = envFlag('OPENCLAW_DISABLE_WELINK', false);

function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function mergeObjects(base, overlay) {
    if (!isPlainObject(base)) {
        return isPlainObject(overlay) ? { ...overlay } : overlay;
    }
    if (!isPlainObject(overlay)) {
        return { ...base };
    }

    const merged = { ...base };
    for (const [key, value] of Object.entries(overlay)) {
        if (isPlainObject(value) && isPlainObject(base[key])) {
            merged[key] = mergeObjects(base[key], value);
        } else if (Array.isArray(value)) {
            merged[key] = value.slice();
        } else {
            merged[key] = value;
        }
    }

    return merged;
}

function cloneConfigValue(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function listChildDirectoriesSafe(dir) {
    try {
        return fs
            .readdirSync(dir, { withFileTypes: true })
            .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules')
            .map((entry) => path.join(dir, entry.name))
            .sort((left, right) => left.localeCompare(right));
    } catch (e) {
        return [];
    }
}

function parseSkillNameFromFile(skillFile) {
    let raw;
    try {
        raw = fs.readFileSync(skillFile, 'utf8');
    } catch (e) {
        return null;
    }

    const fallback = path.basename(path.dirname(skillFile)).trim();
    if (!raw.startsWith('---')) {
        return fallback || null;
    }

    const endIndex = raw.indexOf('\n---', 3);
    const frontmatter = endIndex >= 0 ? raw.slice(3, endIndex) : raw.slice(3, 4096);
    const match = frontmatter.match(/^name:\s*["']?([^"'\n#]+?)["']?\s*$/m);
    const name = match?.[1]?.trim();
    return name || fallback || null;
}

function collectSkillNamesFromRoot(rootDir) {
    const names = new Set();
    const resolvedRoot = path.resolve(rootDir);

    const addSkillDir = (skillDir) => {
        const name = parseSkillNameFromFile(path.join(skillDir, 'SKILL.md'));
        if (name) names.add(name);
    };

    if (fs.existsSync(path.join(resolvedRoot, 'SKILL.md'))) {
        addSkillDir(resolvedRoot);
        return names;
    }

    for (const childDir of listChildDirectoriesSafe(resolvedRoot)) {
        if (fs.existsSync(path.join(childDir, 'SKILL.md'))) {
            addSkillDir(childDir);
            continue;
        }
        for (const nestedDir of listChildDirectoriesSafe(childDir)) {
            if (fs.existsSync(path.join(nestedDir, 'SKILL.md'))) {
                addSkillDir(nestedDir);
            }
        }
    }

    return names;
}

function resolveBundledSkillNames() {
    const names = new Set();
    for (const packageDir of OPENCLAW_PACKAGE_DIRS) {
        const skillsRoot = path.join(packageDir, 'skills');
        if (fs.existsSync(skillsRoot)) {
            for (const name of collectSkillNamesFromRoot(skillsRoot)) names.add(name);
        }
    }
    return Array.from(names).sort((left, right) => left.localeCompare(right));
}

function normalizeStringArray(value) {
    return Array.isArray(value) ? value.filter((entry) => typeof entry === 'string' && entry.trim()) : [];
}

function removeSkillEntryEnabledFalse(config, skillNames) {
    const entries = config.skills?.entries;
    if (!entries || typeof entries !== 'object' || Array.isArray(entries)) return;
    for (const name of skillNames) {
        const current = entries[name];
        if (!current || typeof current !== 'object' || Array.isArray(current)) continue;
        if (current.enabled === false) delete current.enabled;
        if (Object.keys(current).length === 0) delete entries[name];
    }
}

function resolveProjectSkillNames(config) {
    const roots = new Set([SKILLS_DIR]);
    for (const extraDir of normalizeStringArray(config?.skills?.load?.extraDirs)) {
        if (path.resolve(extraDir) === path.resolve(SKILLS_DIR)) {
            roots.add(path.resolve(extraDir));
        }
    }

    const names = new Set();
    for (const root of roots) {
        for (const name of collectSkillNamesFromRoot(root)) names.add(name);
    }
    return Array.from(names).sort((left, right) => left.localeCompare(right));
}

function resolveNonProjectSkillNames(config) {
    const roots = new Set([
        path.join(STATE_DIR, 'skills'),
        path.join(STATE_DIR, 'plugin-skills'),
        path.join(WORKSPACE_DIR, 'skills'),
        path.join(WORKSPACE_DIR, '.agents', 'skills'),
    ]);
    const homeDir = os.homedir();
    if (homeDir) {
        roots.add(path.join(homeDir, '.agents', 'skills'));
    }
    for (const extraDir of normalizeStringArray(config?.skills?.load?.extraDirs)) {
        const resolved = path.resolve(extraDir);
        if (resolved !== path.resolve(SKILLS_DIR)) {
            roots.add(resolved);
        }
    }

    const names = new Set();
    for (const root of roots) {
        for (const name of collectSkillNamesFromRoot(root)) names.add(name);
    }
    return Array.from(names).sort((left, right) => left.localeCompare(right));
}

function applySkillsPolicy(config) {
    const projectSkillNames = resolveProjectSkillNames(config);
    const nonProjectSkillNames = resolveNonProjectSkillNames(config);

    if (!config.skills || typeof config.skills !== 'object') config.skills = {};
    if (!config.skills.load || typeof config.skills.load !== 'object') config.skills.load = {};
    config.skills.load.extraDirs = [SKILLS_DIR];
    config.skills.allowBundled = [DISABLED_BUNDLED_SKILLS_SENTINEL];

    if (!config.skills.entries || typeof config.skills.entries !== 'object' || Array.isArray(config.skills.entries)) {
        config.skills.entries = {};
    }
    removeSkillEntryEnabledFalse(config, projectSkillNames);
    for (const name of nonProjectSkillNames) {
        const current = config.skills.entries[name];
        config.skills.entries[name] = {
            ...(current && typeof current === 'object' && !Array.isArray(current) ? current : {}),
            enabled: false,
        };
    }

    if (!config.agents || typeof config.agents !== 'object') config.agents = {};
    if (!config.agents.defaults || typeof config.agents.defaults !== 'object') config.agents.defaults = {};
    // 名称白名单兜底：启动后运行时新装的 ClawHub / workshop / plugin skills 也不会被激活
    config.agents.defaults.skills = projectSkillNames.slice();

    return {
        projectSkillNames,
        nonProjectSkillNames,
        bundledSkillNames: resolveBundledSkillNames(),
    };
}

function collectConfiguredModelRefs(config) {
    const refs = new Set();
    const providers = config?.models?.providers;
    if (!providers || typeof providers !== 'object') {
        return refs;
    }

    for (const [providerId, providerConfig] of Object.entries(providers)) {
        if (!providerId || !Array.isArray(providerConfig?.models)) {
            continue;
        }
        for (const model of providerConfig.models) {
            const modelId = typeof model?.id === 'string' ? model.id.trim() : '';
            if (modelId) {
                refs.add(`${providerId}/${modelId}`);
            }
        }
    }

    return refs;
}

function syncTemplateModelCatalog(config, templateConfig) {
    const templateProviders = templateConfig?.models?.providers;
    if (!templateProviders || typeof templateProviders !== 'object') {
        return false;
    }

    if (!config.models || typeof config.models !== 'object') config.models = {};
    if (!config.models.providers || typeof config.models.providers !== 'object') {
        config.models.providers = {};
    }

    const currentProviders = config.models.providers;
    const nextProviders = {};
    let synced = false;
    for (const [providerId, templateProvider] of Object.entries(templateProviders)) {
        if (!providerId || !templateProvider || typeof templateProvider !== 'object') {
            continue;
        }
        const currentProvider =
            currentProviders[providerId] && typeof currentProviders[providerId] === 'object'
                ? currentProviders[providerId]
                : {};

        nextProviders[providerId] = {
            ...cloneConfigValue(templateProvider),
            ...currentProvider,
        };

        if (Array.isArray(templateProvider.models)) {
            nextProviders[providerId].models = cloneConfigValue(templateProvider.models);
            synced = true;
        }
    }
    config.models.providers = nextProviders;

    if (!config.agents || typeof config.agents !== 'object') config.agents = {};
    if (!config.agents.defaults || typeof config.agents.defaults !== 'object') {
        config.agents.defaults = {};
    }

    const configuredRefs = collectConfiguredModelRefs(config);
    const currentDefault = resolveDefaultModelRef(config);
    const templateDefault = resolveDefaultModelRef(templateConfig);
    if (templateDefault && (!currentDefault || !configuredRefs.has(currentDefault))) {
        config.agents.defaults.model = cloneConfigValue(templateConfig.agents.defaults.model);
        synced = true;
    }

    return synced;
}

function applyProviderApiKeyDefaults(config, whoami) {
    const providers = config?.models?.providers;
    if (!providers || typeof providers !== 'object') {
        return;
    }

    for (const [providerId, providerConfig] of Object.entries(providers)) {
        if (!providerConfig || typeof providerConfig !== 'object') {
            continue;
        }

        const templateApiKey = providerConfig.apiKey;
        if (templateApiKey === 'xxx' || !templateApiKey) {
            providerConfig.apiKey = whoami;
            console.log(`   - 🔄 ${providerId} apiKey 为默认值，已设置为当前用户: ${whoami}`);
        } else {
            console.log(`   - 🔑 检测到 ${providerId} apiKey 已被自定义，保留模板值: ${templateApiKey}`);
        }
    }
}

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

function applyWelinkOverrides(config) {
    if (!DISABLE_WELINK) {
        return;
    }

    if (!config.channels || typeof config.channels !== 'object') {
        config.channels = {};
    }
    if (!config.channels.welink || typeof config.channels.welink !== 'object') {
        config.channels.welink = {};
    }
    config.channels.welink.enabled = false;

    if (config.plugins && typeof config.plugins === 'object') {
        if (Array.isArray(config.plugins.allow)) {
            config.plugins.allow = config.plugins.allow.filter((entry) => entry !== 'welink');
        }

        if (config.plugins.entries && typeof config.plugins.entries === 'object') {
            const currentEntry =
                config.plugins.entries.welink && typeof config.plugins.entries.welink === 'object'
                    ? config.plugins.entries.welink
                    : {};
            config.plugins.entries.welink = { ...currentEntry, enabled: false };
        }
    }
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
    console.log('📝 [1/2] 正在基于模板初始化配置并同步关键字段...');

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
        const templateConfig = JSON.parse(fs.readFileSync(TEMPLATE_JSON, 'utf8'));
        const config =
            PRESERVE_CONFIG && previousConfig && typeof previousConfig === 'object'
                ? mergeObjects(templateConfig, previousConfig)
                : templateConfig;
        const syncedTemplateModels = syncTemplateModelCatalog(config, templateConfig);

        if (PRESERVE_CONFIG && previousConfig && typeof previousConfig === 'object') {
            console.log('   - ♻️ 已保留现有配置中的插件和自定义字段，仅同步模板关键项');
        }
        if (syncedTemplateModels) {
            console.log('   - 🧠 已按模板同步模型列表和默认模型');
        }

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
        applyProviderApiKeyDefaults(config, whoami);

        applyBrowserSecurityPolicy(config);
        console.log(
            `   - 🔒 已启用 browser 工具，但仅允许内网白名单站点: ${config.browser.ssrfPolicy.hostnameAllowlist.join(', ')}`
        );

        applyWelinkOverrides(config);
        if (DISABLE_WELINK) {
            console.log('   - 📴 已按环境配置禁用 Welink channel / plugin entry');
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

        const skillsPolicy = applySkillsPolicy(config);
        console.log(
            `   - 🧩 已加载业务 skills: ${skillsPolicy.projectSkillNames.length} 个；已禁用默认 bundled skills: ${skillsPolicy.bundledSkillNames.length} 个；已禁用外部 skills (个人/workspace/插件): ${skillsPolicy.nonProjectSkillNames.length} 个`
        );
        console.log(
            `   - 🎯 已写入业务 skills 白名单 (agents.defaults.skills): ${skillsPolicy.projectSkillNames.join(', ') || '(空)'}`
        );

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
        console.log(`   - 💾 配置文件已写入: ${TARGET_JSON_FILE}`);

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
