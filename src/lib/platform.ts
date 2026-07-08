export const isMac = navigator.userAgent.includes('Mac')

/** Key labels for shortcut hints, matching each platform's conventions. */
export const modKey = isMac ? '⌘' : 'Ctrl'
export const shiftKey = isMac ? '⇧' : 'Shift'
export const deleteKey = isMac ? '⌫' : 'Del'
