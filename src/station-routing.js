const stationRoles = {Cashier: 'cashier', Manager: 'manager'};

export function stationRoleFromPath(pathname) {
  return Object.keys(stationRoles).find(role => pathname === '/' + stationRoles[role]) || '';
}

export function liloanWorkflowPath({role, branch, pathname, config}) {
  const name = stationRoles[role];
  if (!name || branch !== 'Liloan' || pathname !== '/' + name) return null;
  if (config?.mode !== 'live' || config.launch?.ready === false) return null;
  return '/pilot/' + name;
}

async function routingRequest(request, path) {
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      request(path, {cache: 'no-store', signal: controller.signal}),
      new Promise((_, reject) => { timer = setTimeout(() => {
        controller.abort();
        reject(new Error('The station login check timed out. Please try again.'));
      }, 15000); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export function cachedCashierBranch(storage) {
  try {
    const cached = JSON.parse(storage.getItem('fueltech-cashier-session-v1') || 'null');
    return Number(cached?.expiresAt) > Date.now() ? cached.branch || '' : '';
  } catch {
    return '';
  }
}

export async function readStationSession(role, request = fetch) {
  const response = await routingRequest(request, '/api/auth/station-session');
  if (response.status === 401 || response.status === 403) return null;
  if (!response.ok) throw new Error('Unable to check your station login. Please try again.');
  const value = await response.json();
  return value.ok && value.role === role && value.branch && Number(value.expiresAt) > Date.now() ? value : null;
}

export async function redirectLiloanLogin(role, branch, {pathname = window.location.pathname, request = fetch, navigate = path => window.location.replace(path)} = {}) {
  if (!stationRoles[role] || branch !== 'Liloan' || stationRoleFromPath(pathname) !== role) return false;
  const response = await routingRequest(request, '/api/pilot/config');
  if (!response.ok) throw new Error('Unable to check the Liloan workflow. Please try again.');
  const path = liloanWorkflowPath({role, branch, pathname, config: await response.json()});
  if (!path) return false;
  navigate(path);
  return true;
}
