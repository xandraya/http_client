import * as pg from 'pg';
import type { AgentOptions, IncomingHttpHeaders } from 'node:http';
interface ScraperOptions {
    debug?: number;
    agentOptions?: AgentOptions;
    pgOptions?: pg.ClientConfig;
}
interface ScraperRequestOptions {
    timeout?: number;
    headersOnly?: boolean;
}
export default class Scraper {
    private _opt;
    private _client;
    private _store;
    private _pub_sufix;
    private _agent;
    private _headers;
    constructor(opt?: ScraperOptions);
    bootup(client: pg.Client): Promise<void>;
    teardown(): Promise<void>;
    private timeout;
    private connectPg;
    private createTables;
    private loadPublicSufixes;
    private loadCookieStore;
    private validateCookieDate;
    private computeDefaultPath;
    private computeCanonHostname;
    private domainMatch;
    private pathMatch;
    private parseSetCookie;
    private computeTempStore;
    private updateStore;
    private parseCookie;
    private handleHTTPError;
    private printDebug;
    request(host: string, path: string, cb: (data: Buffer | IncomingHttpHeaders) => void, options?: ScraperRequestOptions): Promise<number>;
}
export {};
