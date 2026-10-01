import UIKit
import UserNotifications
import React
import React_RCTAppDelegate
import ReactAppDependencyProvider

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
  var window: UIWindow?

  var reactNativeDelegate: ReactNativeDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let delegate = ReactNativeDelegate()
    let factory = RCTReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    // Before React starts: a notification tap that cold-launches the app is delivered to this delegate
    // during launch, and would be lost if it were installed any later.
    UNUserNotificationCenter.current().delegate = PushCenter.shared

    reactNativeDelegate = delegate
    reactNativeFactory = factory

    window = UIWindow(frame: UIScreen.main.bounds)

    factory.startReactNative(
      withModuleName: "Haoji",
      in: window,
      launchOptions: launchOptions
    )

    // Simulator-only: lets a UI test drive a real audio interruption from its own process.
    E2EHooks.registerDarwinTriggers()

    return true
  }

  /// Simulator-only test hooks (E2EHooks is empty on device builds). Returning false for anything
  /// else keeps normal URL handling untouched.
  func application(_ app: UIApplication, open url: URL,
                   options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
    return E2EHooks.handle(url)
  }

  func application(_ application: UIApplication,
                   didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
    PushCenter.shared.didRegister(deviceToken)
  }

  func application(_ application: UIApplication,
                   didFailToRegisterForRemoteNotificationsWithError error: Error) {
    PushCenter.shared.didFailToRegister(error)
  }

  /// iOS wakes the app (relaunching it if needed) once background uploads finish. Hand the completion
  /// handler to BackgroundUpload so it can call it after delivering the events — without this the
  /// system may stop giving the app background time for transfers.
  func application(
    _ application: UIApplication,
    handleEventsForBackgroundURLSession identifier: String,
    completionHandler: @escaping () -> Void
  ) {
    BackgroundUpload.backgroundCompletionHandler = completionHandler
  }
}

class ReactNativeDelegate: RCTDefaultReactNativeFactoryDelegate {
  override func sourceURL(for bridge: RCTBridge) -> URL? {
    self.bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "index")
#else
    Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}
