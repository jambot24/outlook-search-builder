// Cloudflare Turnstile, loaded on first use and run on demand before each protected request.

const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
const TIMEOUT_MS = 60000;

let loading = null;
let widgetId = null;
let pending = null;

function load() {
  if (globalThis.turnstile) return Promise.resolve();
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = SCRIPT_URL;
      s.async = true;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Could not load the "verify you are human" check.'));
      document.head.appendChild(s);
    });
  }
  return loading;
}

export function isConfigured(config) {
  return typeof config?.turnstileSiteKey === 'string' && config.turnstileSiteKey.length > 0;
}

// Resolves with a single-use token. The widget only shows itself if Cloudflare needs an interaction.
export async function getToken(config, container) {
  await load();
  if (widgetId === null) {
    widgetId = globalThis.turnstile.render(container, {
      sitekey: config.turnstileSiteKey,
      execution: 'execute',
      appearance: 'interaction-only',
      callback: (token) => pending?.resolve(token),
      'error-callback': () => pending?.reject(new Error('The "verify you are human" check failed. Try again.')),
      'expired-callback': () => globalThis.turnstile.reset(widgetId),
    });
  } else {
    globalThis.turnstile.reset(widgetId);
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('The "verify you are human" check timed out.')), TIMEOUT_MS);
    pending = {
      resolve: (t) => { clearTimeout(timer); pending = null; resolve(t); },
      reject: (e) => { clearTimeout(timer); pending = null; reject(e); },
    };
    globalThis.turnstile.execute(widgetId);
  });
}
