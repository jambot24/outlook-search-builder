// Optional Microsoft sign-in: identifies users who share and vote, and can list their mail folders.
// MSAL is loaded on demand so visitors who never sign in never download it.

const MSAL_VERSION = '5.22.0';
const MSAL_URL = `https://cdn.jsdelivr.net/npm/@azure/msal-browser@${MSAL_VERSION}/lib/msal-browser.min.js`;
const MSAL_SRI = 'sha384-0xw/kzSK+WLDaLIkXwqFOXYqCnxt2agAhE5d3NN2ynU8GW5pry4+6dDtv4U2Fhkx';
// Signing in asks only for identity. Mail.ReadBasic, the least-privileged scope that can list
// mail folders (it cannot read bodies or attachments), is requested only when folders are loaded,
// so tenants that block user consent to mail access can still sign in to share and vote.
const SIGN_IN_SCOPES = ['openid', 'profile'];
const FOLDER_SCOPES = ['Mail.ReadBasic'];
const GRAPH = 'https://graph.microsoft.com/v1.0';
const MAX_FOLDERS = 500;
const MAX_DEPTH = 4;

let pca = null;

export function isConfigured(config) {
  return typeof config?.msalClientId === 'string' && /^[0-9a-f-]{36}$/i.test(config.msalClientId);
}

async function loadMsal() {
  if (globalThis.msal) return globalThis.msal;
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = MSAL_URL;
    s.integrity = MSAL_SRI;
    s.crossOrigin = 'anonymous';
    s.onload = resolve;
    s.onerror = () => reject(new Error('Could not load the Microsoft sign-in library.'));
    document.head.appendChild(s);
  });
  return globalThis.msal;
}

async function getClient(config) {
  if (pca) return pca;
  const msal = await loadMsal();
  pca = new msal.PublicClientApplication({
    auth: {
      clientId: config.msalClientId,
      // "common" accepts both work/school and personal Microsoft accounts.
      authority: 'https://login.microsoftonline.com/common',
      redirectUri: new URL('auth/redirect.html', location.href).href,
    },
    cache: { cacheLocation: 'sessionStorage' },
  });
  await pca.initialize();
  return pca;
}

export async function currentAccount(config) {
  if (!isConfigured(config)) return null;
  // Avoid loading MSAL for visitors with no session.
  const hasSession = Object.keys(sessionStorage).some((k) => k.startsWith('msal.'));
  if (!hasSession) return null;
  const client = await getClient(config);
  return client.getAllAccounts()[0] || null;
}

export async function signIn(config) {
  const client = await getClient(config);
  const result = await client.loginPopup({ scopes: SIGN_IN_SCOPES, prompt: 'select_account' });
  return result.account;
}

export async function signOut(config) {
  const client = await getClient(config);
  const account = client.getAllAccounts()[0];
  if (account) await client.clearCache({ account });
}

async function getToken(config) {
  const client = await getClient(config);
  const account = client.getAllAccounts()[0];
  if (!account) throw new Error('Not signed in.');
  try {
    return (await client.acquireTokenSilent({ scopes: FOLDER_SCOPES, account })).accessToken;
  } catch {
    return (await client.acquireTokenPopup({ scopes: FOLDER_SCOPES, account })).accessToken;
  }
}

// ID token for this site's own API. The server verifies its signature, audience and issuer.
export async function getIdToken(config, { forceRefresh = false } = {}) {
  const client = await getClient(config);
  const account = client.getAllAccounts()[0];
  if (!account) throw new Error('Sign in with Microsoft first.');
  try {
    return (await client.acquireTokenSilent({ scopes: SIGN_IN_SCOPES, account, forceRefresh })).idToken;
  } catch {
    return (await client.acquireTokenPopup({ scopes: SIGN_IN_SCOPES, account })).idToken;
  }
}

async function graphGet(token, url) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Microsoft Graph returned ${res.status} while listing folders.`);
  return res.json();
}

async function listLevel(token, url) {
  const out = [];
  let next = url;
  while (next && out.length < MAX_FOLDERS) {
    const page = await graphGet(token, next);
    out.push(...(page.value || []));
    next = page['@odata.nextLink'];
  }
  return out;
}

// Returns [{ id, name, path }] in tree order, e.g. path "Inbox / Clients / Contoso".
export async function listFolders(config) {
  const token = await getToken(config);
  const select = '$select=id,displayName,childFolderCount&$top=100';
  const result = [];

  async function walk(url, parentPath, depth) {
    const folders = await listLevel(token, url);
    for (const f of folders) {
      if (result.length >= MAX_FOLDERS) return;
      const path = parentPath ? `${parentPath} / ${f.displayName}` : f.displayName;
      result.push({ id: f.id, name: f.displayName, path });
      if (f.childFolderCount > 0 && depth < MAX_DEPTH) {
        await walk(`${GRAPH}/me/mailFolders/${encodeURIComponent(f.id)}/childFolders?${select}`, path, depth + 1);
      }
    }
  }

  await walk(`${GRAPH}/me/mailFolders?${select}`, '', 1);
  return result;
}
