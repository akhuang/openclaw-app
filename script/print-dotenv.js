const { readEnvFiles } = require('./dotenv');

function shellQuote(value) {
    return `'${String(value).replace(/'/g, `'\"'\"'`)}'`;
}

function cmdQuote(value) {
    return String(value)
        .replace(/\^/g, '^^')
        .replace(/%/g, '%%')
        .replace(/!/g, '^^!')
        .replace(/"/g, '""');
}

function resolveFormat() {
    const arg = process.argv.find((entry) => entry.startsWith('--format='));
    return arg ? arg.slice('--format='.length) : 'sh';
}

function main() {
    const format = resolveFormat();
    const { values } = readEnvFiles();
    const keys = Object.keys(values).sort();

    for (const key of keys) {
        const value = values[key];
        if (format === 'cmd') {
            console.log(`set "${key}=${cmdQuote(value)}"`);
            continue;
        }

        console.log(`export ${key}=${shellQuote(value)}`);
    }
}

main();
