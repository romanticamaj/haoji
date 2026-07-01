#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

// Exposes the Swift AudioInterruption (an RCTEventEmitter subclass) to the RN bridge.
@interface RCT_EXTERN_MODULE(AudioInterruption, RCTEventEmitter)
@end
