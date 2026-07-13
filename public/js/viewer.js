/* Quely Prospect Viewer — client behaviour.
 *
 * Ports the design prototype's interactions to a real backend: the token comes
 * from the /v/<token> URL, personalization + tracking go through the API, and
 * the Orbit demo / Space tabs / Lens Map behave exactly as the prototype.
 */
(function () {
  'use strict';

  // token from /v/<token>
  var parts = location.pathname.split('/').filter(Boolean);
  var token = parts[0] === 'v' && parts[1] ? decodeURIComponent(parts[1]) : null;

  var tracking = false;      // only record if the token resolves to a real prospect
  var prospect = null;
  var current = 'hero';

  // ── tiny API layer (fire-and-forget tracking) ────────────────────────────
  function post(path, body) {
    try {
      return fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {}),
        keepalive: true
      }).catch(function () {});
    } catch (e) {}
  }
  function beacon(path, body) {
    try {
      var blob = new Blob([JSON.stringify(body || {})], { type: 'application/json' });
      if (navigator.sendBeacon && navigator.sendBeacon(path, blob)) return;
    } catch (e) {}
    post(path, body);
  }
  function recordEvent(type, meta) { if (tracking) post('/api/v/' + encodeURIComponent(token) + '/event', { type: type, meta: meta || null }); }

  // ── Orbit answer engine (canned-smart; swap for a real AI call later) ─────
  var SRC = {
    jira:    { label: 'Jira · CHECKOUT-1428', icon: 'ph-fill ph-kanban', color: '#60A5FA' },
    slack:   { label: 'Slack thread', icon: 'ph-fill ph-chat-circle', color: '#A78BFA' },
    gong:    { label: 'Gong · customer call', icon: 'ph-fill ph-phone-call', color: '#C084FC' },
    meeting: { label: 'Meeting · Nov 18 planning', icon: 'ph-fill ph-note-blank', color: '#FBBF24' },
    crm:     { label: 'Salesforce · renewal note', icon: 'ph-fill ph-cloud', color: '#38BDF8' },
    doc:     { label: 'Doc · Checkout requirements', icon: 'ph-fill ph-file-text', color: '#34D399' }
  };
  var ANSWERS = [
    { keys: ['block', 'stuck', 'wait', 'depend'],
      text: "It's blocked on a payments dependency. The card-tokenization change owned by the Platform team has to land first, and that work is still in review, so checkout can't be finished until it merges.",
      sources: ['jira', 'slack', 'meeting'] },
    { keys: ['chang', 'update', 'happen', 'latest', 'status', 'going on', 'new'],
      text: "Since last week: scope was narrowed to card checkout only, a payments dependency was flagged as the blocker, and CS raised that a customer is expecting this for their renewal. The ticket itself still just says “Fix checkout flow.”",
      sources: ['slack', 'meeting', 'crm'] },
    { keys: ['customer', 'renew', 'churn', 'account', 'client'],
      text: "A customer is expecting this fix before their upcoming renewal. CS logged it as a renewal risk, and it came up directly on the last customer call, which is why it got prioritized.",
      sources: ['crm', 'gong'] },
    { keys: ['why', 'decid', 'reason', 'choose', 'chose', 'approach', 'scope'],
      text: "Scope was narrowed to card checkout only. In the Nov 18 planning session the team decided to cut the wallet/ACH paths for now to hit the renewal timeline, and to revisit them afterward.",
      sources: ['meeting', 'slack'] },
    { keys: ['next', 'todo', 'action', 'do now', 'should'],
      text: "Next steps: unblock the payments dependency with the Platform team, confirm the card-only scope with the customer via CS, then finish and QA the checkout flow. Owner on the dependency is still unassigned.",
      sources: ['jira', 'meeting', 'crm'] },
    { keys: ['who', 'own', 'assign', 'responsible'],
      text: "The ticket is assigned to the checkout squad, but the blocking payments dependency has no owner yet. The renewal context is owned by CS, and the scope decision came from the Nov 18 planning group.",
      sources: ['jira', 'meeting', 'crm'] }
  ];
  function answerFor(qtext) {
    var s = (qtext || '').toLowerCase();
    for (var i = 0; i < ANSWERS.length; i++) {
      var a = ANSWERS[i];
      for (var k = 0; k < a.keys.length; k++) { if (s.indexOf(a.keys[k]) !== -1) return a; }
    }
    return {
      text: "Here's what the Space shows on that: the work is “Fix checkout flow,” currently blocked on a payments dependency, scoped to card checkout only, and flagged as a renewal risk by CS. Ask about what's blocking it, what changed, why the scope was set, or what's next.",
      sources: ['jira', 'slack', 'meeting', 'crm']
    };
  }

  var LENSES = [
    { id: 'decisions', label: 'Decisions', icon: 'ph-fill ph-seal-check', color: '#22C55E', items: [
      'Scope narrowed to card checkout only', 'Defer wallet & ACH to the next cycle', 'Prioritize ahead of the Acme renewal' ] },
    { id: 'action', label: 'Action', icon: 'ph-fill ph-list-checks', color: '#60A5FA', items: [
      'Unblock the payments tokenization PR', 'Confirm card-only scope with the customer', 'QA the full checkout flow before launch' ] },
    { id: 'risks', label: 'Risks', icon: 'ph-fill ph-warning', color: '#F87171', items: [
      'Payments dependency has no owner yet', 'Renewal deadline on the 30th is at risk', 'Wallet users need a clear interim message' ] },
    { id: 'opportunities', label: 'Opportunities', icon: 'ph-fill ph-lightbulb', color: '#FBBF24', items: [
      'Reuse tokenization for subscriptions', 'Position the fix in the renewal conversation' ] },
    { id: 'questions', label: 'Open Questions', icon: 'ph-fill ph-question', color: '#C4B5FD', items: [
      'Who owns the payments dependency?', 'Do ACH users need a fallback path?' ] },
    { id: 'next', label: 'Next Steps', icon: 'ph-fill ph-arrow-right', color: '#818CF8', items: [
      'Assign an owner to the dependency', 'Schedule a pre-launch review', 'Send the customer a status update via CS' ] }
  ];

  // ── DOM refs ──────────────────────────────────────────────────────────────
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var orbitScroll = $('#orbitScroll');
  var orbitEmpty = $('#orbitEmpty');
  var orbitInput = $('#orbitInput');

  // state
  var state = {
    spaceTouched: false, orbitTouched: false, lens: 'decisions', lensTouched: false, pushed: {}
  };
  var pendingThink = 0;

  // ── Orbit chips ────────────────────────────────────────────────────────────
  var SUGGESTIONS = [
    { label: 'What’s blocking this?', q: 'What is blocking this right now?' },
    { label: 'What changed recently?', q: 'What changed recently?' },
    { label: 'Why this scope?', q: 'Why did we decide on this scope?' },
    { label: 'What’s next?', q: 'What are the next steps?' }
  ];
  function renderChips() {
    var wrap = $('#orbitChips');
    wrap.innerHTML = '';
    SUGGESTIONS.forEach(function (s, i) {
      var b = document.createElement('button');
      b.className = 'q-orbchip';
      b.style.cssText = 'position:relative; background:rgba(143,91,215,.16); border:1px solid rgba(143,91,215,.4); color:#E4D3F5; font-family:inherit; font-size:14px; font-weight:600; padding:9px 15px; border-radius:9999px; cursor:pointer;';
      if (i === 0 && !state.orbitTouched) {
        var ping = document.createElement('span');
        ping.className = 'orbit-ping';
        ping.style.cssText = 'position:absolute; top:-6px; right:-6px; width:15px; height:15px; pointer-events:none;';
        ping.innerHTML = '<span style="position:absolute; inset:0; border-radius:50%; background:#AB84E1; opacity:.75; animation:qping 1.6s cubic-bezier(0,0,.2,1) infinite;"></span><span style="position:absolute; inset:4px; border-radius:50%; background:#AB84E1;"></span>';
        b.appendChild(ping);
      }
      b.appendChild(document.createTextNode(s.label));
      b.addEventListener('click', function () { runOrbit(s.q); });
      wrap.appendChild(b);
    });
  }

  function addUserBubble(text) {
    if (orbitEmpty) orbitEmpty.style.display = 'none';
    var row = document.createElement('div');
    row.style.cssText = 'display:flex; justify-content:flex-end;';
    var bub = document.createElement('div');
    bub.style.cssText = 'max-width:80%; background:#5C28A4; color:#fff; font-size:15px; line-height:1.45; padding:13px 16px; border-radius:14px; border-bottom-right-radius:4px;';
    bub.textContent = text;
    row.appendChild(bub);
    orbitScroll.appendChild(row);
  }
  function addOrbitBubble(ans) {
    var row = document.createElement('div');
    row.style.cssText = 'display:flex; justify-content:flex-start;';
    var bub = document.createElement('div');
    bub.style.cssText = 'max-width:88%; background:rgba(255,255,255,.06); border:1px solid rgba(255,255,255,.1); color:#EAECEF; font-size:15px; line-height:1.5; padding:14px 17px; border-radius:14px; border-bottom-left-radius:4px; animation:qanswer .45s cubic-bezier(.2,0,0,1);';
    bub.appendChild(document.createTextNode(ans.text));
    if (ans.sources && ans.sources.length) {
      var srcWrap = document.createElement('div');
      srcWrap.style.cssText = 'display:flex; flex-wrap:wrap; gap:7px; margin-top:12px;';
      ans.sources.forEach(function (id) {
        var s = SRC[id] || { label: id, icon: 'ph-fill ph-file', color: '#9CA3AF' };
        var chip = document.createElement('span');
        chip.style.cssText = 'display:inline-flex; align-items:center; gap:6px; background:rgba(255,255,255,.06); border:1px solid rgba(255,255,255,.12); border-radius:9999px; padding:4px 10px; font-size:12px; font-weight:600; color:rgba(255,255,255,.72);';
        chip.innerHTML = '<i class="' + s.icon + '" style="font-size:14px; color:' + s.color + ';"></i>';
        chip.appendChild(document.createTextNode(s.label));
        srcWrap.appendChild(chip);
      });
      bub.appendChild(srcWrap);
    }
    row.appendChild(bub);
    orbitScroll.appendChild(row);
  }
  function showThinking(on) {
    var existing = $('#orbitThinking');
    if (on) {
      if (existing) return;
      var t = document.createElement('div');
      t.id = 'orbitThinking';
      t.style.cssText = 'display:flex; align-items:center; gap:7px; background:rgba(255,255,255,.06); border:1px solid rgba(255,255,255,.1); border-radius:14px; border-bottom-left-radius:4px; padding:15px 17px; align-self:flex-start;';
      t.innerHTML = '<span style="width:7px; height:7px; border-radius:50%; background:#AB84E1; animation:qdot 1.2s infinite;"></span><span style="width:7px; height:7px; border-radius:50%; background:#AB84E1; animation:qdot 1.2s infinite .2s;"></span><span style="width:7px; height:7px; border-radius:50%; background:#AB84E1; animation:qdot 1.2s infinite .4s;"></span>';
      orbitScroll.appendChild(t);
    } else if (existing) {
      existing.remove();
    }
  }
  // Reveal the FULL answer at once after a think delay (no char streaming — that
  // raced and dropped in the prototype).
  function runOrbit(qtext) {
    qtext = (qtext || '').trim();
    if (!qtext) return;
    // first orbit interaction: remove the chip ping
    if (!state.orbitTouched) { state.orbitTouched = true; document.querySelectorAll('.orbit-ping').forEach(function (n) { n.remove(); }); }
    recordEvent('orbit_demo', { q: qtext });
    addUserBubble(qtext);
    orbitInput.value = '';
    pendingThink++;
    showThinking(true);
    var ans = answerFor(qtext);
    setTimeout(function () {
      pendingThink = Math.max(0, pendingThink - 1);
      if (pendingThink === 0) showThinking(false);
      addOrbitBubble(ans);
      requestAnimationFrame(function () { orbitScroll.scrollTop = orbitScroll.scrollHeight; });
    }, 850);
    requestAnimationFrame(function () { orbitScroll.scrollTop = orbitScroll.scrollHeight; });
  }

  // ── Space tabs ──────────────────────────────────────────────────────────────
  function initSpace() {
    var tabs = document.querySelectorAll('[data-space-tab]');
    tabs.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-space-tab');
        recordEvent('space_tab', { tab: id });
        if (!state.spaceTouched) { state.spaceTouched = true; document.querySelectorAll('.space-ping').forEach(function (n) { n.remove(); }); }
        tabs.forEach(function (b) {
          var on = b === btn;
          b.style.borderBottom = '2px solid ' + (on ? '#5C28A4' : 'transparent');
          b.style.color = on ? '#5C28A4' : '#6B7280';
        });
        document.querySelectorAll('[data-space-body]').forEach(function (body) {
          body.style.display = body.getAttribute('data-space-body') === id ? '' : 'none';
        });
      });
    });
  }

  // ── Lens Map ──────────────────────────────────────────────────────────────
  function renderLensRail() {
    var rail = $('#lensRail');
    // keep the "Lens Explorer" header (first child), rebuild the rest
    while (rail.children.length > 1) rail.removeChild(rail.lastChild);
    LENSES.forEach(function (l, li) {
      var on = l.id === state.lens;
      var b = document.createElement('button');
      b.style.cssText = 'position:relative; display:flex; align-items:center; gap:10px; width:100%; font-family:inherit; padding:9px 10px; border:none; border-radius:9px; cursor:pointer; transition:background .14s; color:#fff; background:' + (on ? 'rgba(143,91,215,.22)' : 'transparent') + ';';
      if (li === 0 && !state.lensTouched) {
        var ping = document.createElement('span');
        ping.style.cssText = 'position:absolute; top:8px; right:10px; width:13px; height:13px; pointer-events:none;';
        ping.innerHTML = '<span style="position:absolute; inset:0; border-radius:50%; background:#AB84E1; opacity:.75; animation:qping 1.6s cubic-bezier(0,0,.2,1) infinite;"></span><span style="position:absolute; inset:3.5px; border-radius:50%; background:#AB84E1;"></span>';
        b.appendChild(ping);
      }
      var icon = document.createElement('i');
      icon.className = l.icon;
      icon.style.cssText = 'flex:none; font-size:18px; color:' + l.color + ';';
      b.appendChild(icon);
      var lbl = document.createElement('span');
      lbl.style.cssText = 'flex:1; text-align:left; font-size:14px; font-weight:600;';
      lbl.textContent = l.label;
      b.appendChild(lbl);
      var cnt = document.createElement('span');
      cnt.style.cssText = 'flex:none; min-width:22px; text-align:center; font-size:12px; font-weight:700; padding:2px 7px; border-radius:9999px; ' + (on ? 'background:rgba(255,255,255,.16); color:#fff;' : 'background:rgba(255,255,255,.08); color:rgba(255,255,255,.55);');
      cnt.textContent = l.items.length;
      b.appendChild(cnt);
      b.addEventListener('click', function () { selectLens(l.id); });
      rail.appendChild(b);
    });
    var total = LENSES.reduce(function (a, l) { return a + l.items.length; }, 0);
    $('#lensTotal').textContent = total + ' items · 3 signals';
  }
  function renderLensItems(animate) {
    var def = LENSES.filter(function (l) { return l.id === state.lens; })[0] || LENSES[0];
    $('#activeLensIcon').className = def.icon;
    $('#activeLensIcon').style.color = def.color;
    $('#activeLensLabel').textContent = def.label;
    var wrap = $('#lensItems');
    wrap.innerHTML = '';
    def.items.forEach(function (text, idx) {
      var key = state.lens + '-' + idx;
      var pk = state.pushed[key];
      var row = document.createElement('div');
      row.style.cssText = 'display:flex; align-items:center; gap:13px; padding:13px 14px; border-radius:12px; background:rgba(255,255,255,.03); border:1px solid rgba(255,255,255,.07);' + (animate ? (' animation:qanswer .4s cubic-bezier(.2,0,0,1) both; animation-delay:' + (idx * 55) + 'ms;') : '');
      var icon = document.createElement('i');
      icon.className = def.icon;
      icon.style.cssText = 'flex:none; font-size:20px; color:' + def.color + ';';
      row.appendChild(icon);
      var txt = document.createElement('div');
      txt.style.cssText = 'flex:1; min-width:0; font-size:15px; line-height:1.4; color:#EAECEF;';
      txt.textContent = text;
      row.appendChild(txt);
      if (pk) {
        var done = document.createElement('span');
        done.style.cssText = 'flex:none; display:inline-flex; align-items:center; gap:7px; font-size:13px; font-weight:600; padding:8px 13px; border-radius:9px; background:rgba(34,197,94,.14); border:1px solid rgba(34,197,94,.4); color:#4ADE80; animation:qanswer .4s cubic-bezier(.2,0,0,1);';
        done.innerHTML = '<i class="' + (pk === 'meeting' ? 'ph-fill ph-calendar-check' : 'ph-fill ph-check-circle') + '"></i>' + (pk === 'meeting' ? 'Meeting scheduled' : 'Added to Jira');
        row.appendChild(done);
      } else {
        var btns = document.createElement('div');
        btns.style.cssText = 'display:flex; gap:7px; flex:none;';
        var btnBase = 'position:relative; display:inline-flex; align-items:center; gap:7px; font-family:inherit; font-size:13px; font-weight:600; padding:8px 13px; border-radius:9px; cursor:pointer; white-space:nowrap;';
        var jira = document.createElement('button');
        jira.style.cssText = btnBase + ' background:#fff; border:1px solid #fff; color:#111827;';
        var firstPush = (idx === 0 && Object.keys(state.pushed).length === 0);
        jira.innerHTML = (firstPush ? '<span style="position:absolute; top:-6px; right:-6px; width:14px; height:14px; pointer-events:none;"><span style="position:absolute; inset:0; border-radius:50%; background:#60A5FA; opacity:.8; animation:qping 1.6s cubic-bezier(0,0,.2,1) infinite;"></span><span style="position:absolute; inset:4px; border-radius:50%; background:#60A5FA;"></span></span>' : '') + '<img src="/assets/logos/jira.svg" alt="" style="width:15px; height:15px;">Push to Jira';
        jira.addEventListener('click', function () { pushItem(key, 'jira'); });
        var meet = document.createElement('button');
        meet.style.cssText = btnBase + ' background:transparent; border:1px solid rgba(255,255,255,.22); color:#fff;';
        meet.innerHTML = '<i class="ph-bold ph-calendar-plus" style="font-size:15px;"></i>Schedule';
        meet.addEventListener('click', function () { pushItem(key, 'meeting'); });
        btns.appendChild(jira);
        btns.appendChild(meet);
        row.appendChild(btns);
      }
      wrap.appendChild(row);
    });
  }
  function selectLens(id) {
    recordEvent('lens_view', { lens: id });
    state.lens = id;
    state.lensTouched = true;
    renderLensRail();
    renderLensItems(true);
  }
  function pushItem(key, kind) {
    recordEvent('lens_push', { key: key, kind: kind });
    state.pushed[key] = kind;
    renderLensItems(false);
  }

  // ── Ask a question panel ────────────────────────────────────────────────────
  function initQuestion() {
    var panel = $('#qPanel');
    var form = $('#qForm');
    var done = $('#qDone');
    function open() {
      $('#qText').value = '';
      $('#qSection').value = current || 'hero';
      form.style.display = '';
      done.style.display = 'none';
      panel.style.display = 'flex';
    }
    function close() { panel.style.display = 'none'; }
    $('#askFab').addEventListener('click', open);
    $('#ctaAsk').addEventListener('click', open);
    document.querySelectorAll('.qClose').forEach(function (b) { b.addEventListener('click', close); });
    panel.addEventListener('click', function (e) { if (e.target === panel) close(); });
    $('#qSubmit').addEventListener('click', function () {
      var text = ($('#qText').value || '').trim();
      if (!text) return;
      var section = $('#qSection').value;
      if (tracking) post('/api/v/' + encodeURIComponent(token) + '/question', { text: text, section: section });
      form.style.display = 'none';
      done.style.display = '';
    });
  }

  // ── CTA ─────────────────────────────────────────────────────────────────────
  function initCTA() {
    $('#ctaBook').addEventListener('click', function () { recordEvent('cta'); });
  }

  // ── scroll craft: progress bar, section dots, dwell tracking ─────────────────
  var pendingMs = {};
  function initScroll() {
    var supportsView = (typeof CSS !== 'undefined' && CSS.supports && CSS.supports('animation-timeline: view()'));
    if (!supportsView) {
      var show = function (el) { el.style.opacity = '1'; el.style.transform = 'none'; };
      document.querySelectorAll('[data-reveal]').forEach(show);
      document.querySelectorAll('[data-stagger]').forEach(function (g) { [].forEach.call(g.children, show); });
    }
    function tick() {
      var doc = document.documentElement;
      var max = (doc.scrollHeight - window.innerHeight) || 1;
      var frac = Math.min(1, Math.max(0, window.scrollY / max));
      var bar = document.querySelector('[data-progress]');
      if (bar) bar.style.width = (frac * 100).toFixed(1) + '%';
      var mid = window.innerHeight / 2;
      var els = document.querySelectorAll('[data-section]');
      var cur = null;
      els.forEach(function (el) {
        var r = el.getBoundingClientRect();
        if (r.top <= mid && r.bottom >= mid) cur = el.getAttribute('data-section');
      });
      if (!cur) {
        var best = 1e9;
        els.forEach(function (el) {
          var r = el.getBoundingClientRect();
          var d = Math.min(Math.abs(r.top - mid), Math.abs(r.bottom - mid));
          if (d < best) { best = d; cur = el.getAttribute('data-section'); }
        });
      }
      if (cur) {
        current = cur;
        document.querySelectorAll('[data-dot]').forEach(function (d) {
          var on = d.getAttribute('data-dot') === cur;
          d.style.background = on ? '#5C28A4' : '#D1D5DB';
          d.style.transform = on ? 'scale(1.5)' : 'scale(1)';
        });
      }
    }
    function dwell() {
      if (document.visibilityState !== 'visible') return;
      if (tracking && current) pendingMs[current] = (pendingMs[current] || 0) + 1000;
    }
    function flush(useBeacon) {
      if (!tracking) return;
      Object.keys(pendingMs).forEach(function (sec) {
        var ms = pendingMs[sec];
        if (ms > 0) {
          var path = '/api/v/' + encodeURIComponent(token) + '/section-time';
          var body = { sectionId: sec, ms: ms };
          if (useBeacon) beacon(path, body); else post(path, body);
          pendingMs[sec] = 0;
        }
      });
    }
    setInterval(tick, 120);
    setInterval(dwell, 1000);
    setInterval(function () { flush(false); }, 4000);
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') flush(true); });
    window.addEventListener('pagehide', function () { flush(true); });
    tick();
  }

  // ── boot ────────────────────────────────────────────────────────────────────
  function personalize(data) {
    var eyebrow = $('#heroEyebrow');
    if (data && data.found && data.company) {
      eyebrow.textContent = "Built for " + data.company + "'s product & engineering teams";
    } else {
      eyebrow.textContent = 'Built for product & engineering teams';
    }
    var askingAs = $('#askingAs');
    if (data && data.found && data.name) {
      askingAs.textContent = 'Asking as ' + data.name + (data.company ? (' · ' + data.company) : '');
    } else {
      askingAs.textContent = 'Your question goes straight to the Quely team.';
    }
  }

  function boot() {
    renderChips();
    renderLensRail();
    renderLensItems(false);
    initSpace();
    initQuestion();
    initCTA();
    initScroll();
    orbitInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); runOrbit(orbitInput.value); } });
    $('#orbitSend').addEventListener('click', function () { runOrbit(orbitInput.value); });

    if (!token) { personalize({ found: false }); return; }
    fetch('/api/v/' + encodeURIComponent(token))
      .then(function (r) { return r.json(); })
      .then(function (data) {
        prospect = data;
        tracking = !!(data && data.found);
        personalize(data);
        if (tracking) post('/api/v/' + encodeURIComponent(token) + '/visit');
      })
      .catch(function () { personalize({ found: false }); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
