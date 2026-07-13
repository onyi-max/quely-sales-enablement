/* Quely Sales Dashboard — client behaviour.
 *
 * The prototype computed everything client-side from prospect objects held in
 * localStorage. Here the SAME derived logic runs on prospect objects fetched
 * from the real API, refreshed by polling every 1.5s (so prospect activity on
 * /v/<token> shows up here). Storage/notifications/email now live server-side.
 */
(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  };

  var SECCOLORS = { hero: '#9CA3AF', problem: '#8F5BD7', proof: '#6366F1', spaces: '#5C28A4', orbit: '#2A6FDB', features: '#16A34A', cta: '#D97706' };

  var state = {
    view: 'prospects', selToken: null, notifOpen: false, copyLabel: 'Copy',
    createdToken: null,
    sections: [], painAngles: [], prospects: [], notifications: []
  };

  // ── format helpers (ported) ──────────────────────────────────────────────
  function fmt(ms) {
    if (!ms || ms < 1000) return '0s';
    var s = Math.round(ms / 1000);
    if (s < 60) return s + 's';
    var m = Math.floor(s / 60), r = s % 60;
    return m + 'm ' + (r < 10 ? '0' + r : r) + 's';
  }
  function when(ts) {
    if (!ts) return '';
    var d = new Date(ts), now = new Date();
    var sameDay = d.toDateString() === now.toDateString();
    var t = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    return sameDay ? ('Today ' + t) : (d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + t);
  }
  function secLabel(id) {
    var s = state.sections.find(function (x) { return x.id === id; });
    return s ? s.label : id;
  }
  function fileLink(token) { return '/v/' + encodeURIComponent(token); }
  function absLink(token) { return location.origin + '/v/' + encodeURIComponent(token); }
  function prettyLink(token) { return 'quely.io/share/' + token; }
  function initials(name) {
    var p = String(name || '').trim().split(/\s+/);
    return ((p[0] || ' ')[0] + (p[1] ? p[1][0] : '')).toUpperCase();
  }

  // ── derived helpers (ported from enablement-store) ─────────────────────────
  function totalMs(p) { var s = 0; for (var k in p.sectionMs) s += p.sectionMs[k]; return s; }
  function mostViewedSection(p) {
    var best = null, bestMs = -1;
    state.sections.forEach(function (sec) {
      var ms = p.sectionMs[sec.id] || 0;
      if (ms > bestMs) { bestMs = ms; best = sec; }
    });
    return bestMs > 0 ? best : null;
  }

  function statusStyle(viewed) {
    return 'display:inline-flex; align-items:center; font-size:12px; font-weight:600; padding:4px 11px; border-radius:9999px; ' +
      (viewed ? 'background:#DCFCE7; color:#15803D;' : 'background:#F3F4F6; color:#9CA3AF;');
  }

  // ── data ────────────────────────────────────────────────────────────────
  function refresh() {
    return Promise.all([
      fetch('/api/prospects').then(handleAuth).then(function (r) { return r.json(); }),
      fetch('/api/notifications').then(handleAuth).then(function (r) { return r.json(); })
    ]).then(function (res) {
      var pdata = res[0], ndata = res[1];
      if (pdata) {
        state.sections = pdata.sections || [];
        state.painAngles = pdata.painAngles || [];
        state.prospects = pdata.prospects || [];
      }
      if (ndata) state.notifications = ndata.notifications || [];
      render();
    }).catch(function () {});
  }
  function handleAuth(r) {
    if (r.status === 401) { location.href = '/login'; throw new Error('auth'); }
    return r;
  }

  // ── render ────────────────────────────────────────────────────────────────
  function render() {
    // nav + title
    document.querySelectorAll('.navbtn').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-nav') === state.view);
    });
    var titles = { prospects: 'Prospects', analytics: 'Analytics', questions: 'Questions' };
    $('#viewTitle').textContent = titles[state.view];
    document.querySelectorAll('[data-view]').forEach(function (v) {
      v.style.display = v.getAttribute('data-view') === state.view ? '' : 'none';
    });

    // questions badge
    var qCount = state.prospects.reduce(function (a, p) { return a + (p.questions ? p.questions.length : 0); }, 0);
    var badge = $('#qBadge');
    badge.textContent = qCount;
    badge.style.cssText = 'margin-left:auto; font-size:12px; font-weight:700; min-width:20px; height:20px; padding:0 6px; border-radius:9999px; display:inline-flex; align-items:center; justify-content:center; ' +
      (qCount ? 'background:#8F5BD7; color:#fff;' : 'background:rgba(255,255,255,.12); color:rgba(255,255,255,.5);');

    renderNotifications();
    if (state.view === 'prospects') { renderProspectList(); renderDetail(); }
    else if (state.view === 'analytics') renderAnalytics();
    else if (state.view === 'questions') renderQuestions();
  }

  function renderProspectList() {
    var wrap = $('#prospectList');
    if (!state.prospects.length) {
      wrap.innerHTML = '<div style="padding:40px; text-align:center; font-size:14px; color:#9CA3AF;">No prospects yet. Generate your first link above.</div>';
      return;
    }
    wrap.innerHTML = state.prospects.map(function (p) {
      var viewed = !!p.firstOpened;
      var mv = mostViewedSection(p);
      var selected = state.selToken === p.token;
      var rowStyle = 'display:grid; grid-template-columns:1.6fr .9fr .7fr .7fr 1fr auto; gap:12px; align-items:center; padding:14px 20px; border-bottom:1px solid #F6F7F9; cursor:pointer; ' + (selected ? 'background:#F5EEFB;' : 'background:#fff;');
      return '<div class="prow" data-token="' + esc(p.token) + '" style="' + rowStyle + '">' +
        '<div style="min-width:0;"><div style="font-size:15px; font-weight:600; color:#111827; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">' + esc(p.name || '(no name)') + '</div><div style="font-size:13px; color:#9CA3AF; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">' + esc(p.company || '—') + '</div></div>' +
        '<div><span style="' + statusStyle(viewed) + '">' + (viewed ? 'Viewed' : 'Not opened') + '</span></div>' +
        '<div style="font-size:14px; color:#374151;">' + p.visits.length + '</div>' +
        '<div style="font-size:14px; color:#374151;">' + fmt(totalMs(p)) + '</div>' +
        '<div style="font-size:14px; color:#374151; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">' + esc(mv ? mv.label : '—') + '</div>' +
        '<div style="display:flex; align-items:center; gap:8px;">' +
          (p.questions.length ? '<i class="ph-fill ph-chat-teardrop-text" title="Asked a question" style="color:#8F5BD7; font-size:18px;"></i>' : '') +
          '<a class="openlink" href="' + fileLink(p.token) + '" target="_blank" rel="noopener" title="Open link" style="color:#9CA3AF; text-decoration:none;"><i class="ph ph-arrow-square-out" style="font-size:18px;"></i></a>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  function renderDetail() {
    var wrap = $('#detailPanel');
    var selP = state.selToken ? state.prospects.find(function (p) { return p.token === state.selToken; }) : null;
    if (!selP) {
      wrap.innerHTML = '<div style="background:#fff; border:1px dashed #D1D5DB; border-radius:16px; padding:44px 24px; text-align:center;">' +
        '<i class="ph ph-cursor-click" style="font-size:34px; color:#C4C9D2;"></i>' +
        '<div style="margin-top:12px; font-size:15px; font-weight:600; color:#374151;">Select a prospect</div>' +
        '<div style="margin-top:4px; font-size:13px; color:#9CA3AF; line-height:1.5;">Click any row to see how they engaged and what to follow up on.</div></div>';
      return;
    }
    var total = totalMs(selP) || 0;
    var maxMs = 0;
    state.sections.forEach(function (s) { maxMs = Math.max(maxMs, selP.sectionMs[s.id] || 0); });
    var bars = state.sections.map(function (s) {
      var ms = selP.sectionMs[s.id] || 0;
      var pct = maxMs ? Math.max(ms > 0 ? 4 : 0, Math.round(ms / maxMs * 100)) : 0;
      return '<div style="display:flex; align-items:center; gap:10px;">' +
        '<div style="flex:none; width:92px; font-size:13px; color:#374151;">' + esc(s.label) + '</div>' +
        '<div style="flex:1; height:10px; background:#F3F4F6; border-radius:9999px; overflow:hidden;"><div style="height:100%; border-radius:9999px; background:' + (SECCOLORS[s.id] || '#8F5BD7') + '; width:' + pct + '%;"></div></div>' +
        '<div style="flex:none; width:54px; text-align:right; font-size:13px; color:#6B7280;">' + fmt(ms) + '</div></div>';
    }).join('');

    // interactions derived from viewer events
    var evs = selP.events || [];
    var orbitQs = evs.filter(function (e) { return e.type === 'orbit_demo'; });
    var lensViews = evs.filter(function (e) { return e.type === 'lens_view'; });
    var lensPushes = evs.filter(function (e) { return e.type === 'lens_push'; });
    var tabEvs = evs.filter(function (e) { return e.type === 'space_tab'; });
    var uniq = function (arr) { return arr.filter(function (v, i) { return v && arr.indexOf(v) === i; }); };
    var cap = function (s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; };
    var tabNames = { disc: 'Discussion', docs: 'Docs & assets', dec: 'Decisions', act: 'Activity' };
    var interactions = [];
    if (orbitQs.length) interactions.push({ label: 'Asked Orbit · ' + orbitQs.length, icon: 'ph-fill ph-sparkle', detail: uniq(orbitQs.map(function (e) { return e.meta && e.meta.q; })).join('\n') });
    if (tabEvs.length) interactions.push({ label: 'Explored the Space', icon: 'ph-fill ph-kanban', detail: 'Tabs: ' + uniq(tabEvs.map(function (e) { return tabNames[e.meta && e.meta.tab] || (e.meta && e.meta.tab); })).join(', ') });
    if (lensViews.length) interactions.push({ label: 'Lenses: ' + uniq(lensViews.map(function (e) { return cap(e.meta && e.meta.lens); })).join(', '), icon: 'ph-fill ph-graph', detail: 'Opened ' + lensViews.length + ' lens view(s)' });
    if (lensPushes.length) interactions.push({ label: 'Pushed to tools · ' + lensPushes.length, icon: 'ph-fill ph-arrow-square-out', detail: lensPushes.map(function (e) { return (e.meta && e.meta.kind) === 'meeting' ? 'Scheduled a meeting' : 'Pushed to Jira'; }).join('\n') });

    var mv = mostViewedSection(selP);
    var q0 = selP.questions[0];
    var follow;
    if (!selP.firstOpened) follow = "Hasn't opened the link yet. Send a short nudge with the link again.";
    else if (q0) follow = 'Answer their question on ' + secLabel(q0.section) + ' first, then offer a live walkthrough.';
    else if (selP.ctaClicked) follow = 'Reached the CTA. Confirm the meeting and tailor it to ' + (mv ? mv.label : 'their focus') + '.';
    else if (mv) follow = 'Spent the most time on ' + mv.label + '. Lead your follow-up with that, offer to go deeper.';
    else follow = 'Opened but skimmed. Re-share with a one-line hook on the problem.';

    var sub = [selP.role, selP.company].filter(Boolean).join(' · ') || selP.email || '—';
    var viewed = !!selP.firstOpened;

    var html = '<div style="background:#fff; border:1px solid #E5E7EB; border-radius:16px; padding:22px 24px; box-shadow:0 1px 2px rgba(3,7,18,.05);">' +
      '<div style="display:flex; align-items:flex-start; justify-content:space-between; gap:10px;">' +
        '<div style="min-width:0;"><div style="font-size:18px; font-weight:700;">' + esc(selP.name || '(no name)') + '</div><div style="font-size:14px; color:#6B7280;">' + esc(sub) + '</div></div>' +
        '<span style="' + statusStyle(viewed) + '">' + (viewed ? 'Viewed' : 'Not opened') + '</span>' +
      '</div>' +
      '<div style="display:flex; gap:10px; margin:18px 0;">' +
        '<div style="flex:1; background:#F9FAFB; border-radius:10px; padding:12px 14px;"><div style="font-size:22px; font-weight:800;">' + selP.visits.length + '</div><div style="font-size:12px; color:#9CA3AF;">Visits</div></div>' +
        '<div style="flex:1; background:#F9FAFB; border-radius:10px; padding:12px 14px;"><div style="font-size:22px; font-weight:800;">' + fmt(total) + '</div><div style="font-size:12px; color:#9CA3AF;">Total time</div></div>' +
        '<div style="flex:1; background:#F9FAFB; border-radius:10px; padding:12px 14px;"><div style="font-size:22px; font-weight:800;">' + (selP.ctaClicked ? 'Yes' : 'No') + '</div><div style="font-size:12px; color:#9CA3AF;">Booked</div></div>' +
      '</div>' +
      '<div style="font-size:12px; font-weight:600; letter-spacing:.04em; text-transform:uppercase; color:#9CA3AF; margin-bottom:12px;">Attention by section</div>' +
      '<div style="display:flex; flex-direction:column; gap:9px;">' + bars + '</div>';

    if (interactions.length) {
      html += '<div style="margin-top:20px; font-size:12px; font-weight:600; letter-spacing:.04em; text-transform:uppercase; color:#9CA3AF; margin-bottom:10px;">Interacted with</div>' +
        '<div style="display:flex; flex-wrap:wrap; gap:8px;">' +
        interactions.map(function (ix) {
          return '<span title="' + esc(ix.detail) + '" style="display:inline-flex; align-items:center; gap:7px; background:#F5EEFB; border:1px solid #E4D3F5; border-radius:9999px; padding:6px 12px; font-size:13px; font-weight:600; color:#5C28A4;"><i class="' + ix.icon + '" style="font-size:15px;"></i>' + esc(ix.label) + '</span>';
        }).join('') + '</div>';
    }
    if (selP.questions.length) {
      html += '<div style="margin-top:20px; font-size:12px; font-weight:600; letter-spacing:.04em; text-transform:uppercase; color:#9CA3AF; margin-bottom:10px;">Questions</div>' +
        '<div style="display:flex; flex-direction:column; gap:10px;">' +
        selP.questions.map(function (q) {
          return '<div style="background:#F5EEFB; border-radius:10px; padding:12px 14px;"><div style="font-size:14px; line-height:1.4; color:#1F2937;">"' + esc(q.text) + '"</div><div style="font-size:12px; color:#8F5BD7; margin-top:5px;">on ' + esc(secLabel(q.section)) + ' · ' + esc(when(q.ts)) + '</div></div>';
        }).join('') + '</div>';
    }
    html += '<div style="margin-top:20px; background:#03070F; border-radius:12px; padding:16px;">' +
        '<div style="display:flex; align-items:center; gap:8px; font-size:12px; font-weight:600; letter-spacing:.04em; text-transform:uppercase; color:#AB84E1; margin-bottom:8px;"><i class="ph-fill ph-sparkle"></i>Suggested follow-up</div>' +
        '<div style="font-size:14px; line-height:1.5; color:#fff;">' + esc(follow) + '</div></div>' +
      '<div style="margin-top:16px; display:flex; gap:10px;">' +
        '<a href="' + fileLink(selP.token) + '" target="_blank" rel="noopener" style="flex:1; text-decoration:none;"><span style="display:flex; align-items:center; justify-content:center; gap:8px; background:#fff; border:1px solid #D1D5DB; border-radius:9px; padding:10px; font-size:14px; font-weight:600; color:#111827;"><i class="ph ph-arrow-square-out"></i>Open link</span></a>' +
        '<button id="detailDelete" style="flex:none; background:#fff; border:1px solid #E5E7EB; border-radius:9px; padding:10px 14px; font-size:14px; font-weight:600; color:#DC2626; cursor:pointer;"><i class="ph ph-trash"></i></button>' +
      '</div></div>';
    wrap.innerHTML = html;

    var del = $('#detailDelete');
    if (del) del.addEventListener('click', function () {
      fetch('/api/prospects/' + encodeURIComponent(selP.token), { method: 'DELETE' })
        .then(function () { state.selToken = null; refresh(); });
    });
  }

  function renderAnalytics() {
    var list = state.prospects;
    var sections = state.sections;
    var viewed = list.filter(function (p) { return !!p.firstOpened; });
    var secTotals = {}; sections.forEach(function (s) { secTotals[s.id] = 0; });
    list.forEach(function (p) { sections.forEach(function (s) { secTotals[s.id] += (p.sectionMs[s.id] || 0); }); });
    var maxSec = Math.max.apply(null, [1].concat(sections.map(function (s) { return secTotals[s.id]; })));
    var qCounts = {};
    list.forEach(function (p) { p.questions.forEach(function (q) { qCounts[q.section] = (qCounts[q.section] || 0) + 1; }); });
    var questionSections = Object.keys(qCounts).map(function (k) { return { label: secLabel(k), count: qCounts[k] }; })
      .sort(function (a, b) { return b.count - a.count; });
    var totalCta = list.filter(function (p) { return p.ctaClicked; }).length;
    var avgMs = viewed.length ? viewed.reduce(function (a, p) { return a + totalMs(p); }, 0) / viewed.length : 0;

    var dropLine;
    if (!viewed.length) dropLine = 'No views yet.';
    else {
      var reached = sections.filter(function (s) { return secTotals[s.id] > 0; });
      var lastReached = reached.length ? reached[reached.length - 1] : null;
      dropLine = lastReached ? ('Most journeys reach “' + lastReached.label + '”. Sections after it get little attention — consider moving key points earlier.') : 'Prospects open but barely scroll.';
    }

    var openRate = list.length ? Math.round(viewed.length / list.length * 100) + '%' : '0%';
    var ctaRate = viewed.length ? Math.round(totalCta / viewed.length * 100) + '%' : '0%';

    var statCards = [
      { v: list.length, l: 'Prospects' }, { v: openRate, l: 'Open rate' },
      { v: fmt(avgMs), l: 'Avg time / prospect' }, { v: ctaRate, l: 'Demo booked' }
    ].map(function (c) {
      return '<div style="background:#fff; border:1px solid #E5E7EB; border-radius:14px; padding:18px 20px;"><div style="font-size:28px; font-weight:800;">' + esc(c.v) + '</div><div style="font-size:13px; color:#9CA3AF;">' + esc(c.l) + '</div></div>';
    }).join('');

    var secBars = sections.map(function (s) {
      var pct = Math.round(secTotals[s.id] / maxSec * 100);
      return '<div style="display:flex; align-items:center; gap:12px;">' +
        '<div style="flex:none; width:104px; font-size:14px; color:#374151;">' + esc(s.label) + '</div>' +
        '<div style="flex:1; height:14px; background:#F3F4F6; border-radius:9999px; overflow:hidden;"><div style="height:100%; border-radius:9999px; background:' + (SECCOLORS[s.id] || '#8F5BD7') + '; width:' + pct + '%;"></div></div>' +
        '<div style="flex:none; width:60px; text-align:right; font-size:13px; color:#6B7280;">' + fmt(secTotals[s.id]) + '</div></div>';
    }).join('');

    var qList = questionSections.length
      ? questionSections.map(function (q) {
          return '<div style="display:flex; align-items:center; justify-content:space-between; padding:9px 0; border-bottom:1px solid #F6F7F9;"><span style="font-size:14px; color:#374151;">' + esc(q.label) + '</span><span style="font-size:14px; font-weight:700; color:#5C28A4;">' + q.count + '</span></div>';
        }).join('')
      : '<div style="padding:14px 0; font-size:13px; color:#9CA3AF;">No questions yet.</div>';

    $('#analyticsRoot').innerHTML =
      '<div style="display:grid; grid-template-columns:repeat(4,1fr); gap:16px; margin-bottom:20px;">' + statCards + '</div>' +
      '<div style="display:grid; grid-template-columns:1.3fr 1fr; gap:16px;">' +
        '<div style="background:#fff; border:1px solid #E5E7EB; border-radius:16px; padding:22px 24px;">' +
          '<div style="font-size:16px; font-weight:700; margin-bottom:16px;">Attention by section <span style="font-size:13px; font-weight:400; color:#9CA3AF;">· across all prospects</span></div>' +
          '<div style="display:flex; flex-direction:column; gap:12px;">' + secBars + '</div>' +
        '</div>' +
        '<div style="display:flex; flex-direction:column; gap:16px;">' +
          '<div style="background:#fff; border:1px solid #E5E7EB; border-radius:16px; padding:22px 24px;">' +
            '<div style="font-size:16px; font-weight:700; margin-bottom:12px;">Most asked about</div>' + qList +
          '</div>' +
          '<div style="background:#fff; border:1px solid #E5E7EB; border-radius:16px; padding:22px 24px;">' +
            '<div style="font-size:16px; font-weight:700; margin-bottom:10px;">Drop-off</div>' +
            '<div style="font-size:14px; line-height:1.5; color:#4B5563;">' + esc(dropLine) + '</div>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  function renderQuestions() {
    var questions = [];
    state.prospects.forEach(function (p) {
      p.questions.forEach(function (q) {
        questions.push({ name: p.name || '(no name)', company: p.company || '—', initials: initials(p.name), text: q.text, sectionLabel: secLabel(q.section), timeLabel: when(q.ts), fileLink: fileLink(p.token), ts: q.ts });
      });
    });
    questions.sort(function (a, b) { return b.ts - a.ts; });
    var root = $('#questionsRoot');
    if (!questions.length) {
      root.innerHTML = '<div style="background:#fff; border:1px dashed #D1D5DB; border-radius:16px; padding:48px; text-align:center; color:#9CA3AF; font-size:14px;">No questions yet. They\'ll appear here the moment a prospect asks one.</div>';
      return;
    }
    root.innerHTML = questions.map(function (q) {
      return '<div style="background:#fff; border:1px solid #E5E7EB; border-radius:14px; padding:18px 22px; box-shadow:0 1px 2px rgba(3,7,18,.05);">' +
        '<div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:8px;">' +
          '<div style="display:flex; align-items:center; gap:10px;"><span style="width:34px; height:34px; border-radius:50%; background:#F5EEFB; color:#5C28A4; font-size:14px; font-weight:700; display:flex; align-items:center; justify-content:center;">' + esc(q.initials) + '</span><div><div style="font-size:15px; font-weight:600;">' + esc(q.name) + '</div><div style="font-size:12px; color:#9CA3AF;">' + esc(q.company) + '</div></div></div>' +
          '<div style="font-size:12px; color:#9CA3AF;">' + esc(q.timeLabel) + '</div>' +
        '</div>' +
        '<div style="font-size:16px; line-height:1.45; color:#1F2937;">"' + esc(q.text) + '"</div>' +
        '<div style="margin-top:10px; display:flex; align-items:center; gap:10px;"><span style="font-size:12px; font-weight:600; color:#8F5BD7; background:#F5EEFB; padding:4px 11px; border-radius:9999px;">' + esc(q.sectionLabel) + '</span><a href="' + q.fileLink + '" target="_blank" rel="noopener" style="font-size:12px; color:#6B7280;">Open their link →</a></div>' +
      '</div>';
    }).join('');
  }

  function renderNotifications() {
    var panel = $('#notifPanel');
    panel.style.display = state.notifOpen ? 'block' : 'none';
    var badge = $('#notifBadge');
    if (state.notifications.length) {
      badge.style.display = 'flex';
      badge.textContent = state.notifications.length;
    } else {
      badge.style.display = 'none';
    }
    var listEl = $('#notifList');
    if (!state.notifications.length) {
      listEl.innerHTML = '<div style="padding:26px 18px; text-align:center; font-size:13px; color:#9CA3AF;">No activity yet.</div>';
      return;
    }
    listEl.innerHTML = state.notifications.map(function (n) {
      var isQ = n.type === 'question';
      var icon = isQ ? 'ph-fill ph-chat-teardrop-text' : 'ph-fill ph-eye';
      var color = isQ ? '#8F5BD7' : '#16A34A';
      var text = isQ
        ? ((n.name || 'A prospect') + ' asked a question on ' + secLabel(n.section))
        : ((n.name || 'A prospect') + (n.company ? (' · ' + n.company) : '') + ' opened your link');
      return '<div style="display:flex; gap:12px; padding:14px 18px; border-bottom:1px solid #F6F7F9;">' +
        '<i class="' + icon + '" style="font-size:20px; flex:none; margin-top:2px; color:' + color + ';"></i>' +
        '<div style="min-width:0;"><div style="font-size:14px; line-height:1.4; color:#111827;">' + esc(text) + '</div><div style="font-size:12px; color:#9CA3AF; margin-top:2px;">' + esc(when(n.ts)) + '</div></div>' +
      '</div>';
    }).join('');
  }

  // ── events ──────────────────────────────────────────────────────────────
  function initEvents() {
    document.querySelectorAll('.navbtn').forEach(function (b) {
      b.addEventListener('click', function () { state.view = b.getAttribute('data-nav'); render(); });
    });
    $('#logout').addEventListener('click', function () {
      fetch('/api/logout', { method: 'POST' }).then(function () { location.href = '/login'; });
    });

    // notifications
    $('#notifToggle').addEventListener('click', function () { state.notifOpen = !state.notifOpen; renderNotifications(); });
    $('#notifClear').addEventListener('click', function () {
      fetch('/api/notifications/clear', { method: 'POST' }).then(function () { refresh(); });
    });
    document.addEventListener('click', function (e) {
      if (state.notifOpen && !e.target.closest('#notifPanel') && !e.target.closest('#notifToggle')) {
        state.notifOpen = false; renderNotifications();
      }
    });

    // create
    $('#createBtn').addEventListener('click', createProspect);
    ['fName', 'fCompany', 'fEmail', 'fRole'].forEach(function (id) {
      $('#' + id).addEventListener('keydown', function (e) { if (e.key === 'Enter') createProspect(); });
    });

    // row selection (delegation)
    $('#prospectList').addEventListener('click', function (e) {
      if (e.target.closest('.openlink')) return; // let the open-link anchor work
      var row = e.target.closest('.prow');
      if (row) { state.selToken = row.getAttribute('data-token'); renderProspectList(); renderDetail(); }
    });

    // copy
    $('#copyBtn').addEventListener('click', function () {
      if (!state.createdToken) return;
      try { navigator.clipboard.writeText(absLink(state.createdToken)); } catch (e) {}
      $('#copyBtn').textContent = 'Copied';
      setTimeout(function () { $('#copyBtn').textContent = 'Copy'; }, 1500);
    });
  }

  function createProspect() {
    var d = {
      name: $('#fName').value, company: $('#fCompany').value, email: $('#fEmail').value,
      role: $('#fRole').value, pain: $('#fPain').value
    };
    if (!(d.name || d.company)) return;
    fetch('/api/prospects', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d)
    }).then(handleAuth).then(function (r) { return r.json(); }).then(function (res) {
      var p = res.prospect;
      state.createdToken = p.token;
      state.selToken = p.token;
      // reset form
      ['fName', 'fCompany', 'fEmail', 'fRole'].forEach(function (id) { $('#' + id).value = ''; });
      $('#fPain').value = '';
      // banner
      $('#createdName').textContent = p.name || p.company;
      $('#createdPretty').textContent = prettyLink(p.token);
      $('#createdOpen').setAttribute('href', fileLink(p.token));
      $('#copyBtn').textContent = 'Copy';
      $('#createdBanner').style.display = 'flex';
      refresh();
    }).catch(function () {});
  }

  // ── boot ────────────────────────────────────────────────────────────────
  initEvents();
  refresh();
  setInterval(refresh, 1500);
  window.addEventListener('focus', refresh);
})();
