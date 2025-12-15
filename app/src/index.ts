import Fastify, { FastifyInstance } from 'fastify';
import fetch, { Headers, Request, Response } from 'node-fetch';
import { Blob } from 'buffer';
import FormData from 'form-data';

if (!global.fetch) {
    (global as any).fetch = fetch;
    (global as any).Headers = Headers;
    (global as any).Request = Request;
    (global as any).Response = Response;
}

if (!global.Blob) {
    (global as any).Blob = Blob;
}

import { ReadableStream } from 'stream/web';

if (!global.FormData) {
    (global as any).FormData = FormData;
}

if (!global.ReadableStream) {
    (global as any).ReadableStream = ReadableStream;
}
import websocket from '@fastify/websocket';
import dotenv from 'dotenv';
import { pino } from 'pino';
import { PrettyOptions } from 'pino-pretty';
import serviceLifecylePlugin from './service-lifecycle-plugin';
import dynamodbPlugin from './dynamodb-plugin';
import secretsPlugin from './secrets-plugin';
import { addAudiohookSampleRoute } from './audiohook-sample-endpoint';
import { addAudiohookLoadTestRoute } from './audiohook-load-test-endpoint';
import { addAudiohookVoiceTranscriptionRoute } from './audiohook-vt-endpoint';

dotenv.config();

const isDev = process.env['NODE_ENV'] !== 'production';

const loggerPrettyTransport: pino.TransportSingleOptions<PrettyOptions> = {
    target: 'pino-pretty',
    options: {
        colorize: true,
        ignore: 'pid,hostname',
        translateTime: 'SYS:HH:MM:ss.l',
    }
};

const server = Fastify({
    logger: isDev ? ({
        transport: loggerPrettyTransport
    }) : true
});

server.register(websocket, {
    options: {
        maxPayload: 65536
    }
});



server.register(async (fastify: FastifyInstance) => {
    addAudiohookSampleRoute(fastify, '/api/v1/audiohook/ws');
    addAudiohookVoiceTranscriptionRoute(fastify, '/api/v1/voicetranscription/ws');
    addAudiohookLoadTestRoute(fastify, '/api/v1/loadtest/ws');

});


server.register(dynamodbPlugin);
server.register(secretsPlugin);
server.register(serviceLifecylePlugin);


server.listen({
    port: parseInt(process.env?.['SERVERPORT'] ?? '3000'),
    host: process.env?.['SERVERHOST'] ?? '127.0.0.1'
}).then(() => {
    // Configure timeouts
    const timeout = parseInt(process.env['SERVER_CONNECTION_TIMEOUT'] ?? '1800000'); // Default 30 mins
    server.server.setTimeout(timeout);
    server.server.keepAliveTimeout = timeout;
    server.server.headersTimeout = timeout + 1000; // Must be greater than keepAliveTimeout

    server.log.info(`Server timeouts set to ${timeout}ms`);
    server.log.info(`Routes: \n${server.printRoutes()}`);
}).catch(err => {
    console.error(err);
    process.exit(1);
});
