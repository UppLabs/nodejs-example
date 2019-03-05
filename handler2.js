'use strict';

const AWS = require('aws-sdk');

AWS.config.update({ region: process.env.REGION });

const sqs = new AWS.SQS();

let envSSMScope = process.env.SQS_POSTFIX || 'unknownSSMScope';

let awsAccountId = process.env.AWS_CLIENT_ID;

const sqsPostfix = `${envSSMScope[0].toUpperCase()}${envSSMScope.slice(1)}`;

module.exports.trigger = (event, context, callback) => {
  console.log(`https://sqs.${process.env.REGION}.amazonaws.com/${awsAccountId}/RadloopSNSReportNotificationsEvents${sqsPostfix}`);

  sqs.sendMessage({
    DelaySeconds: 0,
    MessageBody: JSON.stringify(event),
    QueueUrl: `https://sqs.${process.env.REGION}.amazonaws.com/${awsAccountId}/RadloopSNSReportNotificationsEvents${sqsPostfix}`,
  }, function (err, data) {
    if (err) {
      console.log('sendMessageError', err);
    } else {
      console.log('sendMessageSuccess', data);
    }
    callback(err, data);
  });

  //callback(null, response);

  // Use this code if you don't use the http event with the LAMBDA-PROXY integration
  // callback(null, { message: 'Go Serverless v1.0! Your function executed successfully!', event });
};