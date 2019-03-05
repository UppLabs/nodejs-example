const http = require('http');
const https = require('https');
const debug = require('debug')('api:express');
const pem = require('pem');
const async = require('async');
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const compression = require('compression');
const helmet = require('helmet');
const expressPinoLogger = require('express-pino-logger');
const { graphqlExpress, graphiqlExpress } = require('apollo-server-express');
const uuidv4 = require('uuid/v4');

const { pinoExpress } = require('../pino');
const { env } = require('../env');

const ensureApiGateway = require('./lib/ensureApiGateway');
const { ensureCognitoUser, ensureDummyUser } = require('./lib/ensureCognitoUser');

const radloopGraphQL = require('../graphql/index');


const zendeskController = require( './controllers/zendeskController' );

// HTTPS server
const app = express();

// https://github.com/expressjs/body-parser
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Ping
app.get('/ping', (req, res) => res.send('pong'));
app.get('/favicon.ico', (req, res) => res.status(404).send());

// Zendesk
app.post( '/zendesk/mobile/auth', zendeskController.mobileAuth );

// RequestId
app.use((req, res, next) => {
  req.radloopRequestId = `express:${uuidv4()}`;
  next();
});

// https://github.com/pinojs/express-pino-logger
app.use(expressPinoLogger({
  logger: pinoExpress,
  genReqId: req => req.radloopRequestId,
}));
// https://github.com/expressjs/compression
//app.use(compression());
// https://helmetjs.github.io/
app.use(helmet({
  // https://helmetjs.github.io/docs/dns-prefetch-control/
  dnsPrefetchControl: {
    allow: false,
  },
  // https://helmetjs.github.io/docs/frameguard/
  frameguard: {
    action: 'deny',
  },
  // https://helmetjs.github.io/docs/hide-powered-by
  hidePoweredBy: {
    setTo: undefined,
  },
  // https://helmetjs.github.io/docs/hpkp/
  hpkp: env.HPKP_PINS.length === 0 ? undefined : {
    maxAge: env.HPKP_MAX_AGE,
    sha256s: env.HPKP_PINS,
    includeSubdomains: false,
    reportUri: env.HPKP_REPORT_URI,
    reportOnly: env.HPKP_REPORT_ONLY,
    setIf: req => req.secure,
  },
  // https://helmetjs.github.io/docs/hsts/
  hsts: {
    maxAge: 5184000,
  },
  // https://helmetjs.github.io/docs/ienoopen
  ieNoOpen: true,
  // https://helmetjs.github.io/docs/nocache/
  noCache: true,
  // https://helmetjs.github.io/docs/dont-sniff-mimetype/
  noSniff: true,
  // https://helmetjs.github.io/docs/xss-filter/
  xssFilter: true,
}));
// https://helmetjs.github.io/docs/referrer-policy/
app.use(helmet.referrerPolicy({
  policy: 'no-referrer',
}));


// HYYP Public Key Pinning [https://developer.mozilla.org/en-US/docs/Web/HTTP/Public_Key_Pinning]
if (env.isDev || env.HPKP_PINS.length === 0) {
  pinoExpress.info('Init.express: HPKP skipped');
}

// Validate API Gateway requests
app.use(ensureApiGateway({
  amazonAPIGatewayId: env.APIGATEWAY_ID,
  testIf: () => {
    if (!env.isDev) return true;

    pinoExpress.info('Init.express: ENSURE_API_GATEWAY skipped');
    return false;
  },
}));

// Testing route
app.get('/', (req, res) => {
  const data = {
    data: {
      test: true,
      method: req.method,
      url: req.url,
      path: req.path,
      protocol: req.protocol,
      ip: req.ip,
      ipx: req.ipx,
      hostname: req.hostname,

      headers: req.headers,
      params: req.params,
      query: req.query,
      cookies: req.cookies,
      body: req.body,
      env: {
        HOSTNAME: process.env.HOSTNAME,
        NODE_ENV: process.env.NODE_ENV,
      },
    },
  };
  req.log.info({ data }, 'Request /');
  res.send(data);
});


// CORS
const corsOriginAllHosts = env.CORS_VALID_ORIGINS.find(host => host === '*');
const corsOriginHosts = env.CORS_VALID_ORIGINS.map(host => host.toLowerCase());
let graphqlCors = (req, res, next) => next();
if (corsOriginHosts.length > 0) {
  graphqlCors = cors({
    origin: (origin, cb) => {
      if (corsOriginAllHosts) return cb(null, true);
      if (corsOriginHosts.indexOf(origin) !== -1) return cb(null, true);
      return cb(null, false);
    },
    methods: ['GET', 'POST'],
  });
}


// Unsafe GraphQL
const validDummyUser = ensureDummyUser({
  id: 512,
});

app.use('/test/graphiql', graphiqlExpress(radloopGraphQL.testGraphiql));
app.use('/test/graphql', graphqlCors, validDummyUser, graphqlExpress(radloopGraphQL.graphql));


// GraphQL
const validUser = ensureCognitoUser({
  poolId: env.COGNITO_POOL_ID,
  zone: env.AWS_REGION,
});


app.use('/graphql', graphqlCors, validUser, graphqlExpress(radloopGraphQL.graphql));


// Boom error decorator
app.use((error, req, res, next) => {
  req.log.error(error);
  if (res.headersSent) return next(error);
  if (!error.isBoom) return next(error);
  return res.status(error.output.statusCode).send(error.output.payload);
});


module.exports = {
  initialize: ({ port = 3000 }, done) => {
    console.time('Init.express.executionTime');
    async.autoInject({
      keys:
        (cb) => {
          if (env.isDev) return cb(null, false);

          return pem.createCertificate({
            days: 365 * 5,
            selfSigned: true,
            country: 'US',
            state: 'New York',
            locality: 'Wappingers Falls',
            organization: 'Radloop',
          }, cb);
        },
      http:
        (keys, cb) => {
          if (keys !== false) return cb(null, false);

          const server = http.createServer(app);
          return server.listen(port, cb);
        },
      https:
        (keys, cb) => {
          if (keys === false) return cb(null, false);

          const server = https.createServer({
            key: keys.serviceKey,
            cert: keys.certificate,
          }, app);
          return server.listen(port, cb);
        },
    }, (err, ctx) => {
      if (err) {
        pinoExpress.fatal(err, 'Init.express: fatal error');
        return done(err, null);
      }

      pinoExpress.info(`Init.express: HTTP${ctx.https === false ? '' : 'S'} ${port}`);
      console.timeEnd('Init.express.executionTime');
      return done(err, ctx);
    });
  },
};
