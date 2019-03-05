const _ = require('lodash');

const sortTypeEnumsByKey = {
  LAST_UPDATE: 'last_update',
  NAME: 'name',
};
const sortTypeEnumsById = _.assign({
  last_update: 'LAST_UPDATE',
  'name': 'NAME',
}, _.invert(sortTypeEnumsByKey));

const schema = `
  enum Sort {
    ${_.keys(sortTypeEnumsByKey).join('\n')}
  }
  enum RecommendationSortFields {
    date_of_birth
    order_name
    last_update
    patient_name
    status
    date_of_service
    follow_up_date
    practice_name
    ordering_physician_name
  }
`;


module.exports = {
  schema,
  mapToId: name => sortTypeEnumsByKey[name],
  mapFromId: id => sortTypeEnumsById[id],
  mapRecommendationSortFieldsToId:   name => _.invert(recommendationSortFields)[name],
  mapRecommendationSortFieldsFromId: id => recommendationSortFields[id],
};