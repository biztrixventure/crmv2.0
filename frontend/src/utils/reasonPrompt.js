// ============================================================================
// reasonPrompt -- "please say why" for changes the server wants explained.
//
// Some HR / Accounting changes need a reason on record (pay, correcting
// someone else's attendance, deleting something). The server answers those
// with 400 { needs_reason: true } instead of guessing. api/client.js catches
// that, calls askReason(), and resends the SAME request with change_reason
// attached -- so no page has to know which of its buttons need a reason.
//
// The dialog itself is <ReasonPromptHost/>, mounted once by each shell that
// can reach those endpoints. With no host mounted askReason() resolves null
// and the original error surfaces unchanged.
// ============================================================================
let host = null;

export function registerReasonHost(fn) {
  host = fn;
  return () => { if (host === fn) host = null; };
}

export function askReason(message) {
  return host ? host(message) : Promise.resolve(null);
}
