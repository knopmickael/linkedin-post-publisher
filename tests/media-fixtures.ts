import { createFile } from 'mp4box';

export function animatedGif(frames = 2) {
  const header = Buffer.from('47494638396101000100800000000000ffffff', 'hex');
  const frame = Buffer.from('21f904000a0000002c0000000001000100000202440100', 'hex');
  return Buffer.concat([header, ...Array.from({ length: frames }, () => frame), Buffer.from([0x3b])]);
}

// Container fixture for server metadata validation, not a decodable playback clip.
export function mp4Fixture(durationMs = 4000, video = true) {
  const file = createFile();
  const id = file.addTrack({ type: video ? 'avc1' : 'mp4a', width: video ? 640 : 0, height: video ? 360 : 0, timescale: 1000, duration: durationMs });
  file.addSample(id, new Uint8Array(76000), { duration: durationMs, is_sync: true });
  return Buffer.from(file.getBuffer().buffer);
}

export function multipartFile(bytes: Buffer, revision: number, mime = 'application/octet-stream') {
  const boundary = 'publisher-test-boundary';
  return { boundary, payload: Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="revision"\r\n\r\n${revision}\r\n--${boundary}\r\nContent-Disposition: form-data; name="altText"\r\n\r\nDescrição da mídia\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="file.bin"\r\nContent-Type: ${mime}\r\n\r\n`),
    bytes, Buffer.from(`\r\n--${boundary}--\r\n`),
  ]) };
}
