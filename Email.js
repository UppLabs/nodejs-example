const app = require('../server');
const { throwAnError } = require('../utils/loggers');
const sgMail = require('@sendgrid/mail');
const { promisify } = require('util');
const useQueue = app.get('useQueue');

module.exports = function(Email) {
  Email.Operations = {
    EMAIL_SEND: 'EMAIL_SEND'
  };

  Email.queueSend = async function(toEmail, subject, template) {
    if (useQueue) {
      return await Email._queueSend({ toEmail, subject, template });
    } else {
      return await Email.send(toEmail, subject, template);
    }
  };

  Email.consumeSend = async function({ toEmail, subject, template }) {
    await Email.send(toEmail, subject, template);
    return Promise.resolve();
  };

  Email.send = async function(toEmail, subject, template) {
    sgMail.send = promisify(sgMail.send);
    try {
      sgMail.setApiKey(process.env.SENDGRID_API_KEY);

      const msg = {
        to: toEmail,
        from: 'no-reply@vidende.com',
        subject: subject,
        html: template
      };

      if (!!process.env.JSW_ENABLE_EMAIL) {
        await sgMail.send(msg);
      } else {
        console.log(template);
      }
    } catch (error) {
      return throwAnError(error.message, error.statusCode, 'SEND_EMAIL');
    }
    return Promise.resolve();
  };
};
