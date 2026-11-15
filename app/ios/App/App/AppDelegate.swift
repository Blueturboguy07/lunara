import UIKit
import Capacitor
import BackgroundTasks
import Security
import WidgetKit

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?
    private let widgetRefreshTaskIdentifier = "app.lunara.mobile.widget-refresh"
    /// LunaraNativePlugin.swift keeps the vault under this Keychain service.
    private let vaultKeychainService = "app.lunara.mobile.vault"
    private let installedMarker = "lunara.installed.v1"

    func application(_ application: UIApplication, willFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        clearVaultOnFirstLaunchAfterInstall()
        return true
    }

    /// The iOS Keychain keeps items after the app is deleted, so a new install would find the
    /// old publik key and the old own AI keys. A fresh install starts with an empty vault: the
    /// marker lives in UserDefaults, which the deletion removes. An update from a build without
    /// the marker keeps its vault, because its WebView data (Lunara's database) is already there.
    private func clearVaultOnFirstLaunchAfterInstall() {
        let defaults = UserDefaults.standard
        guard !defaults.bool(forKey: installedMarker) else { return }
        defaults.set(true, forKey: installedMarker)
        if let library = FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask).first,
           FileManager.default.fileExists(atPath: library.appendingPathComponent("WebKit").path) {
            return
        }
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: vaultKeychainService
        ]
        SecItemDelete(query as CFDictionary)
    }

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        BGTaskScheduler.shared.register(
            forTaskWithIdentifier: widgetRefreshTaskIdentifier,
            using: nil
        ) { [weak self] task in
            guard let self, let refreshTask = task as? BGAppRefreshTask else {
                task.setTaskCompleted(success: false)
                return
            }
            self.handleWidgetRefresh(refreshTask)
        }
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        scheduleWidgetRefresh()
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

    private func scheduleWidgetRefresh() {
        let request = BGAppRefreshTaskRequest(identifier: widgetRefreshTaskIdentifier)
        request.earliestBeginDate = Date(timeIntervalSinceNow: 6 * 60 * 60)
        do {
            try BGTaskScheduler.shared.submit(request)
        } catch {
            // Scheduling is opportunistic and may be declined by the system.
        }
    }

    private func handleWidgetRefresh(_ task: BGAppRefreshTask) {
        scheduleWidgetRefresh()
        task.expirationHandler = {}

        // The native task can safely refresh the last redacted snapshot without
        // launching the WebView or reading Lunara's private cycle database.
        WidgetCenter.shared.reloadAllTimelines()
        task.setTaskCompleted(success: true)
    }

}
