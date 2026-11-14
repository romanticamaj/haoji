#import <React/RCTBridgeModule.h>

// Exposes the Swift AudioExtract to the RN bridge.
@interface RCT_EXTERN_MODULE(AudioExtract, NSObject)

RCT_EXTERN_METHOD(extractAudio:(NSString *)srcPath
                  destPath:(NSString *)destPath
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
