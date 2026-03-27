const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const VERSION_FILE = path.join(ROOT_DIR, 'openclaw.version');
const EXT_DIR = path.join(ROOT_DIR, 'extensions', 'welink');
const EXT_PACKAGE_JSON = path.join(EXT_DIR, 'package.json');
const CONFIG_PATH = path.resolve(
    process.env.OPENCLAW_CONFIG_PATH || path.join(ROOT_DIR, 'data', '.openclaw', 'openclaw.json')
);
function resolveCommandFromEnv(envKey, fallback) {
    const value = (process.env[envKey] || '').trim();
    if (!value) return fallback;
    if (value.includes(path.sep) || value.includes('/')) {
        return fs.existsSync(value) ? value : fallback;
    }
    return value;
}

const NPM_CMD = resolveCommandFromEnv('OC_LOCAL_NPM', 'npm');
const OPENCLAW_CMD = resolveCommandFromEnv('OC_LOCAL_OPENCLAW_CMD', 'openclaw');

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, data) {
    fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function withWelinkAllowed(config) {
    const plugins = config.plugins || {};
    const currentAllow = Array.isArray(plugins.allow) ? plugins.allow : [];
    if (currentAllow.includes('welink')) {
        return config;
    }
    return {
        ...config,
        plugins: {
            ...plugins,
            allow: [...currentAllow, 'welink'],
        },
    };
}

function quoteWindowsShellArg(value) {
    const str = String(value);
    if (!str) {
        return '""';
    }
    if (!/[\s"&()<>^|]/.test(str)) {
        return str;
    }
    return `"${str.replace(/"/g, '""')}"`;
}

function runCommand(command, args, opts = {}) {
    const spawnOptions = {
        stdio: 'inherit',
        env: process.env,
        cwd: opts.cwd || ROOT_DIR,
    };

    const result = process.platform === 'win32'
        ? spawnSync(
            process.env.ComSpec || 'cmd.exe',
            [
                '/d',
                '/s',
                '/c',
                `"${[command, ...args].map(quoteWindowsShellArg).join(' ')}"`,
            ],
            spawnOptions
        )
        : spawnSync(command, args, spawnOptions);

    if (result.error) {
        throw result.error;
    }

    if (result.status !== 0) {
        throw new Error(`${command} ${args.join(' ')} failed with status ${result.status}`);
    }
}

function shouldConfigureWelink() {
    if (!fs.existsSync(CONFIG_PATH)) {
        console.log(`[welink] 配置文件不存在，跳过: ${CONFIG_PATH}`);
        return false;
    }

    try {
        const config = readJson(CONFIG_PATH);
        const welink = config?.channels?.welink;
        if (!welink || welink.enabled === false) {
            console.log('[welink] channels.welink 未启用，跳过本地插件安装');
            return false;
        }
        return true;
    } catch (error) {
        throw new Error(`无法解析 OpenClaw 配置文件 ${CONFIG_PATH}: ${error.message}`);
    }
}

function resolveRequiredVersion() {
    if (!fs.existsSync(VERSION_FILE)) {
        throw new Error(`缺少版本文件: ${VERSION_FILE}`);
    }
    const version = fs.readFileSync(VERSION_FILE, 'utf8').trim();
    if (!version) {
        throw new Error('openclaw.version 为空');
    }
    return version;
}

function resolveLocalTgz(version) {
    const tgz = path.join(ROOT_DIR, 'pkg', `openclaw-${version}.tgz`);
    if (!fs.existsSync(tgz)) {
        throw new Error(`缺少本地 openclaw 包: ${tgz}`);
    }
    return tgz;
}

function resolveInstalledOpenClawPackageDir() {
    const openclawCmd = OPENCLAW_CMD;
    const basename = path.basename(openclawCmd).toLowerCase();
    let prefixDir = null;

    if (basename === 'openclaw.cmd') {
        prefixDir = path.dirname(openclawCmd);
    } else if (basename === 'openclaw' && path.basename(path.dirname(openclawCmd)).toLowerCase() === 'bin') {
        prefixDir = path.dirname(path.dirname(openclawCmd));
    }

    if (!prefixDir) {
        throw new Error(`无法从 openclaw 命令路径推导安装前缀: ${openclawCmd}`);
    }

    const candidateDirs = [
        path.join(prefixDir, 'node_modules', 'openclaw'),
        path.join(prefixDir, 'lib', 'node_modules', 'openclaw'),
    ];

    for (const packageDir of candidateDirs) {
        if (fs.existsSync(path.join(packageDir, 'package.json'))) {
            return packageDir;
        }
    }

    throw new Error(
        `找不到已安装的 openclaw 包目录: ${candidateDirs.join(' 或 ')}`
    );
}

function readInstalledPackageVersion(packageDir) {
    try {
        return readJson(path.join(packageDir, 'package.json')).version || '';
    } catch {
        return '';
    }
}

function hasMatchingOpenClawDependency(requiredVersion) {
    const pkgPath = path.join(EXT_DIR, 'node_modules', 'openclaw', 'package.json');
    if (!fs.existsSync(pkgPath)) {
        return false;
    }
    try {
        const pkg = readJson(pkgPath);
        return pkg.version === requiredVersion;
    } catch {
        return false;
    }
}

function hasZodDependency() {
    return fs.existsSync(path.join(EXT_DIR, 'node_modules', 'zod', 'package.json'));
}

function ensureOpenClawDependency(requiredVersion) {
    const installedPackageDir = resolveInstalledOpenClawPackageDir();
    const installedVersion = readInstalledPackageVersion(installedPackageDir);
    if (installedVersion !== requiredVersion) {
        throw new Error(
            `已安装 openclaw 版本 ${installedVersion || 'unknown'} 与要求版本 ${requiredVersion} 不一致`
        );
    }

    const extNodeModules = path.join(EXT_DIR, 'node_modules');
    const extOpenClawDir = path.join(extNodeModules, 'openclaw');
    fs.mkdirSync(extNodeModules, { recursive: true });

    if (hasMatchingOpenClawDependency(requiredVersion)) {
        return;
    }

    if (fs.existsSync(extOpenClawDir)) {
        fs.rmSync(extOpenClawDir, { recursive: true, force: true });
    }

    const symlinkType = process.platform === 'win32' ? 'junction' : 'dir';
    fs.symlinkSync(installedPackageDir, extOpenClawDir, symlinkType);
}

function ensureZodDependency() {
    if (hasZodDependency()) {
        console.log('[welink] zod 依赖已就绪');
        return;
    }

    console.log(`[welink] 安装 zod 到 ${EXT_DIR}`);
    runCommand(NPM_CMD, [
        'install',
        '--prefix',
        EXT_DIR,
        '--no-save',
        '--no-package-lock',
        'zod@^4.3.6',
    ]);
}

function ensureExtensionDependencies() {
    const requiredVersion = resolveRequiredVersion();
    resolveLocalTgz(requiredVersion);

    ensureOpenClawDependency(requiredVersion);
    ensureZodDependency();
    console.log(`[welink] 本地依赖已就绪: openclaw@${requiredVersion}, zod`);
}

function ensurePluginLinkedAndEnabled() {
    let originalConfig = null;
    let preservedWelinkConfig = null;

    if (fs.existsSync(CONFIG_PATH)) {
        originalConfig = readJson(CONFIG_PATH);
        preservedWelinkConfig = originalConfig?.channels?.welink;

        if (preservedWelinkConfig) {
            const strippedConfig = structuredClone(originalConfig);
            delete strippedConfig.channels?.welink;
            writeJson(CONFIG_PATH, strippedConfig);
            console.log('[welink] 已临时移除 channels.welink，准备安装插件');
        }
    }

    try {
        console.log('[welink] 链接本地插件 extensions/welink');
        runCommand(OPENCLAW_CMD, ['plugins', 'install', '--link', EXT_DIR]);

        console.log('[welink] 启用 welink 插件');
        runCommand(OPENCLAW_CMD, ['plugins', 'enable', 'welink']);
    } finally {
        if (preservedWelinkConfig) {
            const latestConfig = fs.existsSync(CONFIG_PATH) ? readJson(CONFIG_PATH) : {};
            const mergedConfig = withWelinkAllowed({
                ...latestConfig,
                channels: {
                    ...(latestConfig.channels || {}),
                    welink: preservedWelinkConfig,
                },
            });
            writeJson(CONFIG_PATH, mergedConfig);
            console.log('[welink] 已恢复 channels.welink 配置');
        } else if (originalConfig) {
            writeJson(CONFIG_PATH, originalConfig);
        }
    }
}

function main() {
    if (!fs.existsSync(EXT_PACKAGE_JSON)) {
        console.log('[welink] 未找到 extensions/welink，跳过');
        return;
    }
    if (!shouldConfigureWelink()) {
        return;
    }

    ensureExtensionDependencies();
    ensurePluginLinkedAndEnabled();
    console.log('[welink] 本地插件准备完成');
}

try {
    main();
} catch (error) {
    console.error(`[welink] 初始化失败: ${error.message}`);
    process.exit(1);
}
