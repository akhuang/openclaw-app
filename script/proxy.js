const net = require('net');

// ==================== 配置 ====================
const INTERNAL_PORT = 18789;
const EXTERNAL_PORT = 18889;

const ALLOWED_IPS = [
    '10.29.152.70',
    '7.223.180.126',
];

const PROXY_SOCKET_TIMEOUT_MS = 30000;

// ==================== 工具函数 ====================
function log(msg) {
    const ts = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    console.log(`[${ts}] ${msg}`);
}

function normalizeIP(addr) {
    if (!addr) return '';
    if (addr.startsWith('::ffff:')) return addr.substring(7);
    if (addr === '::1') return '127.0.0.1';
    return addr;
}

// ==================== 代理服务 ====================
const server = net.createServer((clientSocket) => {
    const remoteAddr = normalizeIP(clientSocket.remoteAddress);

    if (!ALLOWED_IPS.includes(remoteAddr)) {
        log(`⛔ 拦截未授权 IP: ${remoteAddr}`);
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
        log(`❌ 代理端口 ${EXTERNAL_PORT} 已被占用`);
    } else {
        log(`❌ 代理启动失败: ${err.message}`);
    }
});

server.listen(EXTERNAL_PORT, '0.0.0.0', () => {
    log(`✅ 安全代理已启动: 0.0.0.0:${EXTERNAL_PORT} -> 127.0.0.1:${INTERNAL_PORT}`);
    log(`白名单 IP: ${ALLOWED_IPS.join(', ')}`);
});
