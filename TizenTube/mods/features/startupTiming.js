/**
 * Historical import path retained for the stable, session-relative clock
 * helper. Startup marks themselves now flow only through the opt-in bounded
 * diagnostics recorder; this module does not install listeners or log timings.
 */
export { createDiagnosticClock } from './browserDiagnostics.js';
