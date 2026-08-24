#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

// Exposes the Swift AudioInterruption (an RCTEventEmitter subclass) to the RN bridge.
@interface RCT_EXTERN_MODULE(AudioInterruption, RCTEventEmitter)

// No-op; JS calls it at startup purely to make the module exist. See AudioInterruption.swift.
RCT_EXTERN_METHOD(prepare)

@end
