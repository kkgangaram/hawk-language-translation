import fetch, { Headers, Request, Response } from 'node-fetch';

if (!global.fetch) {
    (global as any).fetch = fetch;
    (global as any).Headers = Headers;
    (global as any).Request = Request;
    (global as any).Response = Response;
}

console.log('Checking global.Headers...');
if ((global as any).Headers) {
    console.log('SUCCESS: global.Headers is defined.');
    process.exit(0);
} else {
    console.error('FAILURE: global.Headers is NOT defined.');
    process.exit(1);
}
