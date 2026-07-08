// Biometric unlock. The master password never leaves OS-protected storage
// unencrypted: macOS keeps it in the login keychain behind a
// LocalAuthentication prompt; Android encrypts it with a hardware-backed
// AndroidKeyStore AES-GCM key (ciphertext in app-private storage) while the
// fingerprint prompt itself is shown by tauri-plugin-biometric on the
// frontend before the decrypt command is invoked.

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
    use jni::objects::{JByteArray, JObject, JValue};
    use jni::{AttachGuard, JNIEnv, JavaVM};
    use std::fs;
    use std::path::Path;

    const KEY_ALIAS: &str = "keepsake-biometric";
    const GCM_IV_LEN: usize = 12;
    const GCM_TAG_BITS: i32 = 128;
    const ENCRYPT_MODE: i32 = 1;
    const DECRYPT_MODE: i32 = 2;

    pub fn available() -> bool {
        // the fingerprint prompt itself is checked on the frontend via
        // tauri-plugin-biometric; here we only need the keystore, which
        // every Android device has
        true
    }

    fn jvm() -> Result<JavaVM, String> {
        let ctx = ndk_context::android_context();
        unsafe { JavaVM::from_raw(ctx.vm().cast()) }.map_err(|e| e.to_string())
    }

    /// Map a JNI error, clearing any pending Java exception so later calls work.
    fn jerr(env: &mut JNIEnv, e: jni::errors::Error) -> String {
        if env.exception_check().unwrap_or(false) {
            let _ = env.exception_describe();
            let _ = env.exception_clear();
        }
        e.to_string()
    }

    fn get_or_create_key<'a>(env: &mut AttachGuard<'a>) -> Result<JObject<'a>, String> {
        let store_name = env.new_string("AndroidKeyStore").map_err(|e| e.to_string())?;
        let keystore = env
            .call_static_method(
                "java/security/KeyStore",
                "getInstance",
                "(Ljava/lang/String;)Ljava/security/KeyStore;",
                &[JValue::Object(&store_name)],
            )
            .and_then(|v| v.l())
            .map_err(|e| jerr(env, e))?;
        env.call_method(
            &keystore,
            "load",
            "(Ljava/security/KeyStore$LoadStoreParameter;)V",
            &[JValue::Object(&JObject::null())],
        )
        .map_err(|e| jerr(env, e))?;

        let alias = env.new_string(KEY_ALIAS).map_err(|e| e.to_string())?;
        let exists = env
            .call_method(
                &keystore,
                "containsAlias",
                "(Ljava/lang/String;)Z",
                &[JValue::Object(&alias)],
            )
            .and_then(|v| v.z())
            .map_err(|e| jerr(env, e))?;
        if exists {
            return env
                .call_method(
                    &keystore,
                    "getKey",
                    "(Ljava/lang/String;[C)Ljava/security/Key;",
                    &[JValue::Object(&alias), JValue::Object(&JObject::null())],
                )
                .and_then(|v| v.l())
                .map_err(|e| jerr(env, e));
        }

        // KeyGenerator.getInstance("AES", "AndroidKeyStore")
        let aes = env.new_string("AES").map_err(|e| e.to_string())?;
        let keygen = env
            .call_static_method(
                "javax/crypto/KeyGenerator",
                "getInstance",
                "(Ljava/lang/String;Ljava/lang/String;)Ljavax/crypto/KeyGenerator;",
                &[JValue::Object(&aes), JValue::Object(&store_name)],
            )
            .and_then(|v| v.l())
            .map_err(|e| jerr(env, e))?;

        // new KeyGenParameterSpec.Builder(alias, ENCRYPT | DECRYPT)
        //   .setBlockModes("GCM").setEncryptionPaddings("NoPadding")
        //   .setKeySize(256).build()
        let builder_cls = "android/security/keystore/KeyGenParameterSpec$Builder";
        let ret_sig = "([Ljava/lang/String;)Landroid/security/keystore/KeyGenParameterSpec$Builder;";
        let mut builder = env
            .new_object(
                builder_cls,
                "(Ljava/lang/String;I)V",
                &[JValue::Object(&alias), JValue::Int(3)],
            )
            .map_err(|e| jerr(env, e))?;
        for (method, value) in [("setBlockModes", "GCM"), ("setEncryptionPaddings", "NoPadding")] {
            let s = env.new_string(value).map_err(|e| e.to_string())?;
            let arr = env
                .new_object_array(1, "java/lang/String", &s)
                .map_err(|e| jerr(env, e))?;
            builder = env
                .call_method(&builder, method, ret_sig, &[JValue::Object(arr.as_ref())])
                .and_then(|v| v.l())
                .map_err(|e| jerr(env, e))?;
        }
        builder = env
            .call_method(
                &builder,
                "setKeySize",
                "(I)Landroid/security/keystore/KeyGenParameterSpec$Builder;",
                &[JValue::Int(256)],
            )
            .and_then(|v| v.l())
            .map_err(|e| jerr(env, e))?;
        let spec = env
            .call_method(
                &builder,
                "build",
                "()Landroid/security/keystore/KeyGenParameterSpec;",
                &[],
            )
            .and_then(|v| v.l())
            .map_err(|e| jerr(env, e))?;
        env.call_method(
            &keygen,
            "init",
            "(Ljava/security/spec/AlgorithmParameterSpec;)V",
            &[JValue::Object(&spec)],
        )
        .map_err(|e| jerr(env, e))?;
        env.call_method(&keygen, "generateKey", "()Ljavax/crypto/SecretKey;", &[])
            .and_then(|v| v.l())
            .map_err(|e| jerr(env, e))
    }

    fn cipher<'a>(env: &mut AttachGuard<'a>) -> Result<JObject<'a>, String> {
        let transform = env
            .new_string("AES/GCM/NoPadding")
            .map_err(|e| e.to_string())?;
        env.call_static_method(
            "javax/crypto/Cipher",
            "getInstance",
            "(Ljava/lang/String;)Ljavax/crypto/Cipher;",
            &[JValue::Object(&transform)],
        )
        .and_then(|v| v.l())
        .map_err(|e| jerr(env, e))
    }

    /// Encrypt with the keystore key; returns iv ++ ciphertext.
    fn encrypt(plaintext: &[u8]) -> Result<Vec<u8>, String> {
        let vm = jvm()?;
        let mut env = vm.attach_current_thread().map_err(|e| e.to_string())?;
        let key = get_or_create_key(&mut env)?;
        let cipher = cipher(&mut env)?;
        env.call_method(
            &cipher,
            "init",
            "(ILjava/security/Key;)V",
            &[JValue::Int(ENCRYPT_MODE), JValue::Object(&key)],
        )
        .map_err(|e| jerr(&mut env, e))?;
        let iv_obj = env
            .call_method(&cipher, "getIV", "()[B", &[])
            .and_then(|v| v.l())
            .map_err(|e| jerr(&mut env, e))?;
        let iv = env
            .convert_byte_array(JByteArray::from(iv_obj))
            .map_err(|e| e.to_string())?;
        if iv.len() != GCM_IV_LEN {
            return Err(format!("unexpected GCM iv length {}", iv.len()));
        }
        let input = env
            .byte_array_from_slice(plaintext)
            .map_err(|e| e.to_string())?;
        let ct_obj = env
            .call_method(&cipher, "doFinal", "([B)[B", &[JValue::Object(input.as_ref())])
            .and_then(|v| v.l())
            .map_err(|e| jerr(&mut env, e))?;
        let ct = env
            .convert_byte_array(JByteArray::from(ct_obj))
            .map_err(|e| e.to_string())?;
        let mut out = iv;
        out.extend_from_slice(&ct);
        Ok(out)
    }

    fn decrypt(blob: &[u8]) -> Result<Vec<u8>, String> {
        if blob.len() <= GCM_IV_LEN {
            return Err("stored secret is corrupt".to_string());
        }
        let (iv, ct) = blob.split_at(GCM_IV_LEN);
        let vm = jvm()?;
        let mut env = vm.attach_current_thread().map_err(|e| e.to_string())?;
        let key = get_or_create_key(&mut env)?;
        let cipher = cipher(&mut env)?;
        let iv_arr = env.byte_array_from_slice(iv).map_err(|e| e.to_string())?;
        let spec = env
            .new_object(
                "javax/crypto/spec/GCMParameterSpec",
                "(I[B)V",
                &[JValue::Int(GCM_TAG_BITS), JValue::Object(iv_arr.as_ref())],
            )
            .map_err(|e| jerr(&mut env, e))?;
        env.call_method(
            &cipher,
            "init",
            "(ILjava/security/Key;Ljava/security/spec/AlgorithmParameterSpec;)V",
            &[
                JValue::Int(DECRYPT_MODE),
                JValue::Object(&key),
                JValue::Object(&spec),
            ],
        )
        .map_err(|e| jerr(&mut env, e))?;
        let input = env.byte_array_from_slice(ct).map_err(|e| e.to_string())?;
        let pt_obj = env
            .call_method(&cipher, "doFinal", "([B)[B", &[JValue::Object(input.as_ref())])
            .and_then(|v| v.l())
            .map_err(|e| jerr(&mut env, e))?;
        env.convert_byte_array(JByteArray::from(pt_obj))
            .map_err(|e| e.to_string())
    }

    fn slot(dir: &Path, vault: &str) -> std::path::PathBuf {
        // FNV-1a: stable filename for arbitrary vault ids
        let mut h: u64 = 0xcbf29ce484222325;
        for b in vault.as_bytes() {
            h ^= u64::from(*b);
            h = h.wrapping_mul(0x100000001b3);
        }
        dir.join("biometric").join(format!("{h:016x}.bin"))
    }

    pub fn store(dir: &Path, path: &str, password: &str) -> Result<(), String> {
        let blob = encrypt(password.as_bytes())?;
        let file = slot(dir, path);
        if let Some(parent) = file.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        fs::write(file, blob).map_err(|e| e.to_string())
    }

    pub fn unlock(dir: &Path, path: &str, _file_name: &str) -> Result<String, String> {
        let blob = fs::read(slot(dir, path))
            .map_err(|_| "no stored password for this vault".to_string())?;
        let bytes = decrypt(&blob)?;
        String::from_utf8(bytes).map_err(|e| e.to_string())
    }

    pub fn forget(dir: &Path, path: &str) -> Result<(), String> {
        match fs::remove_file(slot(dir, path)) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
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
