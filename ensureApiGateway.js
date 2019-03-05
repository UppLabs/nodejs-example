const _ = require('lodash');
const Boom = require('boom');


module.exports = ({ amazonAPIGatewayId, testIf = () => true }) => {
  if (!testIf()) {
    return (req, res, next) => next();
  }
  if (!_.isString(amazonAPIGatewayId)) {
    return (req, res, next) => next(Boom.badImplementation('Missing default amazonAPIGatewayId'));
  }
  if (amazonAPIGatewayId.trim() === '') {
    return (req, res, next) => next(Boom.badImplementation('Invalid default amazonAPIGatewayId'));
  }

  return (req, res, next) => {
    if (amazonAPIGatewayId !== req.header('x-amzn-apigateway-api-id')) {
      console.log(amazonAPIGatewayId, " does not equal ", req.header('x-amzn-apigateway-api-id'));
      return next(Boom.unauthorized('Unauthorized: Client certificate required'));
    }
    return next();
  };
};
