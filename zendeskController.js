const { env } = require( '../../env' );
const jwt = require('jsonwebtoken');
const uuidv4 = require('uuid/v4');
const { mysqlPersonnel } = require('../../mysql');
const zendesk = require('../../lib/zendesk');

const mobileAuth = ( req, res ) => {
  const userToken = req.body.user_token;
  console.log( '[ZENDESK AUTH]', 'RECEIVED USER TOKEN',  userToken );
  jwt.verify( userToken, env.MOBILE_APP_SECRET, function(err, decoded) {
    if ( err ) {
      res.status( 401 ).send( err );
    }
    else {
      try {
        console.log( '[ZENDESK AUTH]', 'USER TOKEN DECODED', decoded );
        const userId = decoded.id;
        const userEmail = decoded.email;
        mysqlPersonnel
          .findOne({
            where: {
              personnel_id: userId,
            }
          }).then( (personnel) => {
            res.json({
              jwt: zendesk.generateJWT( userEmail, personnel, env.ZENDESK_MOBILE_SDK_SECRET )
            });
          });
      }
      catch( e ) {
        res.status( 422 ).json( e );
      }
    }
  });
}

module.exports = {
  mobileAuth,
};
