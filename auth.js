const url = require('url');
const http = require('http');
const axios = require('axios');
const opn = require('opn');
const AWS = require('aws-sdk');
const Promise = require('bluebird');

AWS.config.update({ region: 'us-east-1' });

const clientId = process.env.ALEXA_GUARD_CLIENT_ID;
const clientSecret = process.env.ALEXA_GUARD_CLIENT_SECRET;
const productId = process.env.ALEXA_GUARD_PRODUCT_ID;
const deviceId = process.env.ALEXA_GUARD_DEVICE_ID;
const randomString = Math.random().toString();
const port = 3000;
const redirectUri = `http://localhost:${port}/callback`;
const ssm = new AWS.SSM();
const getParameter = Promise.promisify(ssm.getParameter, { context: ssm });
const putParameter = Promise.promisify(ssm.putParameter, { context: ssm });

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
            return Promise.all([
              {
                Name: '/alexa-guard/dev/alexa-guard-token',
                Value: response.data.access_token,
                Overwrite: true,
                Type: 'SecureString',
              },
              {
                Name: '/alexa-guard/dev/alexa-guard-refresh-token',
                Value: response.data.refresh_token,
                Overwrite: true,
                Type: 'SecureString',
              },
            ].map((params) => putParameter(params)));
          }).then(() => {
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
    return getParameter({
      Name: '/alexa-guard/dev/alexa-guard-refresh-token',
      WithDecryption: true,
    }).then((parameter) => (
      axios.post('https://api.amazon.com/auth/o2/token', {
        grant_type: 'refresh_token',
        refresh_token: parameter.Value,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
      })
    )).then((response) => {
      if (response.status !== 200) {
        throw new Error(`error code ${response.status}`);
      }
      return Promise.all([
        {
          Name: '/alexa-guard/dev/alexa-guard-token',
          Value: response.data.access_token,
          Overwrite: true,
          Type: 'SecureString',
        },
        {
          Name: '/alexa-guard/dev/alexa-guard-refresh-token',
          Value: response.data.refresh_token,
          Overwrite: true,
          Type: 'SecureString',
        },
      ].map((params) => putParameter(params)));
    });
  },
};

module.exports = auth;
