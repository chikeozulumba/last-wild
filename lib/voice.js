'use strict'

var Promise = require('bluebird')
var unirest = require('unirest')
var validate = require('validate.js')
var bodyParser = require('body-parser')
var _ = require('lodash')

var Common = require('./common')

/**
 *
 * @param params
 * @returns {{session: *, isActive: boolean, isComplete: boolean, isInbound: boolean, isOutbound: boolean, caller: *, callee: *, digits: *, recordingUrl: *, duration: *, currency: (constraints.currencyCode|*), amount: *, respond: respond}}
 * @constructor
 */
var PhoneCall = function (params, res) {
  return {
    session: params.sessionId,
    isActive: params.isActive,
    direction: params.direction,
    caller: params.callerNumber,
    callee: params.destinationNumber,
    digits: params.dtmfDigits,
    recordingUrl: params.recordingUrl,
    duration: params.durationInSeconds,
    currency: params.currencyCode,
    amount: params.amount,
    stats: params.status,
    sessionState: params.callSessionState,
    respond: function (error, data) { }
  }
}

/**
 *
 * @param handle
 * @returns {*[]}
 * @constructor
 */
function ExpressHandler (handle) {
  return [ // connect/express middleware

    bodyParser.urlencoded({extended: true}),
    bodyParser.json(),

    function (req, response) {
      var call = new PhoneCall(req.body, response)

      call.respond = function (err, data) { // FIXME: Need better way to do this
        response.contentType('text/plain')
        response.status(err != null ? 500 : 200).send(data)
      }

      handle(call)
    }
  ]
}

/**
 *
 * @constructor
 */
function XMLBuilder () {
  var that = this

  that.xml = ''

  this.say = function (text, options) {
    // TODO: Proper validation
    options.voice = options.voice || 'woman'
    options.playBeep = options.playBeep || false
    that.xml += `<Say voice="${options.voice}" playBeep="${options.playBeep}">${text}</Say>`

    return that
  }

  this.play = function (url) {
    // TODO: Proper url validation

    that.xml += `<Play url="${url}" />`

    return that
  }

  this.getDigits = function (text, options) {
    that.xml += `<GetDigits 
                    timeout="${options.timeout}" 
                    finishOnKey="${options.finishOnKey}"
                    numDigits="${options.numDigits}"
                    callbackUrl="${options.callbackUrl}">`

    if (options.play) {
      that.play(text, options.play)
    } else if (options.say) {
      that.say(text, options.say)
    } else {
      throw new Error('Need to either say or play something...')
    }

    that.xml += `</GetDigits>`

    return that
  }

  this.dial = function (options) {
    options.record = options.record || false

    that.xml += `<Dial phoneNumbers="${options.phoneNumbers}"  record="${options.record}" 
      callerId="${options.callerId}" sequential="${options.sequential}" ringBackTone="${options.ringBackTone}" 
      maxDuration="${options.maxDuration}"/>`

    return that
  }

  this.conference = function () {
    that.xml += `<Conference />`
    return that
  }

  this.reject = function () {
    that.xml += `<Reject />`
    return that
  }

  this.redirect = function (url) {
    // TODO: Proper url validation
    that.xml += `<Redirect>${url}</Redirect>`

    return that
  }

  this.enqueue = function (options) {
    // TODO: Proper url validation

    that.xml += `<Enqueue holdMusic="${options.holdMusic}" name="${options.name}"></Enqueue>`

    return that
  }

  this.dequeue = function (options) {
    that.xml += `<Dequeue phoneNumber="${options.phoneNumber}" name="${options.name}" />`
    return that
  }

  this.record = function (options) {
    if (options.terminal) {
      that.xml += `<Record />`
    } else {
      that.xml += `<Record 
                    finishOnKey="${options.finishOnKey}" 
                    maxLength="${options.maxLength}"
                    timeout="${options.timeout}"
                    trimSilence="${options.trimSilence}"
                    playBeep="${options.playBeep}"
                    callbackUrl="${options.callbackUrl}">`

      if (options.play) {
        that.play(text, options.play)
      } else if (options.say) {
        that.say(text, options.say)
      } else {
        throw new Error('Need to either say or play something...')
      }

      that.xml += `</Record>`
    }

    return that
  }

  this.build = function () {
    return `<?xml version="1.0" encoding="UTF-8"?><Response>${that.xml}</Response>`
  }
}

function Voice (options) {
  this.options = options
}

Voice.prototype.CallHandler = ExpressHandler

Voice.prototype.call = function (params) {
  let options = _.cloneDeep(params)
  let _self = this

  // Validate params
  let _validateParams = function () {
    var constraints = {
      callTo: function (value) {
        if (validate.isEmpty(value)) {
          return {
            presence: {
              message: 'is required'
            }
          }
        }
        if (!(/^\+?\d+$/).test(value)) {
          return {
            format: 'must not contain invalid callTo phone number'
          }
        }

        return null
      },
      callFrom: function (value) {
        if (validate.isEmpty(value)) {
          return {
            presence: {
              message: 'is required'
            }
          }
        }
        if (!(/^\+?\d+$/).test(value)) {
          return {
            format: 'must not contain invalid callFrom phone number'
          }
        }

        return null
      }
    }

    let error = validate(options, constraints)
    if (error) {
      // TODO should this be rejected by promise instead?

      var msg = ''
      for (var k in error) {
        msg += error[k] + ' '
      }
      throw new Error(msg)
    }
  }

  _validateParams()

  return new Promise(function (resolve, reject) {
    let body = {
      username: _self.options.username,
      to: options.callTo,
      from: options.callFrom
    }

    let rq = unirest.post(Common.VOICE_URL + '/call')
    rq.headers({
      apikey: _self.options.apiKey,
      Accept: _self.options.format
    })

    rq.send(body)

    rq.end(function (resp) {
      if (resp.status === 200 || resp.status === 201) {
        // API returns CREATED on success
        resolve(resp.body)
      } else {
        reject(resp.error || resp.body)
      }
    })
  })
}

Voice.prototype.getNumQueuedCalls = function (params) {
  let options = _.cloneDeep(params)
  let _self = this

  // Validate params
  let _validateParams = function () {
    var constraints = {
      phoneNumbers: function (value) {
        if (validate.isEmpty(value)) {
          return {
            presence: {
              message: 'is required'
            }
          }
        }

        if (!(/^\+?\d+$/).test(value)) {
          return {
            format: 'must contain a VALID phone number'
          }
        }

        return null
      }
    }

    let error = validate(options, constraints)
    if (error) {
      var msg = ''
      for (var k in error) {
        msg += error[k] + ' '
      }
      throw new Error(msg)
    }
  }

  _validateParams()

  return new Promise(function (resolve, reject) {
    // list of phoneNumbers, comma separated
    let body = {
      username: _self.options.username,
      phoneNumbers: options.phoneNumbers
    }

    let rq = unirest.post(Common.VOICE_URL + '/queueStatus')
    rq.headers({
      apikey: _self.options.apiKey,
      Accept: _self.options.format
    })

    rq.send(body)

    rq.end(function (resp) {
      if (resp.status === 201) {
        // API returns CREATED on success
        resolve(resp.body)
      } else {
        reject(resp.error || resp.body)
      }
    })
  })
}

Voice.prototype.builder = function () {
  return new XMLBuilder()
}

Voice.XMLBuilder = XMLBuilder

/* Upload media file
 We don't need uploadMediaFile we have Play command and the api will cache it.
 */

module.exports = Voice
