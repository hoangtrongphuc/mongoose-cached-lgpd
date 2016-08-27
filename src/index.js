'use strict';

const _           = require('lodash');
const dotpathWalk = require('dot-path-walk');
const validator   = require('xana-validator');

const validatePluginOpts = validator.create([
  ['commonFields', 'typeof', 'array', new TypeError('Expect pluginOpts.commonFields to be an array')],
  ['secretFields', 'typeof', 'array', new TypeError('Expect pluginOpts.secretFields to be an array')],
  ['cache', 'typeof', 'number', new TypeError('Expect pluginOpts.cache to be an number')],
  ['limit', 'typeof', 'number', new TypeError('Expect pluginOpts.limit to be an number')],
  ['modelName', 'required', true, new TypeError('Expect pluginOpts.modelName to be existed')],
  ['modelName', 'typeof', 'string', new TypeError('Expect pluginOpts.modelName to be an string')],
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
function readached(schema, pluginOpts) {
  pluginOpts = _.defaults({}, pluginOpts, {
    commonFields: [],
    secretFields: ['__v'],
    limit: 100
  });

  validatePluginOpts(pluginOpts, (errors) => {

  });

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

    opts       = _.defaults({}, opts, {limit: pluginOpts.limit});
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
    if (find.cache && (opts.cache || pluginOpts.cache)) {
      find.cache(opts.cache || pluginOpts.cache, `${pluginOpts.modelName}:list:`);
    }
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
  schema.static.get = function (query, extras, opts, done) {
    extras = _.castArray(extras);
    extras = [...pluginOpts.commonFields, ..._.without(extras, ...pluginOpts.secretFields)];

    let get = this.findOne(query);

    extras.forEach((extra) => {
      for (const path of dotpathWalk(extra)) {
        if (_.has(this.schema.path(path), 'options.ref')) {
          get.populate(path);
          break;
        }
      }
    });

    get = get.select(extras.join(' '));
    opts.lean && get.lean();
    if (get.cache && (opts.cache || pluginOpts.cache)) {
      get.cache(opts.cache || pluginOpts.cache, `${pluginOpts.modelName}:get:`);
    }
    get.exec(done);
  };

  schema.methods.getCommonFields = function () {
    return _.pick(this, pluginOpts.commonFields);
  };

  schema.methods.getNonSecretFields = function () {
    return _.omit(this, pluginOpts.secretFields);
  };
}

module.exports = readached;
