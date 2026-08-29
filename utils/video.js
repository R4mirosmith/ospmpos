const fs = require('fs');

const MAX_VIDEO_SECONDS = 30;
const ALLOWED_VIDEO_MIME = new Set(['video/mp4', 'video/quicktime']);
const ALLOWED_VIDEO_EXT = new Set(['.mp4', '.mov']);

function readUInt64BE(buffer, offset) {
  const high = buffer.readUInt32BE(offset);
  const low = buffer.readUInt32BE(offset + 4);
  return high * 0x100000000 + low;
}

function boxRange(buffer, start, end) {
  const boxes = [];
  let offset = start;
  while (offset + 8 <= end) {
    let size = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    let headerSize = 8;

    if (size === 1) {
      if (offset + 16 > end) break;
      size = readUInt64BE(buffer, offset + 8);
      headerSize = 16;
    } else if (size === 0) {
      size = end - offset;
    }

    if (!Number.isFinite(size) || size < headerSize || offset + size > end) break;
    boxes.push({ type, start: offset, contentStart: offset + headerSize, end: offset + size });
    offset += size;
  }
  return boxes;
}

function mp4DurationSecondsFromBuffer(buffer) {
  const top = boxRange(buffer, 0, buffer.length);
  const moov = top.find((box) => box.type === 'moov');
  if (!moov) return null;

  const children = boxRange(buffer, moov.contentStart, moov.end);
  const mvhd = children.find((box) => box.type === 'mvhd');
  if (!mvhd || mvhd.contentStart + 20 > mvhd.end) return null;

  const version = buffer.readUInt8(mvhd.contentStart);
  let timescale;
  let duration;

  if (version === 0) {
    if (mvhd.contentStart + 20 > mvhd.end) return null;
    timescale = buffer.readUInt32BE(mvhd.contentStart + 12);
    duration = buffer.readUInt32BE(mvhd.contentStart + 16);
  } else if (version === 1) {
    if (mvhd.contentStart + 32 > mvhd.end) return null;
    timescale = buffer.readUInt32BE(mvhd.contentStart + 20);
    duration = readUInt64BE(buffer, mvhd.contentStart + 24);
  } else {
    return null;
  }

  if (!timescale || !Number.isFinite(duration)) return null;
  const seconds = duration / timescale;
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

function videoDurationSeconds(filePath) {
  const buffer = fs.readFileSync(filePath);
  return mp4DurationSecondsFromBuffer(buffer);
}

module.exports = {
  MAX_VIDEO_SECONDS,
  ALLOWED_VIDEO_MIME,
  ALLOWED_VIDEO_EXT,
  mp4DurationSecondsFromBuffer,
  videoDurationSeconds,
};
