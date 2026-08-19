#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

// Exposes the Swift BackgroundUpload (an RCTEventEmitter subclass) to the RN bridge. Events reach JS
// through RCTDeviceEventEmitter, which the New-Architecture interop layer preserves.
@interface RCT_EXTERN_MODULE(BackgroundUpload, RCTEventEmitter)

RCT_EXTERN_METHOD(enqueue:(NSString *)urlString
                  filePath:(NSString *)filePath
                  taskId:(NSString *)taskId
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(pendingTasks:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
