'use strict';

const _           = require('lodash');
const dotpathWalk = require('dot-path-walk');
const validator   = require('xana-validator-sync');

const validatePluginOpts = validator.create([
  ['commonFields', 'typeof', 'array', new TypeError('Expect pluginOpts.commonFields to be an array')],
  ['secretFields', 'typeof', 'array', new TypeError('Expect pluginOpts.secretFields to be an array')],
  ['cache', 'typeof', 'number', new TypeError('Expect pluginOpts.cache to be an number')],
  ['limit', 'typeof', 'number', new TypeError('Expect pluginOpts.limit to be an number')],
  ['modelName', 'required', true, new TypeError('Expect pluginOpts.modelName to be existed')],
  ['modelName', 'typeof', 'string', new TypeError('Expect pluginOpts.modelName to be an string')]
]);


/**
 *
 * @param schema
 * @param {Object} pluginOpts
 * @param {Array} [pluginOpts.commonFields]
 * @param {Array} [pluginOpts.secretFields]
 * @param {Number} [pluginOpts.cache]
 * @param {Number} [pluginOpts.limit]
 * @param {String} pluginOpts.modelName
 */
function plugin(schema, pluginOpts) {
  pluginOpts = _.defaults({}, pluginOpts, {
    commonFields: [],
    secretFields: ['__v'],
    limit: 100
  });

  const validationError = validatePluginOpts(pluginOpts);
  if (validationError) throw new TypeError(validationError.message);

  /**
   *
   * @param query
   * @param extras
   * @param opts
   * @param opts.limit
   * @param opts.sort
   * @param opts.lean
   * @param opts.cache
   * @param done
   */
  schema.statics.list = function (query, extras, opts, done) {
    extras = _.castArray(extras);
    extras = [...pluginOpts.commonFields, ..._.without(extras, ...pluginOpts.secretFields)];

    opts       = _.defaults({}, opts, {
      limit: pluginOpts.limit,
      lean: true,
      cache: pluginOpts.cache
    });
    opts.limit = _.clamp(_.toSafeInteger(opts.limit), pluginOpts.limit);
    opts.sort  = opts.sort && _.mapValues(opts.sort, (val) => val > 0 ? 1 : -1);

    let find = this.find(query);

    extras.forEach((extra) => {
      for (const path of dotpathWalk(extra)) {
        if (_.has(this.schema.path(path), 'options.ref')) {
          find.populate(path);
          break;
        }
      }
    });

    find = find.select(extras.join(' ')).limit(opts.limit).sort(opts.sort);
    opts.lean && find.lean();
    const cachettl = typeof find.cache == 'function' ? (opts.cache || pluginOpts.cache) : 0;
    cachettl && find.cache(cachettl, `${pluginOpts.modelName}:list:`);
    find.exec(done);
  };

  /**
   *
   * @param query
   * @param extras
   * @param opts
   * @param opts.lean
   * @param opts.cache
   * @param done
   */
  schema.statics.get = function (query, extras, opts, done) {
    extras = _.castArray(extras);
    extras = [...pluginOpts.commonFields, ..._.without(extras, ...pluginOpts.secretFields)];

    opts = _.defaults({}, opts, {
      lean: true,
      cache: pluginOpts.cache
    });

    let find = this.findOne(query);

    extras.forEach((extra) => {
      for (const path of dotpathWalk(extra)) {
        if (_.has(this.schema.path(path), 'options.ref')) {
          find.populate(path);
          break;
        }
      }
    });

    find = find.select(extras.join(' '));
    opts.lean && find.lean();
    const cachettl = typeof find.cache == 'function' ? (opts.cache || pluginOpts.cache) : 0;
    cachettl && find.cache(cachettl, `${pluginOpts.modelName}:list:`);
    find.exec(done);
  };

  schema.methods.clearCacheGet = function () {
    if (typeof pluginOpts.clearCache == 'function') {
      pluginOpts.clearCache(`${pluginOpts.modelName}:get:*`);
    }
  };

  schema.methods.clearCacheList = function () {
    if (typeof pluginOpts.clearCache == 'function') {
      pluginOpts.clearCache(`${pluginOpts.modelName}:list:*`);
    }
  };

  schema.methods.patch = function (patch, done) {
    const changes = Object.assign(this, _.omit(patch, pluginOpts.readOnlyFields));
    changes.save((err, doc) => done(err, doc));
  };

  schema.methods.pickCommonFields = function () {
    return _.pick(this.toObject(), pluginOpts.commonFields);
  };

  schema.methods.omitSecretFields = function () {
    return _.omit(this.toObject(), pluginOpts.secretFields);
  };

  schema.post('save', function (doc) {
    doc.clearCacheGet();
    doc.clearCacheList();
  });
}

module.exports = plugin;
