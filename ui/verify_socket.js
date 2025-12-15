const io = require('socket.io-client');
const http = require('http');

console.log('Starting verification...');

const socket1 = io('http://localhost:8080');
const socket2 = io('http://localhost:8080');

let msg1Count = 0;
let msg2Count = 0;

socket1.on('connect', () => {
    console.log('Socket 1 connected, joining conv-111');
    socket1.emit('join', '111');
});

socket2.on('connect', () => {
    console.log('Socket 2 connected, joining conv-222');
    socket2.emit('join', '222');
});

socket1.on('pubsub-message', (msg) => {
    console.log('Socket 1 received message:', msg);
    msg1Count++;
});

socket2.on('pubsub-message', (msg) => {
    console.log('Socket 2 received message:', msg);
    msg2Count++;
});

// Trigger simulation after a delay
setTimeout(() => {
    console.log('Triggering simulation for 111...');
    triggerSimulation('111', 'Hello 111');
}, 1000);

setTimeout(() => {
    console.log('Triggering simulation for 222...');
    triggerSimulation('222', 'Hello 222');
}, 2000);

setTimeout(() => {
    console.log('Checking results...');
    if (msg1Count === 1 && msg2Count === 1) {
        console.log('SUCCESS: Each socket received exactly 1 message.');
        process.exit(0);
    } else {
        console.error(`FAILURE: Socket 1 got ${msg1Count}, Socket 2 got ${msg2Count}`);
        process.exit(1);
    }
}, 3000);

function triggerSimulation(id, text) {
    const data = JSON.stringify({
        conversationId: id,
        message: text,
        sender: 'external'
    });

    const options = {
        hostname: 'localhost',
        port: 8080,
        path: '/simulate-message',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': data.length
        }
    };

    const req = http.request(options, (res) => {
        res.on('data', (d) => {
            console.log('Simulation response:', d.toString());
        });
    });

    req.on('error', (error) => {
        console.error('Simulation error:', error);
    });

    req.write(data);
    req.end();
}
