import Foundation
import AVFoundation
import React

/// Concatenates several WAV recordings into ONE file, losslessly.
///
/// Parts exist for a single reason: while recording, an interruption or crash must not cost the audio
/// captured so far. Once a recording has finished cleanly there is no reason to keep them apart — and
/// leaving them split showed the user "段 1 / 段 2 / 段 3…", one player each, for what was really one
/// meeting. Because every part is PCM written with identical settings, joining them is a byte copy:
/// no re-encode, no quality loss, and fast even for a long meeting.
@objc(AudioMerge)
class AudioMerge: NSObject {
  @objc static func requiresMainQueueSetup() -> Bool { false }

  private struct WavInfo {
    let fmt: Data          // the whole fmt chunk payload, compared across inputs
    let dataOffset: UInt64 // where audio bytes start
    let dataLength: UInt64 // how many of them there are
  }

  /// Parse enough of a WAV to know its format and where the samples live.
  private static func inspect(_ path: String) -> WavInfo? {
    guard let fh = FileHandle(forReadingAtPath: path) else { return nil }
    defer { try? fh.close() }
    let fileSize = (try? FileManager.default.attributesOfItem(atPath: path)[.size] as? UInt64) ?? nil
    guard let total = fileSize ?? nil, total > 12 else { return nil }

    guard let head = try? fh.read(upToCount: 12), head.count == 12,
          head.prefix(4) == Data("RIFF".utf8), head.suffix(4) == Data("WAVE".utf8) else { return nil }

    var offset: UInt64 = 12
    var fmt: Data?
    while offset + 8 <= total {
      try? fh.seek(toOffset: offset)
      guard let hdr = try? fh.read(upToCount: 8), hdr.count == 8 else { return nil }
      let id = String(decoding: hdr.prefix(4), as: UTF8.self)
      let size = UInt64(hdr.withUnsafeBytes { $0.load(fromByteOffset: 4, as: UInt32.self).littleEndian })

      if id == "fmt " {
        fmt = try? fh.read(upToCount: Int(size))
      } else if id == "data" {
        // A recording cut short by a crash can have a zero/oversized length — trust the file instead.
        let avail = total - (offset + 8)
        let usable = (size == 0 || size > avail) ? avail : size
        guard let f = fmt else { return nil }
        return WavInfo(fmt: f, dataOffset: offset + 8, dataLength: usable)
      }
      if size == 0 { return nil }                    // malformed chunk: refuse rather than guess
      offset += 8 + size + (size % 2)                // chunks are word-aligned
    }
    return nil
  }

  private static func u32(_ v: UInt32) -> Data { withUnsafeBytes(of: v.littleEndian) { Data($0) } }

  /// Ask the system what each file actually IS, before offering to join them.
  ///
  /// Deliberately decodes rather than trusting the extension: a picked ".m4a" may be a renamed PDF,
  /// a video with no audio track, or a zero-length file. Joining those silently is not undoable, so
  /// the user is shown what we found and confirms.
  @objc(probe:resolver:rejecter:)
  func probe(_ paths: [String], resolve: @escaping RCTPromiseResolveBlock,
             reject: @escaping RCTPromiseRejectBlock) {
    var out: [[String: Any]] = []
    for p in paths {
      let path = p.replacingOccurrences(of: "file://", with: "")
      var item: [String: Any] = ["path": p, "ok": false, "durationMs": 0]
      if !FileManager.default.fileExists(atPath: path) {
        item["reason"] = "找不到檔案"
      } else {
        let asset = AVURLAsset(url: URL(fileURLWithPath: path))
        let seconds = CMTimeGetSeconds(asset.duration)
        if asset.tracks(withMediaType: .audio).isEmpty {
          item["reason"] = "沒有音訊"
        } else if !seconds.isFinite || seconds <= 0 {
          item["reason"] = "長度為零或無法讀取"
        } else {
          item["ok"] = true
          item["durationMs"] = Int(seconds * 1000)
        }
      }
      out.append(item)
    }
    resolve(out)
  }

  /// Concatenate ANY audio the system can read (m4a, mp3, wav, a video's audio track…) into one
  /// .m4a. Used for imported files, which are typically compressed and may not even share a format,
  /// so the lossless byte-copy path below cannot apply. This re-encodes; that costs a little time
  /// and quality, but the alternative is showing one player per imported file for what the user
  /// picked as a single meeting.
  @objc(concatToM4A:destPath:resolver:rejecter:)
  func concatToM4A(_ paths: [String], destPath: String,
                   resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    let srcs = paths.map { $0.replacingOccurrences(of: "file://", with: "") }
    let dst = URL(fileURLWithPath: destPath.replacingOccurrences(of: "file://", with: ""))
    guard srcs.count >= 2 else { reject("too_few", "需要至少兩個檔案。", nil); return }

    let composition = AVMutableComposition()
    guard let track = composition.addMutableTrack(withMediaType: .audio,
                                                 preferredTrackID: kCMPersistentTrackID_Invalid) else {
      reject("no_track", "無法建立音訊軌。", nil); return
    }

    var cursor = CMTime.zero
    for p in srcs {
      let asset = AVURLAsset(url: URL(fileURLWithPath: p))
      guard let src = asset.tracks(withMediaType: .audio).first else { continue }   // no audio: skip
      let duration = asset.duration
      guard duration.isValid, duration > CMTime.zero else { continue }
      do {
        try track.insertTimeRange(CMTimeRange(start: .zero, duration: duration), of: src, at: cursor)
        cursor = CMTimeAdd(cursor, duration)
      } catch {
        reject("insert_failed", "串接失敗：\(error.localizedDescription)", error); return
      }
    }
    guard cursor > CMTime.zero else { reject("no_audio", "這些檔案裡沒有音訊。", nil); return }

    guard let export = AVAssetExportSession(asset: composition, presetName: AVAssetExportPresetAppleM4A) else {
      reject("no_export", "無法建立轉檔工作。", nil); return
    }
    try? FileManager.default.removeItem(at: dst)
    export.outputURL = dst
    export.outputFileType = .m4a
    export.exportAsynchronously {
      switch export.status {
      case .completed: resolve(dst.path)
      case .cancelled: reject("cancelled", "串接已取消。", nil)
      default: reject("export_failed", export.error?.localizedDescription ?? "串接失敗。", export.error)
      }
    }
  }

  /// paths → destPath. Rejects (so the caller can keep the parts as they are) unless every input is a
  /// WAV sharing the exact same format.
  @objc(concatWav:destPath:resolver:rejecter:)
  func concatWav(_ paths: [String], destPath: String,
                 resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    let srcs = paths.map { $0.replacingOccurrences(of: "file://", with: "") }
    let dst = destPath.replacingOccurrences(of: "file://", with: "")

    guard srcs.count >= 2 else { reject("too_few", "需要至少兩個檔案。", nil); return }
    var infos: [WavInfo] = []
    for p in srcs {
      guard let info = Self.inspect(p) else { reject("not_wav", "不是可串接的 WAV：\(p)", nil); return }
      if let first = infos.first, first.fmt != info.fmt {
        reject("format_mismatch", "音訊格式不一致，無法無損串接。", nil); return
      }
      infos.append(info)
    }
    let fmt = infos[0].fmt
    let totalData = infos.reduce(UInt64(0)) { $0 + $1.dataLength }

    FileManager.default.createFile(atPath: dst, contents: nil)
    guard let out = FileHandle(forWritingAtPath: dst) else {
      reject("cannot_write", "無法建立輸出檔：\(dst)", nil); return
    }
    defer { try? out.close() }

    do {
      // RIFF header, then the fmt chunk exactly as the inputs had it, then all the samples.
      var header = Data("RIFF".utf8)
      // Split out with explicit types: mixing Int (fmt.count) and UInt64 (totalData) in one
      // expression defeats Swift's type checker ("unable to type-check in reasonable time").
      let fmtLen: UInt64 = UInt64(fmt.count)
      let dataLen: UInt64 = totalData
      let riffSize: UInt64 = 4 + 8 + fmtLen + 8 + dataLen        // "WAVE" + fmt chunk + data chunk
      header.append(Self.u32(UInt32(riffSize)))
      header.append(Data("WAVE".utf8))
      header.append(Data("fmt ".utf8))
      header.append(Self.u32(UInt32(fmtLen)))
      header.append(fmt)
      header.append(Data("data".utf8))
      header.append(Self.u32(UInt32(dataLen)))
      try out.write(contentsOf: header)

      for (i, p) in srcs.enumerated() {
        guard let input = FileHandle(forReadingAtPath: p) else {
          reject("cannot_read", "無法讀取：\(p)", nil); return
        }
        defer { try? input.close() }
        try input.seek(toOffset: infos[i].dataOffset)
        var remaining = infos[i].dataLength
        while remaining > 0 {                        // stream in chunks: a long meeting must not be
          let want = Int(min(remaining, 1 << 20))    // loaded into memory all at once
          guard let chunk = try input.read(upToCount: want), !chunk.isEmpty else { break }
          try out.write(contentsOf: chunk)
          remaining -= UInt64(chunk.count)
        }
      }
      resolve(dst)
    } catch {
      try? FileManager.default.removeItem(atPath: dst)   // never leave a half-written file behind
      reject("merge_failed", "串接失敗：\(error.localizedDescription)", error)
    }
  }
}
