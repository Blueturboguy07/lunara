import Capacitor
import Foundation
import HealthKit
import LocalAuthentication
import SafariServices
import Security
import StoreKit
import UIKit
import WidgetKit

@objc(LunaraNativePlugin)
public final class LunaraNativePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "LunaraNativePlugin"
    public let jsName = "LunaraNative"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "secureVaultStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "secureSet", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "secureGet", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "secureDelete", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "secureClear", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "biometricStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "authenticate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "healthStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestHealthAccess", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "importHealthData", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "widgetStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "publishWidgetSnapshot", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearWidgetSnapshot", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "printReport", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "publikLaunchOptions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "publikSelfTestDone", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "publikTestLine", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "publikSheetOpen", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "publikSheetClose", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "publikWatchStop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "appStoreStorefront", returnType: CAPPluginReturnPromise)
    ]

    private let keychainService = "app.lunara.mobile.vault"
    private let widgetSuite = "group.app.lunara.mobile"
    private let widgetSnapshotKey = "cycle-widget-snapshot-v1"
    private let healthStore = HKHealthStore()
    private let healthRequestedKey = "health-authorization-requested-v1"

    // MARK: Report export

    @objc public func printReport(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let webView = self.webView else {
                call.reject("The report view is unavailable.", "REPORT_VIEW_UNAVAILABLE")
                return
            }

            let controller = UIPrintInteractionController.shared
            let info = UIPrintInfo(dictionary: nil)
            info.jobName = call.getString("jobName") ?? "Lunara cycle report"
            info.outputType = .general
            controller.printInfo = info
            controller.printFormatter = webView.viewPrintFormatter()
            controller.showsNumberOfCopies = false

            let presented = controller.present(animated: true) { _, _, error in
                if let error {
                    call.reject("The report export sheet failed.", "REPORT_EXPORT_FAILED", error)
                } else {
                    call.resolve()
                }
            }

            if !presented {
                call.reject("The report export sheet could not open.", "REPORT_EXPORT_UNAVAILABLE")
            }
        }
    }

    // MARK: publik launch options and self-test

    private static let publikLaunchNames = [
        "PUBLIK_API_BASE_URL", "PUBLIK_SELF_TEST", "PUBLIK_TEST_SIGN_IN", "DO_NOT_TRACK", "PUBLIK_TELEMETRY", "PUBLIK_TELEMETRY_DEBUG"
    ]

    /// The fake publik of a test runs on this computer.
    private static let publikTestHosts: Set<String> = ["127.0.0.1", "localhost", "::1"]

    /// A value for the publik module (src/lib/publik.ts): the process environment
    /// (`SIMCTL_CHILD_PUBLIK_SELF_TEST=1 xcrun simctl launch ...`, or the Xcode scheme),
    /// else a launch argument (`-PUBLIK_API_BASE_URL http://127.0.0.1:8787/api/v1`).
    /// The two test hooks, PUBLIK_API_BASE_URL and PUBLIK_SELF_TEST, exist only in a Debug
    /// build made with PUBLIK_TEST_HOOKS=YES (Lunara.xcconfig; CI passes it to xcodebuild).
    /// A Release build never compiles them in. PUBLIK_API_BASE_URL must name this computer.
    private func publikLaunchValue(_ name: String) -> String? {
        #if !PUBLIK_TEST_HOOKS
        if name == "PUBLIK_API_BASE_URL" || name == "PUBLIK_SELF_TEST" || name == "PUBLIK_TEST_SIGN_IN" { return nil }
        #endif
        let fromEnvironment = ProcessInfo.processInfo.environment[name]
        let fromArguments = UserDefaults.standard.volatileDomain(forName: UserDefaults.argumentDomain)[name].map { "\($0)" }
        guard let value = (fromEnvironment ?? fromArguments)?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty else {
            return nil
        }
        if name == "PUBLIK_API_BASE_URL" {
            guard let url = URL(string: value),
                  let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https",
                  let host = url.host?.lowercased(), Self.publikTestHosts.contains(host) else {
                return nil
            }
        }
        return value
    }

    @objc public func publikLaunchOptions(_ call: CAPPluginCall) {
        var options: [String: Any] = [:]
        for name in Self.publikLaunchNames {
            if let value = publikLaunchValue(name) { options[name] = value }
        }
        call.resolve(options)
    }

    /// PUBLIK_SELF_TEST: print the module's one line on stdout, then end the app.
    @objc public func publikSelfTestDone(_ call: CAPPluginCall) {
        guard publikLaunchValue("PUBLIK_SELF_TEST") != nil else {
            call.reject("No publik self-test was requested.", "PUBLIK_NO_SELF_TEST")
            return
        }
        let line = call.getString("line") ?? "publik self-test: failed: no result"
        print(line)
        fflush(stdout)
        call.resolve()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { exit(0) }
    }

    /// PUBLIK_TEST_SIGN_IN (test builds only): one line on stdout for the CI log. The app goes on.
    @objc public func publikTestLine(_ call: CAPPluginCall) {
        guard publikLaunchValue("PUBLIK_TEST_SIGN_IN") != nil else {
            call.reject("No publik sign-in test was requested.", "PUBLIK_NO_TEST")
            return
        }
        publikTestPrint(call.getString("line") ?? "")
        call.resolve()
    }

    /// A line for the CI log, only in a test build that was asked for the sign-in test. Never a key.
    private func publikTestPrint(_ line: String) {
        #if PUBLIK_TEST_HOOKS
        guard !line.isEmpty, publikLaunchValue("PUBLIK_TEST_SIGN_IN") != nil else { return }
        print(line)
        fflush(stdout)
        #endif
    }

    // MARK: publik in-app sheet and its wallet check
    //
    // While SFSafariViewController covers the app, the web view's JavaScript timers stop, so a
    // wallet check in the web layer cannot see the sign-in. The check runs here instead: GET /wallet
    // every 3 s on a fixed grid, for at most 10 minutes, each check with its own 8 s limit. When
    // publik says the work is done ("claimed", or a plan or pack), this closes the sheet itself and
    // tells the web layer ("publikSheet" event). It also checks at once when the app becomes active
    // and when the person closes the sheet by hand. The key goes only to publikhq.com (or, in a test
    // build, to the fake publik on this computer) and is never printed.

    private static let publikWatchInterval: TimeInterval = 3
    private static let publikWatchLimit: TimeInterval = 10 * 60
    private static let publikCheckTimeout: TimeInterval = 8

    private var publikSheet: SFSafariViewController?
    private var publikWatchTimer: DispatchSourceTimer?
    private var publikActiveObserver: NSObjectProtocol?
    private var publikWatchRun = 0
    private var publikWatchURL: URL?
    private var publikWatchKey: String?
    private var publikWatchUntil = "claimed"
    private var publikWatchEnd = Date.distantPast
    private lazy var publikWatchSession: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = Self.publikCheckTimeout
        configuration.timeoutIntervalForResource = Self.publikCheckTimeout
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.urlCache = nil
        return URLSession(configuration: configuration)
    }()

    private static func publikMillis() -> Int64 {
        Int64(Date().timeIntervalSince1970 * 1000)
    }

    /// GET /wallet goes only to publik: publikhq.com over https, or the fake publik of a test build.
    private func publikWalletURL(_ raw: String?) -> URL? {
        guard let raw, let url = URL(string: raw), let scheme = url.scheme?.lowercased(),
              let host = url.host?.lowercased(), url.path.hasSuffix("/api/v1/wallet") else { return nil }
        if scheme == "https" && host == "publikhq.com" { return url }
        #if PUBLIK_TEST_HOOKS
        if (scheme == "http" || scheme == "https") && Self.publikTestHosts.contains(host) { return url }
        #endif
        return nil
    }

    private func publikTopViewController() -> UIViewController? {
        var top = bridge?.viewController
        while let presented = top?.presentedViewController, !presented.isBeingDismissed {
            top = presented
        }
        return top
    }

    /// Opens publik's page in SFSafariViewController. With walletUrl, key and until, it also starts the wallet check.
    @objc public func publikSheetOpen(_ call: CAPPluginCall) {
        guard let raw = call.getString("url"), let url = URL(string: raw),
              let scheme = url.scheme?.lowercased(), scheme == "https" || scheme == "http" else {
            call.reject("A valid http(s) URL is required.", "INVALID_ARGUMENT")
            return
        }
        let walletURL = publikWalletURL(call.getString("walletUrl"))
        let key = call.getString("key")
        let until = call.getString("until") == "plan" ? "plan" : "claimed"
        DispatchQueue.main.async {
            let present: () -> Void = {
                guard let host = self.publikTopViewController() else {
                    call.reject("There is no screen to show the page on.", "NO_VIEW")
                    return
                }
                let sheet = SFSafariViewController(url: url)
                sheet.delegate = self
                sheet.dismissButtonStyle = .done
                sheet.modalPresentationStyle = .fullScreen
                self.publikSheet = sheet
                host.present(sheet, animated: true) {
                    self.publikTestPrint("publik sheet: opened at=\(Self.publikMillis())")
                    call.resolve()
                }
                if let walletURL, let key, key.hasPrefix("pk_") {
                    self.publikWatchStart(url: walletURL, key: key, until: until)
                } else {
                    self.publikStopWatch()
                }
            }
            // A second open replaces the first sheet.
            if let open = self.publikSheet, open.presentingViewController != nil {
                self.publikSheet = nil
                open.dismiss(animated: false, completion: present)
            } else {
                present()
            }
        }
    }

    @objc public func publikSheetClose(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let sheet = self.publikSheet, sheet.presentingViewController != nil else {
                self.publikSheet = nil
                call.resolve()
                return
            }
            self.publikSheet = nil
            sheet.dismiss(animated: true) { call.resolve() }
        }
    }

    @objc public func publikWatchStop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.publikStopWatch()
            call.resolve()
        }
    }

    private func publikWatchStart(url: URL, key: String, until: String) {
        publikStopWatch()
        publikWatchRun += 1
        let run = publikWatchRun
        publikWatchURL = url
        publikWatchKey = key
        publikWatchUntil = until
        publikWatchEnd = Date().addingTimeInterval(Self.publikWatchLimit)
        // A fixed 3-second grid: every tick starts its own check, even when an earlier one still waits.
        let timer = DispatchSource.makeTimerSource(queue: .main)
        timer.schedule(deadline: .now() + Self.publikWatchInterval, repeating: Self.publikWatchInterval, leeway: .milliseconds(100))
        timer.setEventHandler { [weak self] in self?.publikCheck(run: run) }
        timer.resume()
        publikWatchTimer = timer
        publikActiveObserver = NotificationCenter.default.addObserver(
            forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main
        ) { [weak self] _ in
            self?.publikCheck(run: run)
        }
    }

    private func publikStopWatch() {
        publikWatchRun += 1
        publikWatchTimer?.cancel()
        publikWatchTimer = nil
        if let observer = publikActiveObserver {
            NotificationCenter.default.removeObserver(observer)
        }
        publikActiveObserver = nil
        publikWatchURL = nil
        publikWatchKey = nil
    }

    /// True when the wallet shows what the sheet waits for (the same rule as walletDone in src/lib/publik.ts).
    private static func publikWalletDone(_ body: [String: Any], until: String) -> Bool {
        if until == "plan" {
            let kind = (body["plan"] as? [String: Any])?["kind"] as? String
            let balance = (body["balance_micros"] as? NSNumber)?.doubleValue ?? 0
            return kind == "plan" || kind == "pack" || balance > 0
        }
        return body["claim_state"] as? String == "claimed"
    }

    private func publikCheck(run: Int) {
        guard run == publikWatchRun, let url = publikWatchURL, let key = publikWatchKey else { return }
        if Date() >= publikWatchEnd {
            publikStopWatch()
            notifyListeners("publikSheet", data: ["state": "timeout"])
            return
        }
        publikRequest(url: url, key: key, until: publikWatchUntil) { [weak self] in self?.publikDone(run: run) }
    }

    /// One GET /wallet with its own 8 s limit; `done` runs on the main queue when the wallet shows what the wait is for.
    private func publikRequest(url: URL, key: String, until: String, done: @escaping () -> Void) {
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: Self.publikCheckTimeout)
        request.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        publikWatchSession.dataTask(with: request) { data, response, _ in
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode), let data,
                  let body = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
                  Self.publikWalletDone(body, until: until) else { return }
            DispatchQueue.main.async(execute: done)
        }.resume()
    }

    /// publik says the work is done: stop checking, close the sheet, then tell the web layer.
    private func publikDone(run: Int) {
        guard run == publikWatchRun else { return }
        publikStopWatch()
        let tell = { self.notifyListeners("publikSheet", data: ["state": "done"]) }
        guard let sheet = publikSheet, sheet.presentingViewController != nil else {
            publikSheet = nil
            tell()
            return
        }
        publikSheet = nil
        sheet.dismiss(animated: true) {
            self.publikTestPrint("publik sheet: closed by the app at=\(Self.publikMillis())")
            tell()
        }
    }

    // MARK: App Store storefront

    /// The App Store storefront country (ISO 3166-1 alpha-3, for example "USA"), or null when
    /// StoreKit has none. The web layer shows purchase links only on the US storefront
    /// (src/lib/storefront.ts). This reads no account data and makes no purchase.
    /// The simulator has no App Store account (StoreKit answers a default country there), so it
    /// counts as unknown: no purchase link.
    @objc public func appStoreStorefront(_ call: CAPPluginCall) {
        #if targetEnvironment(simulator)
        call.resolve(["countryCode": NSNull()])
        #else
        Task {
            let country = await Storefront.current?.countryCode
            call.resolve(["countryCode": country ?? NSNull()])
        }
        #endif
    }

    // MARK: Secure vault

    @objc public func secureVaultStatus(_ call: CAPPluginCall) {
        call.resolve([
            "available": true,
            "persistence": "keychain",
            "hardwareBacked": false,
            "platform": "ios"
        ])
    }

    @objc public func secureSet(_ call: CAPPluginCall) {
        guard let key = validatedKey(call.getString("key")),
              let value = call.getString("value"),
              let data = value.data(using: .utf8) else {
            call.reject("A valid key and string value are required.", "INVALID_ARGUMENT")
            return
        }

        let query = keychainQuery(key: key)
        let attributes: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        ]

        var status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            var insert = query
            attributes.forEach { insert[$0.key] = $0.value }
            status = SecItemAdd(insert as CFDictionary, nil)
        }
        #if targetEnvironment(simulator)
        if status == errSecMissingEntitlement {
            UserDefaults.standard.set(value, forKey: simulatorVaultKey(key))
            status = errSecSuccess
        }
        #endif
        guard status == errSecSuccess else {
            call.reject(keychainMessage(status), "KEYCHAIN_WRITE_FAILED")
            return
        }

        call.resolve()
    }

    @objc public func secureGet(_ call: CAPPluginCall) {
        guard let key = validatedKey(call.getString("key")) else {
            call.reject("A valid key is required.", "INVALID_ARGUMENT")
            return
        }
        readKeychainItem(key, call: call, retryWhenUnlocked: true)
    }

    /// Reads one vault item. While the phone is still locked (an app started before the first
    /// unlock, or prewarmed), the Keychain answers errSecInteractionNotAllowed: the item is
    /// there, so the read waits until protected data is available and runs once more. If it
    /// still fails, the answer is KEYCHAIN_LOCKED, which the app never treats as "no key".
    private func readKeychainItem(_ key: String, call: CAPPluginCall, retryWhenUnlocked: Bool) {
        var query = keychainQuery(key: key)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        #if targetEnvironment(simulator)
        if status == errSecMissingEntitlement {
            if let stored = UserDefaults.standard.string(forKey: simulatorVaultKey(key)) {
                call.resolve(["value": stored])
            } else {
                call.resolve(["value": NSNull()])
            }
            return
        }
        #endif
        if status == errSecItemNotFound {
            call.resolve(["value": NSNull()])
            return
        }
        if status == errSecInteractionNotAllowed {
            if retryWhenUnlocked {
                whenProtectedDataAvailable { [weak self] in
                    guard let self else {
                        call.reject("The phone is locked. Unlock it, then try again.", "KEYCHAIN_LOCKED")
                        return
                    }
                    self.readKeychainItem(key, call: call, retryWhenUnlocked: false)
                }
            } else {
                call.reject("The phone is locked. Unlock it, then try again.", "KEYCHAIN_LOCKED")
            }
            return
        }
        guard status == errSecSuccess,
              let data = result as? Data,
              let value = String(data: data, encoding: .utf8) else {
            call.reject(keychainMessage(status), "KEYCHAIN_READ_FAILED")
            return
        }

        call.resolve(["value": value])
    }

    /// Runs `work` once protected data is available: at once (after a short wait) when it is
    /// available already, else when iOS posts protectedDataDidBecomeAvailableNotification.
    private func whenProtectedDataAvailable(_ work: @escaping () -> Void) {
        DispatchQueue.main.async {
            if UIApplication.shared.isProtectedDataAvailable {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.5, execute: work)
                return
            }
            var observer: NSObjectProtocol?
            observer = NotificationCenter.default.addObserver(
                forName: UIApplication.protectedDataDidBecomeAvailableNotification,
                object: nil,
                queue: .main
            ) { _ in
                if let observer { NotificationCenter.default.removeObserver(observer) }
                work()
            }
        }
    }

    @objc public func secureDelete(_ call: CAPPluginCall) {
        guard let key = validatedKey(call.getString("key")) else {
            call.reject("A valid key is required.", "INVALID_ARGUMENT")
            return
        }

        var status = SecItemDelete(keychainQuery(key: key) as CFDictionary)
        #if targetEnvironment(simulator)
        if status == errSecMissingEntitlement {
            UserDefaults.standard.removeObject(forKey: simulatorVaultKey(key))
            status = errSecSuccess
        }
        #endif
        guard status == errSecSuccess || status == errSecItemNotFound else {
            call.reject(keychainMessage(status), "KEYCHAIN_DELETE_FAILED")
            return
        }
        call.resolve()
    }

    @objc public func secureClear(_ call: CAPPluginCall) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService
        ]
        var status = SecItemDelete(query as CFDictionary)
        #if targetEnvironment(simulator)
        if status == errSecMissingEntitlement {
            let prefix = simulatorVaultKey("")
            for name in UserDefaults.standard.dictionaryRepresentation().keys where name.hasPrefix(prefix) {
                UserDefaults.standard.removeObject(forKey: name)
            }
            status = errSecSuccess
        }
        #endif
        guard status == errSecSuccess || status == errSecItemNotFound else {
            call.reject(keychainMessage(status), "KEYCHAIN_DELETE_FAILED")
            return
        }
        call.resolve()
    }

    #if targetEnvironment(simulator)
    /// Simulator builds only; a device build never compiles this. An unsigned simulator app
    /// (the CI test build `ios-sim-app`) has no entitlements, so the Keychain answers
    /// errSecMissingEntitlement. Only then does the vault keep its values in the app's own
    /// defaults, so sign-in and own keys still work in that test build.
    private func simulatorVaultKey(_ key: String) -> String {
        "\(keychainService).simulator.\(key)"
    }
    #endif

    private func validatedKey(_ key: String?) -> String? {
        guard let key, !key.isEmpty, key.count <= 128 else { return nil }
        let allowed = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-")
        return key.unicodeScalars.allSatisfy { allowed.contains($0) } ? key : nil
    }

    private func keychainQuery(key: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: key
        ]
    }

    private func keychainMessage(_ status: OSStatus) -> String {
        (SecCopyErrorMessageString(status, nil) as String?) ?? "Keychain error \(status)."
    }

    // MARK: Biometrics

    @objc public func biometricStatus(_ call: CAPPluginCall) {
        call.resolve(biometricStatusPayload())
    }

    @objc public func authenticate(_ call: CAPPluginCall) {
        guard let reason = call.getString("reason")?.trimmingCharacters(in: .whitespacesAndNewlines),
              !reason.isEmpty else {
            call.reject("An authentication reason is required.", "INVALID_ARGUMENT")
            return
        }

        let context = LAContext()
        context.localizedCancelTitle = "Cancel"
        var evaluationError: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &evaluationError) else {
            let code = laErrorCode(evaluationError)
            call.resolve([
                "authenticated": false,
                "kind": biometricKind(context),
                "errorCode": code
            ])
            return
        }

        context.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, localizedReason: reason) {
            success, error in
            let payload: JSObject = [
                "authenticated": success,
                "kind": self.biometricKind(context),
                "errorCode": success ? NSNull() : self.laErrorCode(error as NSError?)
            ]
            DispatchQueue.main.async {
                call.resolve(payload)
            }
        }
    }

    private func biometricStatusPayload() -> JSObject {
        let context = LAContext()
        var error: NSError?
        let available = context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error)
        let code = (error?.code).flatMap(LAError.Code.init(rawValue:))

        var state = "unavailable"
        if available {
            state = "available"
        } else if code == .biometryNotEnrolled {
            state = "not-enrolled"
        } else if code == .biometryLockout {
            state = "locked-out"
        } else if code == .biometryNotAvailable {
            state = "unavailable"
        }

        return [
            "available": available,
            "enrolled": available || (code != .biometryNotEnrolled && context.biometryType != .none),
            "kind": biometricKind(context),
            "state": state,
            "reason": error?.localizedDescription ?? NSNull()
        ]
    }

    private func biometricKind(_ context: LAContext) -> String {
        switch context.biometryType {
        case .faceID:
            return "face"
        case .touchID:
            return "fingerprint"
        case .opticID:
            return "iris"
        case .none:
            return "none"
        @unknown default:
            return "none"
        }
    }

    private func laErrorCode(_ error: NSError?) -> String {
        guard let error else { return "BIOMETRIC_UNAVAILABLE" }
        switch LAError.Code(rawValue: error.code) {
        case .authenticationFailed:
            return "AUTHENTICATION_FAILED"
        case .userCancel, .appCancel, .systemCancel:
            return "USER_CANCELLED"
        case .userFallback:
            return "FALLBACK_SELECTED"
        case .biometryNotAvailable:
            return "BIOMETRIC_UNAVAILABLE"
        case .biometryNotEnrolled:
            return "NOT_ENROLLED"
        case .biometryLockout:
            return "LOCKED_OUT"
        case .passcodeNotSet:
            return "PASSCODE_NOT_SET"
        default:
            return "AUTHENTICATION_ERROR"
        }
    }

    // MARK: HealthKit

    @objc public func healthStatus(_ call: CAPPluginCall) {
        call.resolve(healthStatusPayload())
    }

    @objc public func requestHealthAccess(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.resolve(healthStatusPayload())
            return
        }

        let names = call.getArray("types", String.self) ?? supportedHealthNames
        let readTypes = Set(names.compactMap(healthType(named:)))
        guard !readTypes.isEmpty else {
            call.reject("At least one supported HealthKit data type is required.", "INVALID_ARGUMENT")
            return
        }

        // Read only: Lunara writes nothing to Apple Health, so it asks for no share types.
        healthStore.requestAuthorization(toShare: nil, read: readTypes) { success, error in
            if let error {
                DispatchQueue.main.async {
                    call.reject("HealthKit authorization could not be completed.", "HEALTH_AUTH_FAILED", error)
                }
                return
            }
            if success {
                UserDefaults.standard.set(true, forKey: self.healthRequestedKey)
            }
            DispatchQueue.main.async {
                call.resolve(self.healthStatusPayload())
            }
        }
    }

    @objc public func importHealthData(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.resolve(["samples": JSArray()])
            return
        }
        guard let startDate = parseDate(call.getString("startDate"), endOfDay: false),
              let endDate = parseDate(call.getString("endDate"), endOfDay: true),
              startDate <= endDate else {
            call.reject("Valid startDate and endDate values are required.", "INVALID_ARGUMENT")
            return
        }

        let names = call.getArray("types", String.self) ?? supportedHealthNames
        let descriptors = names.compactMap { name -> (String, HKSampleType)? in
            guard let type = healthType(named: name) else { return nil }
            return (name, type)
        }
        guard !descriptors.isEmpty else {
            call.resolve(["samples": JSArray()])
            return
        }

        let predicate = HKQuery.predicateForSamples(
            withStart: startDate,
            end: endDate,
            options: [.strictStartDate]
        )
        let group = DispatchGroup()
        let lock = NSLock()
        var imported: [JSObject] = []
        var firstError: Error?

        for (name, sampleType) in descriptors {
            group.enter()
            let query = HKSampleQuery(
                sampleType: sampleType,
                predicate: predicate,
                limit: HKObjectQueryNoLimit,
                sortDescriptors: [NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)]
            ) { _, samples, error in
                lock.lock()
                if let error, firstError == nil {
                    firstError = error
                } else if let samples {
                    imported.append(contentsOf: samples.compactMap { self.healthPayload($0, named: name) })
                }
                lock.unlock()
                group.leave()
            }
            healthStore.execute(query)
        }

        group.notify(queue: .main) {
            if let firstError {
                call.reject("HealthKit data could not be read.", "HEALTH_READ_FAILED", firstError)
                return
            }
            let sorted = imported.sorted {
                ($0["startDate"] as? String ?? "") < ($1["startDate"] as? String ?? "")
            }
            call.resolve(["samples": sorted])
        }
    }

    private var supportedHealthNames: [String] {
        ["menstrualFlow", "basalBodyTemperature", "ovulationTest", "weight", "sleep", "steps"]
    }

    private func healthStatusPayload() -> JSObject {
        let available = HKHealthStore.isHealthDataAvailable()
        return [
            "available": available,
            "platform": available ? "healthkit" : "none",
            // Apple deliberately does not reveal read authorization per type.
            "authorization": available
                ? (UserDefaults.standard.bool(forKey: healthRequestedKey) ? "requested" : "not-determined")
                : "unavailable",
            "supportedTypes": available ? supportedHealthNames : [],
            "grantedTypes": JSArray(),
            "reason": available
                ? "HealthKit keeps per-type read authorization private; an empty import may mean no records or denied access."
                : "HealthKit is not available on this device."
        ]
    }

    private func healthType(named name: String) -> HKSampleType? {
        switch name {
        case "menstrualFlow":
            return HKObjectType.categoryType(forIdentifier: .menstrualFlow)
        case "basalBodyTemperature":
            return HKObjectType.quantityType(forIdentifier: .basalBodyTemperature)
        case "ovulationTest":
            return HKObjectType.categoryType(forIdentifier: .ovulationTestResult)
        case "weight":
            return HKObjectType.quantityType(forIdentifier: .bodyMass)
        case "sleep":
            return HKObjectType.categoryType(forIdentifier: .sleepAnalysis)
        case "steps":
            return HKObjectType.quantityType(forIdentifier: .stepCount)
        default:
            return nil
        }
    }

    private func healthPayload(_ sample: HKSample, named name: String) -> JSObject? {
        var value: JSValue
        var unit: String
        var metadata: JSObject = [:]

        if let quantity = sample as? HKQuantitySample {
            switch name {
            case "basalBodyTemperature":
                value = quantity.quantity.doubleValue(for: .degreeCelsius())
                unit = "°C"
            case "weight":
                value = quantity.quantity.doubleValue(for: .gramUnit(with: .kilo))
                unit = "kg"
            case "steps":
                value = quantity.quantity.doubleValue(for: .count())
                unit = "count"
            default:
                return nil
            }
        } else if let category = sample as? HKCategorySample {
            if name == "sleep" {
                value = category.endDate.timeIntervalSince(category.startDate) / 60
                unit = "min"
            } else if name == "menstrualFlow" {
                // HKCategoryValueMenstrualFlow and its iOS 18 replacement,
                // HKCategoryValueVaginalBleeding, intentionally share 1...5.
                switch category.value {
                case 2:
                    value = "light"
                case 3:
                    value = "medium"
                case 4:
                    value = "heavy"
                default:
                    return nil
                }
                unit = "category"
                if let cycleStart = category.metadata?[HKMetadataKeyMenstrualCycleStart] as? NSNumber {
                    metadata["menstrualCycleStart"] = cycleStart.boolValue
                }
            } else if name == "ovulationTest" {
                switch category.value {
                case HKCategoryValueOvulationTestResult.negative.rawValue:
                    value = "negative"
                case HKCategoryValueOvulationTestResult.luteinizingHormoneSurge.rawValue,
                     HKCategoryValueOvulationTestResult.estrogenSurge.rawValue:
                    value = "positive"
                default:
                    return nil
                }
                unit = "category"
            } else {
                return nil
            }
        } else {
            return nil
        }

        if let wasUserEntered = sample.metadata?[HKMetadataKeyWasUserEntered] as? NSNumber {
            metadata["wasUserEntered"] = wasUserEntered.boolValue
        }

        return [
            "id": sample.uuid.uuidString,
            "type": name,
            "startDate": ISO8601DateFormatter().string(from: sample.startDate),
            "endDate": ISO8601DateFormatter().string(from: sample.endDate),
            // An ISO timestamp is UTC. Preserve the Health app's device-calendar
            // day so an evening record cannot land on the wrong tracker date.
            "localDate": localDateString(sample.startDate),
            "value": value,
            "unit": unit,
            "source": sample.sourceRevision.source.name,
            "sourceBundleIdentifier": sample.sourceRevision.source.bundleIdentifier,
            "metadata": metadata
        ]
    }

    private func localDateString(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.calendar = Calendar.autoupdatingCurrent
        formatter.timeZone = TimeZone.autoupdatingCurrent
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }

    private func parseDate(_ raw: String?, endOfDay: Bool) -> Date? {
        guard let raw else { return nil }
        if let date = ISO8601DateFormatter().date(from: raw) {
            return date
        }
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        guard let date = formatter.date(from: raw) else { return nil }
        return endOfDay
            ? Calendar.current.date(byAdding: DateComponents(day: 1, second: -1), to: date)
            : date
    }

    // MARK: Widget snapshot publishing

    @objc public func widgetStatus(_ call: CAPPluginCall) {
        call.resolve([
            "available": true,
            "publisherAvailable": true,
            "extensionInstalled": true,
            "backgroundRefreshConfigured": true,
            "platform": "ios"
        ])
    }

    @objc public func publishWidgetSnapshot(_ call: CAPPluginCall) {
        guard let snapshot = call.getObject("snapshot"),
              JSONSerialization.isValidJSONObject(snapshot) else {
            call.reject("A JSON-compatible widget snapshot is required.", "INVALID_ARGUMENT")
            return
        }

        do {
            let data = try JSONSerialization.data(withJSONObject: snapshot)
            guard let json = String(data: data, encoding: .utf8) else {
                call.reject("Widget snapshot could not be encoded.", "WIDGET_WRITE_FAILED")
                return
            }
            UserDefaults.standard.set(json, forKey: widgetSnapshotKey)
            UserDefaults(suiteName: widgetSuite)?.set(json, forKey: widgetSnapshotKey)
            WidgetCenter.shared.reloadAllTimelines()
            call.resolve()
        } catch {
            call.reject("Widget snapshot could not be encoded.", "WIDGET_WRITE_FAILED", error)
        }
    }

    @objc public func clearWidgetSnapshot(_ call: CAPPluginCall) {
        UserDefaults.standard.removeObject(forKey: widgetSnapshotKey)
        UserDefaults(suiteName: widgetSuite)?.removeObject(forKey: widgetSnapshotKey)
        WidgetCenter.shared.reloadAllTimelines()
        call.resolve()
    }
}

// MARK: SFSafariViewController: closed by hand

extension LunaraNativePlugin: SFSafariViewControllerDelegate {
    /// "Done": the sheet closes itself. One wallet check at once; then the web layer, which runs again, takes over.
    public func safariViewControllerDidFinish(_ controller: SFSafariViewController) {
        guard controller === publikSheet else { return }
        publikSheet = nil
        publikTestPrint("publik sheet: closed by hand at=\(Self.publikMillis())")
        notifyListeners("publikSheet", data: ["state": "closed"])
        guard let url = publikWatchURL, let key = publikWatchKey else { return }
        let until = publikWatchUntil
        publikStopWatch()
        publikRequest(url: url, key: key, until: until) { [weak self] in
            self?.notifyListeners("publikSheet", data: ["state": "done"])
        }
    }
}
