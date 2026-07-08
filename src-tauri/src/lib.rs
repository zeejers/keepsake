mod biometric;

/// Initialize the ndk-context crate's global VM + application context.
/// android-native-keyring-store needs it, and Tauri no longer initializes
/// it for us; MainActivity.onCreate calls this before any keyring use.
#[cfg(target_os = "android")]
#[allow(non_snake_case)]
#[no_mangle]
pub extern "system" fn Java_com_zeejers_keepsake_MainActivity_initNdkContext(
  env: jni::JNIEnv,
  _this: jni::objects::JObject,
  context: jni::objects::JObject,
) {
  use jni::objects::GlobalRef;
  use std::ffi::c_void;
  use std::sync::OnceLock;
  static CONTEXT: OnceLock<Option<GlobalRef>> = OnceLock::new();
  CONTEXT.get_or_init(|| match env.new_global_ref(&context) {
    Ok(global) => {
      let vm = env.get_java_vm().expect("JNIEnv without a JavaVM");
      let vm = vm.get_java_vm_pointer() as *mut c_void;
      unsafe {
        ndk_context::initialize_android_context(vm, global.as_obj().as_raw() as _);
      }
      Some(global)
    }
    Err(e) => {
      log::error!("could not take a global ref to the Android context: {e}");
      None
    }
  });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let builder = tauri::Builder::default();
  #[cfg(mobile)]
  let builder = builder.plugin(tauri_plugin_biometric::init());
  builder
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_clipboard_manager::init())
    .invoke_handler(tauri::generate_handler![
      biometric::biometric_available,
      biometric::biometric_store,
      biometric::biometric_unlock,
      biometric::biometric_forget,
    ])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
