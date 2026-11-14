import Capacitor
import Foundation
import HealthKit
import LocalAuthentication
import Security
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
        CAPPluginMethod(name: "publikSelfTestDone", returnType: CAPPluginReturnPromise)
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
        "PUBLIK_API_BASE_URL", "PUBLIK_SELF_TEST", "DO_NOT_TRACK", "PUBLIK_TELEMETRY", "PUBLIK_TELEMETRY_DEBUG"
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
        if name == "PUBLIK_API_BASE_URL" || name == "PUBLIK_SELF_TEST" { return nil }
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

        healthStore.requestAuthorization(toShare: [], read: readTypes) { success, error in
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
