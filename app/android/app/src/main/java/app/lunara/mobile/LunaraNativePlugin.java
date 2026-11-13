package app.lunara.mobile;

import android.annotation.SuppressLint;
import android.annotation.TargetApi;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.hardware.biometrics.BiometricManager;
import android.hardware.biometrics.BiometricPrompt;
import android.hardware.fingerprint.FingerprintManager;
import android.health.connect.HealthConnectException;
import android.health.connect.HealthConnectManager;
import android.health.connect.HealthPermissions;
import android.health.connect.ReadRecordsRequestUsingFilters;
import android.health.connect.ReadRecordsResponse;
import android.health.connect.TimeInstantRangeFilter;
import android.health.connect.datatypes.BasalBodyTemperatureRecord;
import android.health.connect.datatypes.InstantRecord;
import android.health.connect.datatypes.IntervalRecord;
import android.health.connect.datatypes.MenstruationFlowRecord;
import android.health.connect.datatypes.OvulationTestRecord;
import android.health.connect.datatypes.Record;
import android.health.connect.datatypes.SleepSessionRecord;
import android.health.connect.datatypes.StepsRecord;
import android.health.connect.datatypes.WeightRecord;
import android.os.Build;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.os.Handler;
import android.os.Looper;
import android.os.OutcomeReceiver;
import android.util.Log;
import android.print.PrintDocumentAdapter;
import android.print.PrintJob;
import android.print.PrintManager;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyInfo;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import android.webkit.WebView;
import androidx.annotation.NonNull;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.SecureRandom;
import java.security.spec.KeySpec;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONObject;

@CapacitorPlugin(
    name = "LunaraNative",
    permissions = {
        @Permission(alias = "menstrualFlow", strings = { HealthPermissions.READ_MENSTRUATION }),
        @Permission(alias = "basalBodyTemperature", strings = { HealthPermissions.READ_BASAL_BODY_TEMPERATURE }),
        @Permission(alias = "ovulationTest", strings = { HealthPermissions.READ_OVULATION_TEST }),
        @Permission(alias = "weight", strings = { HealthPermissions.READ_WEIGHT }),
        @Permission(alias = "sleep", strings = { HealthPermissions.READ_SLEEP }),
        @Permission(alias = "steps", strings = { HealthPermissions.READ_STEPS })
    }
)
public class LunaraNativePlugin extends Plugin {

    private static final String VAULT_KEY_ALIAS = "lunara-vault-key-v1";
    private static final String VAULT_PREFERENCES = "lunara.secure.v1";
    private static final String HEALTH_PREFERENCES = "lunara.health.v1";
    private static final String HEALTH_REQUESTED_KEY = "authorization-requested";
    private static final String ANDROID_KEYSTORE = "AndroidKeyStore";
    private static final String CIPHER_TRANSFORMATION = "AES/GCM/NoPadding";
    private static final Set<String> SUPPORTED_HEALTH_TYPES = Collections.unmodifiableSet(
        new LinkedHashSet<>(
            Arrays.asList("menstrualFlow", "basalBodyTemperature", "ovulationTest", "weight", "sleep", "steps")
        )
    );
    private static final Map<String, String> HEALTH_PERMISSIONS;

    static {
        Map<String, String> permissions = new HashMap<>();
        permissions.put("menstrualFlow", HealthPermissions.READ_MENSTRUATION);
        permissions.put("basalBodyTemperature", HealthPermissions.READ_BASAL_BODY_TEMPERATURE);
        permissions.put("ovulationTest", HealthPermissions.READ_OVULATION_TEST);
        permissions.put("weight", HealthPermissions.READ_WEIGHT);
        permissions.put("sleep", HealthPermissions.READ_SLEEP);
        permissions.put("steps", HealthPermissions.READ_STEPS);
        HEALTH_PERMISSIONS = Collections.unmodifiableMap(permissions);
    }

    // publik launch options and self-test

    private static final String[] PUBLIK_LAUNCH_NAMES = {
        "PUBLIK_API_BASE_URL", "PUBLIK_SELF_TEST", "DO_NOT_TRACK", "PUBLIK_TELEMETRY", "PUBLIK_TELEMETRY_DEBUG"
    };

    /**
     * A value for the publik module (src/lib/publik.ts), from the launch intent:
     * adb shell am start -n app.lunara.mobile/.MainActivity --es PUBLIK_API_BASE_URL http://10.0.2.2:8787/api/v1
     * PUBLIK_API_BASE_URL, the test hook, works in a debuggable build only, so
     * another app cannot point a release build at a different server.
     */
    @SuppressWarnings("deprecation")
    private String publikLaunchValue(String name) {
        if ("PUBLIK_API_BASE_URL".equals(name)) {
            boolean debuggable = (getContext().getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
            if (!debuggable) return null;
        }
        Activity activity = getActivity();
        Intent intent = activity == null ? null : activity.getIntent();
        Bundle extras = intent == null ? null : intent.getExtras();
        Object raw = extras == null ? null : extras.get(name);
        String value = raw == null ? null : String.valueOf(raw).trim();
        return value == null || value.isEmpty() ? null : value;
    }

    @PluginMethod
    public void publikLaunchOptions(PluginCall call) {
        JSObject options = new JSObject();
        for (String name : PUBLIK_LAUNCH_NAMES) {
            String value = publikLaunchValue(name);
            if (value != null) options.put(name, value);
        }
        call.resolve(options);
    }

    /** PUBLIK_SELF_TEST: print the module's one line (logcat tag "publik" and stdout), then end the app. */
    @PluginMethod
    public void publikSelfTestDone(PluginCall call) {
        if (publikLaunchValue("PUBLIK_SELF_TEST") == null) {
            call.reject("No publik self-test was requested.", "PUBLIK_NO_SELF_TEST");
            return;
        }
        String line = call.getString("line", "publik self-test: failed: no result");
        Log.i("publik", line);
        System.out.println(line);
        call.resolve();
        Activity activity = getActivity();
        new Handler(Looper.getMainLooper()).postDelayed(
            () -> {
                if (activity != null) activity.finishAndRemoveTask();
                System.exit(0);
            },
            300
        );
    }

    // Report export

    @PluginMethod
    public void printReport(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("The report screen is unavailable.", "REPORT_VIEW_UNAVAILABLE");
            return;
        }

        activity.runOnUiThread(
            () -> {
                WebView webView = getBridge().getWebView();
                PrintManager printManager = (PrintManager) activity.getSystemService(Context.PRINT_SERVICE);
                if (webView == null || printManager == null) {
                    call.reject("Android printing is unavailable.", "REPORT_EXPORT_UNAVAILABLE");
                    return;
                }

                String requestedName = call.getString("jobName");
                String jobName = requestedName == null || requestedName.trim().isEmpty()
                    ? "Lunara cycle report"
                    : requestedName;

                try {
                    PrintDocumentAdapter adapter = webView.createPrintDocumentAdapter(jobName);
                    PrintJob job = printManager.print(jobName, adapter, null);
                    if (job == null) {
                        call.reject("The report export sheet could not open.", "REPORT_EXPORT_UNAVAILABLE");
                        return;
                    }
                    call.resolve();
                } catch (RuntimeException error) {
                    call.reject("The report export sheet failed.", "REPORT_EXPORT_FAILED", error);
                }
            }
        );
    }

    // Secure vault

    @PluginMethod
    public void secureVaultStatus(PluginCall call) {
        try {
            SecretKey key = getOrCreateVaultKey();
            call.resolve(
                new JSObject()
                    .put("available", true)
                    .put("persistence", "keystore")
                    .put("hardwareBacked", isHardwareBacked(key))
                    .put("platform", "android")
            );
        } catch (Exception error) {
            call.reject("Android Keystore is unavailable.", "KEYSTORE_UNAVAILABLE", error);
        }
    }

    @PluginMethod
    public void secureSet(PluginCall call) {
        String key = validatedKey(call.getString("key"));
        String value = call.getString("value");
        if (key == null || value == null) {
            call.reject("A valid key and string value are required.", "INVALID_ARGUMENT");
            return;
        }

        try {
            SecretKey secretKey = getOrCreateVaultKey();
            Cipher cipher = Cipher.getInstance(CIPHER_TRANSFORMATION);
            cipher.init(Cipher.ENCRYPT_MODE, secretKey, new SecureRandom());
            cipher.updateAAD(key.getBytes(StandardCharsets.UTF_8));
            byte[] encrypted = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
            String stored = Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP)
                + "."
                + Base64.encodeToString(encrypted, Base64.NO_WRAP);
            vaultPreferences().edit().putString(key, stored).apply();
            call.resolve();
        } catch (Exception error) {
            call.reject("Secret could not be encrypted.", "KEYSTORE_WRITE_FAILED", error);
        }
    }

    @PluginMethod
    public void secureGet(PluginCall call) {
        String key = validatedKey(call.getString("key"));
        if (key == null) {
            call.reject("A valid key is required.", "INVALID_ARGUMENT");
            return;
        }

        String stored = vaultPreferences().getString(key, null);
        if (stored == null) {
            call.resolve(new JSObject().put("value", JSONObject.NULL));
            return;
        }

        try {
            String[] parts = stored.split("\\.", 2);
            if (parts.length != 2) throw new IllegalStateException("Invalid encrypted value.");
            byte[] iv = Base64.decode(parts[0], Base64.NO_WRAP);
            byte[] encrypted = Base64.decode(parts[1], Base64.NO_WRAP);
            Cipher cipher = Cipher.getInstance(CIPHER_TRANSFORMATION);
            cipher.init(Cipher.DECRYPT_MODE, getOrCreateVaultKey(), new GCMParameterSpec(128, iv));
            cipher.updateAAD(key.getBytes(StandardCharsets.UTF_8));
            String value = new String(cipher.doFinal(encrypted), StandardCharsets.UTF_8);
            call.resolve(new JSObject().put("value", value));
        } catch (Exception error) {
            call.reject("Secret could not be decrypted.", "KEYSTORE_READ_FAILED", error);
        }
    }

    @PluginMethod
    public void secureDelete(PluginCall call) {
        String key = validatedKey(call.getString("key"));
        if (key == null) {
            call.reject("A valid key is required.", "INVALID_ARGUMENT");
            return;
        }
        vaultPreferences().edit().remove(key).apply();
        call.resolve();
    }

    @PluginMethod
    public void secureClear(PluginCall call) {
        vaultPreferences().edit().clear().apply();
        call.resolve();
    }

    private SharedPreferences vaultPreferences() {
        return getContext().getSharedPreferences(VAULT_PREFERENCES, Context.MODE_PRIVATE);
    }

    private String validatedKey(String key) {
        if (key == null || key.length() == 0 || key.length() > 128 || !key.matches("[A-Za-z0-9._-]+")) return null;
        return key;
    }

    private SecretKey getOrCreateVaultKey() throws Exception {
        KeyStore keyStore = KeyStore.getInstance(ANDROID_KEYSTORE);
        keyStore.load(null);
        if (keyStore.containsAlias(VAULT_KEY_ALIAS)) {
            return (SecretKey) keyStore.getKey(VAULT_KEY_ALIAS, null);
        }

        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE);
        generator.init(
            new KeyGenParameterSpec.Builder(
                VAULT_KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true)
                .build()
        );
        return generator.generateKey();
    }

    private boolean isHardwareBacked(SecretKey key) {
        try {
            SecretKeyFactory factory = SecretKeyFactory.getInstance(key.getAlgorithm(), ANDROID_KEYSTORE);
            KeySpec spec = factory.getKeySpec(key, KeyInfo.class);
            return spec instanceof KeyInfo && ((KeyInfo) spec).isInsideSecureHardware();
        } catch (Exception ignored) {
            return false;
        }
    }

    // Biometrics

    @PluginMethod
    public void biometricStatus(PluginCall call) {
        call.resolve(buildBiometricStatus());
    }

    @PluginMethod
    public void authenticate(PluginCall call) {
        String reason = call.getString("reason");
        if (reason == null || reason.trim().isEmpty()) {
            call.reject("An authentication reason is required.", "INVALID_ARGUMENT");
            return;
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) {
            call.resolve(
                new JSObject().put("authenticated", false).put("kind", "none").put("errorCode", "UNSUPPORTED")
            );
            return;
        }

        getActivity().runOnUiThread(() -> showBiometricPrompt(call, reason.trim()));
    }

    private JSObject buildBiometricStatus() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) {
            return new JSObject()
                .put("available", false)
                .put("enrolled", false)
                .put("kind", "none")
                .put("state", "unsupported")
                .put("reason", "BiometricPrompt requires Android 9 or newer.");
        }

        int result;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            BiometricManager manager = getContext().getSystemService(BiometricManager.class);
            result = manager == null ? BiometricManager.BIOMETRIC_ERROR_HW_UNAVAILABLE : manager.canAuthenticate();
        } else {
            FingerprintManager manager = (FingerprintManager) getContext().getSystemService(Context.FINGERPRINT_SERVICE);
            if (manager == null || !manager.isHardwareDetected()) {
                result = BiometricManager.BIOMETRIC_ERROR_NO_HARDWARE;
            } else if (!manager.hasEnrolledFingerprints()) {
                result = BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED;
            } else {
                result = BiometricManager.BIOMETRIC_SUCCESS;
            }
        }

        String state = "unavailable";
        if (result == BiometricManager.BIOMETRIC_SUCCESS) state = "available";
        else if (result == BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED) state = "not-enrolled";

        return new JSObject()
            .put("available", result == BiometricManager.BIOMETRIC_SUCCESS)
            .put("enrolled", result == BiometricManager.BIOMETRIC_SUCCESS)
            .put("kind", biometricKind())
            .put("state", state)
            .put("reason", biometricReason(result));
    }

    private void showBiometricPrompt(PluginCall call, String reason) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) {
            call.resolve(
                new JSObject().put("authenticated", false).put("kind", "none").put("errorCode", "UNSUPPORTED")
            );
            return;
        }

        final AtomicBoolean completed = new AtomicBoolean(false);
        final java.util.concurrent.Executor executor = ContextCompat.getMainExecutor(getContext());
        BiometricPrompt.Builder builder = new BiometricPrompt.Builder(getActivity())
            .setTitle("Unlock Lunara")
            .setDescription(reason)
            .setNegativeButton("Cancel", executor, (dialog, which) -> {
                if (completed.compareAndSet(false, true)) {
                    call.resolve(
                        new JSObject()
                            .put("authenticated", false)
                            .put("kind", biometricKind())
                            .put("errorCode", "USER_CANCELLED")
                    );
                }
            });

        BiometricPrompt prompt = builder.build();
        prompt.authenticate(
            new CancellationSignal(),
            executor,
            new BiometricPrompt.AuthenticationCallback() {
                @Override
                public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) {
                    if (completed.compareAndSet(false, true)) {
                        call.resolve(
                            new JSObject().put("authenticated", true).put("kind", biometricKind())
                        );
                    }
                }

                @Override
                public void onAuthenticationError(int errorCode, CharSequence errString) {
                    if (completed.compareAndSet(false, true)) {
                        call.resolve(
                            new JSObject()
                                .put("authenticated", false)
                                .put("kind", biometricKind())
                                .put("errorCode", biometricErrorCode(errorCode))
                        );
                    }
                }
            }
        );
    }

    private String biometricKind() {
        PackageManager packageManager = getContext().getPackageManager();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q &&
            packageManager.hasSystemFeature(PackageManager.FEATURE_FACE)) {
            return "face";
        }
        if (packageManager.hasSystemFeature(PackageManager.FEATURE_FINGERPRINT)) {
            return "fingerprint";
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q &&
            packageManager.hasSystemFeature(PackageManager.FEATURE_IRIS)) {
            return "iris";
        }
        return "biometric-or-device-credential";
    }

    private String biometricReason(int result) {
        if (result == BiometricManager.BIOMETRIC_SUCCESS) return "";
        if (result == BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED) return "No biometric credential is enrolled.";
        if (result == BiometricManager.BIOMETRIC_ERROR_NO_HARDWARE) return "This device has no biometric hardware.";
        if (result == BiometricManager.BIOMETRIC_ERROR_HW_UNAVAILABLE) return "Biometric hardware is temporarily unavailable.";
        return "Biometric authentication is unavailable.";
    }

    private String biometricErrorCode(int code) {
        if (code == BiometricPrompt.BIOMETRIC_ERROR_USER_CANCELED ||
            code == BiometricPrompt.BIOMETRIC_ERROR_CANCELED) return "USER_CANCELLED";
        if (code == BiometricPrompt.BIOMETRIC_ERROR_NO_BIOMETRICS) return "NOT_ENROLLED";
        if (code == BiometricPrompt.BIOMETRIC_ERROR_LOCKOUT ||
            code == BiometricPrompt.BIOMETRIC_ERROR_LOCKOUT_PERMANENT) return "LOCKED_OUT";
        if (code == BiometricPrompt.BIOMETRIC_ERROR_NO_DEVICE_CREDENTIAL) return "PASSCODE_NOT_SET";
        if (code == BiometricPrompt.BIOMETRIC_ERROR_HW_NOT_PRESENT ||
            code == BiometricPrompt.BIOMETRIC_ERROR_HW_UNAVAILABLE) return "BIOMETRIC_UNAVAILABLE";
        return "AUTHENTICATION_FAILED";
    }

    // Health Connect

    @PluginMethod
    public void healthStatus(PluginCall call) {
        call.resolve(buildHealthStatus());
    }

    @PluginMethod
    public void requestHealthAccess(PluginCall call) {
        if (!healthConnectAvailable()) {
            call.resolve(buildHealthStatus());
            return;
        }

        List<String> requested = requestedHealthTypes(call);
        if (requested.isEmpty()) {
            call.reject("At least one supported Health Connect data type is required.", "INVALID_ARGUMENT");
            return;
        }
        getContext().getSharedPreferences(HEALTH_PREFERENCES, Context.MODE_PRIVATE)
            .edit()
            .putBoolean(HEALTH_REQUESTED_KEY, true)
            .apply();
        requestPermissionForAliases(requested.toArray(new String[0]), call, "healthPermissionCallback");
    }

    @PermissionCallback
    private void healthPermissionCallback(PluginCall call) {
        call.resolve(buildHealthStatus());
    }

    @PluginMethod
    @SuppressLint("NewApi") // HealthApi34 is loaded only after the Android 14 availability check.
    public void importHealthData(PluginCall call) {
        if (!healthConnectAvailable()) {
            call.resolve(new JSObject().put("samples", new JSArray()));
            return;
        }

        List<String> requested = requestedHealthTypes(call);
        if (requested.isEmpty()) {
            call.resolve(new JSObject().put("samples", new JSArray()));
            return;
        }
        for (String type : requested) {
            String permission = HEALTH_PERMISSIONS.get(type);
            if (permission == null || ContextCompat.checkSelfPermission(getContext(), permission) != PackageManager.PERMISSION_GRANTED) {
                call.reject("Health Connect permission is required for " + type + ".", "HEALTH_PERMISSION_REQUIRED");
                return;
            }
        }

        HealthApi34.read(
            getContext(),
            requested,
            call.getString("startDate"),
            call.getString("endDate"),
            call
        );
    }

    private JSObject buildHealthStatus() {
        boolean available = healthConnectAvailable();
        JSArray supported = new JSArray();
        JSArray granted = new JSArray();
        if (available) {
            for (String type : SUPPORTED_HEALTH_TYPES) {
                supported.put(type);
                String permission = HEALTH_PERMISSIONS.get(type);
                if (permission != null &&
                    ContextCompat.checkSelfPermission(getContext(), permission) == PackageManager.PERMISSION_GRANTED) {
                    granted.put(type);
                }
            }
        }

        boolean requested = getContext().getSharedPreferences(HEALTH_PREFERENCES, Context.MODE_PRIVATE)
            .getBoolean(HEALTH_REQUESTED_KEY, false);
        String authorization = "unavailable";
        if (available && granted.length() == SUPPORTED_HEALTH_TYPES.size()) authorization = "granted";
        else if (available && granted.length() > 0) authorization = "partial";
        else if (available && requested) authorization = "denied";
        else if (available) authorization = "not-determined";

        String reason;
        if (available) reason = "";
        else if (Build.VERSION.SDK_INT < 34) {
            reason = "This native bridge uses the platform Health Connect API available on Android 14 and newer.";
        } else {
            reason = "Health Connect is not available on this device.";
        }

        return new JSObject()
            .put("available", available)
            .put("platform", available ? "health-connect" : "none")
            .put("authorization", authorization)
            .put("supportedTypes", supported)
            .put("grantedTypes", granted)
            .put("reason", reason);
    }

    private List<String> requestedHealthTypes(PluginCall call) {
        JSArray array = call.getArray("types");
        if (array == null || array.length() == 0) return new ArrayList<>(SUPPORTED_HEALTH_TYPES);
        List<String> requested = new ArrayList<>();
        for (int index = 0; index < array.length(); index++) {
            String type = array.optString(index, "");
            if (SUPPORTED_HEALTH_TYPES.contains(type) && !requested.contains(type)) requested.add(type);
        }
        return requested;
    }

    private boolean healthConnectAvailable() {
        // Keep Health Connect classes isolated from Android 13 and older.
        return Build.VERSION.SDK_INT >= 34 && HealthApi34.isAvailable(getContext());
    }

    // Widgets

    @PluginMethod
    public void widgetStatus(PluginCall call) {
        android.appwidget.AppWidgetManager manager = android.appwidget.AppWidgetManager.getInstance(getContext());
        int configuredWidgets = manager.getAppWidgetIds(
            new android.content.ComponentName(getContext(), LunaraCycleWidgetProvider.class)
        ).length;
        call.resolve(
            new JSObject()
                .put("available", true)
                .put("publisherAvailable", true)
                .put("extensionInstalled", true)
                .put("backgroundRefreshConfigured", true)
                .put("configuredWidgets", configuredWidgets)
                .put("platform", "android")
        );
    }

    @PluginMethod
    public void publishWidgetSnapshot(PluginCall call) {
        JSObject snapshot = call.getObject("snapshot");
        if (snapshot == null) {
            call.reject("A JSON-compatible widget snapshot is required.", "INVALID_ARGUMENT");
            return;
        }
        WidgetSnapshotStore.save(
            getContext(),
            new WidgetSnapshotStore.JSCompatibleSnapshot(snapshot.toString())
        );
        getContext().sendBroadcast(
            new Intent(WidgetSnapshotStore.REFRESH_ACTION).setPackage(getContext().getPackageName())
        );
        call.resolve();
    }

    @PluginMethod
    public void clearWidgetSnapshot(PluginCall call) {
        WidgetSnapshotStore.clear(getContext());
        getContext().sendBroadcast(
            new Intent(WidgetSnapshotStore.REFRESH_ACTION).setPackage(getContext().getPackageName())
        );
        call.resolve();
    }

    private static final class HealthApi34 {
        private HealthApi34() {}

        @TargetApi(34)
        static boolean isAvailable(Context context) {
            return context.getSystemService(HealthConnectManager.class) != null;
        }

        @TargetApi(34)
        static void read(
            Context context,
            List<String> types,
            String rawStart,
            String rawEnd,
            PluginCall call
        ) {
            Instant start;
            Instant end;
            try {
                start = parseInstant(rawStart, false);
                end = parseInstant(rawEnd, true);
            } catch (Exception error) {
                call.reject("Valid startDate and endDate values are required.", "INVALID_ARGUMENT", error);
                return;
            }
            if (start.isAfter(end)) {
                call.reject("Health import start date must be before its end date.", "INVALID_ARGUMENT");
                return;
            }

            HealthConnectManager manager = context.getSystemService(HealthConnectManager.class);
            if (manager == null) {
                call.resolve(new JSObject().put("samples", new JSArray()));
                return;
            }

            TimeInstantRangeFilter filter = new TimeInstantRangeFilter.Builder()
                .setStartTime(start)
                .setEndTime(end)
                .build();
            List<JSObject> samples = Collections.synchronizedList(new ArrayList<>());
            AtomicInteger remaining = new AtomicInteger(types.size());
            AtomicBoolean finished = new AtomicBoolean(false);

            for (String type : types) {
                Class<? extends Record> recordClass = recordClass(type);
                if (recordClass == null) {
                    completeOne(call, samples, remaining, finished);
                    continue;
                }
                readOne(manager, context, recordClass, type, filter, call, samples, remaining, finished);
            }
        }

        @TargetApi(34)
        private static Instant parseInstant(String raw, boolean endOfDay) {
            if (raw == null || raw.trim().isEmpty()) {
                throw new IllegalArgumentException("Missing date.");
            }
            try {
                return Instant.parse(raw);
            } catch (Exception ignored) {
                LocalDate date = LocalDate.parse(raw);
                if (endOfDay) {
                    return date.plusDays(1)
                        .atStartOfDay(ZoneId.systemDefault())
                        .toInstant()
                        .minusMillis(1);
                }
                return date.atStartOfDay(ZoneId.systemDefault()).toInstant();
            }
        }

        @TargetApi(34)
        private static Class<? extends Record> recordClass(String type) {
            switch (type) {
                case "menstrualFlow":
                    return MenstruationFlowRecord.class;
                case "basalBodyTemperature":
                    return BasalBodyTemperatureRecord.class;
                case "ovulationTest":
                    return OvulationTestRecord.class;
                case "weight":
                    return WeightRecord.class;
                case "sleep":
                    return SleepSessionRecord.class;
                case "steps":
                    return StepsRecord.class;
                default:
                    return null;
            }
        }

        @TargetApi(34)
        private static <T extends Record> void readOne(
            HealthConnectManager manager,
            Context context,
            Class<T> recordClass,
            String type,
            TimeInstantRangeFilter filter,
            PluginCall call,
            List<JSObject> samples,
            AtomicInteger remaining,
            AtomicBoolean finished
        ) {
            ReadRecordsRequestUsingFilters<T> request = new ReadRecordsRequestUsingFilters.Builder<>(recordClass)
                .setTimeRangeFilter(filter)
                .setAscending(true)
                .setPageSize(1000)
                .build();
            manager.readRecords(
                request,
                ContextCompat.getMainExecutor(context),
                new OutcomeReceiver<ReadRecordsResponse<T>, HealthConnectException>() {
                    @Override
                    public void onResult(ReadRecordsResponse<T> result) {
                        for (T record : result.getRecords()) {
                            JSObject payload = recordPayload(record, type);
                            if (payload != null) samples.add(payload);
                        }
                        completeOne(call, samples, remaining, finished);
                    }

                    @Override
                    public void onError(@NonNull HealthConnectException error) {
                        if (finished.compareAndSet(false, true)) {
                            call.reject("Health Connect data could not be read.", "HEALTH_READ_FAILED", error);
                        }
                    }
                }
            );
        }

        private static void completeOne(
            PluginCall call,
            List<JSObject> samples,
            AtomicInteger remaining,
            AtomicBoolean finished
        ) {
            if (remaining.decrementAndGet() != 0 || !finished.compareAndSet(false, true)) return;
            samples.sort((left, right) -> left.optString("startDate", "").compareTo(right.optString("startDate", "")));
            JSArray resultSamples = new JSArray();
            for (JSObject sample : samples) resultSamples.put(sample);
            call.resolve(new JSObject().put("samples", resultSamples));
        }

        @TargetApi(34)
        private static JSObject recordPayload(Record record, String type) {
            Instant start;
            Instant end;
            if (record instanceof InstantRecord) {
                start = ((InstantRecord) record).getTime();
                end = start;
            } else if (record instanceof IntervalRecord) {
                start = ((IntervalRecord) record).getStartTime();
                end = ((IntervalRecord) record).getEndTime();
            } else {
                return null;
            }

            Object value;
            String unit;
            if (record instanceof MenstruationFlowRecord) {
                value = HealthValueNormalizer.menstrualFlow(
                    ((MenstruationFlowRecord) record).getFlow()
                );
                if (value == null) return null;
                unit = "category";
            } else if (record instanceof BasalBodyTemperatureRecord) {
                value = ((BasalBodyTemperatureRecord) record).getTemperature().getInCelsius();
                unit = "°C";
            } else if (record instanceof OvulationTestRecord) {
                value = HealthValueNormalizer.ovulationTest(
                    ((OvulationTestRecord) record).getResult()
                );
                if (value == null) return null;
                unit = "category";
            } else if (record instanceof WeightRecord) {
                value = ((WeightRecord) record).getWeight().getInGrams() / 1000d;
                unit = "kg";
            } else if (record instanceof SleepSessionRecord) {
                value = (end.toEpochMilli() - start.toEpochMilli()) / 60000d;
                unit = "min";
            } else if (record instanceof StepsRecord) {
                value = ((StepsRecord) record).getCount();
                unit = "count";
            } else {
                return null;
            }

            String source = record.getMetadata().getDataOrigin().getPackageName();
            return new JSObject()
                .put("id", record.getMetadata().getId())
                .put("type", type)
                .put("startDate", start.toString())
                .put("endDate", end.toString())
                .put("value", value)
                .put("unit", unit)
                .put("source", source);
        }
    }
}
