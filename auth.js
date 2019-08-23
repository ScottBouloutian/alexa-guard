const url = require('url');
const http = require('http');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const opn = require('opn');

const clientId = process.env.ALEXA_GUARD_CLIENT_ID;
const clientSecret = process.env.ALEXA_GUARD_CLIENT_SECRET;
const productId = process.env.ALEXA_GUARD_PRODUCT_ID;
const deviceId = process.env.ALEXA_GUARD_DEVICE_ID;
const seedRefreshToken = process.env.ALEXA_GUARD_REFRESH_TOKEN;
const randomString = Math.random().toString();
const port = 3000;
const redirectUri = `http://localhost:${port}/callback`;

// Format the authentication url
const loginPath = url.format({
  protocol: 'https',
  host: 'www.amazon.com',
  pathname: 'ap/oa',
  query: {
    client_id: clientId,
    scope: 'alexa:all',
    scope_data: JSON.stringify({
      'alexa:all': {
        productID: productId,
        productInstanceAttributes: {
          deviceSerialNumber: deviceId,
        },
      },
    }),
    response_type: 'code',
    redirect_uri: redirectUri,
    state: randomString,
  },
});

const auth = {
  login() {
    // Start the server to accept the redirect
    const server = http.createServer((req, resp) => {
      const urlObject = url.parse(req.url, true);
      const { query, pathname } = urlObject;
      switch (pathname) {
        case '/':
          resp.writeHead(302, {
            Location: loginPath,
          });
          resp.end();
          break;
        case '/callback':
          if (query.state !== randomString) {
            resp.end('Cross site forgery checking failed');
            break;
          }
          axios.post('https://api.amazon.com/auth/o2/token', {
            grant_type: 'authorization_code',
            code: query.code,
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: redirectUri,
          }).then((response) => {
            if (response.status !== 200) {
              resp.end(`Error code ${response.status}`);
            }
            const token = response.data.access_token;
            const refreshToken = response.data.refresh_token;
            const data = JSON.stringify({ token, refreshToken });
            fs.writeFileSync(path.resolve(__dirname, '.token.json'), data);
            resp.end('Done, you may close this page');
            server.close();
            process.exit();
          }).catch((error) => resp.end(error.message));
          break;
        default:
          resp.end('Invalid pathname');
      }
    }).listen(port);
    opn(`http://localhost:${port}`);
  },

  refresh() {
    const exists = fs.existsSync('/tmp/.token.json');
    const tokenData = exists
      ? JSON.parse(fs.readFileSync('/tmp/.token.json'))
      : { refreshToken: seedRefreshToken };
    return axios.post('https://api.amazon.com/auth/o2/token', {
      grant_type: 'refresh_token',
      refresh_token: tokenData.refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
    }).then((response) => {
      if (response.status !== 200) {
        throw new Error(`error code ${response.status}`);
      }
      const token = response.data.access_token;
      const refreshToken = response.data.refresh_token;
      const data = JSON.stringify({ token, refreshToken });
      fs.writeFileSync('/tmp/.token.json', data);
    });
  },
};

module.exports = auth;
