import HTTPClient from '../../src/main';
import { HTTPError } from '../../src/types';

describe('Bootup && Cleanup', () => {
  let s1: HTTPClient;
  let s2: HTTPClient;

  test('constructing', () => {
    const agentOptions = { keepAlive: false }
    const pgOptions = {
      host: 'database',
      port: 6566,
      user: 'postgres',
      password: 'password',
      database: 'test',
    };

    expect(s1 = new HTTPClient({})).toBeDefined();
    expect(s2 = new HTTPClient({ debug: 0, agentOptions, pgOptions })).toBeDefined();
  });

  test('bootup', () => {
    return expect(new Promise(async (resolve) => {
      await s1.bootup();
      await s2.bootup();
      expect(s1['_pub_sufix'].length).toBeGreaterThan(99);
      expect(s2['_pub_sufix'].length).toBeGreaterThan(99);
      resolve(0)
    })).resolves.toBe(0);
  });

  test('teardown', () => {
    return expect(new Promise(async (resolve) => {
      await s1.teardown();
      await s2.teardown();
      resolve(0)
    })).resolves.toBe(0);
  });
});

describe('Request', () => {
  let client: HTTPClient;

  beforeAll(() => {
    client = new HTTPClient({ debug: 1 });
    return Promise.resolve(client.bootup());
  });

  afterAll(() => {
    return Promise.resolve(client.teardown());
  });

  test('TLS GET', async () => {
    const opts = Object.freeze({
      host: 'httpbin.org',
      path: '/get',
      method: 'GET',
    });

    let data: string = '';
    const cb = (chunk: Buffer) => data += chunk;

    await client.request(opts, cb, 'foo=bar').then(() => {
      expect(JSON.parse(data).url).toBe('https://httpbin.org/get');
    });
  }, 10000);
  
  test('TLS POST', async () => {
    const opts = Object.freeze({
      host: 'httpbin.org',
      path: '/post',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      }
    });

    let data: string = '';
    const cb = (chunk: Buffer) => data += chunk;
      
    await client.request(opts, cb, 'foo=bar').then(() => {
      expect(JSON.parse(data).form.foo).toBe('bar');
    });
  }, 10000);

  test('HTTP GET', async () => {
    const opts = Object.freeze({
      host: 'example.com',
      path: '/',
      method: 'GET',
      protocol: 'http',
    });

    let data: string = '';
    const cb = (chunk: Buffer) => data += chunk;

    await client.request(opts, cb).then(() => {
      expect(data.search('<title>Example Domain</title>')).not.toBe(-1);
    });
  }, 10000);

  test('Handles 301, 302, 307, 308', async () => {
    const opts = Object.freeze({
      host: 'httpbin.org',
      path: '/redirect/2',
      method: 'GET',
    });

    let data: string = '';
    const cb = (chunk: Buffer) => data += chunk;

    await client.request(opts, cb).then(() => {
      expect(JSON.parse(data).url).toBe('https://httpbin.org/get');
    });
  }, 10000);

  test('Handles 4**', async () => {
    const opts = Object.freeze({
      host: 'httpbin.org',
      path: '/status/400',
      method: 'GET',
    });

    let data: string = '';
    const cb = (chunk: Buffer) => data += chunk;
    
    await client.request(opts, cb).catch((e: HTTPError) => {
      expect(e.code).toBe(400);
    });
  }, 10000);
});
