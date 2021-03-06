/*!
 * ws: a node.js websocket client
 * Copyright(c) 2011 Einar Otto Stangvik <einaros@gmail.com>
 * MIT Licensed
 */

var events = require('events')
  , util = require('util')
  , EventEmitter = events.EventEmitter
  , Options = require('options')
  , ErrorCodes = require('./ErrorCodes')
  , bufferUtil = new require('./BufferUtil').BufferUtil;

/**
 * HyBi Sender implementation
 */

function Sender (socket, options) {
  options = new Options({
    sendBufferCacheSize: 65536
  }).merge(options);
  if (options.value.sendBufferCacheSize > 0) {
    this._sendCacheSize = options.value.sendBufferCacheSize;
    this._sendCache = new Buffer(this._sendCacheSize);
  }
  this._socket = socket;
  this.firstFragment = true;
}

/**
 * Inherits from EventEmitter.
 */

util.inherits(Sender, events.EventEmitter);

/**
 * Sends a close instruction to the remote party.
 *
 * @api public
 */

Sender.prototype.close = function(code, data, mask) {
  if (typeof code !== 'undefined') {
    if (typeof code !== 'number' ||
      !ErrorCodes.isValidErrorCode(code)) throw new Error('first argument must be a valid error code number');
  }
  code = code || 1000;
  var dataBuffer = new Buffer(2 + (data ? Buffer.byteLength(data) : 0));
  writeUInt16BE.call(dataBuffer, code, 0);
  if (dataBuffer.length > 2) dataBuffer.write(data, 2);
  this.frameAndSend(0x8, dataBuffer, true, mask);
}

/**
 * Sends a ping message to the remote party.
 *
 * @api public
 */

Sender.prototype.ping = function(data, options) {
  var mask = options && options.mask;
  this.frameAndSend(0x9, data || '', true, mask);
}

/**
 * Sends a pong message to the remote party.
 *
 * @api public
 */

Sender.prototype.pong = function(data, options) {
  var mask = options && options.mask;
  this.frameAndSend(0xa, data || '', true, mask);
}

/**
 * Sends text or binary data to the remote party.
 *
 * @api public
 */

Sender.prototype.send = function(data, options, cb) {
  var finalFragment = options && options.fin === false ? false : true;
  var mask = options && options.mask;
  var opcode = options && options.binary ? 2 : 1;
  if (this.firstFragment === false) opcode = 0;
  else this.firstFragment = false;
  if (finalFragment) this.firstFragment = true
  this.frameAndSend(opcode, data, finalFragment, mask, cb);
}

/**
 * Frames and sends a piece of data according to the HyBi WebSocket protocol.
 *
 * @api private
 */

Sender.prototype.frameAndSend = function(opcode, data, finalFragment, maskData, cb) {
  if (!data) {
    try {
      this._socket.write(new Buffer([opcode | (finalFragment ? 0x80 : 0), 0]), 'binary', cb);
    }
    catch (e) {
      if (typeof cb == 'function') cb(e);
      else this.emit('error', e);
    }
    return;
  }
  else if (!Buffer.isBuffer(data)) {
    data = (data && typeof data.buffer !== 'undefined') ? getArrayBuffer(data.buffer) : new Buffer(data);
  }
  var dataLength = data.length
    , dataOffset = maskData ? 6 : 2
    , secondByte = dataLength;
  if (dataLength >= 65536) {
    dataOffset += 8;
    secondByte = 127;
  }
  else if (dataLength > 125) {
    dataOffset += 2;
    secondByte = 126;
  }
  var totalLength = maskData ? dataLength + dataOffset : dataOffset;
  var outputBuffer = (this._sendCache && totalLength <= this._sendCacheSize) 
    ? (totalLength == this._sendCacheSize ? this._sendCache : this._sendCache.slice(0, totalLength)) 
    : new Buffer(totalLength);
  outputBuffer[0] = finalFragment ? opcode | 0x80 : opcode;
  switch (secondByte) {
    case 126:
      writeUInt16BE.call(outputBuffer, dataLength, 2);
      break;
    case 127:
      writeUInt32BE.call(outputBuffer, 0, 2);
      writeUInt32BE.call(outputBuffer, dataLength, 6);
  }
  if (maskData) {
    outputBuffer[1] = secondByte | 0x80;
    var mask = this._randomMask || (this._randomMask = getRandomMask());
    outputBuffer[dataOffset - 4] = mask[0];
    outputBuffer[dataOffset - 3] = mask[1];
    outputBuffer[dataOffset - 2] = mask[2];
    outputBuffer[dataOffset - 1] = mask[3];
    bufferUtil.mask(data, mask, outputBuffer, dataOffset, dataLength);
    try {
      this._socket.write(outputBuffer, 'binary', cb);
    }
    catch (e) {
      if (typeof cb == 'function') cb(e);
      else this.emit('error', e);
    }
  }
  else {
    outputBuffer[1] = secondByte;
    var done = 0;
    function callback() {
      if (++done == 2 && typeof cb == 'function') cb(null);
    }
    try {
      this._socket.write(outputBuffer, 'binary', callback);
      this._socket.write(data, 'binary', callback);
    }
    catch (e) {
      if (typeof cb == 'function') cb(e);
      else this.emit('error', e);
    }
  }
}

module.exports = Sender;

function writeUInt16BE(value, offset) {
  this[offset] = (value & 0xff00)>>8;
  this[offset+1] = value & 0xff;
}

function writeUInt32BE(value, offset) {
  this[offset] = (value & 0xff000000)>>24;
  this[offset+1] = (value & 0xff0000)>>16;
  this[offset+2] = (value & 0xff00)>>8;
  this[offset+3] = value & 0xff;
}

function getArrayBuffer(array) {
  var l = array.byteLength
    , buffer = new Buffer(l);
  for (var i = 0; i < l; ++i) {
    buffer[i] = array[i];
  }
  return buffer;
}

function getRandomMask() {
  return new Buffer([
    ~~(Math.random() * 255),
    ~~(Math.random() * 255),
    ~~(Math.random() * 255),
    ~~(Math.random() * 255)
  ]);
}
