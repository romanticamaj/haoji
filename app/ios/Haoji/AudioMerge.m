#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(AudioMerge, NSObject)

RCT_EXTERN_METHOD(concatWav:(NSArray<NSString *> *)paths
                  destPath:(NSString *)destPath
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
