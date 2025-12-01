# http_client

smol http client that i use for stuff

# Example usage

```typescript

// optional
const opt: HTTPClientOptions = {
  debug: 0                                      // 0 (default) - off; 1 - basic; 2 - verbose
  agentOptions: {}                              // AgentOptions object - config for node's HTTP connection manager
  pgOptions: {}                                 // ClientConfig object - credentials for connecting to the postgres db
}

const client = new HTTPClient(opt)

// connect to the postgres database, load pubsufixes, restore old cookie session
await client.bootup()

const reqOpt: HTTPClientRequestOptions = {
  host: 'example.com',
  path: '/',
  method: 'GET',                                // GET and POST supported
  protocol: 'https',                            // set to HTTPS if unspecified
  port: 433,                                    // set to either 80 or 443, depending on the protocol, if unspecified
  headers: [ 'Connection': 'keep-alive' ]       // optional list of headers to include/replace
  timeout: 200,                                 // number of ms to wait after the request, useful for large scale scraping, 0ms by default
  headersOnly: false,                           // if set to yes, will terminate the connection upon receiving reponse headers,
                                                //   and pass the header array as the 2nd argument to the supplied callback
  useCookies: true                              // use and set cookies from the local store, true by default
}

let data = '';
const cb = (chunk: Buffer) => data += chunk;
await client.request(reqOpts, cb).catch(e => {
  // rejects on HTTP 400 and 500 error codes or other TCP connection errors
  /* error object has the following schema:
     {
       code: string
       message: string
       content_type: string
     }
  */
  handleError(e);
});

// at this point $data should hold the full response, 300 redirects are automatically followed
doSomething(data);

// save cookies and disconnect from the database
await client.teardown()
```


# RFCs referenced:

* 5234 | Augmented BNF for Syntax Specifications: ABNF
* 6265 | HTTP State Management Mechanism

ꉂ(˵˃ ᗜ ˂˵)
