const net = require('net');

const INTERNAL_PORT = 18789;
const EXTERNAL_PORT = 18889;

const ALLOWED_IPS = [
    '10.29.152.70',
    '7.223.180.126'
];

const server = net.createServer((clientSocket) => {
    let remoteAddress = clientSocket.remoteAddress;
    if (remoteAddress.startsWith('::ffff:')) remoteAddress = remoteAddress.substring(7);

    if (!ALLOWED_IPS.includes(remoteAddress)) {
        console.log(`⛔ 拦截未授权 IP: ${remoteAddress}`);
        clientSocket.destroy();
        return;
    }

    const serviceSocket = new net.Socket();
    serviceSocket.connect(INTERNAL_PORT, '127.0.0.1', () => {
        clientSocket.pipe(serviceSocket);
        serviceSocket.pipe(clientSocket);
    });

    const handleError = () => { clientSocket.destroy(); serviceSocket.destroy(); };
    serviceSocket.on('error', handleError);
    clientSocket.on('error', handleError);
    serviceSocket.on('close', handleError);
    clientSocket.on('close', handleError);
});

server.listen(EXTERNAL_PORT, '0.0.0.0', () => {
    console.log(`✅ 代理已启动: 0.0.0.0:${EXTERNAL_PORT} -> 127.0.0.1:${INTERNAL_PORT}`);
});
