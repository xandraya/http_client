import HTTPClient from '../../src/main';
import { ClientRequest, IncomingMessage } from 'http';

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

  test('parseSetCookie', () => {
    const res = {
      url: '/foo/bar?key=value#text',
      headers: {
        'set-cookie': [
          // parsed
          'cookie',
          'cookie="Parses cookies with both name and value, and no additional attributes"',
          'cookie="Parses values that include the \'=\' character"',
          'cookie="Parses attribute values that include the \'=\' character"; Path=/foo=bar',
          'cookie="Parses valid Expires attribute"; Expires="Sun, 01-Jan-35 11:12:13 GMT"',
          'cookie="Parses valid Max-Age attribute"; Max-Age=3600',
          'cookie="Parses valid Domain attribute"; Domain=.www.example.com',
          'cookie="Parses valid Path attribute"; Path=/path',
          'cookie="Parses valid Secure attribute"; Secure',
          'cookie="Parses valid HttpOnly attribute"; HttpOnly',

          // ignored
          '; Max-Age=3600',
          'cookie="Ignores malformed Max-Age attribute"; Max-Age=null',
        ]
      }
    }

    let attrList = client['parseSetCookie'](res as IncomingMessage);
    expect(attrList).toHaveLength(11);
    expect(attrList[0].name).toBe('');
    expect(attrList[0].value).toBe('cookie');
    expect(attrList[1].name).toBe('cookie');
    expect(attrList[1].value).toBe('"Parses cookies with both name and value, and no additional attributes"');
    expect(attrList[2].value).toContain('=');
    expect(attrList[3].value).toContain('=');
    expect(attrList[4].expires).toContain('Mon, 01 Jan 2035 11:12:13 GMT');
    expect(attrList[5].max_age).toBeDefined();
    expect(attrList[6].domain).toBe('www.example.com');
    expect(attrList[7].path).toBe('/path');
    expect(attrList[8].secure).toBe(true);
    expect(attrList[9].httponly).toBe(true);
    expect(attrList[10].max_age).not.toBeDefined();

  });

  test('computeTempStore', () => {
    client['_store'] = [
      {
        name: 'cookie', value: 'secure',
        creation_time: 0, last_access_time: Date.now(),
        domain: 'www.example.com', path: '/foo',
        secure_only_flag: true, http_only_flag: true,
      },
    ]

    const reqS = { host: 'www.example.com', protocol: 'https:' } 
    const resS = {
      url: '/foo/bar?key=value#text',
      headers: {
        'set-cookie': [
          // returned
          'cookie="Persistent flag not set"',
          'cookie="Persistent flag set"; Max-Age=3600',
          'cookie="Persistent flag and expiry time set"; Expires="Sun, 01-Jan-35 11:12:13 GMT"',
          'cookie="Domain set to request hostname, host_only flag set"',
          'cookie="Domain set to Domain attribute if request hostname domain-matches the Domain attribute, host-only flag not set"; Domain=example.com',
          'cookie="Path set to Path attribute"; Path=/path',
          'cookie="Path set to default-path"',
          'cookie="Secure flag set"; Secure',
          'cookie="Http_only flag set"; HttpOnly',
          '__Secure-cookie="Returns cookies whose name begins with __Secure-"; Secure',
          '__Host-cookie="Returns cookies whose name begins with __Host-"; Path=/; Secure',

          // ignored
          'cookie="Ignores cookies if Domain attribute value is a public suffix"; Domain=com',
          'cookie="Ignores cookies if request hostname does not domain-match the Domain attribute"; Domain=www.foobar.com',
        ]
      }
    }

    const req = { host: 'www.example.com', protocol: 'http:' } 
    const res = {
      url: '/foo/bar?key=value#text',
      headers: {
        'set-cookie': [
          'cookie="Returns cookies if their \"secure equivalents\" do not already exist in the store"; Path=/bar',

          // ignored
          'cookie="Ignores cookies from an unsecure protocol if secure flag is set"; Secure',
          'cookie="Ignores cookies that were already set during connections that used a secure context"; Path=/foo',
          '__Secure-cookie="Ignores cookies whose name begins with __Secure-"',
          '__Host-cookie="Ignores cookies whose name begins with __Host-"',
        ]
      }
    }


    const tempStoreS = client['computeTempStore'](reqS as ClientRequest, resS as IncomingMessage);
    expect(tempStoreS).toHaveLength(11);
    expect(tempStoreS[0].persistent_flag).toBe(false);
    expect(tempStoreS[1].persistent_flag).toBe(true);
    expect(tempStoreS[2].persistent_flag).toBe(true);
    expect(tempStoreS[2].expiry_time).toBe(2051262733000);
    expect(tempStoreS[3].domain).toBe('www.example.com');
    expect(tempStoreS[3].host_only_flag).toBe(true);
    expect(tempStoreS[4].domain).toBe('example.com');
    expect(tempStoreS[4].host_only_flag).toBe(false);
    expect(tempStoreS[5].path).toBe('/path');
    expect(tempStoreS[6].path).toBe('/foo');
    expect(tempStoreS[7].secure_only_flag).toBe(true);
    expect(tempStoreS[8].http_only_flag).toBe(true);

    const tempStore = client['computeTempStore'](req as ClientRequest, res as IncomingMessage);
    expect(tempStore).toHaveLength(1);
    expect(tempStore[0].path).toBe('/bar');
  });

  test('updateStore', () => {
    client['_store'] = [
      {
        name: 'update', value: 'toBeUpdated',
        creation_time: 0, last_access_time: Date.now(), expiry_time: 1,
        domain: 'example.com', path: '/',
      },
    ]

    const req = { host: 'www.example.com', protocol: 'https:' } 
    const res = {
      url: '/foo/bar?key=value#text',
      headers: {
        'set-cookie': [
          'update=updated; Domain=example.com; Path=/',
        ]
      }
    }

    client['updateStore'](req as ClientRequest, res as IncomingMessage);
    expect(client['_store']).toHaveLength(1);
    expect(client['_store'][0].expiry_time).not.toBe(1);
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
        creation_time: time, last_access_time: time,
        domain: 'example.com', path: '/foo/bar/baz',
      },
      {
        name: 'domainNotMatching', value: 'foobar',
        creation_time: time, last_access_time: time,
        domain: 'sub.dom.example.com', path: '/foo',
      },
      {
        name: 'secureFlagSet', value: 'foobar',
        creation_time: time, last_access_time: time,
        domain: 'sub.dom.example.com', path: '/foo',
        secure_only_flag: true,
      },

      // parsed
      {
        name: 'host_only_flag', value: 'true',
        creation_time: time, last_access_time: time,
        domain: 'www.example.com', path: '/foo',
        host_only_flag: true
      },
      {
        name: 'host_only_flag', value: 'false',
        creation_time: time, last_access_time: time,
        domain: 'example.com', path: '/foo',
        host_only_flag: false
      },
      {
        name: 'sorted_second', value: 'true',
        creation_time: time-9999, last_access_time: time,
        domain: 'example.com', path: '/foo',
      },
      {
        name: 'sorted_first', value: 'true',
        creation_time: time, last_access_time: time,
        domain: 'example.com', path: '/foo/bar',
      },
    ];

    const parsed_cookie = client['parseCookie']('www.example.com', '/foo/bar?key=value#text', 'http:').split(';');
    expect(client['_store']).toHaveLength(7);
    expect(parsed_cookie).toHaveLength(4);
    expect(parsed_cookie[0]).toContain('sorted_first=true');
    expect(parsed_cookie[1]).toContain('sorted_second=true');
    expect(client['_store'][4].last_access_time).not.toBe(time);
  })
});
