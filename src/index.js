'use strict';

const _         = require('lodash');
const walkExtra = require('dot-path-walk');
const validator = require('xana-validator-sync');

/**
 * Default plugin options.
 * @type {Object}
 */
const DEFAULT_PLUGIN_OPTS = {
  commonFields: [],
  secretFields: ['__v'],
  readOnlyFields: [],
  limit: 100,
  lean: true
};

/**
 * Plugin option validator.
 * @type {Function}
 */
const pluginOptsValidator = validator.create([
  // @formatter:off
  ['commonFields', 'is'       , 'array'   , 'Expect commonFields to be an array'  ],
  ['secretFields', 'is'       , 'array'   , 'Expect secretFields to be an array'  ],
  ['cache'       , 'is'       , 'number'  , 'Expect cache to be an number'        ],
  ['limit'       , 'is'       , 'number'  , 'Expect limit to be an number'        ],
  ['lean'        , 'is'       , 'boolean' , 'Expect lean to be a boolean'         ],
  ['modelName'   , 'required' , true      , 'Expect modelName to be existed'      ],
  ['modelName'   , 'is'       , 'string'  , 'Expect modelName to be an string'    ]
  // @formatter:on
]);

/**
 * Validate plugin options.
 * @param opts - Plugin options.
 */
function validatePluginOpts(opts) {
  const error = pluginOptsValidator(opts);
  if (error) throw new TypeError(error.message);
}


/**
 * Plugin entry point.
 * @param schema
 * @param {Object}    pluginOpts
 * @param {String}    pluginOpts.modelName
 * @param {Array}    [pluginOpts.commonFields]
 * @param {Array}    [pluginOpts.secretFields]
 * @param {Array}    [pluginOpts.readOnlyFields]
 * @param {Number}   [pluginOpts.cache]
 * @param {Boolean}  [pluginOpts.lean]
 * @param {Function} [pluginOpts.clearCache]
 * @param {Number}   [pluginOpts.limit]
 */
function plugin(schema, pluginOpts) {
  pluginOpts = _.defaults({}, pluginOpts, DEFAULT_PLUGIN_OPTS);
  validatePluginOpts(pluginOpts);

  const LIST_CACHE_PREFIX = `${pluginOpts.modelName}:list`;
  const GET_CACHE_PREFIX  = `${pluginOpts.modelName}:get`;

  /**
   * List documents.
   * @param query
   * @param extras
   * @param opts
   * @param done
   */
  schema.statics.list = function (query, extras, opts, done) {
    opts       = Object.assign({}, pluginOpts, opts);
    opts.limit = _.clamp(_.toSafeInteger(opts.limit), pluginOpts.limit);

    extras = _.castArray(extras);
    extras = [...opts.commonFields, ..._.without(extras, ...opts.secretFields)];

    let find = this.find(query);

    for (const extra of extras) {
      for (const path of walkExtra(extra)) {
        const schema = this.schema.path(path);
        if (_.has(schema, 'options.ref')) {
          find.populate(path);
          break;
        }
      }
    }

    find = find.select(extras.join(' '))
               .limit(opts.limit)
               .sort(opts.sort);

    opts.lean && find.lean();

    const ttl = _.isFunction(find.cache) ? opts.cache : 0;
    ttl && find.cache(ttl, LIST_CACHE_PREFIX);

    find.exec(done);
  };

  /**
   * Get a document.
   * @param query
   * @param extras
   * @param opts
   * @param done
   */
  schema.statics.get = function (query, extras, opts, done) {
    opts = Object.assign({}, pluginOpts, opts);

    extras = _.castArray(extras);
    extras = [...opts.commonFields, ..._.without(extras, ...opts.secretFields)];

    let find = this.findOne(query);

    for (const extra of extras) {
      for (const path of walkExtra(extra)) {
        const schema = this.schema.path(path);
        if (_.has(schema, 'options.ref')) {
          find.populate(path);
          break;
        }
      }
    }

    find = find.select(extras.join(' '));

    opts.lean && find.lean();

    const ttl = _.isFunction(find.cache) ? opts.cache : 0;
    ttl && find.cache(ttl, GET_CACHE_PREFIX);

    find.exec(done);
  };

  /**
   * Clear caches of getting the current document.
   */
  schema.methods.clearCacheGet = function () {
    if (typeof pluginOpts.clearCache == 'function') {
      pluginOpts.clearCache(`${GET_CACHE_PREFIX}*`);
    }
  };

  /**
   * Clear caches of listing.
   *
   */
  schema.methods.clearCacheList = function () {
    if (typeof pluginOpts.clearCache == 'function') {
      pluginOpts.clearCache(`${LIST_CACHE_PREFIX}*`);
    }
  };

  /**
   * Patch the current document.
   * @param patch
   * @param done
   */
  schema.methods.patch = function (patch, done) {
    const changes = Object.assign(this, _.omit(patch, pluginOpts.readOnlyFields));
    changes.save((err, doc) => done(err, doc));
  };

  /**
   * Pick common fields of the current document.
   * @returns {*}
   */
  schema.methods.pickCommonFields = function () {
    return _.pick(this.toObject(), pluginOpts.commonFields);
  };

  /**
   * Omit secret fields of the current document.
   * @returns {*}
   */
  schema.methods.omitSecretFields = function () {
    return _.omit(this.toObject(), pluginOpts.secretFields);
  };

  /**
   * Clear caches after patched a document.
   */
  schema.post('save', function (doc) {
    doc.clearCacheGet();
    doc.clearCacheList();
  });
}

module.exports = plugin;
