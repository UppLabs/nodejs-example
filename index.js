const { makeExecutableSchema } = require('graphql-tools');

const { UserContext } = require('./userContext');


const radloopSchema = makeExecutableSchema(require('./schema'));


module.exports = {
  graphql: req => ({
    schema: radloopSchema,
    context: new UserContext(req),
    formatError: (err) => {
      req.log.warn(err);
      return err;
    },
  }),
  graphiql: () => ({
    endpointURL: '/graphql',
  }),
  testGraphiql: () => ({
    endpointURL: '/test/graphql',
  }),
  schema: radloopSchema,
};
