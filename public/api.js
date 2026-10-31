export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

let onUnauthorized = () => {};
export function setUnauthorizedHandler(handler) {
  onUnauthorized = handler;
}

async function request(path, { method = 'GET', json, blob } = {}) {
  const init = { method };
  if (json !== undefined) {
    init.headers = { 'content-type': 'application/json' };
    init.body = JSON.stringify(json);
  }
  if (blob) {
    init.headers = { 'content-type': 'image/jpeg' };
    init.body = blob;
  }

  let response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new ApiError(0, 'Serveur injoignable. Vérifie ton Wi-Fi.');
  }
  if (response.status === 204) return null;
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401 && path !== '/api/login') onUnauthorized();
    throw new ApiError(response.status, data?.message ?? 'Erreur du serveur.');
  }
  return data;
}

export const login = (pin) => request('/api/login', { method: 'POST', json: { pin } });
export const scan = (blob) => request('/api/scan', { method: 'POST', blob });
export const retryScan = (id) => request(`/api/scan/${id}/retry`, { method: 'POST' });
export const listPendingScans = () => request('/api/scans?status=pending');
export const searchCards = (name, lang) => request(`/api/cards/search?${new URLSearchParams({ name, lang })}`);
export const getCard = (id, lang) => request(`/api/cards/${encodeURIComponent(id)}?lang=${lang}`);
export const addToCollection = (body) => request('/api/collection', { method: 'POST', json: body });
export const updateRow = (id, patch) => request(`/api/collection/${id}`, { method: 'PATCH', json: patch });
export const deleteRow = (id) => request(`/api/collection/${id}`, { method: 'DELETE' });
export const getCollection = (params) => request(`/api/collection?${new URLSearchParams(params)}`);
export const refreshAllPrices = () => request('/api/prices/refresh', { method: 'POST' });
export const refreshCardPrice = (id, lang) => request('/api/prices/refresh', { method: 'POST', json: { id, lang } });
export const getSettings = () => request('/api/settings');
export const saveSettings = (settings) => request('/api/settings', { method: 'PUT', json: settings });
