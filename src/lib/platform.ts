export const isMac = navigator.userAgent.includes('Mac')
export const isAndroid = navigator.userAgent.includes('Android')

/** What the platform calls its biometric unlock, for UI copy. */
export const bioName = isMac ? 'Touch ID' : 'Biometrics'

/** Key labels for shortcut hints, matching each platform's conventions. */
export const modKey = isMac ? '⌘' : 'Ctrl'
export const shiftKey = isMac ? '⇧' : 'Shift'
export const deleteKey = isMac ? '⌫' : 'Del'
