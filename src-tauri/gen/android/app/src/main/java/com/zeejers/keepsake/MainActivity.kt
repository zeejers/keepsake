package com.zeejers.keepsake

import android.content.Context
import android.os.Bundle
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  // implemented in Rust (lib.rs); hands ndk-context the app context that
  // the keystore-backed credential store needs
  private external fun initNdkContext(context: Context)

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    initNdkContext(this.applicationContext)
  }
}
