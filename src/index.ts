import * as http from 'node:http';
import * as https from 'node:https';
import * as zlib from 'node:zlib';
import * as pg from 'pg';

import type { ClientRequest, IncomingMessage, Agent, RequestOptions, OutgoingHttpHeaders, IncomingHttpHeaders } from 'node:http';
import type { Client } from 'pg';
import type { HTTPClientOptions, HTTPClientRequestOptions, CookieAttrList, Cookie, Month, CookieDate  } from './types';

const colors = Object.freeze({
	red: '\x1b[0;31m%s\x1b[0m',
	green: '\x1b[0;32m%s\x1b[0m',
	yellow: '\x1b[0;33m%s\x1b[0m',
	blue: '\x1b[0;34m%s\x1b[0m',
	magenta: '\x1b[0;35m%s\x1b[0m',
	cyan: '\x1b[0;36m%s\x1b[0m'
});

/**
 * Each HTTPClient instance should use its own database
  *@usage * const client = new HTTPClient(opt?: HTTPClientOptions)
          * await client.bootup()
          * await client.teardown()
*/
export default class HTTPClient {
  private _opt!: HTTPClientOptions;
  private _client!: Client;
  private _store!: Cookie[];
  private _pub_sufix!: string[];
  private _agent!: Agent;
  private _secureAgent!: Agent;
  private _headers!: OutgoingHttpHeaders;

  constructor(opt?: HTTPClientOptions) {
    const agentOpts = Object.freeze({
      keepAlive: true, // false
      keepAliveMsecs: 45000, // 1000
      maxSockets: 5, // Infinity
      maxTotalSockets: 5, // Infinity
      maxFreeSockets: 5, // 256
      scheduling: 'fifo', // 'lifo'
    });

    this._opt = Object.assign({}, opt);

    this._store = [];
    this._pub_sufix = [];

    this._agent = new http.Agent(this._opt.agentOptions || agentOpts);
    this._secureAgent = new https.Agent(this._opt.agentOptions || agentOpts);

    this._headers = {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      'Accept-Language': 'en-US,en;q=0.5',
      'DNT': 1,
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'no-cors',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Sec-GPC': '1',
      'Upgrade-Insecure-Requests': 1,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; rv:137.0) Gecko/20100101 Firefox/137.0',
    };
    !this._opt.agentOptions ? this._headers['Connection'] = 'keep-alive' :
      this._opt.agentOptions.keepAlive && (this._headers['Connection'] = 'keep-alive');
  }

  async bootup(client?: pg.Client): Promise<void> {
    return new Promise(async (resolve, reject) => {
      try {
        this._client = client || await this.connectPg();
        await this.createTables();
        await this.loadPublicSufixes();
        await this.loadCookieStore();
      } catch(err: any) {
        reject(new Error(`BOOTUP FAILED: ${err.message}`));
      }
      resolve();
    });
  }

  async teardown(): Promise<void> {
    return new Promise(async (resolve, reject) => {
      try{
        this._agent.destroy();

        await this._client.query('truncate table cookie_store');
        for (let cookie of this._store)
          cookie.persistent_flag && 
            await this._client.query(`insert into cookie_store values ('${cookie.name}', '${cookie.value}', ${cookie.creation_time}, \
\ \ \ \ \ \ \ ${cookie.last_access_time}, ${cookie.expiry_time}, '${cookie.domain}', '${cookie.path}', \
\ \ \ \ \ \ \ ${cookie.host_only_flag}, ${cookie.secure_only_flag}, ${cookie.http_only_flag})`);

        await this._client.end();
      } catch(err: any) {
        reject(new Error(`CLEANUP FAILED: ${err.message}`));
      }
      resolve();
    });
  }

  private timeout(ms: number) {
    return new Promise(res => setTimeout(res, ms));
  }

  private async connectPg(): Promise<pg.Client> {
    const config: pg.ClientConfig = Object.freeze({
      host: 'database',
      port: 6566,
      user: 'postgres',
      password: 'password',
      database: 'test',
    });

    const client = new pg.Client(this._opt.pgOptions || config);
    await client.connect();
    if (this._opt.debug === 2) {
      client.on('error', err => {
        console.error('postgres error', err.stack)
      });
      client.on('notice', msg => console.warn('notice:', msg));
    }

    return client;
  }

  private async createTables() {
    await this._client.query(
      `create table if not exists cookie_store (name varchar(256), value varchar(4096), creation_time bigint, last_access_time bigint, \
\ \ \ \ expiry_time bigint, domain varchar(256), path varchar(256), host_only_flag boolean, secure_only_flag boolean, http_only_flag boolean)`
    );
    await this._client.query(`create table if not exists pub_sufix (timestamp bigint, data text)`);
  }

  private async loadPublicSufixes() {
    console.log('Public sufix list empty; Loading from database...')
    const result = await this._client.query('select * from pub_sufix');

    if (!result.rows.length || result.rows.length && Date.now() - Number(result.rows[0].timestamp) > 1000*60*60*24) {
      console.log('Database empty or outdated list; Loading from upstream...')

      const regex = /\r?\n/;
      let data = '';
      const cb = (chunk: any) => {
        let next: number;
        let line: string;
        data += chunk as string;
        data = data.trimStart();

        while (true) {
          next = data.search(regex);
          if (next === -1) break;

          line = data.slice(0, next);
          if (!line.startsWith('//')) this._pub_sufix.push(line);
          data = data.slice(next, data.length);
          data = data.trimStart();
        }
      };
      await this.request({ host: 'publicsuffix.org', path: '/list/public_suffix_list.dat', method: 'GET' }, cb); 

      await this._client.query('truncate table pub_sufix');
      await this._client.query(`insert into pub_sufix (timestamp, data) values (${Date.now()}, '${JSON.stringify(this._pub_sufix)}')`);
    } 

    else
      this._pub_sufix = JSON.parse((result.rows[0].data as string));
  }

  private async loadCookieStore() {
    const cookies = await this._client.query('select * from cookie_store').then(r => r.rows); 
    for (let cookie of cookies) {
      cookie.creation_time = Number(cookie.creation_time);
      cookie.last_access_time = Number(cookie.last_access_time);
      cookie.expiry_time = Number(cookie.expiry_time);
      cookie.persistent_flag = true;
    }
    this._store = cookies;
  }

  private validateCookieDate(date: string): string {
    const delimRegex = /(\x09|[\x20-\x2F]|[\x3B-\x40]|[\x5B-\x60]|[\x7B-\x7E])/;
    const nonDelimRegex = /([\x00-\x08]|[\x0A-\x1F]|[\x30-\x39]|:|([\x41-\x5A]|[\x61-\x7A])|[\x7B-\x7E])/;

    let [found_time, found_day_of_month, found_month, found_year] = [false, false, false, false];
    let parsedDate: CookieDate = { hour: 0, minute: 0, second: 0, day_of_month: 0, month: 'jan', year: 0 };
    let split = date.split('');

    parsing: {
      while (true) {
        let date_token = '';

        while (split[0].match(nonDelimRegex)) {
          date_token += split.shift();
          if (!split.length) break;
        }

        matching: {
          if (date_token.match(/^\d{1,2}:\d{1,2}:\d{1,2}$/) && !found_time) {
            [parsedDate.hour, parsedDate.minute, parsedDate.second] = date_token.split(':').map(e => Number(e));
            found_time = true;
            break matching;
          }

          if (date_token.match(/^\d{1,2}$/) && !found_day_of_month) {
            parsedDate.day_of_month = Number(date_token);
            found_day_of_month = true;
            break matching;
          }

          if (date_token.toLowerCase().match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/) && !found_month) {
            parsedDate.month = date_token.toLowerCase() as Month;
            found_month = true;
            break matching;
          }

          if (date_token.match(/\d{2,4}/) && !found_year) {
            parsedDate.year = Number(date_token);
            found_year = true;
            break matching;
          }
        }

        if (!split.length) break parsing;
        while (split[0].match(delimRegex)) {
          split.shift();
          if (!split.length) break parsing;
        } 
      }
    }

    if (parsedDate.year.toString().length === 2) {
      if (parsedDate.year >= 70 && parsedDate.year <= 99)
        parsedDate.year += 1900;

      else if (parsedDate.year >= 0 && parsedDate.year <= 69)
        parsedDate.year += 2000;
    }

    if (
      !found_time || !found_day_of_month || !found_month || !found_year ||
      parsedDate.day_of_month < 1 || parsedDate.day_of_month > 31 ||
      parsedDate.year < 1601 ||
      parsedDate.hour > 23 ||
      parsedDate.minute > 59 ||
      parsedDate.second > 59
    )
      throw new Error(`DATE PARSING FAILED; FLAGS: ${Number(found_time)}${Number(found_day_of_month)}${Number(found_month)}${Number(found_year)}`);

    return (new Date(
      `${parsedDate.day_of_month} ${parsedDate.month} ${parsedDate.year} ${parsedDate.hour}:${parsedDate.minute}:${parsedDate.second} GMT`
    )).toUTCString();
  }

  private computeDefaultPath(url: string | undefined): string {
    let uri_path: string = '';
    if (url) uri_path = url.split(String.fromCharCode(0x3F))[0];
    if (!uri_path || !uri_path.startsWith(String.fromCharCode(0x2F))) return String.fromCharCode(0x2F);
    if ([...uri_path.matchAll(/\//g)].length === 1) return String.fromCharCode(0x2F);
    else return uri_path.slice(0, uri_path.lastIndexOf(String.fromCharCode(0x2F)));
  }

  private computeCanonHostname(host: string): string {
    // implementation deferred
    return host.toLowerCase();
  }

  private domainMatch(hostname: string, domain: string): boolean {
    return hostname === domain || hostname.endsWith(domain) && hostname.slice(0, -domain.length).endsWith(String.fromCharCode(0x2E)); 
  }

  private pathMatch(request_path: string, cookie_path: string): boolean {
    const pos = request_path.search(/\?/);
    if (pos >= 0) request_path = request_path.slice(0, pos);
    return cookie_path === request_path || 
      request_path.startsWith(cookie_path) && (cookie_path.endsWith(String.fromCharCode(0x2F)) || 
      request_path.slice(cookie_path.length).startsWith(String.fromCharCode(0x2F)))
  }

  private parseSetCookie(res: IncomingMessage): CookieAttrList[] {
    const cookies = res.headers['set-cookie'] as string[];
    let attrList: CookieAttrList[] = [];

    for (let cookie of cookies) {
      let validated: CookieAttrList = { name: '', value: '' };

      let [name_value, ...unparsed_attr] = cookie.split(';');

      let name, value, pos;
      if ((pos = name_value.search('=')) > 0) {
        name = name_value.slice(0, pos);
        value = name_value.slice(pos+1);
      } else {
        name = '';
        value = name_value;
      }
      name = name.replace(/(^\s+|\s+$)/g, '');
      value = value.replace(/(^\s+|\s+$)/g, '');
      if (!name && !value) continue;
      validated.name = name;
      validated.value = value;

      if (unparsed_attr) {
        for (let attr of unparsed_attr) {
          let name, value, pos;
          if ((pos = attr.search('=')) > 0) {
            name = attr.slice(0, pos);
            value = attr.slice(pos+1);
          } else {
            name = attr;
            value = undefined;
          }
          name = name.replace(/(^\s+|\s+$)/g, '');
          value && (value = value.replace(/(^\s+|\s+$)/g, ''));
          if (!name) continue;

          if (name.toLowerCase() === 'expires') {
            try {
              if (!value) continue;
              validated.expires = this.validateCookieDate(value);
            } catch(err: any) {
              continue;
            }
            continue;
          }

          if (name.toLowerCase() === 'max-age') {
            if (!value) continue;
            if (value.match(/^-?\d+$/)) {
              let delta = Math.round(Number(value));
              if (isNaN(delta)) continue;
              validated.max_age = delta <= 0 ? (new Date()).toUTCString() : (new Date()).toUTCString() + delta;
            }
            continue;
          }

          if (name.toLowerCase() === 'domain') {
            if (!value) continue;
            if (value[0].match(/\x2E/))
              validated.domain = value.slice(1).toLowerCase();
            else validated.domain = value.toLowerCase();
            continue;
          }

          if (name.toLowerCase() === 'path') {
            if (!value || !value[0].match(/\x2F/))
              validated.path = this.computeDefaultPath(res.url);
            //else validated.path = res.url!.split(String.fromCharCode(0x3F))[0];
            else validated.path = value;
            continue;
          }

          if (name.toLowerCase() === 'secure') {
            validated.secure = true;
            continue;
          }

          if (name.toLowerCase() === 'httponly')
            validated.httponly = true;

        }
      }
      attrList.push(validated);
    }

    return attrList;
  }

  private computeTempStore(req: ClientRequest, res: IncomingMessage): Cookie[] { 
    const store = this._store;
    const attrListArray = this.parseSetCookie(res);
    const tempStore: Cookie[] = [];
    const canonHostname = this.computeCanonHostname(req.host);
    let domain_attribute: string;

    for (let attrList of attrListArray) {
      let cookie: Cookie = { name: attrList.name, value: attrList.value, creation_time: Date.now(), last_access_time: Date.now() }

      if (attrList.max_age || attrList.expires) { 
        cookie.persistent_flag = true;
        cookie.expiry_time = attrList.max_age ? (new Date(attrList.max_age)).getTime() : (new Date(attrList.expires as string)).getTime();
      } else {
        cookie.persistent_flag = false;
        cookie.expiry_time = Date.now()+1000*60*60*24;
      }

      if (attrList.domain)
        domain_attribute = attrList.domain;
      else domain_attribute = '';

      if (this._pub_sufix.includes(domain_attribute)) {
        if (domain_attribute === canonHostname)
          domain_attribute = '';
        else continue;
      }
      
      if (domain_attribute) {
        if (!this.domainMatch(canonHostname, domain_attribute))
          continue;
        else {
          cookie.host_only_flag = false;
          cookie.domain = domain_attribute;
        }
      } else {
        cookie.host_only_flag = true;
        cookie.domain = canonHostname;
      }

      cookie.path = attrList.path ? attrList.path : this.computeDefaultPath(res.url);
      cookie.secure_only_flag = attrList.secure ? true : false;
      if (cookie.secure_only_flag && req.protocol !== 'https:') continue;
      cookie.http_only_flag = attrList.httponly ? true : false;

      let dump = false;
      if (!cookie.secure_only_flag && req.protocol !== 'https:')
        for (let i=0; i<store.length; i++) {
          if (store[i].name === cookie.name && store[i].secure_only_flag && 
            (this.domainMatch(cookie.domain || '', store[i].domain || '') && this.domainMatch(store[i].domain || '', cookie.domain || '')) &&
            this.pathMatch(cookie.path || '', store[i].path || '')
          ) { dump = true; break; }
        }
      if (dump) continue;

      if (cookie.name.startsWith('__Secure-') && !cookie.secure_only_flag) continue;
      if (cookie.name.startsWith('__Host-') && 
        (!cookie.secure_only_flag || !cookie.host_only_flag || cookie.path && cookie.path !== '/')) 
        continue;

      tempStore.push(cookie);
    }

    return tempStore;
  }

  private updateStore(req: ClientRequest, res: IncomingMessage): void {
    const store = this._store;
    const tempStore = this.computeTempStore(req, res);

    for (let i=0; i<tempStore.length; i++) {
      for (let j=0; j<store.length; j++) {
        if (store[j].name === tempStore[i].name && store[j].domain === tempStore[i].domain && store[j].path === tempStore[i].path) {
          tempStore[i].creation_time = store[j].creation_time;
          store.splice(j,1);
          break;
        }
      }
    }

    store.push(...tempStore);
  }

  private parseCookie(host: string, path: string, protocol: 'http:' | 'https:'): string { 
    const store = this._store;
    let parsed_cookie_list: string = '';

    for (let i=0; i<store.length; i++)
      typeof store[i].expiry_time === 'number' && Date.now() - store[i].expiry_time! > 0 && store.splice(i, 1);

    const cookie_list = store.filter(cookie => {
      if (
        (cookie.host_only_flag && this.computeCanonHostname(host) === cookie.domain ||
          !cookie.host_only_flag && this.domainMatch(host, cookie.domain as string)) &&
        this.pathMatch(path, cookie.path || '') &&
        (protocol === 'https:' && cookie.secure_only_flag || protocol === 'http:' && !cookie.secure_only_flag)
      ) return true;
    });

    cookie_list.sort((a: Cookie, b: Cookie) => {
      const aPath = a.path || '';
      const bPath = b.path || '';
      if (aPath.length < bPath.length) return 1;
      else if (aPath.length === bPath.length)
        return a.creation_time < b.creation_time ? -1 : 1;
      else return -1;
    })

    for (let i=0; i<cookie_list.length; i++) {
      for (let j=0; j<store.length; j++) {
        if (store[j].name === cookie_list[i].name && store[j].domain === cookie_list[i].domain && store[j].path === cookie_list[i].path) {
          store[j].last_access_time = Date.now();
          break;
        }
      }
    }
    
    for (let i=0; i<cookie_list.length; i++) {
      parsed_cookie_list += `${cookie_list[i].name}=${cookie_list[i].value}`;
      if (i !== cookie_list.length-1) parsed_cookie_list += '; ';
    }

    return parsed_cookie_list;
  }

  private async handleHTTPError(res: IncomingMessage, opts: HTTPClientRequestOptions, cb: (data: Buffer, headers?: IncomingHttpHeaders) => void, postData?: string): Promise<number> 
  {
    let regex: RegExpExecArray | null;
    let host, path: string | undefined;

    switch (res.statusCode) {
      case 302:
        if (this._opt.debug) {
          console.log('');
          console.log(`${colors.blue} ${colors.cyan}`, 'Redirecting to: ', res.headers.location);
        }

        if (!res.headers.location) throw new Error('302 - redirect path not obtained');
        res.headers.location.startsWith('http') ?
          regex = /https:\/\/([^\/]*)(\/.*)/.exec(res.headers.location) :
          regex = /(\/.*)/.exec(res.headers.location);
        if (!regex) throw new Error('302 - could not parse URL');
        regex.shift();
        path = regex.pop();
        if (!path) throw new Error('302 - could not parse PATH');
        host = regex.pop();
        if (!host) host = opts.host;

        return this.request(Object.assign({}, opts, { host, path }) , cb, postData);
      case 403:
        throw new Error('403 - Forbidden');
      case 429:
        console.log('');
        console.log(colors.yellow, 'Server returned 429; Waiting...');

        await this.timeout(1000*60*5);
        return this.request(Object.assign({}, opts, { host, path }) , cb, postData);
      default:
        throw new Error(`Missing HTTP error handler for status code ${res.statusCode}`);
    }
  }

  private printDebug(req: ClientRequest, res: IncomingMessage) {
    console.log('');
    console.log(`${colors.blue} ${colors.cyan}`, 'Requested url:', `${req.host}${req.path}`);
    console.log(`${colors.blue} ${colors.cyan}`, 'Requested with headers:', req.getHeaders());
    console.log(`${colors.blue} ${colors.cyan}`, 'Response status:', res.statusCode);
    console.log(`${colors.blue} ${colors.cyan}`, 'Response headers:', res.headers);
    res.headers['set-cookie'] && console.log(`${colors.blue} ${colors.cyan}`, 'Response set-cookie header:', res.headers['set-cookie']);

    if (this._opt.debug === 2) {
      let sockets: string[] = [];
      let cookies: string[] = [];

      let freeSockets = Object.keys(this._agent.freeSockets);
      freeSockets && freeSockets.forEach(s => {
        let socket = this._agent.freeSockets[s];
        if (socket) sockets.push(`${socket[0].localAddress}:${socket[0].localPort}`);
      });

      for (let cookie of this._store)
        cookies.push(`${cookie.name}=${cookie.value}`);

      console.log('');
      console.log(`${colors.blue} ${colors.cyan}`, 'Used socket:', `${res.socket.localAddress}:${res.socket.localPort}`);
      console.log(`${colors.blue} ${colors.cyan}`, 'Available sockets:', sockets);
      console.log(`${colors.blue} ${colors.cyan}`, 'Cookies in store:', cookies);
    }
  }

  async request(opts: HTTPClientRequestOptions, cb: (data: Buffer, headers?: IncomingHttpHeaders) => void, postData?: string): Promise<number> { 
    return new Promise((resolve, reject) => {
      const protocol = opts.protocol === 'http' ? http : https; 
      const reqCookie = this.parseCookie(opts.host, opts.path, protocol === http ? 'http:' : 'https:');
      const reqOptions: RequestOptions = {
        agent: (protocol === http ? this._agent : this._secureAgent),
        method: opts.method,
        host: opts.host,
        path: opts.path, 
        family: 4,
        protocol: (protocol === http ? 'http:' : 'https:'),
        port: opts.port || (protocol === http ? '80' : '443'),
        headers: reqCookie || opts.headers ? Object.assign({}, this._headers, { 'Cookie': reqCookie }, opts.headers) : this._headers,
      }

      const req: ClientRequest = protocol.request(reqOptions, (res) => {
        this._opt.debug && this.printDebug(req, res);

        try {
          if (res.headers['set-cookie']) 
            this.updateStore(req, res);
        } catch(err: any) {
          reject(new Error(`REQUEST FAILED: ${err.message}`));
        }

        if (!String(res.statusCode).match(/^2\d{2}$/)) { 
          res.destroy();
          return resolve(this.handleHTTPError(res, opts, cb, postData));
        }

        res.on('error', (err: any) => {
          reject(new Error(`REQUEST FAILED: ${err.message} | ${err.code}`));
        });

        if (opts.headersOnly) {
          res.destroy();
          cb(Buffer.alloc(0), res.headers);
          return resolve(0);
        }

        if (res.headers['content-encoding']) {
          switch (res.headers['content-encoding']) {
            case 'gzip':
              const gzip = zlib.createGunzip();
              res.pipe(gzip);
              gzip.on('data', (chunk) => cb(chunk, res.headers));
              gzip.on('end', () => {
                opts.timeout && this.timeout(opts.timeout);
                resolve(0);
              });
              break;
            case 'deflate':
              const deflate = zlib.createInflate();
              res.pipe(deflate);
              deflate.on('data', (chunk) => cb(chunk, res.headers));
              deflate.on('end', () => {
                opts.timeout && this.timeout(opts.timeout);
                resolve(0);
              });
              break;
            case 'br':
              const br = zlib.createBrotliDecompress();
              res.pipe(br);
              br.on('data', (chunk) => cb(chunk, res.headers));
              br.on('end', () => {
                opts.timeout && this.timeout(opts.timeout);
                resolve(0);
              });
              break;
            default:
              reject(new Error('REQUEST FAILED: Encoding algo not supported'));
              return;
          }
        }
        else {
          res.on('data', (chunk) => cb(chunk, res.headers));
          res.on('end', () => {
            opts.timeout && this.timeout(opts.timeout);
            resolve(0);
          });
        }
      });

      req.on('error', async (err: any) => {
        if (err.message === 'socket hang up' && err.code === 'ECONNRESET') {
          console.log('');
          console.log(colors.yellow, 'Connection closed before receiving the response; Retrying in 15s...');

          await this.timeout(1000*15);
          resolve(this.request(opts, cb, postData));
        }
        else
          reject(new Error(`REQUEST FAILED: ${err.message} | ${err.code}`));
      });

      opts.method === 'POST' && req.write(postData);
      req.end();
    });
  }
}
