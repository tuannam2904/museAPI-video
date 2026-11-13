const TOKEN_KEY = 'muse_studio_token';

export const getToken = () => localStorage.getItem(TOKEN_KEY) || '';
export const setToken = (t) => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY));

async function request(path, { method = 'GET', body, form } = {}) {
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (form) {
    payload = form;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(path, { method, headers, body: payload });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) {
    const msg = data?.error || data?.detail || `Yêu cầu thất bại (${res.status})`;
    const err = new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export const api = {
  register: (b) => request('/api/auth/register', { method: 'POST', body: b }),
  login: (b) => request('/api/auth/login', { method: 'POST', body: b }),
  invite: () => request('/api/auth/invite'),
  me: () => request('/api/auth/me'),
  updateMe: (b) => request('/api/auth/me', { method: 'PATCH', body: b }),

  meta: () => request('/api/meta'),

  accounts: () => request('/api/accounts'),
  refreshQuota: (accountId) => request('/api/accounts/quota', { method: 'POST', body: { accountId } }),
  importAccount: (b) => request('/api/accounts', { method: 'POST', body: b }),
  bindCode: (label) => request('/api/accounts/bind-code', { method: 'POST', body: { label } }),
  bindStatus: (code) => request(`/api/accounts/bind/${code}`),
  testAccount: (id) => request(`/api/accounts/${id}/test`, { method: 'POST' }),
  keepaliveAccount: (id) => request(`/api/accounts/${id}/keepalive`, { method: 'POST' }),
  updateAccountProxy: (id, proxy) => request(`/api/accounts/${id}/proxy`, { method: 'PATCH', body: { proxy } }),
  deleteAccount: (id) => request(`/api/accounts/${id}`, { method: 'DELETE' }),
  setPromptWriter: (id) => request(`/api/accounts/${id}/prompt-writer`, { method: 'POST' }),
  clearPromptWriter: (id) => request(`/api/accounts/${id}/prompt-writer`, { method: 'DELETE' }),

  createVideo: (b) => request('/api/videos', { method: 'POST', body: b }),
  createImage: (b) => request('/api/images', { method: 'POST', body: b }),
  jobs: (q = {}) => {
    const s = new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined && v !== null && v !== ''));
    return request(`/api/jobs?${s.toString()}`);
  },
  job: (id) => request(`/api/jobs/${id}`),
  deleteJob: (id) => request(`/api/jobs/${id}`, { method: 'DELETE' }),
  mediaStats: () => request('/api/media-stats'),

  listCanvas: () => request('/api/canvas'),
  createCanvas: (title) => request('/api/canvas', { method: 'POST', body: { title } }),
  getCanvas: (id) => request(`/api/canvas/${id}`),
  saveCanvas: (id, doc) => request(`/api/canvas/${id}`, { method: 'PUT', body: { doc } }),
  renameCanvas: (id, title) => request(`/api/canvas/${id}`, { method: 'PATCH', body: { title } }),
  deleteCanvas: (id) => request(`/api/canvas/${id}`, { method: 'DELETE' }),

  upload: (files) => {
    const fd = new FormData();
    for (const f of files) fd.append('files', f);
    return request('/api/upload', { method: 'POST', form: fd });
  },

  adminOverview: () => request('/api/admin/overview'),
  adminUsers: (params) => {
    const p = typeof params === 'string' ? { q: params } : (params || {});
    const qs = new URLSearchParams();
    if (p.q) qs.set('q', p.q);
    if (p.role) qs.set('role', p.role);
    if (p.status) qs.set('status', p.status);
    if (p.sort) qs.set('sort', p.sort);
    const s = qs.toString();
    return request(`/api/admin/users${s ? `?${s}` : ''}`);
  },
  adminUserDetail: (id) => request(`/api/admin/users/${id}`),
  adminDeleteUser: (id) => request(`/api/admin/users/${id}`, { method: 'DELETE' }),
  adminResetPassword: (id, password) => request(`/api/admin/users/${id}/reset-password`, { method: 'POST', body: { password } }),
  adminSetLimits: (id, limits) => request(`/api/admin/users/${id}/limits`, { method: 'PATCH', body: limits }),
  adminAudit: (limit) => request(`/api/admin/audit?limit=${limit || 100}`),
  adminPatchUser: (id, b) => request(`/api/admin/users/${id}`, { method: 'PATCH', body: b }),
  adminCreateUser: (b) => request('/api/admin/users', { method: 'POST', body: b }),
  adminMediaStats: () => request('/api/admin/media-stats'),
  adminMediaCleanup: () => request('/api/admin/media-cleanup', { method: 'POST' }),
  adminSettings: () => request('/api/admin/settings'),
  adminSaveSettings: (b) => request('/api/admin/settings', { method: 'PATCH', body: b }),
  updateAdminSettings: (b) => request('/api/admin/settings', { method: 'PATCH', body: b }),

  vipStatus: () => request('/api/vip/status'),
  createVipOrder: (plan) => request('/api/vip/order', { method: 'POST', body: { plan } }),
  vipOrders: () => request('/api/vip/orders'),
  vipOrder: (id) => request(`/api/vip/order/${id}`),
  cancelVipOrder: (id) => request(`/api/vip/order/${id}/cancel`, { method: 'POST' }),
  adminVipOrders: () => request('/api/admin/vip/orders'),
  adminGrantVip: (userId, days) => request('/api/admin/vip/grant', { method: 'POST', body: { userId, days } }),
  adminRevokeVip: (userId) => request('/api/admin/vip/revoke', { method: 'POST', body: { userId } }),
  adminConfirmVipOrder: (id) => request(`/api/admin/vip/orders/${id}/confirm`, { method: 'POST' }),
  adminVipAccounts: () => request('/api/admin/accounts'),
  setVipAccount: (id, vip) => request(`/api/admin/accounts/${id}/vip`, { method: 'PATCH', body: { vip } }),
  adminSystem: () => request('/api/admin/system'),
  adminKeepalive: () => request('/api/admin/keepalive', { method: 'POST' }),
  adminOrders: (kind) => request(`/api/admin/orders${kind ? `?kind=${kind}` : ''}`),
  adminPosts: () => request('/api/admin/posts'),
  adminDeletePost: (id) => request(`/api/admin/posts/${id}`, { method: 'DELETE' }),
  adminTrend: () => request('/api/admin/trend'),

  keys: () => request('/api/keys'),
  createKey: (name) => request('/api/keys', { method: 'POST', body: { name } }),
  deleteKey: (id) => request(`/api/keys/${id}`, { method: 'DELETE' }),

  queue: () => request('/api/queue'),
  addQueue: (b) => request('/api/queue', { method: 'POST', body: b }),
  patchQueue: (id, b) => request(`/api/queue/${id}`, { method: 'PATCH', body: b }),
  moveQueue: (id, dir) => request(`/api/queue/${id}/move`, { method: 'POST', body: { dir } }),
  deleteQueue: (id) => request(`/api/queue/${id}`, { method: 'DELETE' }),
  clearQueueDone: () => request('/api/queue/done', { method: 'DELETE' }),
  clearQueueAll: () => request('/api/queue', { method: 'DELETE' }),

  team: () => request('/api/team'),
  joinTeam: (code) => request('/api/team/join', { method: 'POST', body: { code } }),

  chatModels: () => request('/api/chat/models'),
  chat: (b) => request('/api/chat', { method: 'POST', body: b }),
  analyzeImage: (b) => request('/api/analyze-image', { method: 'POST', body: b }),
  prompts: () => request('/api/prompts'),

  films: () => request('/api/films'),
  createFilm: (b) => request('/api/films', { method: 'POST', body: b }),
  film: (id) => request(`/api/films/${id}`),
  patchFilm: (id, b) => request(`/api/films/${id}`, { method: 'PATCH', body: b }),
  deleteFilm: (id) => request(`/api/films/${id}`, { method: 'DELETE' }),
  filmScript: (id) => request(`/api/films/${id}/script`, { method: 'POST' }),
  filmStoryboard: (id) => request(`/api/films/${id}/storyboard`, { method: 'POST' }),
  addFilmScene: (id, b) => request(`/api/films/${id}/scenes`, { method: 'POST', body: b }),
  patchFilmScene: (id, sceneId, b) => request(`/api/films/${id}/scenes/${sceneId}`, { method: 'PATCH', body: b }),
  deleteFilmScene: (id, sceneId) => request(`/api/films/${id}/scenes/${sceneId}`, { method: 'DELETE' }),
  filmSceneImage: (id, sceneId) => request(`/api/films/${id}/scenes/${sceneId}/image`, { method: 'POST' }),
  filmSceneVideo: (id, sceneId) => request(`/api/films/${id}/scenes/${sceneId}/video`, { method: 'POST' }),
  filmSceneRetry: (id, sceneId) => request(`/api/films/${id}/scenes/${sceneId}/retry`, { method: 'POST' }),
  filmGenerateAll: (id) => request(`/api/films/${id}/generate-all`, { method: 'POST' }),
  filmStitch: (id) => request(`/api/films/${id}/stitch`, { method: 'POST' }),
  filmCharacters: (id) => request(`/api/films/${id}/characters`),
  addFilmCharacter: (id, b) => request(`/api/films/${id}/characters`, { method: 'POST', body: b }),
  patchFilmCharacter: (id, charId, b) => request(`/api/films/${id}/characters/${charId}`, { method: 'PATCH', body: b }),
  deleteFilmCharacter: (id, charId) => request(`/api/films/${id}/characters/${charId}`, { method: 'DELETE' }),
  filmCharacterPortrait: (id, charId) => request(`/api/films/${id}/characters/${charId}/portrait`, { method: 'POST' }),

  membership: () => request('/api/membership'),
  subscribe: (plan) => request('/api/membership', { method: 'POST', body: { plan } }),
  recharge: (amount) => request('/api/recharge', { method: 'POST', body: { amount } }),
  orders: () => request('/api/recharge/orders'),

  posts: (q = {}) => {
    const s = new URLSearchParams(Object.entries(q).filter(([, v]) => v));
    return request(`/api/posts?${s.toString()}`);
  },
  createPost: (b) => request('/api/posts', { method: 'POST', body: b }),
  likePost: (id) => request(`/api/posts/${id}/like`, { method: 'POST' }),
  replies: (id) => request(`/api/posts/${id}/replies`),
  replyPost: (id, content) => request(`/api/posts/${id}/replies`, { method: 'POST', body: { content } }),
};

export const fmtTime = (ts) => {
  if (!ts) return '—';
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

export const fmtAgo = (ts) => {
  if (!ts) return '—';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'Vừa xong';
  if (s < 3600) return `${Math.floor(s / 60)} phút trước`;
  if (s < 86400) return `${Math.floor(s / 3600)} giờ trước`;
  return `${Math.floor(s / 86400)} ngày trước`;
};

export const fmtBytes = (n) => {
  if (!n) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
};
