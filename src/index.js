'use strict'

const _ = require('lodash')
const walkExtra = require('dot-path-walk')
const validator = require('xana-validator-sync')

/**
 * Default plugin options.
 * @type {Object}
 */
const DEFAULT_PLUGIN_OPTS = {
  commonFields: [],
  secretFields: ['__v'],
  readOnlyFields: [],
  lean: true
}

/**
 * Plugin option validator.
 * @type {Function}
 */
const pluginOptsValidator = validator.create([
  ['commonFields', 'is', 'array', 'Expect commonFields to be an array'],
  ['secretFields', 'is', 'array', 'Expect secretFields to be an array'],
  ['cache', 'is', 'number', 'Expect cache to be an number'],
  ['limit', 'is', 'number', 'Expect limit to be an number'],
  ['lean', 'is', 'boolean', 'Expect lean to be a boolean'],
  ['modelName', 'required', true, 'Expect modelName to be existed'],
  ['modelName', 'is', 'string', 'Expect modelName to be an string']
])

/**
 * Validate plugin options.
 * @param opts - Plugin options.
 */
function validatePluginOpts (opts) {
  const error = pluginOptsValidator(opts)
  if (error) throw new TypeError(error.message)
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
function plugin (schema, pluginOpts) {
  pluginOpts = _.defaults({}, pluginOpts, DEFAULT_PLUGIN_OPTS)
  validatePluginOpts(pluginOpts)

  const COUNT_CACHE_PREFIX = `${pluginOpts.modelName}:count:`
  const LIST_CACHE_PREFIX = `${pluginOpts.modelName}:list:`
  const GET_CACHE_PREFIX = `${pluginOpts.modelName}:get:`

  /**
   *
   * @param query
   * @param done
   */
  schema.statics.numberOf = function (query, opts, done) {
    _.isFunction(opts) && ([opts, done] = [{}, opts])
    opts = Object.assign({}, pluginOpts, opts)
    this.count(query)
        .cache(opts.cache, COUNT_CACHE_PREFIX)
        .exec(done)
  }

  /**
   * List documents.
   * @param query
   * @param extras
   * @param opts
   * @param done
   */
  schema.statics.list = function (query, extras, opts, done) {
    const searchText = _.has(query, '$text.$search')
    searchText && (query.$text.$search = query.$text.$search.toString())

    _.isFunction(opts) && ([opts, done] = [{}, opts])
    opts = Object.assign({}, pluginOpts, opts)
    opts.limit = _.clamp(_.toSafeInteger(opts.limit), pluginOpts.limit)
    searchText && (opts.sort = _.assign({}, opts.sort, {score: {$meta: 'textScore'}}))

    extras = _.castArray(extras)
    extras = [...opts.commonFields, ..._.without(extras, ...opts.secretFields)]

    let find = searchText ? this.find(query, {score: {$meta: 'textScore'}}) : this.find(query)

    const validExtras = []

    for (const extra of extras) {
      if (!extra) continue
      for (const path of walkExtra(extra.toString())) {
        const schema = this.schema.path(path)
        const schemaType = this.schema.pathType(path)
        if (schemaType === 'adhocOrUndefined') break
        validExtras.push(path)
        if (_.has(schema, 'caster.options.ref') || _.has(schema, 'options.ref')) {
          find.populate(path, extras.filter((e) => e.startsWith(path))
                                    .map((e) => e.replace(`${path}.`, ''))
                                    .join(' '))
          break
        }
      }
    }

    find = find.select(validExtras.join(' '))
               .limit(opts.limit)
               .sort(opts.sort)

    opts.lean && find.lean()

    const ttl = _.isFunction(find.cache) ? opts.cache : 0
    ttl && opts.lean && find.cache(ttl, LIST_CACHE_PREFIX)

    find.exec(done)
  }

  /**
   * Get a document by its id.
   * @param id
   * @param query
   * @param extras
   * @param opts
   * @param done
   */
  schema.statics.get = function (id, query, extras, opts, done) {
    _.isFunction(opts) && ([opts, done] = [{}, opts])
    opts = Object.assign({}, pluginOpts, opts)

    extras = _.castArray(extras)
    extras = [...opts.commonFields, ..._.without(extras, ...opts.secretFields)]

    let find = this.findOne(Object.assign({}, query, {_id: id}))

    const validExtras = []

    for (const extra of extras) {
      if (!extra) continue
      for (const path of walkExtra(extra.toString())) {
        const schema = this.schema.path(path)
        const schemaType = this.schema.pathType(path)
        if (schemaType === 'adhocOrUndefined') break
        validExtras.push(path)
        if (_.has(schema, 'caster.options.ref') || _.has(schema, 'options.ref')) {
          find.populate(path, extras.filter((e) => e.startsWith(path))
                                    .map((e) => e.replace(`${path}.`, ''))
                                    .join(' '))
          break
        }
      }
    }

    find = find.select(validExtras.join(' '))

    opts.lean && find.lean()

    const ttl = _.isFunction(find.cache) ? opts.cache : 0
    ttl && opts.lean && find.cache(ttl, `${GET_CACHE_PREFIX}${id}:`)

    find.exec(done)
  }

  /**
   * Patch a document by its id.
   * @param id
   * @param patch
   * @param done
   */
  schema.statics.patch = function (id, patch, done) {
    this.findById(id, (err, doc) => {
      if (err) return done(err)
      doc.patch(patch, done)
    })
  }

  /**
   * Clear caches of listing.
   *
   */
  schema.statics.clearCacheAll = function () {
    if (typeof pluginOpts.clearCache === 'function') {
      pluginOpts.clearCache(`${COUNT_CACHE_PREFIX}*`)
      pluginOpts.clearCache(`${LIST_CACHE_PREFIX}*`)
      pluginOpts.clearCache(`${GET_CACHE_PREFIX}*`)
    }
  }

  /**
   * Clear caches of getting the current document.
   */
  schema.methods.clearCache = function () {
    if (typeof pluginOpts.clearCache === 'function') {
      pluginOpts.clearCache(`${COUNT_CACHE_PREFIX}*`)
      pluginOpts.clearCache(`${LIST_CACHE_PREFIX}*`)
      pluginOpts.clearCache(`${GET_CACHE_PREFIX}${this._id.toString()}:*`)
    }
  }

  /**
   * Patch the current document.
   * @param patch
   * @param done
   */
  schema.methods.patch = function (patch, done) {
    const changes = Object.assign(this, _.omit(patch, pluginOpts.readOnlyFields))
    changes.save((err, doc) => done(err, doc))
  }

  /**
   * Pick common fields of the current document.
   * @returns {*}
   */
  schema.methods.pickCommonFields = function () {
    return _.pick(this.toObject(), pluginOpts.commonFields)
  }

  /**
   * Omit secret fields of the current document.
   * @returns {*}
   */
  schema.methods.omitSecretFields = function () {
    return _.omit(this.toObject(), pluginOpts.secretFields)
  }

  /**
   * Clear caches after patched a document.
   */
  schema.post('save', function (doc) {
    doc.clearCache()
  })

  schema.post('remove', function (doc) {
    doc.clearCache()
  })

  schema.post('findOneAndRemove', function (doc) {
    doc.clearCache()
  })

  schema.post('findOneAndUpdate', function (doc) {
    doc.clearCache()
  })
}

module.exports = plugin
