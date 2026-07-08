.PHONY: dev build check install install-app clean android-apk android-install

ANDROID_ENV = ANDROID_HOME=$(HOME)/Library/Android/sdk \
	NDK_HOME=$(HOME)/Library/Android/sdk/ndk/27.2.12479018 \
	JAVA_HOME=$(HOME)/.local/share/mise/installs/java/adoptopenjdk-17.0.9+9

install:
	npm install

dev:
	npx tauri dev

build:
	npx tauri build

install-app: build
	rm -rf /Applications/Keepsake.app
	ditto src-tauri/target/release/bundle/macos/Keepsake.app /Applications/Keepsake.app
	@echo "✓ Installed to /Applications/Keepsake.app"

check:
	npx vue-tsc -b && (cd src-tauri && cargo check)

# debug-signed APK for sideloading (arm64)
android-apk:
	$(ANDROID_ENV) npx tauri android build --debug --apk --target aarch64

android-install: android-apk
	$(HOME)/Library/Android/sdk/platform-tools/adb install -r "src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk"

clean:
	rm -rf dist node_modules src-tauri/target
