export interface HTTPClientOptions {
  debug?: number
  agentOptions?: AgentOptions
  pgOptions?: pg.ClientConfig
}

export interface HTTPClientRequestOptions {
  host: string
  path: string
  method: 'GET' | 'POST'
  protocol?: 'http' | 'https'
  port?: number
  headers?: { [name: string]: string | number }
  timeout?: number
  headersOnly?: boolean
  useCookies?: boolean
}

export interface CookieAttrList {
  name: string
  value: string
  expires?: string
  max_age?: string
  domain?: string
  path?: string
  secure?: boolean
  httponly?: boolean
}

export interface Cookie {
  name: string
  value: string
  creation_time: number
  last_access_time: number
  expiry_time?: number
  domain?: string
  path?: string
  persistent_flag?: boolean
  host_only_flag?: boolean
  secure_only_flag?: boolean
  http_only_flag?: boolean
}

export type Month = "jan" | "feb" | "mar" | "apr" | "may" | "jun" | "jul" | "aug" | "sep" | "oct" | "nov" | "dec";

export interface CookieDate {
  hour: number
  minute: number
  second: number
  day_of_month: number
  month: Month
  year: number
}
