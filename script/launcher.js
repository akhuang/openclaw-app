const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execSync } = require('child_process');

// ==================== 配置区域 ====================
const INTERNAL_PORT = 18789;
const EXTERNAL_PORT = 18889;
const SERVER_URL = 'http://xiaoluban.rnd.huawei.com:80/y/llm/register-gateway';

// ==================== 全局变量 ====================
const ROOT_DIR = path.resolve(__dirname, '..');
const TEMPLATE_JSON = path.join(__dirname, 'openclaw.json');
const SKILLS_DIR = path.join(ROOT_DIR, 'skills');
const TARGET_JSON_DIR = path.join(os.homedir(), '.openclaw');
const TARGET_JSON_FILE = path.join(TARGET_JSON_DIR, 'openclaw.json');

// ==================== 步骤 1: 生成并部署配置文件 ====================
function setupConfig() {
    console.log('📝 [1/2] 正在基于最新模板初始化并覆盖配置文件...');

    try {
        let existingToken = null;
        let whoami = 'unknown';

        try {
            whoami = execSync('whoami').toString().trim();
        } catch (e) {
            console.warn('   - ⚠️ 无法获取 whoami，将使用默认值 unknown');
        }

        if (fs.existsSync(TARGET_JSON_FILE)) {
            try {
                const oldConfig = JSON.parse(fs.readFileSync(TARGET_JSON_FILE, 'utf8'));
                existingToken = oldConfig?.gateway?.auth?.token;
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
        console.log(`   - 💾 配置文件已基于最新模板重新覆盖: ${TARGET_JSON_FILE}`);

        return { token: finalToken };
    } catch (err) {
        console.error('❌ 配置初始化失败:', err.message);
        process.exit(1);
    }
}

// ==================== 步骤 2: 注册到服务端 ====================
async function registerToServer(token) {
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
