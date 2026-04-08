const fs = require('fs');
const path = require('path');

const DEFAULT_FILENAMES = ['.env', '.env.local'];

function stripBom(text) {
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function parseQuotedValue(rawValue, quote) {
    const endIndex = rawValue.lastIndexOf(quote);
    if (endIndex <= 0) {
        return rawValue.slice(1);
    }

    const inner = rawValue.slice(1, endIndex);
    if (quote === "'") {
        return inner;
    }

    return inner
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '\r')
        .replace(/\\t/g, '\t')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\');
}

function parseValue(rawValue) {
    const trimmed = rawValue.trim();
    if (!trimmed) {
        return '';
    }

    const quote = trimmed[0];
    if (quote === '"' || quote === "'") {
        return parseQuotedValue(trimmed, quote);
    }

    return trimmed.replace(/\s+#.*$/, '').trim();
}

function parseDotEnv(content) {
    const values = {};
    const lines = stripBom(content).split(/\r?\n/);

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) {
            continue;
        }

        const normalized = trimmed.startsWith('export ') ? trimmed.slice(7).trim() : trimmed;
        const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(normalized);
        if (!match) {
            continue;
        }

        const [, key, rawValue] = match;
        values[key] = parseValue(rawValue);
    }

    return values;
}

function readEnvFiles(rootDir = path.resolve(__dirname, '..'), filenames = DEFAULT_FILENAMES) {
    const values = {};
    const loadedFiles = [];

    for (const filename of filenames) {
        const filePath = path.join(rootDir, filename);
        if (!fs.existsSync(filePath)) {
            continue;
        }

        const content = fs.readFileSync(filePath, 'utf8');
        Object.assign(values, parseDotEnv(content));
        loadedFiles.push(filePath);
    }

    return { values, loadedFiles };
}

function applyEnv(values, options = {}) {
    const { override = false } = options;
    for (const [key, value] of Object.entries(values)) {
        if (!override && Object.prototype.hasOwnProperty.call(process.env, key)) {
            continue;
        }
        process.env[key] = value;
    }
}

function loadEnv(options = {}) {
    const { values, loadedFiles } = readEnvFiles(options.rootDir, options.filenames);
    applyEnv(values, options);
    return { values, loadedFiles };
}

function envFlag(name, defaultValue = false) {
    const raw = (process.env[name] || '').trim().toLowerCase();
    if (!raw) {
        return defaultValue;
    }

    if (['1', 'true', 'yes', 'on'].includes(raw)) {
        return true;
    }

    if (['0', 'false', 'no', 'off'].includes(raw)) {
        return false;
    }

    return defaultValue;
}

module.exports = {
    DEFAULT_FILENAMES,
    applyEnv,
    envFlag,
    loadEnv,
    parseDotEnv,
    readEnvFiles,
};
