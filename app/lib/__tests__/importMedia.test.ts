import { extOf, isVideo, isAudio, storageExtFor } from '../importMedia';

test('extOf handles uris, query strings and names without an extension', () => {
  expect(extOf('file:///a/b/clip.MOV')).toBe('mov');
  expect(extOf('/tmp/voice memo.m4a')).toBe('m4a');
  expect(extOf('https://x/y/f.mp3?token=1')).toBe('mp3');
  expect(extOf('noextension')).toBe('');
  expect(extOf('/a/.hidden')).toBe('');          // leading dot is not an extension
  expect(extOf('/a/trailing.')).toBe('');
});

test('classifies audio vs video containers', () => {
  expect(isVideo('a.mov')).toBe(true);
  expect(isVideo('a.MP4')).toBe(true);
  expect(isVideo('a.m4a')).toBe(false);
  expect(isAudio('a.wav')).toBe(true);
  expect(isAudio('a.mov')).toBe(false);
});

test('storage extension keeps playable audio as-is and normalises everything else to m4a', () => {
  expect(storageExtFor('voice.wav')).toBe('wav');   // was forced to .m4a before, breaking playback
  expect(storageExtFor('voice.mp3')).toBe('mp3');
  expect(storageExtFor('clip.mov')).toBe('m4a');    // video → we extract its audio track
  expect(storageExtFor('weird.xyz')).toBe('m4a');
  expect(storageExtFor('noext')).toBe('m4a');
});
