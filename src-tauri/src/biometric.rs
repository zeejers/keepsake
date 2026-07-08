// Biometric unlock. The master password never leaves OS-protected storage
// unencrypted: macOS keeps it in the login keychain behind a
// LocalAuthentication prompt; Android stores it via
// android-native-keyring-store (SharedPreferences encrypted with a
// hardware-backed AndroidKeyStore key) while the fingerprint prompt itself
// is shown by tauri-plugin-biometric on the frontend before the read
// command is invoked.

use std::path::PathBuf;

#[cfg(target_os = "macos")]
mod imp {
    use block2::RcBlock;
    use objc2::runtime::Bool;
    use objc2_foundation::{NSError, NSString};
    use objc2_local_authentication::{LAContext, LAPolicy};
    use security_framework::passwords::{
        delete_generic_password, get_generic_password, set_generic_password,
    };
    use std::path::Path;
    use std::sync::mpsc;

    const SERVICE: &str = "com.zeejers.keepsake";

    pub fn available() -> bool {
        unsafe {
            let ctx = LAContext::new();
            ctx.canEvaluatePolicy_error(LAPolicy::DeviceOwnerAuthenticationWithBiometrics)
                .is_ok()
        }
    }

    fn authenticate(reason: &str) -> Result<(), String> {
        let (tx, rx) = mpsc::channel::<Result<(), String>>();
        unsafe {
            let ctx = LAContext::new();
            let reason_ns = NSString::from_str(reason);
            let block = RcBlock::new(move |success: Bool, error: *mut NSError| {
                let result = if success.as_bool() {
                    Ok(())
                } else if error.is_null() {
                    Err("authentication failed".to_string())
                } else {
                    Err((*error).localizedDescription().to_string())
                };
                let _ = tx.send(result);
            });
            // biometry first, automatic fallback to the account password
            ctx.evaluatePolicy_localizedReason_reply(
                LAPolicy::DeviceOwnerAuthentication,
                &reason_ns,
                &block,
            );
            rx.recv().map_err(|e| e.to_string())?
        }
    }

    pub fn store(_dir: &Path, path: &str, password: &str) -> Result<(), String> {
        set_generic_password(SERVICE, path, password.as_bytes()).map_err(|e| e.to_string())
    }

    pub fn unlock(_dir: &Path, path: &str, file_name: &str) -> Result<String, String> {
        authenticate(&format!("unlock \u{201c}{file_name}\u{201d}"))?;
        let bytes = get_generic_password(SERVICE, path).map_err(|e| e.to_string())?;
        String::from_utf8(bytes).map_err(|e| e.to_string())
    }

    pub fn forget(_dir: &Path, path: &str) -> Result<(), String> {
        match delete_generic_password(SERVICE, path) {
            Ok(()) => Ok(()),
            // already gone is fine
            Err(e) if e.code() == -25300 => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    }
}

#[cfg(target_os = "android")]
mod imp {
    use std::path::Path;
    use std::sync::OnceLock;

    const SERVICE: &str = "com.zeejers.keepsake";

    /// One-time setup of the SharedPreferences+Keystore-backed store.
    /// Requires the ndk context, which MainActivity.initNdkContext provides
    /// at startup (Tauri itself no longer initializes it).
    fn ensure_store() -> Result<(), String> {
        static STORE: OnceLock<Result<(), String>> = OnceLock::new();
        STORE
            .get_or_init(|| {
                let store = android_native_keyring_store::Store::new()
                    .map_err(|e| format!("keystore init: {e}"))?;
                keyring_core::set_default_store(store);
                Ok(())
            })
            .clone()
    }

    fn entry(path: &str) -> Result<keyring_core::Entry, String> {
        ensure_store()?;
        keyring_core::Entry::new(SERVICE, path).map_err(|e| e.to_string())
    }

    pub fn available() -> bool {
        ensure_store().is_ok()
    }

    pub fn store(_dir: &Path, path: &str, password: &str) -> Result<(), String> {
        entry(path)?
            .set_password(password)
            .map_err(|e| e.to_string())
    }

    pub fn unlock(_dir: &Path, path: &str, _file_name: &str) -> Result<String, String> {
        entry(path)?.get_password().map_err(|e| e.to_string())
    }

    pub fn forget(_dir: &Path, path: &str) -> Result<(), String> {
        match entry(path)?.delete_credential() {
            Ok(()) => Ok(()),
            Err(keyring_core::Error::NoEntry) => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    }
}

#[cfg(not(any(target_os = "macos", target_os = "android")))]
mod imp {
    use std::path::Path;

    pub fn available() -> bool {
        false
    }
    pub fn store(_dir: &Path, _path: &str, _password: &str) -> Result<(), String> {
        Err("biometric unlock is not supported on this platform".to_string())
    }
    pub fn unlock(_dir: &Path, _path: &str, _file_name: &str) -> Result<String, String> {
        Err("biometric unlock is not supported on this platform".to_string())
    }
    pub fn forget(_dir: &Path, _path: &str) -> Result<(), String> {
        Ok(())
    }
}

fn data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    use tauri::Manager;
    app.path().app_data_dir().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn biometric_available() -> bool {
    tauri::async_runtime::spawn_blocking(imp::available)
        .await
        .unwrap_or(false)
}

#[tauri::command]
pub async fn biometric_store(
    app: tauri::AppHandle,
    path: String,
    password: String,
) -> Result<(), String> {
    let dir = data_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || imp::store(&dir, &path, &password))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn biometric_unlock(
    app: tauri::AppHandle,
    path: String,
    file_name: String,
) -> Result<String, String> {
    let dir = data_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || imp::unlock(&dir, &path, &file_name))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn biometric_forget(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let dir = data_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || imp::forget(&dir, &path))
        .await
        .map_err(|e| e.to_string())?
}
