const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const DEFAULT_NPM_PREFIX = path.join(ROOT_DIR, 'runtime', 'npm-global');
const NPM_PREFIX = path.resolve(process.env.OC_NPM_PREFIX || DEFAULT_NPM_PREFIX);
const OPENCLAW_DIR = path.join(NPM_PREFIX, 'lib', 'node_modules', 'openclaw');
const ASSETS_DIR = path.join(OPENCLAW_DIR, 'dist', 'control-ui', 'assets');
const VERSION_FILE = path.join(ROOT_DIR, 'openclaw.version');

const ABORT_BUTTON_OLD = 'canAbort:!!e.chatRunId';
const ABORT_BUTTON_NEW =
    'canAbort:!!e.connected&&(!!e.chatRunId||e.chatSending||!!e.chatStream)';

const STOP_PHRASES_OLD =
    'return n===`/stop`?!0:n===`stop`||n===`esc`||n===`abort`||n===`wait`||n===`exit`';
const STOP_PHRASES_NEW =
    'return n===`/stop`?!0:n===`stop`||n===`esc`||n===`abort`||n===`wait`||n===`exit`||n===`interrupt`||n===`stop action`||n===`stop run`||n===`stop openclaw`||n===`please stop`';

function findControlUiBundle() {
    if (!fs.existsSync(ASSETS_DIR)) {
        throw new Error(`找不到 Control UI 目录: ${ASSETS_DIR}`);
    }

    const bundleName = fs
        .readdirSync(ASSETS_DIR)
        .find((entry) => /^index-.*\.js$/.test(entry) && !entry.endsWith('.js.map'));

    if (!bundleName) {
        throw new Error(`找不到 Control UI 主 bundle: ${ASSETS_DIR}`);
    }

    return path.join(ASSETS_DIR, bundleName);
}

function replaceOnce(content, from, to, label) {
    if (content.includes(to)) {
        return { content, changed: false, status: 'already' };
    }

    if (!content.includes(from)) {
        return { content, changed: false, status: 'missing', label };
    }

    return {
        content: content.replace(from, to),
        changed: true,
        status: 'patched',
        label,
    };
}

function readInstalledVersion() {
    const pkgJson = path.join(OPENCLAW_DIR, 'package.json');
    if (!fs.existsSync(pkgJson)) {
        return 'unknown';
    }

    try {
        const pkg = JSON.parse(fs.readFileSync(pkgJson, 'utf8'));
        return pkg.version || 'unknown';
    } catch {
        return 'unknown';
    }
}

function readBundledVersion() {
    if (!fs.existsSync(VERSION_FILE)) {
        return 'unknown';
    }

    try {
        return fs.readFileSync(VERSION_FILE, 'utf8').trim() || 'unknown';
    } catch {
        return 'unknown';
    }
}

function main() {
    const bundlePath = findControlUiBundle();
    const installedVersion = readInstalledVersion();
    const bundledVersion = readBundledVersion();

    if (
        bundledVersion !== 'unknown' &&
        installedVersion !== 'unknown' &&
        installedVersion !== bundledVersion
    ) {
        console.warn(
            `[警告] Control UI 停止补丁已跳过: 已安装 openclaw v${installedVersion} 与仓库目标版本 v${bundledVersion} 不一致`
        );
        return;
    }

    const original = fs.readFileSync(bundlePath, 'utf8');

    let next = original;
    let changed = false;
    const missingTargets = [];

    const abortPatch = replaceOnce(next, ABORT_BUTTON_OLD, ABORT_BUTTON_NEW, 'abort button state');
    next = abortPatch.content;
    changed = changed || abortPatch.changed;
    if (abortPatch.status === 'missing') {
        missingTargets.push(abortPatch.label);
    }

    const stopPatch = replaceOnce(next, STOP_PHRASES_OLD, STOP_PHRASES_NEW, 'stop command aliases');
    next = stopPatch.content;
    changed = changed || stopPatch.changed;
    if (stopPatch.status === 'missing') {
        missingTargets.push(stopPatch.label);
    }

    if (missingTargets.length > 0) {
        console.warn(
            `[警告] Control UI 停止补丁已跳过: 当前 bundle 结构与预期不一致 (${missingTargets.join(', ')})`
        );
        return;
    }

    if (!changed) {
        console.log(
            `[修复] Control UI 停止补丁已存在，无需重复应用 (${path.basename(bundlePath)}, v${installedVersion})`
        );
        return;
    }

    fs.writeFileSync(bundlePath, next);
    console.log(
        `[修复] 已应用 Control UI 停止补丁 (${path.basename(bundlePath)}, v${installedVersion})`
    );
}

try {
    main();
} catch (err) {
    console.error(`[修复] Control UI 停止补丁失败: ${err.message}`);
    process.exit(1);
}
