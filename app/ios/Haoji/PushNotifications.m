#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

// Exposes the Swift PushNotifications (an RCTEventEmitter subclass) to the RN bridge. Taps reach JS
// through RCTDeviceEventEmitter, which the New-Architecture interop layer preserves.
@interface RCT_EXTERN_MODULE(PushNotifications, RCTEventEmitter)

RCT_EXTERN_METHOD(register:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(attach:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
