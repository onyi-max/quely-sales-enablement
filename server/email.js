/* Rep notifications by email.
 *
 * The README calls this out explicitly: in production the rep should get an
 * email on a prospect's FIRST view and on EVERY question (the prototype only
 * mocked it in-app). This module does the real send via SMTP when configured,
 * and otherwise degrades to a console log so the app runs out-of-the-box.
 *
 * Configure via env (see .env.example):
 *   SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS
 *   MAIL_FROM   — the From: address
 *   REP_EMAIL   — where rep notifications are sent
 *   APP_BASE_URL — used to build absolute prospect links in the email
 */
'use strict';

let nodemailer = null;
try { nodemailer = require('nodemailer'); } catch (_) { /* optional */ }

const {
  SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS,
  MAIL_FROM, REP_EMAIL, APP_BASE_URL
} = process.env;

let transporter = null;
if (nodemailer && SMTP_HOST) {
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT ? Number(SMTP_PORT) : 587,
    secure: String(SMTP_SECURE || '').toLowerCase() === 'true',
    auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined
  });
}

const baseUrl = (APP_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
const repTo = REP_EMAIL || '';

function prospectLink(token) { return `${baseUrl}/v/${encodeURIComponent(token)}`; }

async function send(subject, text, html) {
  if (!repTo) {
    console.log(`[email] (no REP_EMAIL set) would send → "${subject}"`);
    return;
  }
  if (!transporter) {
    console.log(`[email] (no SMTP configured) would email ${repTo}: "${subject}"\n${text}`);
    return;
  }
  try {
    await transporter.sendMail({
      from: MAIL_FROM || 'Quely <no-reply@quely.io>',
      to: repTo,
      subject,
      text,
      html: html || undefined
    });
    console.log(`[email] sent to ${repTo}: "${subject}"`);
  } catch (err) {
    console.error(`[email] send failed: ${err.message}`);
  }
}

// First time a prospect opens their link.
function notifyView(p) {
  const who = p.name || 'A prospect';
  const co = p.company ? ` · ${p.company}` : '';
  const link = prospectLink(p.token);
  const subject = `👀 ${who}${co} just opened your Quely link`;
  const text = `${who}${co} opened their prospect link.\n\nView their engagement: ${baseUrl}/dashboard\nTheir link: ${link}`;
  const html =
    `<p><strong>${esc(who)}</strong>${co ? ' · ' + esc(p.company) : ''} just opened their Quely link.</p>` +
    `<p><a href="${esc(baseUrl)}/dashboard">Open the dashboard</a> · <a href="${esc(link)}">Their link</a></p>`;
  return send(subject, text, html);
}

// Every question a prospect asks.
function notifyQuestion(p, question, sectionLabel) {
  const who = p.name || 'A prospect';
  const co = p.company ? ` · ${p.company}` : '';
  const link = prospectLink(p.token);
  const subject = `💬 ${who}${co} asked a question`;
  const text =
    `${who}${co} asked a question on "${sectionLabel}":\n\n"${question}"\n\n` +
    `Reply/track in the dashboard: ${baseUrl}/dashboard\nTheir link: ${link}`;
  const html =
    `<p><strong>${esc(who)}</strong>${co ? ' · ' + esc(p.company) : ''} asked a question on <em>${esc(sectionLabel)}</em>:</p>` +
    `<blockquote>${esc(question)}</blockquote>` +
    `<p><a href="${esc(baseUrl)}/dashboard">Open the dashboard</a> · <a href="${esc(link)}">Their link</a></p>`;
  return send(subject, text, html);
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = {
  notifyView,
  notifyQuestion,
  enabled: !!transporter,
  repConfigured: !!repTo
};
