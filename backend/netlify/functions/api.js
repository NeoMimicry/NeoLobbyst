const serverless = require('serverless-http');
const app = require('../../serverless');

module.exports.handler = serverless(app);
