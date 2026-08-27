/* OfficeFlow first-party database/auth client. */
(() => {
  const tokenKey = 'officeflow.session';
  const jsonHeaders = () => {
    const headers = { 'Content-Type': 'application/json' };
    const token = localStorage.getItem(tokenKey);
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
  };
  async function parse(res) {
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { data: null, error: { message: body.error || 'Request failed' } };
    return { data: body.data ?? body, error: null };
  }
  class Query {
    constructor(table, action = 'select', payload = null) { this.table = table; this.action = action; this.payload = payload; this.filters = []; this.sort = null; this.max = null; this.singleMode = false; this.maybe = false; this.columns = '*'; }
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
      const method = this.action === 'select' ? 'GET' : this.action === 'insert' ? 'POST' : this.action === 'update' ? 'PATCH' : 'DELETE';
      const params = new URLSearchParams();
      if (this.filters.length) params.set('filters', JSON.stringify(this.filters));
      if (this.sort) params.set('order', JSON.stringify(this.sort));
      if (this.max) params.set('limit', String(this.max));
      if (this.columns) params.set('select', this.columns);
      let url = `/api/tables/${encodeURIComponent(this.table)}${params.toString() ? `?${params}` : ''}`;
      const res = await fetch(url, { method, headers: jsonHeaders(), body: method === 'GET' ? undefined : JSON.stringify({ data: this.payload }) });
      const out = await parse(res);
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
          const out = await parse(await fetch('/api/auth/login', { method: 'POST', headers: jsonHeaders(), body: JSON.stringify(credentials) }));
          if (!out.error && out.data?.session?.access_token) localStorage.setItem(tokenKey, out.data.session.access_token);
          return out;
        },
        async signUp({ email, password, options = {} }) {
          const out = await parse(await fetch('/api/auth/register', { method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ email, password, profile: options.data || {} }) }));
          if (!out.error && out.data?.session?.access_token) localStorage.setItem(tokenKey, out.data.session.access_token);
          return out;
        },
        async getSession() {
          const token = localStorage.getItem(tokenKey);
          if (!token) return { data: { session: null }, error: null };
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
