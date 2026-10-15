// Parse JSON without running the YTArk JSON.parse response hook.
//
// The hook in features/adblock.js rewrites YouTube responses as they are parsed
// by the app. Code that needs to read and rewrite a response body itself (the
// DeArrow response boundary) must parse it without triggering that hook a second
// time, otherwise the hook would run twice on the same payload.

let suppressed = 0;

export function parseWithoutHooks(text) {
  suppressed++;
  try {
    return JSON.parse(text);
  } finally {
    suppressed--;
  }
}

export function jsonHooksSuppressed() {
  return suppressed > 0;
}
