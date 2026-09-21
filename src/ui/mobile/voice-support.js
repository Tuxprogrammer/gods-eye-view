/** Pure helpers for the mobile Voice FAB/page (unit-tested, no DOM). */

/**
 * Can this page start a microphone session? getUserMedia needs a secure
 * context (https or localhost); LAN http exposes no navigator.mediaDevices.
 * @returns {{ok: boolean, reason: 'insecure'|'no-media'|'no-webrtc'|null, message: string}}
 */
export function voiceSupport(win = globalThis) {
  const nav = win.navigator;
  if (win.isSecureContext === false || !nav?.mediaDevices) {
    return {
      ok: false,
      reason: win.isSecureContext === false ? 'insecure' : 'no-media',
      message:
        win.isSecureContext === false
          ? 'Voice needs a secure connection (https:// or localhost). This page was opened over plain http, so the browser blocks the microphone. Open the https address instead.'
          : 'This browser does not expose a microphone API.',
    };
  }
  if (!win.RTCPeerConnection) {
    return {
      ok: false,
      reason: 'no-webrtc',
      message: 'This browser does not support WebRTC, which voice needs.',
    };
  }
  return { ok: true, reason: null, message: '' };
}

/** Short FAB accessible name for a voice status. */
export function fabLabel(status, support = { ok: true }) {
  if (!support.ok) return 'Voice unavailable - tap for details';
  switch (status) {
    case 'connecting':
      return 'Voice connecting - tap to cancel';
    case 'listening':
    case 'executing':
      return 'Voice on - tap to stop';
    case 'error':
      return 'Voice error - tap to retry, hold for details';
    default:
      return 'Voice off - tap to start, hold for details';
  }
}

/** Human status word for the Voice page. */
export function statusWord(status) {
  return (
    {
      idle: 'Off',
      connecting: 'Connecting',
      listening: 'Listening',
      executing: 'Working',
      error: 'Error',
    }[status] || 'Off'
  );
}

/** True while a session is live or starting (button should read Stop). */
export function isSessionBusy(status) {
  return (
    status === 'connecting' || status === 'listening' || status === 'executing'
  );
}
