// koffi bindings for libomt (Open Media Transport C library, MIT —
// github.com/openmediatransport). Used inside the renderer's Electron main
// process; koffi is N-API based so the same prebuilt binary serves Node and
// Electron. The DLLs are NOT in the repo — the in-app installer places them in
// vendor/omt/ (override with OMT_BIN for development).
'use strict';
const path = require('path');
const fs = require('fs');
const koffi = require('koffi');

function resolveBinDir() {
  const candidates = [
    process.env.OMT_BIN,
    path.join(__dirname, 'vendor', 'omt'),
    path.join(__dirname, '..', 'omt-spike', 'bin'),   // dev fallback: the spike's binaries
  ].filter(Boolean);
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'libomt.dll'))) return c;
  }
  throw new Error('libomt.dll not found — run the OMT install from the app (Routing page), or set OMT_BIN');
}
const BIN = resolveBinDir();
// libomt resolves its sibling libvmx.dll via the DLL search path, not its own
// folder — omt_send fails with DllNotFoundException otherwise.
process.env.PATH = BIN + ';' + process.env.PATH;
const lib = koffi.load(path.join(BIN, 'libomt.dll'));

const FrameType = { None: 0, Metadata: 1, Video: 2, Audio: 4 };
const Codec = { VMX1: 0x31584D56, BGRA: 0x41524742, UYVY: 0x59565955 };
const Quality = { Default: 0, Low: 1, Medium: 50, High: 100 };
const VideoFlags = { None: 0, Interlaced: 1, Alpha: 2, PreMultiplied: 4 };

const OMTMediaFrame = koffi.struct('OMTMediaFrame', {
  Type: 'int',
  Timestamp: 'int64_t',
  Codec: 'int',
  Width: 'int',
  Height: 'int',
  Stride: 'int',
  Flags: 'int',
  FrameRateN: 'int',
  FrameRateD: 'int',
  AspectRatio: 'float',
  ColorSpace: 'int',
  SampleRate: 'int',
  Channels: 'int',
  SamplesPerChannel: 'int',
  Data: 'void *',
  DataLength: 'int',
  CompressedData: 'void *',
  CompressedLength: 'int',
  FrameMetadata: 'void *',
  FrameMetadataLength: 'int',
});

const OMTStatistics = koffi.struct('OMTStatistics', {
  BytesSent: 'int64_t', BytesReceived: 'int64_t',
  BytesSentSinceLast: 'int64_t', BytesReceivedSinceLast: 'int64_t',
  Frames: 'int64_t', FramesSinceLast: 'int64_t', FramesDropped: 'int64_t',
  CodecTime: 'int64_t', CodecTimeSinceLast: 'int64_t',
  Reserved1: 'int64_t', Reserved2: 'int64_t', Reserved3: 'int64_t',
  Reserved4: 'int64_t', Reserved5: 'int64_t', Reserved6: 'int64_t', Reserved7: 'int64_t',
});

const fns = {
  sendCreate: lib.func('void* omt_send_create(const char* name, int quality)'),
  sendDestroy: lib.func('void omt_send_destroy(void* inst)'),
  send: lib.func('int omt_send(void* inst, OMTMediaFrame* frame)'),
  sendConnections: lib.func('int omt_send_connections(void* inst)'),
  sendGetAddress: lib.func('int omt_send_getaddress(void* inst, _Out_ uint8_t* address, int maxLength)'),
  sendGetVideoStats: lib.func('void omt_send_getvideostatistics(void* inst, _Out_ OMTStatistics* stats)'),
  setLogFile: lib.func('void omt_setloggingfilename(const char* filename)'),
};

// Stable native memory for frame data (struct pointer members need a real native
// allocation); JS Buffers are first-class as FUNCTION arg pointers, so copy via
// msvcrt memcpy.
const crt = koffi.load('msvcrt.dll');
const memcpy = crt.func('void* memcpy(void* dest, const void* src, size_t n)');
const nativeBuffer = bytes => koffi.alloc('uint8_t', bytes);

function readCString(buf) {
  const z = buf.indexOf(0);
  return buf.toString('utf8', 0, z < 0 ? buf.length : z);
}

module.exports = { koffi, fns, OMTMediaFrame, OMTStatistics, FrameType, Codec, Quality, VideoFlags, memcpy, nativeBuffer, readCString, BIN };
