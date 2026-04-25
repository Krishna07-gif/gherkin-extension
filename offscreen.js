// ============================================================
// offscreen.js — Offscreen Document (Chrome MV3)
//
// Strategy:
//   PRIMARY  → WebCodecs VideoEncoder (H.264/AVC) + inline MP4 muxer
//              → outputs real .mp4, plays everywhere
//   FALLBACK → MediaRecorder (VP9) + WebM container
//              → used only when WebCodecs unavailable
// ============================================================
'use strict';

// ---- Recording state ----
let recording      = false;
let captureStream  = null;
let frameReader    = null;
let videoEncoder   = null;
let frameCount     = 0;

// Collected encoded data
let encodedChunks  = [];   // { data: Uint8Array, isKey, timestamp(µs), duration(µs) }
let avcCBytes      = null; // AVCDecoderConfigurationRecord from first keyframe
let videoWidth     = 0;
let videoHeight    = 0;

// Fallback MediaRecorder state
let mediaRecorder  = null;
let mrChunks       = [];

// ============================================================
// Message Router
// ============================================================
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.target !== 'offscreen') return;

  switch (msg.type) {
    case 'START_VIDEO':
      startCapture(msg.streamId)
        .then(() => sendResponse({ success: true }))
        .catch(e  => sendResponse({ success: false, error: e.message }));
      return true; // async

    case 'STOP_VIDEO':
      stopCapture().then(() => sendResponse({ success: true }));
      return true;

    case 'PAUSE_VIDEO':
      recording = false;
      if (mediaRecorder?.state === 'recording') mediaRecorder.pause();
      sendResponse({ success: true });
      break;

    case 'RESUME_VIDEO':
      recording = true;
      if (mediaRecorder?.state === 'paused') mediaRecorder.resume();
      sendResponse({ success: true });
      break;
  }
  return true;
});

// ============================================================
// CAPTURE START
// ============================================================
async function startCapture(streamId) {
  encodedChunks = [];
  avcCBytes     = null;
  frameCount    = 0;
  recording     = true;

  captureStream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      mandatory: {
        chromeMediaSource:   'tab',
        chromeMediaSourceId: streamId,
        maxWidth:   1920,
        maxHeight:  1080,
        maxFrameRate: 30
      }
    }
  });

  const track    = captureStream.getVideoTracks()[0];
  const settings = track.getSettings();
  videoWidth     = settings.width  || 1280;
  videoHeight    = settings.height || 720;

  // ── Try WebCodecs path first ──
  if (typeof VideoEncoder !== 'undefined' && typeof MediaStreamTrackProcessor !== 'undefined') {
    await startWebCodecsPath(track);
  } else {
    startMediaRecorderFallback();
  }
}

// ============================================================
// PATH A — WebCodecs → MP4
// ============================================================
async function startWebCodecsPath(track) {
  let codecStr = 'avc1.640028'; // H.264 High Profile Level 4.0 (1080p support)

  // Check codec support, fall back gracefully
  const cfg = { codec: codecStr, width: videoWidth, height: videoHeight,
                bitrate: 3_000_000, framerate: 30, avc: { format: 'avc' } };

  const support = await VideoEncoder.isConfigSupported(cfg).catch(() => ({ supported: false }));
  if (!support.supported) {
    cfg.codec = 'avc1.42001f'; // Baseline 3.1 fallback
    const s2 = await VideoEncoder.isConfigSupported(cfg).catch(() => ({ supported: false }));
    if (!s2.supported) {
      // WebCodecs H.264 not available → fall back to MediaRecorder
      startMediaRecorderFallback();
      return;
    }
    codecStr = 'avc1.42001f';
  }

  videoEncoder = new VideoEncoder({
    output: onEncodedChunk,
    error:  e => console.warn('[VideoEncoder]', e)
  });

  videoEncoder.configure({
    codec:     codecStr,
    width:     videoWidth,
    height:    videoHeight,
    bitrate:   3_000_000,
    framerate: 30,
    avc:       { format: 'avc' }  // AVCC format — required for MP4 mdat
  });

  const processor = new MediaStreamTrackProcessor({ track });
  frameReader     = processor.readable.getReader();
  drainFrames();
}

async function drainFrames() {
  try {
    while (true) {
      const { value: frame, done } = await frameReader.read();
      if (done) break;
      if (recording && videoEncoder?.state === 'configured') {
        const isKey = frameCount % 60 === 0; // keyframe every ~2 s at 30 fps
        videoEncoder.encode(frame, { keyFrame: isKey });
        frameCount++;
      }
      frame.close();
    }
  } catch (_) { /* stream closed — normal on stop */ }
}

function onEncodedChunk(chunk, meta) {
  // The very first keyframe carries SPS+PPS in decoderConfig.description
  if (meta?.decoderConfig?.description) {
    avcCBytes = new Uint8Array(
      meta.decoderConfig.description instanceof ArrayBuffer
        ? meta.decoderConfig.description
        : meta.decoderConfig.description.buffer
          ? meta.decoderConfig.description.buffer.slice(
              meta.decoderConfig.description.byteOffset,
              meta.decoderConfig.description.byteOffset + meta.decoderConfig.description.byteLength
            )
          : meta.decoderConfig.description
    );
  }
  const data = new Uint8Array(chunk.byteLength);
  chunk.copyTo(data);
  encodedChunks.push({
    data,
    isKey:     chunk.type === 'key',
    timestamp: chunk.timestamp,                        // µs
    duration:  chunk.duration > 0
                 ? chunk.duration
                 : Math.round(1_000_000 / 30)          // default 30 fps
  });
}

// ============================================================
// PATH B — MediaRecorder fallback → WebM
// ============================================================
function startMediaRecorderFallback() {
  mrChunks = [];
  const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
    .find(t => MediaRecorder.isTypeSupported(t)) || 'video/webm';

  mediaRecorder = new MediaRecorder(captureStream, { mimeType: mime });
  mediaRecorder.ondataavailable = e => { if (e.data?.size > 0) mrChunks.push(e.data); };
  mediaRecorder.onstop = () => {
    const blob = new Blob(mrChunks, { type: mime });
    captureStream?.getTracks().forEach(t => t.stop());
    captureStream = mediaRecorder = null;
    emitResult(blob, mime);
  };
  mediaRecorder.start(1000);
}

// ============================================================
// CAPTURE STOP
// ============================================================
async function stopCapture() {
  recording = false;

  // ── WebM fallback path ──
  if (mediaRecorder) {
    if (mediaRecorder.state !== 'inactive') mediaRecorder.stop();
    return; // onstop fires emitResult
  }

  // ── WebCodecs path ──
  if (frameReader) {
    try { await frameReader.cancel(); } catch (_) {}
    frameReader = null;
  }
  if (videoEncoder && videoEncoder.state !== 'closed') {
    try { await videoEncoder.flush(); videoEncoder.close(); } catch (_) {}
    videoEncoder = null;
  }
  if (captureStream) {
    captureStream.getTracks().forEach(t => t.stop());
    captureStream = null;
  }

  if (encodedChunks.length === 0) {
    postReady(null, null, 0, 'No frames were captured');
    return;
  }

  try {
    const mp4 = buildMP4(encodedChunks, avcCBytes, videoWidth, videoHeight);
    emitResult(new Blob([mp4], { type: 'video/mp4' }), 'video/mp4');
  } catch (e) {
    // If MP4 build fails, try a raw WebM fallback won't help here
    postReady(null, null, 0, 'MP4 encoding failed: ' + e.message);
  }
}

function emitResult(blob, mimeType) {
  const fr = new FileReader();
  fr.onloadend = () => postReady(fr.result, mimeType, blob.size, null);
  fr.readAsDataURL(blob);
}

function postReady(dataUrl, mimeType, size, error) {
  chrome.runtime.sendMessage({ type: 'VIDEO_READY', dataUrl, mimeType, size, error })
    .catch(() => {});
}

// ============================================================
//
//   ██████████████████████████████████████████████
//   █                                            █
//   █   INLINE MP4 MUXER — pure JS, no deps      █
//   █   Outputs ISO Base Media File (MP4)        █
//   █   with a single H.264 video track          █
//   █                                            █
//   ██████████████████████████████████████████████
//
// Box layout produced:
//   ftyp  ← file type declaration
//   moov  ← movie metadata
//     mvhd  ← movie header
//     trak  ← video track
//       tkhd
//       mdia
//         mdhd
//         hdlr  (vide)
//         minf
//           vmhd
//           dinf > dref > url
//           stbl
//             stsd > avc1 > avcC
//             stts  (time-to-sample)
//             stss  (keyframes)
//             stsc  (sample-to-chunk)
//             stsz  (sample sizes)
//             stco  (chunk offset)   ← two-pass to get real offset
//   mdat  ← raw H.264 sample data (AVCC format)
//
// ============================================================

// ---- Binary helpers ----

function u8arr(...vals) { return new Uint8Array(vals.map(v => v & 0xFF)); }

function u16(v) {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setUint16(0, v >>> 0, false);
  return b;
}

function u32(v) {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, v >>> 0, false);
  return b;
}

function cc(s) { // fourCC string → 4 bytes
  return new Uint8Array([s.charCodeAt(0), s.charCodeAt(1), s.charCodeAt(2), s.charCodeAt(3)]);
}

function cat(...parts) {
  let total = 0;
  for (const p of parts) total += p.byteLength;
  const out = new Uint8Array(total);
  let i = 0;
  for (const p of parts) { out.set(p, i); i += p.byteLength; }
  return out;
}

// Regular box: size(4) + type(4) + body
function box(type, ...bodies) {
  const body = cat(...bodies);
  return cat(u32(8 + body.byteLength), cc(type), body);
}

// FullBox: size(4) + type(4) + version(1) + flags(3) + body
function fbox(type, version, flags, ...bodies) {
  const body = cat(...bodies);
  return cat(
    u32(12 + body.byteLength), cc(type),
    u8arr(version, (flags >>> 16) & 0xFF, (flags >>> 8) & 0xFF, flags & 0xFF),
    body
  );
}

// Padded string to fixed byte length (null-padded)
function fixedStr(s, len) {
  const out = new Uint8Array(len);
  for (let i = 0; i < Math.min(s.length, len); i++) out[i] = s.charCodeAt(i);
  return out;
}

// ---- Box constructors ----

function mkFtyp() {
  return box('ftyp',
    cc('isom'), u32(512),                    // major brand, minor version
    cc('isom'), cc('iso2'), cc('avc1'), cc('mp41') // compatible brands
  );
}

// Movie header (version 0, timescale = ms)
function mkMvhd(durMs) {
  return fbox('mvhd', 0, 0,
    u32(0), u32(0),        // creation / modification time
    u32(1000),             // timescale = 1000 (ms)
    u32(durMs),            // duration in ms
    u32(0x00010000),       // rate = 1.0  (16.16 fixed)
    u16(0x0100),           // volume = 1.0 (8.8 fixed)
    new Uint8Array(10),    // reserved
    // 3x3 unity matrix
    u32(0x00010000), u32(0), u32(0),
    u32(0), u32(0x00010000), u32(0),
    u32(0), u32(0), u32(0x40000000),
    new Uint8Array(24),    // pre-defined
    u32(2)                 // next_track_ID
  );
}

// Track header (flags 3 = enabled + in-movie)
function mkTkhd(w, h, durMs) {
  return fbox('tkhd', 0, 3,
    u32(0), u32(0),       // creation / modification
    u32(1),               // track_ID = 1
    u32(0),               // reserved
    u32(durMs),           // duration
    new Uint8Array(8),    // reserved
    u16(0), u16(0),       // layer, alternate_group
    u16(0), u16(0),       // volume (0 for video), reserved
    u32(0x00010000), u32(0), u32(0),
    u32(0), u32(0x00010000), u32(0),
    u32(0), u32(0), u32(0x40000000),
    u32(w << 16),         // width  (16.16 fixed point)
    u32(h << 16)          // height (16.16 fixed point)
  );
}

// Media header (timescale = 90000, standard for video)
function mkMdhd(durMs) {
  const ts  = 90000;
  const dur = Math.round(durMs * ts / 1000);
  return fbox('mdhd', 0, 0,
    u32(0), u32(0),    // creation / modification
    u32(ts),           // timescale
    u32(dur),          // duration
    u16(0x55C4),       // language = 'und'
    u16(0)             // pre_defined
  );
}

function mkHdlr() {
  return fbox('hdlr', 0, 0,
    u32(0),             // pre_defined
    cc('vide'),         // handler_type
    u32(0), u32(0), u32(0), // reserved
    new TextEncoder().encode('VideoHandler\0')
  );
}

function mkVmhd() {
  return fbox('vmhd', 0, 1,
    u16(0), u16(0), u16(0), u16(0)  // graphicsMode, opcolor[3]
  );
}

function mkDinf() {
  const urlBox  = fbox('url ', 0, 1);          // flags=1 → in same file
  const drefBox = fbox('dref', 0, 0, u32(1), urlBox);
  return box('dinf', drefBox);
}

// avc1 visual sample entry
function mkAvc1(w, h, avcCData) {
  return box('avc1',
    new Uint8Array(6),     // reserved
    u16(1),                // data_reference_index
    new Uint8Array(2),     // pre_defined
    new Uint8Array(2),     // reserved
    new Uint8Array(12),    // pre_defined[3]
    u16(w), u16(h),        // width, height
    u32(0x00480000),       // horizresolution 72 dpi (16.16)
    u32(0x00480000),       // vertresolution  72 dpi (16.16)
    u32(0),                // reserved
    u16(1),                // frame_count = 1
    new Uint8Array(32),    // compressorname (empty)
    u16(0x0018),           // depth = 24
    u8arr(0xFF, 0xFF),     // pre_defined = -1
    box('avcC', avcCData)  // H.264 decoder config record (SPS + PPS)
  );
}

function mkStsd(w, h, avcCData) {
  return fbox('stsd', 0, 0, u32(1), mkAvc1(w, h, avcCData));
}

// stts — time-to-sample (run-length encoded durations)
function mkStts(chunks, mediaTS) {
  const durs = chunks.map(c => Math.max(1, Math.round(c.duration * mediaTS / 1_000_000)));

  const entries = [];
  if (durs.length > 0) {
    let run = { count: 1, delta: durs[0] };
    for (let i = 1; i < durs.length; i++) {
      if (durs[i] === run.delta) { run.count++; }
      else { entries.push(run); run = { count: 1, delta: durs[i] }; }
    }
    entries.push(run);
  }

  const body = new Uint8Array(4 + entries.length * 8);
  const dv   = new DataView(body.buffer);
  dv.setUint32(0, entries.length, false);
  entries.forEach(({ count, delta }, i) => {
    dv.setUint32(4 + i * 8,     count, false);
    dv.setUint32(4 + i * 8 + 4, delta, false);
  });
  return fbox('stts', 0, 0, body);
}

// stss — sync sample table (keyframe indices, 1-based)
function mkStss(chunks) {
  const keys = [];
  chunks.forEach((c, i) => { if (c.isKey) keys.push(i + 1); });
  const body = new Uint8Array(4 + keys.length * 4);
  const dv   = new DataView(body.buffer);
  dv.setUint32(0, keys.length, false);
  keys.forEach((k, i) => dv.setUint32(4 + i * 4, k, false));
  return fbox('stss', 0, 0, body);
}

// stsc — one chunk containing ALL samples
function mkStsc(sampleCount) {
  return fbox('stsc', 0, 0,
    u32(1),            // entry_count
    u32(1),            // first_chunk
    u32(sampleCount),  // samples_per_chunk
    u32(1)             // sample_description_index
  );
}

// stsz — per-sample sizes
function mkStsz(chunks) {
  const body = new Uint8Array(8 + chunks.length * 4);
  const dv   = new DataView(body.buffer);
  dv.setUint32(0, 0,             false); // sample_size = 0 → variable
  dv.setUint32(4, chunks.length, false);
  chunks.forEach((c, i) => dv.setUint32(8 + i * 4, c.data.byteLength, false));
  return fbox('stsz', 0, 0, body);
}

// stco — one chunk offset entry
function mkStco(offset) {
  return fbox('stco', 0, 0, u32(1), u32(offset));
}

// ---- Full MP4 assembly ----

function buildMP4(chunks, avcCData, w, h) {
  if (!avcCData || avcCData.byteLength === 0) {
    throw new Error('Missing H.264 decoder config (no SPS/PPS received). Try recording for a longer time.');
  }

  // Sort by timestamp
  chunks = [...chunks].sort((a, b) => a.timestamp - b.timestamp);

  const MEDIA_TS = 90000; // 90 kHz media timescale

  // Total duration: sum of all sample durations (µs) → convert to ms
  const totalDurUS = chunks.reduce((s, c) => s + c.duration, 0);
  const totalDurMs = Math.max(1, Math.round(totalDurUS / 1000));

  // Helper: assemble moov with a given stco offset
  function assembleMoov(mdatOffset) {
    const stbl = box('stbl',
      mkStsd(w, h, avcCData),
      mkStts(chunks, MEDIA_TS),
      mkStss(chunks),
      mkStsc(chunks.length),
      mkStsz(chunks),
      mkStco(mdatOffset)
    );
    const minf = box('minf', mkVmhd(), mkDinf(), stbl);
    const mdia = box('mdia', mkMdhd(totalDurMs), mkHdlr(), minf);
    const trak = box('trak', mkTkhd(w, h, totalDurMs), mdia);
    return box('moov', mkMvhd(totalDurMs), trak);
  }

  // ── Two-pass to resolve stco offset ──
  // Pass 1: moov with placeholder offset 0
  const ftyp      = mkFtyp();
  const moovPass1 = assembleMoov(0);

  // mdat starts after ftyp + moov + 8-byte mdat header
  const mdatBodyOffset = ftyp.byteLength + moovPass1.byteLength + 8;

  // Pass 2: moov with correct offset (moov size is identical → stco value doesn't affect box size)
  const moov = assembleMoov(mdatBodyOffset);

  // ── Build mdat box manually ──
  const mdatBodyLen = chunks.reduce((s, c) => s + c.data.byteLength, 0);
  const mdat        = new Uint8Array(8 + mdatBodyLen);
  new DataView(mdat.buffer).setUint32(0, mdat.byteLength, false);
  mdat.set(cc('mdat'), 4);
  let off = 8;
  for (const c of chunks) { mdat.set(c.data, off); off += c.data.byteLength; }

  return cat(ftyp, moov, mdat);
}
