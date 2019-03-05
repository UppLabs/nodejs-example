const app = require('../server');
const { checkModelEntryPermission } = require('../utils/permissions');
const fs = require('fs');
const _ = require('lodash');

const { throwAnError } = require('../utils/loggers');
const { Operations, Permissions } = require('../utils/permissions');
const {
  downloadFromAzure,
  processUpload,
  getStorePath
} = require('../utils/attachment');
const promisify = require('util').promisify;
const crypter = require('../utils/crypter');

module.exports = function(Model) {
  Model.hasAndBelongsToMany('attachments', {
    model: 'Attachment'
  });

  const pickProperties = [
    'fileName',
    'containerName',
    'originalFileName',
    'isEncrypted',
    'creatorId',
    'type',
    'classification',
    'description',
    'attachmentSize'
  ];

  Model.uploadattachments = async function(req, res, options) {
    try {
      let modelInstance = await Model.findById(req.params.id);
      const { Event, EventType, Attachment } = app.models;

      const result = [];

      let execution = modelInstance;
      if (Model.definition.name == 'ExecutionTicket') {
        execution = await modelInstance.execution.get();
      }

      const structuralNodeId = execution.structuralNodeId;
      const attachments = await processUpload(
        req,
        structuralNodeId,
        process.env.JSW_ENCRYPT_ATTACHMENTS,
        options
      );

      for (const attachmentInfo of attachments) {
        const attachment = await modelInstance.attachments.create(
          attachmentInfo,
          options
        );
        result.push(attachment);

        const uploadedEventData = {
          targetModel: Attachment.definition.name,
          targetId: attachment.id,
          structuralNodeId: attachment.structuralNodeId
        };

        const attachedEventData = {
          targetModel: Model.definition.name,
          targetId: execution.id,
          structuralNodeId: execution.structuralNodeId
        };

        await Event.generate({
          eventData: uploadedEventData,
          eventTypeId: EventType.types.UPLOADED,
          hidden: true,
          options
        });
        await Event.generate({
          eventData: attachedEventData,
          eventTypeId: EventType.types.ATTACHED,
          hidden: false,
          options
        });
      }

      res.status(200).send(result);
    } catch (error) {
      return throwAnError(
        error.message,
        error.statusCode,
        app.models.Attachment.Operations.ATTACHMENT_UPLOADING
      );
    }
  };

  Model.downloadAttachments = async function(
    id,
    attachmentId,
    req,
    res,
    options
  ) {
    try {
      res.download = promisify(res.download);
      const unlink = promisify(fs.unlink);
      let modelInstance = await Model.findById(id);
      const attachment = await modelInstance.attachments.findById(attachmentId);
      const {
        fileName,
        containerName,
        originalFileName,
        isEncrypted,
        creatorId
      } = await modelInstance.attachments.findById(attachmentId);

      const { Event, EventType } = app.models;
      const path = getStorePath(containerName, fileName);
      const localdir = path.replace(fileName, '');

      if (!fs.existsSync(localdir)) {
        fs.mkdirSync(localdir);
      }

      await downloadFromAzure(containerName, fileName, path);

      let decryptedFilePath;
      if (isEncrypted) {
        decryptedFilePath = await crypter.decryptFile(path, creatorId);
      }

      await res.download(
        decryptedFilePath || path,
        originalFileName,
        async function() {
          if (!process.env.TESTING_SERVER) {
            unlink(path);
          }

          if (decryptedFilePath) {
            unlink(decryptedFilePath);
          }

          const attachmentData = {
            ..._.pick(attachment, pickProperties),
            userIP: req.connection.remoteAddress
          };

          const eventData = {
            targetModel: Model.definition.name,
            targetId: modelInstance.id,
            structuralNodeId: modelInstance.structuralNodeId,
            data: attachmentData
          };

          await Event.generate({
            eventData,
            eventTypeId: EventType.types.DOWNLOADED,
            hidden: true,
            options
          });
        }
      );
    } catch (error) {
      return throwAnError(
        error.message,
        error.statusCode,
        app.models.Attachment.Operations.ATTACHMENT_DOWNLOADING
      );
    }
  };

  Model.deleteAttachments = async function(req, res, options) {
    try {
      const { id, attachmentId } = req.params;
      let modelInstance = await Model.findById(id);
      const attachment = await modelInstance.attachments.findById(attachmentId);
      await attachment.updateAttribute('deleted', 1, options);
    } catch (error) {
      return throwAnError(
        error.message,
        error.statusCode,
        app.models.Attachment.Operations.ATTACHMENT_DELETING
      );
    }
  };

  Model.addAttachments = async function(req, res, options) {
    try {
      let { Attachment, Event, EventType } = app.models;
      let modelInstance = await Model.findById(req.params.id);

      const result = [];
      const filterParam = Array.isArray(req.body.id)
        ? req.body.id.map(value => {
            return {
              id: value
            };
          })
        : [{ id: req.body.id }];

      let attachments = await Attachment.find({
        where: { or: filterParam }
      });

      for (const attachmentInfo of attachments) {
        const attachment = await modelInstance.attachments.add(attachmentInfo);
        result.push(attachment);

        const eventData = {
          targetModel: Model.definition.name,
          targetId: modelInstance.id,
          structuralNodeId: modelInstance.structuralNodeId,
          data: _.pick(attachmentInfo, pickProperties)
        };

        await Event.generate({
          eventData,
          eventTypeId: EventType.types.ATTACHED,
          hidden: false,
          options
        });
      }
      res.status(200).send(result);
    } catch (error) {
      return throwAnError(
        error.message,
        error.statusCode,
        app.models.Attachment.Operations.ATTACHMENT_ADDING
      );
    }
  };

  async function checkPermissionUploadAdd(ctx) {
    try {
      return await checkModelEntryPermission(
        Model,
        ctx.res.locals.currentUser.id,
        ctx.req.params.id,
        Permissions.EDIT
      );
    } catch (error) {
      return throwAnError(
        error.message,
        error.statusCode,
        Operations.PERMISSION_CHECK
      );
    }
  }

  Model.beforeRemote('uploadattachments', checkPermissionUploadAdd);

  Model.beforeRemote('downloadAttachments', async ctx => {
    try {
      const { Attachment } = app.models;
      await checkModelEntryPermission(
        Attachment,
        ctx.res.locals.currentUser.id,
        ctx.req.params.attachmentId,
        Permissions.VIEW
      );
    } catch (error) {
      return throwAnError(
        error.message,
        error.statusCode,
        Operations.PERMISSION_CHECK
      );
    }
  });

  Model.beforeRemote('deleteAttachments', async ctx => {
    try {
      const { Attachment } = app.models;
      await checkModelEntryPermission(
        Attachment,
        ctx.res.locals.currentUser.id,
        ctx.req.params.attachmentId,
        Permissions.CREATE
      );
    } catch (error) {
      return throwAnError(
        error.message,
        error.statusCode,
        Operations.PERMISSION_CHECK
      );
    }
  });

  Model.beforeRemote('addAttachments', checkPermissionUploadAdd);

  Model.remoteMethod('uploadattachments', {
    http: { path: '/:id/uploadattachments', verb: 'post' },
    accepts: [
      { arg: 'req', type: 'object', http: { source: 'req' } },
      { arg: 'res', type: 'object', http: { source: 'res' } },
      { arg: 'options', type: 'object', http: 'optionsFromRequest' }
    ],
    returns: { arg: 'result', type: 'array', root: true }
  });

  Model.remoteMethod('downloadAttachments', {
    http: { path: '/:id/downloadAttachments/:attachmentId', verb: 'get' },
    accepts: [
      { arg: 'id', type: 'string', http: { source: 'path' } },
      { arg: 'attachmentId', type: 'string', http: { source: 'path' } },
      { arg: 'req', type: 'object', http: { source: 'req' } },
      { arg: 'res', type: 'object', http: { source: 'res' } },
      { arg: 'options', type: 'object', http: 'optionsFromRequest' }
    ],
    returns: { arg: 'result', type: 'array', root: true }
  });

  Model.remoteMethod('deleteAttachments', {
    http: { path: '/:id/attachments/:attachmentId', verb: 'delete' },
    accepts: [
      { arg: 'req', type: 'object', http: { source: 'req' } },
      { arg: 'res', type: 'object', http: { source: 'res' } },
      { arg: 'options', type: 'object', http: 'optionsFromRequest' }
    ],
    returns: { arg: 'result', type: 'array', root: true }
  });

  Model.remoteMethod('addAttachments', {
    http: { path: '/:id/addAttachments', verb: 'post' },
    accepts: [
      { arg: 'req', type: 'object', http: { source: 'req' } },
      { arg: 'res', type: 'object', http: { source: 'res' } },
      { arg: 'options', type: 'object', http: 'optionsFromRequest' }
    ],
    returns: { arg: 'result', type: 'array', root: true }
  });
};
