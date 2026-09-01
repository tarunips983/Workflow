/* OfficeFlow first-party database/auth client. */
(() => {
  const tokenKey = 'officeflow.session';
  const fallbackKey = 'officeflow.browserFallback.v1';

  const readFallback = () => JSON.parse(localStorage.getItem(fallbackKey) || '{"users":[],"tables":{}}');
  const writeFallback = data => localStorage.setItem(fallbackKey, JSON.stringify(data));
  const randomId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const now = () => new Date().toISOString();
  const enc = value => new TextEncoder().encode(value);
  const b64 = value => btoa(JSON.stringify(value));
  const fromB64 = value => JSON.parse(atob(value));

  const jsonHeaders = () => {
    const headers = { 'Content-Type': 'application/json' };
    const token = localStorage.getItem(tokenKey);
    if (token && !token.startsWith('browser.')) headers.Authorization = `Bearer ${token}`;
    return headers;
  };

  async function digest(value) {
    const hash = await crypto.subtle.digest('SHA-256', enc(value));
    return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
  }

  async function parse(res) {
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { data: null, error: { message: body.error || 'Request failed', status: res.status } };
    return { data: body.data ?? body, error: null };
  }

  const publicUser = user => ({ id: user.id, email: user.email, user_metadata: user.user_metadata || {} });
  const browserSession = user => ({ session: { access_token: `browser.${b64({ sub: user.id, email: user.email })}`, user: publicUser(user) }, user: publicUser(user) });

  function match(row, filter) {
    if (filter.op === 'eq') return String(row[filter.key] ?? '') === String(filter.value ?? '');
    if (filter.op === 'is') return (row[filter.key] ?? null) === filter.value;
    if (filter.op === 'or') {
      return String(filter.value).split(',').some(part => {
        const found = part.match(/^([\w_]+)\.eq\.(.+)$/);
        return found && String(row[found[1]] ?? '') === String(found[2]);
      });
    }
    return true;
  }

  function fallbackUserFromToken() {
    const token = localStorage.getItem(tokenKey);
    if (!token?.startsWith('browser.')) return null;
    const payload = fromB64(token.slice('browser.'.length));
    return readFallback().users.find(user => user.id === payload.sub) || null;
  }

  function fallbackTable(table, action, payload, filters, sort, max) {
    const db = readFallback();
    db.tables[table] ||= [];
    let rows = db.tables[table];
    if (action === 'insert') {
      const items = Array.isArray(payload) ? payload : [payload];
      const inserted = items.map(item => ({ id: randomId(), created_at: now(), updated_at: now(), ...item }));
      db.tables[table].push(...inserted);
      writeFallback(db);
      return Array.isArray(payload) ? inserted : inserted[0];
    }
    rows = rows.filter(row => filters.every(filter => match(row, filter)));
    if (action === 'update') {
      const changedIds = new Set(rows.map(row => row.id));
      db.tables[table] = db.tables[table].map(row => changedIds.has(row.id) ? { ...row, ...payload, updated_at: now() } : row);
      writeFallback(db);
      return db.tables[table].filter(row => changedIds.has(row.id));
    }
    if (action === 'delete') {
      const removeIds = new Set(rows.map(row => row.id));
      db.tables[table] = db.tables[table].filter(row => !removeIds.has(row.id));
      writeFallback(db);
      return { deleted: removeIds.size };
    }
    if (sort) rows.sort((a, b) => (a[sort.key] > b[sort.key] ? 1 : -1) * (sort.ascending ? 1 : -1));
    return max ? rows.slice(0, max) : rows;
  }

  class Query {
    constructor(table, action = 'select', payload = null) {
      this.table = table;
      this.action = action;
      this.payload = payload;
      this.filters = [];
      this.sort = null;
      this.max = null;
      this.singleMode = false;
      this.maybe = false;
      this.columns = '*';
    }
    select(cols = '*') { this.columns = cols; return this; }
    insert(payload) { return new Query(this.table, 'insert', payload); }
    update(payload) { return new Query(this.table, 'update', payload); }
    delete() { return new Query(this.table, 'delete'); }
    eq(k, v) { this.filters.push({ op: 'eq', key: k, value: v }); return this; }
    is(k, v) { this.filters.push({ op: 'is', key: k, value: v }); return this; }
    or(expr) { this.filters.push({ op: 'or', value: expr }); return this; }
    order(k, opt = {}) { this.sort = { key: k, ascending: opt.ascending !== false }; return this; }
    limit(n) { this.max = n; return this; }
    single() { this.singleMode = true; return this; }
    maybeSingle() { this.singleMode = true; this.maybe = true; return this; }
    then(resolve, reject) { return this.exec().then(resolve, reject); }
    async exec() {
      const usingBrowserSession = !!fallbackUserFromToken();
      let out;
      if (!usingBrowserSession) {
        const method = this.action === 'select' ? 'GET' : this.action === 'insert' ? 'POST' : this.action === 'update' ? 'PATCH' : 'DELETE';
        const params = new URLSearchParams();
        if (this.filters.length) params.set('filters', JSON.stringify(this.filters));
        if (this.sort) params.set('order', JSON.stringify(this.sort));
        if (this.max) params.set('limit', String(this.max));
        if (this.columns) params.set('select', this.columns);
        const url = `/api/tables/${encodeURIComponent(this.table)}${params.toString() ? `?${params}` : ''}`;
        out = await parse(await fetch(url, { method, headers: jsonHeaders(), body: method === 'GET' ? undefined : JSON.stringify({ data: this.payload }) }));
      }
      if (usingBrowserSession || out?.error?.status === 401 || out?.error?.status === 404 || out?.error?.status === 500) {
        out = { data: fallbackTable(this.table, this.action, this.payload, this.filters, this.sort, this.max), error: null };
      }
      if (!out.error && this.singleMode) {
        const row = Array.isArray(out.data) ? out.data[0] : out.data;
        out.data = row || null;
        if (!row && !this.maybe) out.error = { message: 'No row returned' };
      }
      return out;
    }
  }

  function createClient() {
    const authListeners = [];
    return {
      from: table => new Query(table),
      auth: {
        async signInWithPassword(credentials) {
          const email = String(credentials.email || '').trim().toLowerCase();
          const password = credentials.password || '';
          let out = await parse(await fetch('/api/auth/login', { method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ email, password }) }));
          if (out.error) {
            const user = readFallback().users.find(item => item.email === email && item.password_hash === undefined);
            const secureUser = readFallback().users.find(item => item.email === email);
            if (secureUser && secureUser.password_hash === await digest(`${secureUser.password_salt}:${password}`)) {
              out = { data: browserSession(secureUser), error: null };
            } else if (user) {
              out = { data: browserSession(user), error: null };
            }
          }
          if (!out.error && out.data?.session?.access_token) localStorage.setItem(tokenKey, out.data.session.access_token);
          return out;
        },
        async signUp({ email, password, options = {} }) {
          const normalizedEmail = String(email || '').trim().toLowerCase();
          const out = await parse(await fetch('/api/auth/register', { method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ email: normalizedEmail, password, profile: options.data || {} }) }));
          const db = readFallback();
          if (!db.users.some(user => user.email === normalizedEmail)) {
            const id = out.data?.user?.id || randomId();
            const salt = randomId();
            const user = { id, email: normalizedEmail, password_salt: salt, password_hash: await digest(`${salt}:${password}`), user_metadata: options.data || {} };
            db.users.push(user);
            db.tables.profiles ||= [];
            db.tables.profiles.push({ id, email: normalizedEmail, full_name: options.data?.full_name || normalizedEmail.split('@')[0], employee_code: options.data?.employee_code || null, department: options.data?.department || '', designation: options.data?.designation || '', role: db.users.length === 1 ? 'admin' : 'employee', created_at: now(), updated_at: now() });
            writeFallback(db);
          }
          if (!out.error && out.data?.session?.access_token) localStorage.setItem(tokenKey, out.data.session.access_token);
          if (out.error && out.error.status >= 500) {
            const user = readFallback().users.find(item => item.email === normalizedEmail);
            const local = { data: browserSession(user), error: null };
            localStorage.setItem(tokenKey, local.data.session.access_token);
            return local;
          }
          return out;
        },
        async getSession() {
          const token = localStorage.getItem(tokenKey);
          if (!token) return { data: { session: null }, error: null };
          const fallbackUser = fallbackUserFromToken();
          if (fallbackUser) return { data: browserSession(fallbackUser), error: null };
          const out = await parse(await fetch('/api/auth/session', { headers: jsonHeaders() }));
          if (out.error) localStorage.removeItem(tokenKey);
          return out.error ? { data: { session: null }, error: out.error } : out;
        },
        async signOut() { localStorage.removeItem(tokenKey); authListeners.forEach(fn => fn('SIGNED_OUT', null)); return { error: null }; },
        onAuthStateChange(fn) { authListeners.push(fn); return { data: { subscription: { unsubscribe() {} } } }; },
        async resetPasswordForEmail(email) { return parse(await fetch('/api/auth/password-reset', { method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ email }) })); }
      },
      storage: { from: bucket => ({
        async upload(key, file) { return parse(await fetch(`/api/storage/${bucket}?path=${encodeURIComponent(key)}`, { method: 'POST', headers: { Authorization: `Bearer ${localStorage.getItem(tokenKey) || ''}`, 'Content-Type': file.type || 'application/octet-stream' }, body: file })); },
        async createSignedUrl(key) { return parse(await fetch(`/api/storage/${bucket}/signed-url?path=${encodeURIComponent(key)}`, { headers: jsonHeaders() })); },
        async remove(keys) { return parse(await fetch(`/api/storage/${bucket}`, { method: 'DELETE', headers: jsonHeaders(), body: JSON.stringify({ keys }) })); }
      }) }
    };
  }
  window.officeflow = { createClient };
})();
