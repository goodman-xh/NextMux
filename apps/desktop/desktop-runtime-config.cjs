'use strict';

// Scripts only from the app's own files. The page is a file: page that talks to its own backend on this computer
// (http/ws on localhost, a random port) and shows local files, generated media and site icons of links.
const localBackend = 'http://localhost:* http://127.0.0.1:*';
const strictContentSecurityPolicy = [
  "default-src 'self'",
  // Only the app's own script files: no inline or remote scripts. 'unsafe-eval' stays because Theia validates its
  // preference schemas with AJV, which compiles validators at runtime (new Function); without it the workbench
  // never starts (checked 2026-09-29 with the policy on the loaded pages).
  "script-src 'self' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: file: https: ${localBackend}`,
  `media-src 'self' data: blob: file: https: ${localBackend}`,
  "font-src 'self' data:",
  // data:/blob: — bundled WebAssembly (syntax highlighting) is fetched from data URLs.
  `connect-src 'self' data: blob: ws: wss: https: ${localBackend}`,
  "worker-src 'self' blob:",
  "child-src 'self' blob:",
  `frame-src 'self' blob: data: https: ${localBackend}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

module.exports = { strictContentSecurityPolicy };
