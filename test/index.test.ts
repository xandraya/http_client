import HTTPClient from '../src/index.ts';

import { ClientRequest, IncomingMessage } from 'http';

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

describe('Cookie Store', () => {
  let client: HTTPClient;

  beforeAll(() => {
    client = new HTTPClient({ debug: 0, agentOptions: { keepAlive: false }});
    return Promise.resolve(client.bootup());
  });

  beforeEach(() => {
    client['_store'] = [];
  });

  afterAll(() => {
    return Promise.resolve(client.teardown());
  });

  test('validateCookieDate', () => {
    expect(client['validateCookieDate']('Sun, 08-Jan-84 11:12:13 GMT')).toContain('08 Jan 1984 11:12:13 GMT');
    expect(client['validateCookieDate']('Sun, 08-Jan-14 11:12:13 GMT')).toContain('08 Jan 2014 11:12:13 GMT');

    // order: time, DoM, month, year
    expect(() => client['validateCookieDate']('Sun, 08-Jan-14 11:12013 GMT')).toThrow('0111');
    expect(() => client['validateCookieDate']('Sun, 08-Jaf-14 11:12:13 GMT')).toThrow('1101');
    expect(() => client['validateCookieDate']('Sun, 08-Jan- 11:12:13 GMT')).toThrow('1110');
    expect(() => client['validateCookieDate']('Sun, -Jan- 11:12:13 GMT')).toThrow('1010');
    expect(() => client['validateCookieDate']('Sun, 32-Jan-14 11:12:13 GMT')).toThrow('1111');
    expect(() => client['validateCookieDate']('Sun, 08-Jan-1600 11:12:13 GMT')).toThrow('1111');
    expect(() => client['validateCookieDate']('Sun, 08-Jan-14 24:12:13 GMT')).toThrow('1111');
    expect(() => client['validateCookieDate']('Sun, 08-Jan-14 11:60:13 GMT')).toThrow('1111');
    expect(() => client['validateCookieDate']('Sun, 08-Jan-14 11:12:60 GMT')).toThrow('1111');
  });

  test('computeDefaultPath', () => {
    expect(client['computeDefaultPath']('')).toBe('/');
    expect(client['computeDefaultPath']('foobar')).toBe('/');
    expect(client['computeDefaultPath']('/foobar')).toBe('/');
    expect(client['computeDefaultPath']('/foo/bar')).toBe('/foo');
  });

  test('updateStore && computeTempStore && parseSetCookie', () => {
    client['_store'] = [
      {
        name: 'update', value: 'toBeUpdated',
        creation_time: Date.now(), last_access_time: Date.now(),
        domain: 'example.com', path: '/',
      },
    ]

    const req = { host: 'www.example.com' } 
    const res = {
      url: '/foo/bar?key=value#text',
      headers: {
        'set-cookie': [
          // ignored
          'foobar',
          '=foobar',
          'foo=bar; Domain=com',
          'foo=bar; Domain=notexample.com',
          'foo=bar; Domain=sub.dom.example.com',

          // updated
          'update=updated; Domain=example.com; Path=/',

          // added
          'foo=bar; Domain=www.example.com; Path=/foobar/fembaj; Secure; HttpOnly',
          'foo=bar; Domain=',
          'foo=bar; Domain=.www.example.com',
          'foo=bar; Domain=example.com',
        ]
      }
    }

    client['updateStore'](req as ClientRequest, res as IncomingMessage);
    expect(client['_store']).toHaveLength(5);
  });

  test('parseCookie', () => {
    const time = Date.now()-9999;
    client['_store'] = [
      // evicted
      {
        name: 'toBeEvicted', value: 'foobar',
        creation_time: time, last_access_time: time, expiry_time: (new Date(0)).getTime(),
        domain: 'example.com', path: '/foo',
      },

      // ignored
      {
        name: 'pathNotMatching', value: 'foobar',
        creation_time: time, last_access_time: time, expiry_time: Date.now()+999999999,
        domain: 'example.com', path: '/foo/bar/baz',
      },
      {
        name: 'domainNotMatching', value: 'foobar',
        creation_time: time, last_access_time: time, expiry_time: Date.now()+999999999,
        domain: 'sub.dom.example.com', path: '/foo',
      },

      // parsed
      {
        name: 'host_only_flag', value: 'true',
        creation_time: time, last_access_time: time, expiry_time: Date.now()+999999999,
        domain: 'www.example.com', path: '/foo',
        host_only_flag: true,
      },
      {
        name: 'host_only_flag', value: 'false',
        creation_time: time, last_access_time: time, expiry_time: Date.now()+999999999,
        domain: 'example.com', path: '/foo',
        host_only_flag: false,
      },
      {
        name: 'sorted_second', value: 'true',
        creation_time: time-9999, last_access_time: time, expiry_time: Date.now()+999999999,
        domain: 'example.com', path: '/foo',
        host_only_flag: false,
      },
      {
        name: 'sorted_first', value: 'true',
        creation_time: time, last_access_time: time, expiry_time: Date.now()+999999999,
        domain: 'example.com', path: '/foo/bar',
        host_only_flag: false,
      },
    ];

    const parsed_cookie = client['parseCookie']('www.example.com', '/foo/bar/baz?key=value#text').split(';');
    expect(client['_store']).toHaveLength(6);
    expect(parsed_cookie).toHaveLength(4);
    expect(parsed_cookie[0]).toContain('sorted_first=true');
    expect(parsed_cookie[1]).toContain('sorted_second=true');
    expect(client['_store'][4].last_access_time).not.toBe(time);
  })
});

describe('request', () => {
  let client: HTTPClient;

  beforeAll(() => {
    client = new HTTPClient({ debug: 1 });
    return Promise.resolve(client.bootup());
  });

  afterAll(() => {
    return Promise.resolve(client.teardown());
  });

  test('main', () => {
    return expect(new Promise(async (resolve) => {
      const cb = () => {};
      expect(await client.request('www.example.com', '/', cb)).toBe(0);
      resolve(0);
    })).resolves.toBe(0);
  });
});
