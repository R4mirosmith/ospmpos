const assert = require('assert');
const { mp4DurationSecondsFromBuffer, MAX_VIDEO_SECONDS } = require('../utils/video');

function box(type, payload) {
  const out = Buffer.alloc(8 + payload.length);
  out.writeUInt32BE(out.length, 0);
  out.write(type, 4, 4, 'ascii');
  payload.copy(out, 8);
  return out;
}

function makeMp4Duration(seconds, timescale = 1000) {
  const mvhdPayload = Buffer.alloc(100);
  mvhdPayload.writeUInt8(0, 0); // version 0
  mvhdPayload.writeUInt32BE(timescale, 12);
  mvhdPayload.writeUInt32BE(Math.round(seconds * timescale), 16);
  return Buffer.concat([
    box('ftyp', Buffer.alloc(8)),
    box('moov', box('mvhd', mvhdPayload)),
  ]);
}

for (const seconds of [1, 12.5, 30]) {
  const parsed = mp4DurationSecondsFromBuffer(makeMp4Duration(seconds));
  assert.ok(Math.abs(parsed - seconds) < 0.001, `Duración incorrecta para ${seconds}: ${parsed}`);
}

assert.strictEqual(mp4DurationSecondsFromBuffer(Buffer.from('not-a-video')), null);
assert.strictEqual(MAX_VIDEO_SECONDS, 30);
console.log('OK validación de duración MP4/MOV');
