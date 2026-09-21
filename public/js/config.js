// Public site configuration. Nothing here is a secret.
window.OSB_CONFIG = {
  // Application (client) ID of the Entra app registration behind "Sign in with Microsoft".
  // Every single-page app ships this to the browser. Must match MSAL_CLIENT_ID in wrangler.toml.
  // Empty hides sign-in, folder loading, sharing and voting.
  msalClientId: '',
  // Cloudflare Turnstile site key (public). The matching secret key is a Pages secret.
  // Empty switches community sharing off.
  turnstileSiteKey: '',
  repoUrl: 'https://github.com/jambot24/outlook-search-builder',
  // Empty hides the link.
  coffeeUrl: 'https://buymeacoffee.com/kevinspellman',
};
