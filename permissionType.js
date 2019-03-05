const _ = require('lodash');


const permissionTypeEnumsByKey = {
  OWNER: 1,
  VIEWER: 2,
  ADMIN: 3,
};

const permissionTypeEnumsById = _.assign({
  1: 'OWNER',
  2: 'VIEWER',
  3: 'ADMIN',

}, _.invert(permissionTypeEnumsByKey));


const schema = `
  enum PERMISSION_TYPE {
    ${_.keys(permissionTypeEnumsByKey).join('\n')}
  }
`;


module.exports = {
  schema,
  mapToId: name => permissionTypeEnumsByKey[name],
  mapFromId: id => permissionTypeEnumsById[id],
};
