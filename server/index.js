/* Quely Sales Enablement — one app, two doors.
 *
 *   /dashboard   internal surface, requires auth (shared team password)
 *   /v/:token    prospect surface, no login — the unguessable token IS the key
 *
 * One shared SQLite database (server/db.js) backs both. Prospect actions on
 * /v/:token show up on /dashboard via polling. Rep gets an email (server/email.js)
 * on a prospect's first view and on every question.
 */
'use strict';

require('dotenv').config();

const path = require('path');
const express = require('express');
const session = require('express-session');

const store = require('./db');
const email = require('./email');

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || 'quely';
const SESSION_SECRET = process.env.SESSION_SECRET || 'quely-dev-secret-change-me';

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

app.set('trust proxy', 1);
app.use(express.json({ limit: '64kb' }));
app.use(session({
  name: 'quely.sid',
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: String(process.env.COOKIE_SECURE || '').toLowerCase() === 'true',
    maxAge: 1000 * 60 * 60 * 24 * 7 // 7 days
  }
}));

// Static assets & scripts (safe to serve publicly; both surfaces share them).
// Use ETag/Last-Modified revalidation rather than a hard max-age so that
// swapping an asset on disk (e.g. dropping in the real quely-product-ui.png)
// is picked up immediately instead of being masked by a stale browser cache.
app.use('/assets', express.static(path.join(PUBLIC_DIR, 'assets'), { maxAge: 0, etag: true, lastModified: true }));
app.use('/js', express.static(path.join(PUBLIC_DIR, 'js'), { maxAge: 0 }));

function requireAuth(req, res, next) {
  if (req.session && req.session.authed) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'auth_required' });
  return res.redirect('/login');
}

function sectionLabel(id) {
  const s = store.SECTIONS.find(x => x.id === id);
  return s ? s.label : id;
}

// ── auth ────────────────────────────────────────────────────────────────
app.post('/api/login', (req, res) => {
  const { password } = req.body || {};
  if (password && password === DASHBOARD_PASSWORD) {
    req.session.authed = true;
    return res.json({ ok: true });
  }
  return res.status(401).json({ ok: false, error: 'bad_password' });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', (req, res) => {
  res.json({ authed: !!(req.session && req.session.authed) });
});

// ── dashboard API (auth required) ─────────────────────────────────────────
app.get('/api/prospects', requireAuth, (req, res) => {
  res.json({
    sections: store.SECTIONS,
    painAngles: store.PAIN_ANGLES,
    prospects: store.listProspects()
  });
});

app.post('/api/prospects', requireAuth, (req, res) => {
  const d = req.body || {};
  if (!(d.name || d.company)) return res.status(400).json({ error: 'name_or_company_required' });
  const p = store.createProspect({
    name: d.name, company: d.company, email: d.email, role: d.role, pain: d.pain, note: d.note
  });
  res.json({ prospect: p });
});

app.get('/api/prospects/:token', requireAuth, (req, res) => {
  const p = store.getProspect(req.params.token);
  if (!p) return res.status(404).json({ error: 'not_found' });
  res.json({ prospect: p });
});

app.delete('/api/prospects/:token', requireAuth, (req, res) => {
  store.deleteProspect(req.params.token);
  res.json({ ok: true });
});

app.get('/api/notifications', requireAuth, (req, res) => {
  res.json({ notifications: store.getNotifications() });
});

app.post('/api/notifications/clear', requireAuth, (req, res) => {
  store.clearNotifications();
  res.json({ ok: true });
});

// ── prospect (public, token-scoped) API ───────────────────────────────────
// Only ever exposes the prospect's own name/company (for personalization).
// Unknown token → { found:false }, never a data leak.
app.get('/api/v/:token', (req, res) => {
  const p = store.getProspect(req.params.token);
  if (!p) return res.json({ found: false });
  res.json({ found: true, name: p.name, company: p.company, sections: store.SECTIONS });
});

app.post('/api/v/:token/visit', (req, res) => {
  const r = store.recordVisit(req.params.token);
  if (r && r.firstOpen) {
    const p = store.getProspect(req.params.token);
    if (p) email.notifyView(p);
  }
  res.json({ ok: true });
});

app.post('/api/v/:token/section-time', (req, res) => {
  const { sectionId, ms } = req.body || {};
  store.addSectionTime(req.params.token, sectionId, Number(ms) || 0);
  res.json({ ok: true });
});

app.post('/api/v/:token/event', (req, res) => {
  const { type, meta } = req.body || {};
  if (!type) return res.status(400).json({ error: 'type_required' });
  store.recordEvent(req.params.token, type, meta || null);
  res.json({ ok: true });
});

app.post('/api/v/:token/question', (req, res) => {
  const { text, section } = req.body || {};
  const result = store.addQuestion(req.params.token, { text, section });
  if (result) {
    const p = store.getProspect(req.params.token);
    if (p) email.notifyQuestion(p, result.item.text, sectionLabel(result.item.section));
  }
  res.json({ ok: true });
});

// ── page routes ───────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.redirect(req.session && req.session.authed ? '/dashboard' : '/login');
});

app.get('/login', (req, res) => {
  if (req.session && req.session.authed) return res.redirect('/dashboard');
  res.sendFile(path.join(PUBLIC_DIR, 'login.html'));
});

app.get('/dashboard', requireAuth, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'dashboard.html'));
});

app.get('/v/:token', (req, res) => {
  // Serve the viewer shell for ANY token; the client resolves the token via the
  // API and shows a generic marketing page when it doesn't exist.
  res.sendFile(path.join(PUBLIC_DIR, 'viewer.html'));
});

app.listen(PORT, () => {
  console.log(`\n  Quely Sales Enablement running`);
  console.log(`  ▸ Dashboard : http://localhost:${PORT}/dashboard  (password: ${DASHBOARD_PASSWORD === 'quely' ? 'quely — set DASHBOARD_PASSWORD' : '••••••'})`);
  console.log(`  ▸ Prospect  : http://localhost:${PORT}/v/<token>`);
  console.log(`  ▸ Email     : ${email.enabled ? 'SMTP configured' : 'console-log mode (set SMTP_* to send real mail)'}${email.repConfigured ? '' : ', REP_EMAIL not set'}\n`);
});
