import Foundation
import AVFoundation
import React

/// Extracts the audio track of a video into a playable .m4a.
///
/// An imported video transcribes fine (the backend re-encodes whatever it is given), but nothing on
/// the device can PLAY it back through an audio player — so a perfectly good import looked broken in
/// the preview. Pulling the audio track out once, at import time, makes it behave exactly like a
/// recording: playable, scrubbable, and still transcribable.
@objc(AudioExtract)
class AudioExtract: NSObject {
  @objc static func requiresMainQueueSetup() -> Bool { false }

  @objc(extractAudio:destPath:resolver:rejecter:)
  func extractAudio(_ srcPath: String, destPath: String,
                    resolve: @escaping RCTPromiseResolveBlock,
                    reject: @escaping RCTPromiseRejectBlock) {
    let src = URL(fileURLWithPath: srcPath.replacingOccurrences(of: "file://", with: ""))
    let dst = URL(fileURLWithPath: destPath.replacingOccurrences(of: "file://", with: ""))

    guard FileManager.default.fileExists(atPath: src.path) else {
      reject("missing_file", "File not found: \(src.path)", nil); return
    }
    let asset = AVURLAsset(url: src)
    guard !asset.tracks(withMediaType: .audio).isEmpty else {
      reject("no_audio", "這個檔案沒有音訊軌。", nil); return
    }
    guard let export = AVAssetExportSession(asset: asset, presetName: AVAssetExportPresetAppleM4A) else {
      reject("no_export", "無法建立音訊轉檔工作。", nil); return
    }

    try? FileManager.default.removeItem(at: dst)   // a retry must not fail on a leftover file
    export.outputURL = dst
    export.outputFileType = .m4a
    export.exportAsynchronously {
      switch export.status {
      case .completed:
        resolve(dst.path)
      case .cancelled:
        reject("cancelled", "音訊擷取已取消。", nil)
      default:
        reject("export_failed", export.error?.localizedDescription ?? "音訊擷取失敗。", export.error)
      }
    }
  }
}
