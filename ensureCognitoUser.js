const _ = require('lodash');
const request = require('request-promise-native');
const jwkToPem = require('jwk-to-pem');
const jwt = require('jsonwebtoken');
const Boom = require('boom');
const debug = require('debug')('api:ensureCognitoUser');

const { mysqlPersonnel } = require('../../mysql');
const ACL = require('../../module/personnel/aclPersonnel');


const cache = {};

const getCognitoPEMs = ({ zone = 'us-east-1', poolId }) =>
  request.get({
    uri: `https://cognito-idp.${zone}.amazonaws.com/${poolId}/.well-known/jwks.json`,
    json: true,
  })
  .then(body => _.chain(body)
    .get('keys', [])
    .transform((out, key) => {
      out[key.kid] = jwkToPem(key); // eslint-disable-line no-param-reassign
    }, {})
    .value());

const getCachedCognitoPEMs = ({ zone = 'us-east-1', poolId }) => {
  const key = `${zone}::${poolId}`;
  if (!cache[key]) cache[key] = getCognitoPEMs({ zone, poolId });
  return cache[key];
};

const validateToken = ({ pems, jwtToken, zone = 'us-east-1', poolId }) =>
  new Promise((resolve, reject) => {
    if (!pems) return reject('Missing PEMs');
    if (!jwtToken) return reject('Missing JWT token');

    const issuer = `https://cognito-idp.${zone}.amazonaws.com/${poolId}`;
    const decodedJWT = jwt.decode(jwtToken, {
      complete: true,
    });

    if (!decodedJWT) return reject('Not a valid JWT token');
    if (!decodedJWT.payload) return reject('Not a valid JWT payload');
    if (decodedJWT.payload.iss !== issuer) return reject('Invalid iss');
    if (decodedJWT.payload.token_use !== 'id') return reject('Not an id token');

    const pem = pems[decodedJWT.header.kid];
    if (!pem) return reject('Invalid kid');

    return jwt.verify(jwtToken, pem, { issuer }, (err, payload) => {
      if (err) return reject('Unauthorized signature for this JWT Token');
      return resolve(payload);
    });
  });

const validateDBUser = ({ webToken }) =>
  mysqlPersonnel.findByCognitoUsername(webToken['cognito:username'])
    .then((user) => {

      debug('validateDBUser returned '+JSON.stringify(user));

      if (!user) throw new Error(`User ${webToken['cognito:username']} (${webToken.email}) not authorized`);
      return user;
    });

const userCanAccess = ({ user }) => {
  const userACL = user.getUserACL();
  if (!userACL.canAccess()) throw new Error(`User type:${userACL.getMe('role')} unauthorized`);
  return user;
};


const ensureCognitoUser = ({ zone = 'us-east-1', poolId, storeOnKey = 'personnelUser' }) => {
  const cognitoPoolPEMs = getCachedCognitoPEMs({ zone, poolId });
  return (req, res, next) => {
    const jwtToken = req.header('authorization');
    if (!jwtToken) return next(Boom.unauthorized('Missing jwtToken'));

    return cognitoPoolPEMs
      .then(pems => validateToken({ pems, jwtToken, zone, poolId }))
      .then(webToken => validateDBUser({ webToken, context: req }))
      .then((user) => {
        req[storeOnKey] = user;
        return user;
      })
      .then(user => userCanAccess({ user }))
      .then(() => next())
      .catch(err => next(Boom.unauthorized(err)));
  };
};

const ensureDummyUser = ({ id, storeOnKey = 'personnelUser' }) =>
  (req, res, next) =>
    mysqlPersonnel.findByCognitoDummyUser(id)
      .then((user) => {
        if (!user) throw new Error(`User id:${id} not authorized`);
        req[storeOnKey] = user;
        return user;
      })
      .then(user => userCanAccess({ user }))
      .then(() => next())
      .catch(err => next(Boom.unauthorized(err)));


module.exports = {
  ensureCognitoUser,
  ensureDummyUser,
};
