// Touch ID unlock: the master password is stored in the login keychain
// (scoped to this app by the OS), and retrieval is gated behind a
// LocalAuthentication prompt (biometry with device-password fallback).

#[cfg(target_os = "macos")]
mod imp {
    use block2::RcBlock;
    use objc2::runtime::Bool;
    use objc2_foundation::{NSError, NSString};
    use objc2_local_authentication::{LAContext, LAPolicy};
    use security_framework::passwords::{
        delete_generic_password, get_generic_password, set_generic_password,
    };
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

    pub fn store(path: &str, password: &str) -> Result<(), String> {
        set_generic_password(SERVICE, path, password.as_bytes()).map_err(|e| e.to_string())
    }

    pub fn unlock(path: &str, file_name: &str) -> Result<String, String> {
        authenticate(&format!("unlock \u{201c}{file_name}\u{201d}"))?;
        let bytes = get_generic_password(SERVICE, path).map_err(|e| e.to_string())?;
        String::from_utf8(bytes).map_err(|e| e.to_string())
    }

    pub fn forget(path: &str) -> Result<(), String> {
        match delete_generic_password(SERVICE, path) {
            Ok(()) => Ok(()),
            // already gone is fine
            Err(e) if e.code() == -25300 => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    }
}

#[cfg(not(target_os = "macos"))]
mod imp {
    pub fn available() -> bool {
        false
    }
    pub fn store(_path: &str, _password: &str) -> Result<(), String> {
        Err("biometric unlock is not supported on this platform".to_string())
    }
    pub fn unlock(_path: &str, _file_name: &str) -> Result<String, String> {
        Err("biometric unlock is not supported on this platform".to_string())
    }
    pub fn forget(_path: &str) -> Result<(), String> {
        Ok(())
    }
}

#[tauri::command]
pub async fn biometric_available() -> bool {
    tauri::async_runtime::spawn_blocking(imp::available)
        .await
        .unwrap_or(false)
}

#[tauri::command]
pub async fn biometric_store(path: String, password: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || imp::store(&path, &password))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn biometric_unlock(path: String, file_name: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || imp::unlock(&path, &file_name))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn biometric_forget(path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || imp::forget(&path))
        .await
        .map_err(|e| e.to_string())?
}
