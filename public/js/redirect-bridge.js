// Kept in its own file so the Content-Security-Policy can forbid inline scripts.
globalThis.msalRedirectBridge.broadcastResponseToMainFrame().catch((err) => {
  document.body.textContent = `Sign-in failed: ${err.message}`;
});
