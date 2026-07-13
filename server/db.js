/* Quely Sales Enablement — real backend data layer (node:sqlite).
 *
 * This module is the production replacement for the prototype's
 * `enablement-store.js` (which faked a backend in localStorage). It keeps the
 * SAME data model, the SAME function names, and the SAME semantics — only the
 * storage is now a real, persistent SQLite database shared by both surfaces.
 *
 * Data model (unchanged from the contract):
 *   Prospect: { token, name, company, email, role, pain, note, created,
 *               visits[], firstOpened, lastOpened, sectionMs{}, ctaClicked,
 *               events[], questions[] }
 *   events[]:    { type:'cta'|'orbit_demo'|'lens_view'|'lens_push'|'space_tab', meta, ts }
 *   questions[]: { text, section, ts }
 *   notifications[]: { type:'view'|'question', token, name, company, text?, section?, ts }
 */
'use strict';

const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

// Canonical sections both surfaces agree on (order = story order).
const SECTIONS = [
  { id: 'hero', label: 'Intro' },
  { id: 'problem', label: 'The problem' },
  { id: 'proof', label: 'Real teams' },
  { id: 'spaces', label: 'Spaces' },
  { id: 'orbit', label: 'Orbit' },
  { id: 'features', label: 'Features' },
  { id: 'cta', label: 'Book a demo' }
];

const PAIN_ANGLES = ['Jira context', 'EM visibility', 'Orbit / AI', 'Customer context', 'Async discussion', 'Integrations'];

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'quely.db');

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
  CREATE TABLE IF NOT EXISTS prospects (
    token        TEXT PRIMARY KEY,
    seq          INTEGER,
    name         TEXT NOT NULL DEFAULT '',
    company      TEXT NOT NULL DEFAULT '',
    email        TEXT NOT NULL DEFAULT '',
    role         TEXT NOT NULL DEFAULT '',
    pain         TEXT NOT NULL DEFAULT '',
    note         TEXT NOT NULL DEFAULT '',
    created      INTEGER NOT NULL,
    first_opened INTEGER,
    last_opened  INTEGER,
    cta_clicked  INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS visits (
    id    INTEGER PRIMARY KEY AUTOINCREMENT,
    token TEXT NOT NULL REFERENCES prospects(token) ON DELETE CASCADE,
    ts    INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS section_ms (
    token   TEXT NOT NULL REFERENCES prospects(token) ON DELETE CASCADE,
    section TEXT NOT NULL,
    ms      INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (token, section)
  );
  CREATE TABLE IF NOT EXISTS events (
    id    INTEGER PRIMARY KEY AUTOINCREMENT,
    token TEXT NOT NULL REFERENCES prospects(token) ON DELETE CASCADE,
    type  TEXT NOT NULL,
    meta  TEXT,
    ts    INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS questions (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    token   TEXT NOT NULL REFERENCES prospects(token) ON DELETE CASCADE,
    text    TEXT NOT NULL DEFAULT '',
    section TEXT NOT NULL DEFAULT '',
    ts      INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS notifications (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    type    TEXT NOT NULL,
    token   TEXT NOT NULL,
    name    TEXT,
    company TEXT,
    text    TEXT,
    section TEXT,
    ts      INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_visits_token ON visits(token);
  CREATE INDEX IF NOT EXISTS idx_events_token ON events(token);
  CREATE INDEX IF NOT EXISTS idx_questions_token ON questions(token);
`);

// ── helpers ───────────────────────────────────────────────────────────────
function now() { return Date.now(); }

function slug(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);
}

function makeToken(name, company) {
  const base = (slug(company) || 'prospect') + '-' + (slug(name).split('-')[0] || 'x');
  let t = base, i = 2;
  const exists = db.prepare('SELECT 1 FROM prospects WHERE token = ?');
  while (exists.get(t)) { t = base + '-' + i; i++; }
  return t;
}

// Prepared statements
const q = {
  insertProspect: db.prepare(
    `INSERT INTO prospects (token, seq, name, company, email, role, pain, note, created, cta_clicked)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`),
  nextSeq: db.prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS s FROM prospects'),
  getProspectRow: db.prepare('SELECT * FROM prospects WHERE token = ?'),
  listProspectRows: db.prepare('SELECT * FROM prospects ORDER BY seq DESC'),
  deleteProspect: db.prepare('DELETE FROM prospects WHERE token = ?'),
  deleteNotifsForToken: db.prepare('DELETE FROM notifications WHERE token = ?'),

  visitsFor: db.prepare('SELECT ts FROM visits WHERE token = ? ORDER BY ts ASC'),
  insertVisit: db.prepare('INSERT INTO visits (token, ts) VALUES (?, ?)'),
  setFirstOpened: db.prepare('UPDATE prospects SET first_opened = ? WHERE token = ?'),
  setLastOpened: db.prepare('UPDATE prospects SET last_opened = ? WHERE token = ?'),

  sectionMsFor: db.prepare('SELECT section, ms FROM section_ms WHERE token = ?'),
  upsertSectionMs: db.prepare(
    `INSERT INTO section_ms (token, section, ms) VALUES (?, ?, ?)
     ON CONFLICT(token, section) DO UPDATE SET ms = ms + excluded.ms`),

  eventsFor: db.prepare('SELECT type, meta, ts FROM events WHERE token = ? ORDER BY ts ASC, id ASC'),
  insertEvent: db.prepare('INSERT INTO events (token, type, meta, ts) VALUES (?, ?, ?, ?)'),
  setCta: db.prepare('UPDATE prospects SET cta_clicked = 1 WHERE token = ?'),

  questionsFor: db.prepare('SELECT text, section, ts FROM questions WHERE token = ? ORDER BY ts ASC, id ASC'),
  insertQuestion: db.prepare('INSERT INTO questions (token, text, section, ts) VALUES (?, ?, ?, ?)'),

  insertNotif: db.prepare(
    `INSERT INTO notifications (type, token, name, company, text, section, ts)
     VALUES (?, ?, ?, ?, ?, ?, ?)`),
  listNotifs: db.prepare('SELECT * FROM notifications ORDER BY id DESC'),
  clearNotifs: db.prepare('DELETE FROM notifications')
};

// Assemble a full prospect object (matching the original data shape) from rows.
function hydrate(row) {
  if (!row) return null;
  const sectionMs = {};
  for (const s of q.sectionMsFor.all(row.token)) sectionMs[s.section] = s.ms;
  const events = q.eventsFor.all(row.token).map(e => ({
    type: e.type,
    meta: e.meta == null ? null : safeParse(e.meta),
    ts: e.ts
  }));
  return {
    token: row.token,
    name: row.name,
    company: row.company,
    email: row.email,
    role: row.role,
    pain: row.pain,
    note: row.note,
    created: row.created,
    visits: q.visitsFor.all(row.token).map(v => v.ts),
    firstOpened: row.first_opened || null,
    lastOpened: row.last_opened || null,
    sectionMs,
    ctaClicked: !!row.cta_clicked,
    events,
    questions: q.questionsFor.all(row.token).map(x => ({ text: x.text, section: x.section, ts: x.ts }))
  };
}

function safeParse(s) { try { return JSON.parse(s); } catch (_) { return null; } }

// ── public API (mirrors enablement-store.js) ───────────────────────────────
const API = {
  SECTIONS,
  PAIN_ANGLES,

  listProspects() {
    return q.listProspectRows.all().map(hydrate);
  },

  getProspect(token) {
    return hydrate(q.getProspectRow.get(token));
  },

  createProspect(d) {
    d = d || {};
    const token = makeToken(d.name, d.company);
    const seq = q.nextSeq.get().s;
    q.insertProspect.run(
      token, seq, d.name || '', d.company || '', d.email || '',
      d.role || '', d.pain || '', d.note || '', now()
    );
    return this.getProspect(token);
  },

  deleteProspect(token) {
    q.deleteNotifsForToken.run(token);
    q.deleteProspect.run(token);
  },

  // Returns a "view" notification object if this visit was the first open, else null.
  recordVisit(token) {
    const row = q.getProspectRow.get(token);
    if (!row) return { ok: false };
    const t = now();
    q.insertVisit.run(token, t);
    let firstOpen = null;
    if (!row.first_opened) {
      q.setFirstOpened.run(t, token);
      q.insertNotif.run('view', token, row.name, row.company, null, null, t);
      firstOpen = { type: 'view', token, name: row.name, company: row.company, ts: t };
    }
    q.setLastOpened.run(t, token);
    return { ok: true, firstOpen };
  },

  addSectionTime(token, sectionId, ms) {
    if (!ms || ms < 0) return { ok: false };
    if (!q.getProspectRow.get(token)) return { ok: false };
    q.upsertSectionMs.run(token, sectionId, ms);
    return { ok: true };
  },

  recordEvent(token, type, meta) {
    if (!q.getProspectRow.get(token)) return { ok: false };
    q.insertEvent.run(token, type, meta == null ? null : JSON.stringify(meta), now());
    if (type === 'cta') q.setCta.run(token);
    return { ok: true };
  },

  addQuestion(token, qy) {
    const row = q.getProspectRow.get(token);
    if (!row) return null;
    const item = { text: (qy && qy.text) || '', section: (qy && qy.section) || '', ts: now() };
    q.insertQuestion.run(token, item.text, item.section, item.ts);
    q.insertNotif.run('question', token, row.name, row.company, item.text, item.section, item.ts);
    return { item, name: row.name, company: row.company, email: row.email };
  },

  getNotifications() {
    return q.listNotifs.all().map(n => ({
      type: n.type, token: n.token, name: n.name, company: n.company,
      text: n.text, section: n.section, ts: n.ts
    }));
  },

  clearNotifications() { q.clearNotifs.run(); },

  // demo helper: wipe everything
  reset() {
    db.exec('DELETE FROM notifications; DELETE FROM questions; DELETE FROM events; DELETE FROM section_ms; DELETE FROM visits; DELETE FROM prospects;');
  }
};

module.exports = API;
