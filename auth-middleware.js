const jwt = require('jwt-simple');
const app = require('../server');
const { errorCodes } = require('../utils/errorCodes');

module.exports = function(params) {
  const authMiddleware = (req, res, next) => {
    const accessToken = req.query.access_token;
    if (
      accessToken &&
      accessToken.length === 36 &&
      process.env.NODE_ENV === 'development'
    ) {
      app.models.User.findOne({ where: { id: accessToken } }, (err, user) => {
        res.locals.currentUser = user;
        next();
      });
      return;
    }

    if (params.freeRoutes.some(route => RegExp(route, 'g').test(req.url))) {
      next();
      return;
    }

    const authHeader = req.headers.authorization;
    if (authHeader || req.query.access_token) {
      try {
        const token = authHeader
          ? authHeader.replace('bearer ', '')
          : accessToken;

        const preDecode = jwt.decode(token, '', true);
        const now = new Date().getTime();

        if (preDecode.exp < now) {
          const error = new Error('Token expired');
          error.status = 401;
          error.code = errorCodes.TOKEN_EXPIRED;
          next(error);
        }

        app.models.User.findOne(
          { where: { id: preDecode.userId } },
          (err, user) => {
            try {
              let decodeToken = app.get('jwtTokenSecret');
              if (preDecode.isLongLife) {
                const timestamp = user.modifiedAt.getTime();
                decodeToken = app.get('jwtTokenSecret') + timestamp.toString();
              }
              const decoded = jwt.decode(token, decodeToken);
              res.locals.currentUser = user;
              res.locals.originalUserId = decoded.originalUserId;
              next();
            } catch (err) {
              const error = new Error('Invalid token');
              error.status = 401;
              error.code = errorCodes.TOKEN_EXPIRED;
              next(error);
            }
          }
        );
      } catch (err) {
        const error = new Error('Invalid token');
        error.status = 401;
        error.code = errorCodes.TOKEN_EXPIRED;
        next(error);
      }
    } else {
      const noTokenError = new Error('No auth token');
      noTokenError.status = 401;
      next(noTokenError);
    }
  };

  return authMiddleware;
};
