/* STEVEXA Partners - screens. All security is enforced by the Apps Script backend; this page only decides what to show.
   Raise SX_UI_VERSION by 1 every time you change the design or wording: installed apps then download the new screens by themselves. */
window.SX_UI_VERSION = 4;
(function () {
  'use strict';
  var root = document.getElementById('app');
  var S = { user: null, tab: null, flash: null, temp: null };

  /* ---------- helpers (user-supplied text always goes through textContent: no HTML injection) ---------- */
  function el(tag, props) {
    var n = document.createElement(tag);
    Object.keys(props || {}).forEach(function (k) {
      if (k === 'class') n.className = props[k];
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), props[k]);
      else if (props[k] !== false && props[k] != null) n.setAttribute(k, props[k]);
    });
    for (var i = 2; i < arguments.length; i++) add(n, arguments[i]);
    return n;
  }
  function add(n, c) { if (c == null || c === false) return; if (Array.isArray(c)) c.forEach(function (x) { add(n, x); }); else n.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c))); }
  function svg(markup, cls) { var s = document.createElement('span'); s.innerHTML = markup; var n = s.firstChild; if (cls) n.setAttribute('class', cls); return n; }   // markup below is constant, never user text
  var WAVE = '<svg class="wave" viewBox="0 0 400 34" preserveAspectRatio="none"><path d="M0 18 C 80 40 160 -4 260 14 S 380 30 400 12 V34 H0 Z" fill="#eef3fb"/></svg>';
  var IC_MAIL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="m4 7 8 6 8-6"/></svg>';
  var IC_LOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="9" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';
  function naira(kobo) { var v = (Number(kobo) || 0) / 100; return '₦' + v.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function pct(p) { return (Math.round(p * 100) / 100) + '%'; }
  function initials(n) { var p = String(n || '?').trim().split(/\s+/); return ((p[0] || '?')[0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase(); }
  function tok() { try { return sessionStorage.getItem('sx_token') || ''; } catch (e) { return ''; } }
  function setTok(t) { try { if (t) sessionStorage.setItem('sx_token', t); else sessionStorage.removeItem('sx_token'); } catch (e) {} }

  function api(action, data) {
    if (!window.STEVEXA_API) return Promise.resolve({ ok: false, error: 'The server address is not set yet (docs/config.js).' });
    return fetch(window.STEVEXA_API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(Object.assign({ action: action, token: tok() }, data || {})) })
      .then(function (r) { return r.json(); })
      .then(function (j) { if (j && j.expired && S.user) { signOut(true); } return j; })
      .catch(function () { return { ok: false, error: 'Could not reach the server. Check your internet connection.' }; });
  }
  function flash(type, text) { S.flash = { type: type, text: text }; }
  function flashBox() { var f = S.flash; S.flash = null; return f ? el('div', { class: 'msg ' + f.type }, f.text) : null; }
  function table(heads, rows, numCols) {
    numCols = numCols || [];
    return el('table', {}, el('thead', {}, el('tr', {}, heads.map(function (h, i) { return el('th', { class: numCols.indexOf(i) >= 0 ? 'n' : '' }, h); }))),
      el('tbody', {}, rows.map(function (r) {
        var cells = r.cells || r;
        return el('tr', { class: r.cls || '' }, cells.map(function (c, i) { return el('td', { class: numCols.indexOf(i) >= 0 ? 'n' : '' }, c); }));
      })));
  }
  function field(label, input) { return el('div', {}, el('label', {}, label), input); }
  function busy(btn, p) { btn.disabled = true; return p.then(function (r) { btn.disabled = false; return r; }); }
  function card(title, sub) { var c = el('div', { class: 'card' }); if (title) add(c, el('h2', {}, title)); if (sub) add(c, el('p', { class: 'sub' }, sub)); for (var i = 2; i < arguments.length; i++) add(c, arguments[i]); return c; }
  function hero(label, big, sm, cls) { return el('div', { class: 'latest ' + (cls || '') }, el('small', {}, label), el('div', { class: 'big' }, big), sm ? el('div', { class: 'sm' }, sm) : null); }
  function kpi(label, value, cls) { return el('div', { class: 'kpi ' + (cls || '') }, el('small', {}, label), el('b', {}, value)); }
  function row(av, title, sub, right, btns, avCls) {
    return el('div', { class: 'row' }, el('div', { class: 'av ' + (avCls || '') }, av), el('div', { class: 'mid' }, el('b', {}, title), sub),
      right ? el('div', { class: 'amt' }, right) : null, btns ? el('div', { class: 'btns' }, btns) : null);
  }
  function sub(t) { return t ? el('small', {}, t) : null; }
  function empty(t) { return el('div', { class: 'empty' }, t); }
  function err(r) { return el('div', { class: 'msg err' }, r.error || 'Something went wrong.'); }

  /* ---------- shell ---------- */
  var TABS = {
    owner: [['overview', 'Overview'], ['people', 'People'], ['schools', 'Schools'], ['payments', 'Payments'], ['payouts', 'Payouts'], ['audit', 'Audit']],
    partner: [['share', 'My share']],
    bd: [['myschools', 'My schools'], ['register', 'Register'], ['commission', 'My commission']]
  };
  var ROLE_NAME = { owner: 'IP Owner', partner: 'Partner', bd: 'Business developer' };

  function signOut(expired) {
    setTok(''); S.user = null; S.tab = null;
    if (expired) flash('warn', 'Your session ended. Please sign in again.');
    render();
  }

  function footer() { return el('div', { class: 'foot' }, 'Powered by STEVETECH'); }

  function showUpdate() {
    if (document.getElementById('sx-upd')) return;
    var b = el('div', { class: 'upd', id: 'sx-upd' }, el('span', {}, 'A new version of the app is ready.'),
      el('button', { onclick: function () { location.reload(); } }, 'Update now'));
    document.body.appendChild(b);
  }
  window.SX_SHOW_UPDATE = showUpdate;

  function render() {
    root.textContent = '';
    if (!S.user) return renderLogin();
    if (S.user.mustChange) return renderForcedPw();
    var tabs = TABS[S.user.role] || [];
    if (!S.tab || (S.tab !== '_pw' && !tabs.some(function (t) { return t[0] === S.tab; }))) S.tab = tabs[0] && tabs[0][0];
    var fl = flashBox(), content = el('section', {}, el('div', { class: 'empty' }, 'Loading…'));
    root.appendChild(el('div', { class: 'hdr' },
      el('div', { class: 'top' },
        el('div', { class: 'badge' }, el('img', { src: 'logo.png', alt: '' })),
        el('div', { class: 'ttl' }, el('b', {}, 'STEVEXA Partners'), el('small', {}, S.user.name + ' · ' + ROLE_NAME[S.user.role])),
        el('div', { class: 'acts' }, el('button', { class: 'hbtn', onclick: function () { S.tab = '_pw'; render(); } }, 'Password'), el('button', { class: 'hbtn', onclick: function () { signOut(); } }, 'Sign out'))),
      svg(WAVE)));
    root.appendChild(el('main', {},
      el('div', { class: 'tabs' }, tabs.map(function (t) { return el('button', { class: S.tab === t[0] ? 'on' : '', onclick: function () { S.tab = t[0]; render(); } }, t[1]); })),
      fl, content, footer()));
    if (S.tab === '_pw') { content.textContent = ''; content.appendChild(pwCard(false)); window.SX_ON_READY && window.SX_ON_READY(); return; }
    (VIEWS[S.tab] || function () { return Promise.resolve(el('div')); })().then(function (node) { content.textContent = ''; content.appendChild(node); window.SX_ON_READY && window.SX_ON_READY(); });
    if (window.SX_UPDATE_READY) showUpdate();
  }

  function renderLogin() {
    var email = el('input', { type: 'email', autocomplete: 'username', required: true, placeholder: 'you@example.com' });
    var pw = el('input', { type: 'password', autocomplete: 'current-password', required: true, placeholder: 'Your password' });
    var eye = el('button', { type: 'button', class: 'eye', onclick: function () { var show = pw.type === 'password'; pw.type = show ? 'text' : 'password'; eye.textContent = show ? 'Hide' : 'Show'; } }, 'Show');
    var btn = el('button', { class: 'btn block', type: 'submit' }, 'Sign in');
    var form = el('form', { class: 'card', onsubmit: function (e) {
      e.preventDefault();
      busy(btn, api('login', { email: email.value, password: pw.value })).then(function (r) {
        if (!r.ok) { flash('err', r.error || 'Could not sign in.'); return render(); }
        setTok(r.token); S.user = r.user; S.tab = null; render();
      });
    } }, el('h2', {}, 'Welcome back'), el('p', { class: 'sub' }, 'Sign in with the email and password the IP Owner gave you.'), flashBox(),
      field('Email', el('div', { class: 'in' }, svg(IC_MAIL), email)), field('Password', el('div', { class: 'in' }, svg(IC_LOCK), pw, eye)), btn);
    root.appendChild(el('div', { class: 'hero' }, el('img', { class: 'mk', src: 'logo.png', alt: 'STEVEXA' }), el('h1', {}, 'STEVEXA Partners'), el('span', { class: 'tag' }, 'Partners & Business Developers'), svg(WAVE)));
    root.appendChild(el('div', { class: 'loginwrap' }, form, el('p', { class: 'regnote' }, 'To register/sign-up, contact 08025457275/07057348203'), footer()));
    window.SX_ON_READY && window.SX_ON_READY();
  }

  function pwCard(forced) {
    var cur = el('input', { type: 'password', autocomplete: 'current-password', required: true }), np = el('input', { type: 'password', autocomplete: 'new-password', required: true }), cf = el('input', { type: 'password', autocomplete: 'new-password', required: true });
    var btn = el('button', { class: 'btn block', type: 'submit' }, 'Save new password');
    return el('form', { class: 'card', onsubmit: function (e) {
      e.preventDefault();
      if (np.value !== cf.value) { flash('err', 'The new passwords do not match.'); return render(); }
      busy(btn, api('change_password', { current: cur.value, password: np.value })).then(function (r) {
        if (!r.ok) { flash('err', r.error); return render(); }
        S.user.mustChange = false; S.tab = null; flash('ok', 'Your password has been changed.'); render();
      });
    } }, el('h2', {}, forced ? 'Choose your own password' : 'Change password'),
      el('p', { class: 'sub' }, forced ? 'You signed in with a temporary password. Choose a new one: 10+ characters, upper and lower case letters, and a number.' : '10+ characters, upper and lower case letters, and a number.'),
      field(forced ? 'Temporary password' : 'Current password', cur), field('New password', np), field('Repeat new password', cf), btn);
  }
  function renderForcedPw() {
    root.appendChild(el('div', { class: 'hero' }, el('img', { class: 'mk', src: 'logo.png', alt: '' }), el('h1', {}, 'Almost there'), svg(WAVE)));
    root.appendChild(el('div', { class: 'loginwrap' }, flashBox(), pwCard(true), footer()));
    window.SX_ON_READY && window.SX_ON_READY();
  }

  /* ---------- views ---------- */
  var VIEWS = {};

  // ===== IP owner
  VIEWS.overview = function () {
    return api('owner_summary').then(function (r) {
      if (!r.ok) return err(r);
      var by = { developer: 0, bd: 0, partner: 0, unallocated: 0, pilot: 0 };
      r.rows.forEach(function (x) { by[x.kind] += x.total; });
      var warn = Math.abs(r.poolShareTotal - 100) > 0.001 ? el('div', { class: 'msg warn' }, 'Partner shares of the pool add up to ' + pct(r.poolShareTotal) + ', not 100%. The difference stays unallocated.') : null;
      var order = { pilot: 0, developer: 1, bd: 2, partner: 3, unallocated: 4 }, names = { pilot: 'Pilot schools (100% to you)', developer: 'IP Owner', bd: 'Business developer', partner: 'Partner', unallocated: 'Unallocated' };
      var rows = r.rows.slice().sort(function (a, b) { return order[a.kind] - order[b.kind] || a.name.localeCompare(b.name); }).map(function (x) {
        var who = x.kind === 'unallocated' ? 'Rounding, and the business-developer % when a payment has no commission' : (x.kind === 'partner' && x.label && x.label !== x.name ? x.name + ' – ' + x.label : x.name);
        return [names[x.kind], who, naira(x.total), x.kind === 'unallocated' ? '' : naira(x.pending), x.kind === 'unallocated' ? '' : naira(x.paidOut)];
      });
      var mine = by.developer + by.pilot;
      return el('div', {}, warn, hero('Revenue collected', naira(r.gross), 'From all schools, after every recorded payment'),
        el('div', { class: 'kpis' }, kpi('Yours (50% + pilot)', naira(mine)), kpi('Pilot schools', naira(by.pilot)), kpi('Business developers', naira(by.bd)), kpi('Partner pool (' + r.config.poolFirstPct + '% / ' + r.config.poolRenewalPct + '%)', naira(by.partner))),
        card('Who gets what', null, rows.length ? table(['Role', 'Name', 'Total', 'To pay out', 'Paid out'], rows, [2, 3, 4]) : empty('No payments recorded yet.')));
    });
  };

  VIEWS.people = function () {
    return api('users_list').then(function (r) {
      if (!r.ok) return err(r);
      var role = el('select', {}, el('option', { value: 'bd' }, 'Business developer'), el('option', { value: 'partner' }, 'Partner (shares the remaining pool)'));
      var name = el('input', { required: true }), email = el('input', { type: 'email', required: true }), phone = el('input', { type: 'tel' }), label = el('input', { placeholder: 'e.g. DE-TECHPATHSOL, Legal Adviser' });
      var rate = el('input', { type: 'number', step: '0.01', min: '0', max: '10', value: '10' }), pool = el('input', { type: 'number', step: '0.01', min: '0.01', max: '100' });
      var rateF = field('Commission on a first payment (max 10%; renewals pay up to 5%)', rate), poolF = field('Share of the remaining pool (%)', pool);
      function sync() { rateF.style.display = role.value === 'bd' ? '' : 'none'; poolF.style.display = role.value === 'partner' ? '' : 'none'; }
      role.addEventListener('change', sync); sync();
      var btn = el('button', { class: 'btn', type: 'submit' }, 'Create account');
      var form = el('form', { class: 'card', onsubmit: function (e) {
        e.preventDefault();
        busy(btn, api('user_create', { role: role.value, name: name.value, email: email.value, phone: phone.value, label: label.value, rate: rate.value, poolShare: pool.value })).then(function (x) {
          if (!x.ok) { flash('err', x.error); return render(); }
          S.temp = { who: name.value, pw: x.tempPassword }; render();
        });
      } }, el('h2', {}, 'Register a business developer or partner'), el('p', { class: 'sub' }, 'Only you can do this. They sign in with a temporary password that is shown once, then choose their own.'),
        el('div', { class: 'grid' }, field('Account type', role), field('Full name', name), field('Email', email), field('Phone', phone), field('Label (optional)', label), rateF, poolF), btn);
      var temp = null;
      if (S.temp) { temp = card(null, null, el('div', { class: 'msg ok' }, 'Account created for ' + S.temp.who + '. Send them this temporary password now. It is not shown again:'), el('div', { class: 'pw' }, S.temp.pw)); S.temp = null; }
      var list = r.users.map(function (u) {
        var share = u.role === 'bd' ? pct(u.rate) + ' commission' : u.role === 'partner' ? pct(u.poolShare) + ' of pool' : 'Owner';
        var btns = u.role === 'owner' ? null : [
          el('button', { class: 'btn sm ghost', onclick: function () { if (confirm('Reset the password for ' + u.name + '?')) api('user_reset_password', { id: u.id }).then(function (x) { if (x.ok) S.temp = { who: u.name, pw: x.tempPassword }; else flash('err', x.error); render(); }); } }, 'Reset password'),
          el('button', { class: 'btn sm ' + (u.active ? 'red' : 'ghost'), onclick: function () { api('user_update', { id: u.id, name: u.name, phone: u.phone, label: u.label, rate: u.rate, poolShare: u.poolShare, active: !u.active }).then(function (x) { flash(x.ok ? 'ok' : 'err', x.ok ? u.name + (u.active ? ' deactivated.' : ' activated.') : x.error); render(); }); } }, u.active ? 'Deactivate' : 'Activate')];
        return row(initials(u.name), u.name, [sub(ROLE_NAME[u.role] + (u.label && u.role === 'partner' ? ' – ' + u.label : '') + ' · ' + share), sub(u.email + (u.active ? '' : ' · DEACTIVATED'))], null, btns, u.role === 'owner' ? 'orange' : u.role === 'partner' ? 'green' : '');
      });
      return el('div', {}, temp, form, card('Everyone with access', null, el('div', { class: 'rows' }, list)));
    });
  };

  var STATES = ['Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue', 'Borno', 'Cross River', 'Delta', 'Ebonyi', 'Edo', 'Ekiti', 'Enugu', 'FCT Abuja', 'Gombe', 'Imo', 'Jigawa', 'Kaduna', 'Kano', 'Katsina', 'Kebbi', 'Kogi', 'Kwara', 'Lagos', 'Nasarawa', 'Niger', 'Ogun', 'Ondo', 'Osun', 'Oyo', 'Plateau', 'Rivers', 'Sokoto', 'Taraba', 'Yobe', 'Zamfara'];
  function stateSelect() { return el('select', { required: true }, el('option', { value: '' }, 'Choose…'), STATES.map(function (s) { return el('option', { value: s }, s); })); }

  VIEWS.schools = function () {
    return Promise.all([api('schools_all'), api('users_list')]).then(function (rs) {
      var r = rs[0], u = rs[1];
      if (!r.ok) return err(r);
      var bds = (u.users || []).filter(function (x) { return x.role === 'bd' && x.active; });
      // --- record payment
      var sel = el('select', { required: true }, el('option', { value: '' }, 'Choose…'), r.schools.map(function (s) { return el('option', { value: s.id }, s.name + ' (' + s.state + ')' + (s.pilot ? ' – pilot' : '')); }));
      var note = el('div', { class: 'msg info', style: 'display:none;margin-top:12px' }, 'Pilot school: the whole amount goes to you. Nothing is shared with partners or business developers.');
      sel.addEventListener('change', function () { var s = r.schools.filter(function (x) { return x.id === sel.value; })[0]; note.style.display = s && s.pilot ? '' : 'none'; });
      var amount = el('input', { required: true, inputmode: 'decimal', placeholder: '150000' }), paid = el('input', { type: 'date', required: true, value: new Date().toISOString().slice(0, 10) }),
        ps = el('input', { type: 'date', required: true }), pe = el('input', { type: 'date', required: true }), lab = el('input', { placeholder: '2026/2027 first term' }), ref = el('input');
      var pbtn = el('button', { class: 'btn', type: 'submit' }, 'Record payment');
      var payForm = el('form', { class: 'card', onsubmit: function (e) {
        e.preventDefault();
        busy(pbtn, api('payment_add', { schoolId: sel.value, amount: amount.value, paidOn: paid.value, periodStart: ps.value, periodEnd: pe.value, label: lab.value, reference: ref.value })).then(function (x) {
          flash(x.ok ? 'ok' : 'err', x.ok ? 'Payment recorded and shared out.' : x.error); render();
        });
      } }, el('h2', {}, 'Record a payment'), el('div', { class: 'grid' }, field('School', sel), field('Amount collected (₦)', amount), field('Date received', paid), field('Period starts', ps), field('Period ends', pe), field('Label (optional)', lab), field('Reference (optional)', ref)), note,
        el('p', { class: 'hint', style: 'margin:14px 0 0' }, 'Worked out automatically. A school\u2019s first payment: you 50%, business developer 10%, partners 40%. Every renewal after that: you 50%, business developer 5%, partners 45%.'), pbtn);
      // --- register school (for a business developer, or as a pilot)
      var bdSel = el('select', { required: true }, el('option', { value: '' }, 'Choose…'), el('option', { value: '__pilot__' }, 'PILOT SCHOOL – 100% to me, no business developer'), bds.map(function (b) { return el('option', { value: b.id }, b.name); }));
      var f = {}; ['name', 'town', 'contactName', 'contactPhone', 'contactEmail'].forEach(function (k) { f[k] = el('input', { required: k === 'name' || k === 'contactName' || k === 'contactPhone' }); });
      var stateSel = stateSelect(), rbtn = el('button', { class: 'btn', type: 'submit' }, 'Register school');
      var regForm = el('form', { class: 'card', onsubmit: function (e) {
        e.preventDefault();
        var pilot = bdSel.value === '__pilot__', body = { name: f.name.value, state: stateSel.value, town: f.town.value, contactName: f.contactName.value, contactPhone: f.contactPhone.value, contactEmail: f.contactEmail.value };
        if (!pilot) body.bdId = bdSel.value;
        busy(rbtn, api(pilot ? 'school_register_pilot' : 'school_register_for', body)).then(function (x) {
          flash(x.ok ? 'ok' : 'err', x.ok ? (pilot ? 'Pilot school registered. You keep 100% of its revenue.' : 'School registered.') : x.error); render();
        });
      } }, el('h2', {}, 'Register a school'), el('p', { class: 'sub' }, 'Choose a business developer, or choose PILOT to keep 100% of the school’s revenue yourself.'),
        el('div', { class: 'grid' }, field('Business developer / pilot', bdSel), field('School name', f.name), field('State', stateSel), field('Town', f.town), field('Contact person', f.contactName), field('Contact phone', f.contactPhone), field('Contact email', f.contactEmail)), rbtn);
      // --- list
      var list = r.schools.map(function (s) {
        var btn = el('button', { class: 'btn sm ghost', onclick: function () {
          var msg = s.pilot ? 'Make "' + s.name + '" a regular school? Payments recorded from now on will be shared with the partners.' : 'Make "' + s.name + '" a pilot school? Payments recorded from now on go 100% to you.';
          if (confirm(msg)) api('school_set_pilot', { schoolId: s.id, pilot: !s.pilot }).then(function (x) { flash(x.ok ? 'ok' : 'err', x.ok ? 'Updated.' : x.error); render(); });
        } }, s.pilot ? 'Make regular' : 'Make pilot');
        return row(initials(s.name), s.name, [sub([s.town, s.state].filter(Boolean).join(', ')), sub(s.contactName + ' · ' + s.contactPhone), sub(s.pilot ? 'Pilot: no business developer' : 'Business developer: ' + (s.bd || '—')), el('span', { class: 'pill ' + s.status }, s.statusLabel)], null, btn, s.pilot ? 'orange' : '');
      });
      return el('div', {}, payForm, regForm, card('All schools (' + r.schools.length + ')', null, list.length ? el('div', { class: 'rows' }, list) : empty('No schools yet.')));
    });
  };

  VIEWS.payments = function () {
    return api('payments_list').then(function (r) {
      if (!r.ok) return err(r);
      var list = r.payments.map(function (p) {
        var btn = p.voided ? el('span', { class: 'pill' }, 'Voided') : el('button', { class: 'btn sm red', onclick: function () { var why = prompt('Reason for voiding this payment?'); if (why) api('payment_void', { id: p.id, reason: why }).then(function (x) { flash(x.ok ? 'ok' : 'err', x.ok ? 'Payment voided.' : x.error); render(); }); } }, 'Void');
        return row('₦', p.school, [sub(p.paidOn + ' · ' + (p.label || 'Payment')), sub('Period ' + p.periodStart + ' → ' + p.periodEnd), sub(p.type === 'pilot' ? 'Pilot: 100% to you' : p.type === 'renewal' ? 'Renewal (5% business developer)' : 'First payment (10% business developer)')], naira(p.amountKobo), btn, 'green');
      });
      return card('Payments', null, list.length ? el('div', { class: 'rows' }, list) : empty('No payments yet.'));
    });
  };

  VIEWS.payouts = function () {
    return api('owner_summary').then(function (r) {
      if (!r.ok) return err(r);
      var due = r.rows.filter(function (x) { return x.kind !== 'unallocated' && x.pending > 0; });
      var total = due.reduce(function (a, x) { return a + x.pending; }, 0);
      var list = due.map(function (x) {
        var btn = el('button', { class: 'btn sm', onclick: function () { if (confirm('Mark ' + naira(x.pending) + ' as paid out to ' + x.name + '? Do this only after the money has been sent.')) api('payout_mark', { userId: x.userId }).then(function (y) { flash(y.ok ? 'ok' : 'err', y.ok ? naira(y.totalKobo) + ' marked as paid to ' + x.name + '.' : y.error); render(); }); } }, 'Mark paid');
        return row(initials(x.name), x.name, sub({ bd: 'Business developer', partner: x.label || 'Partner', developer: 'IP Owner share', pilot: 'Pilot schools' }[x.kind]), naira(x.pending), btn, x.kind === 'partner' ? 'green' : x.kind === 'bd' ? '' : 'orange');
      });
      return el('div', {}, hero('Waiting to be paid out', naira(total), 'Includes your own share. Mark a line paid only after the money has left.', 'orange'),
        card('Who is owed', null, list.length ? el('div', { class: 'rows' }, list) : empty('Nothing is waiting to be paid out.')));
    });
  };

  VIEWS.audit = function () {
    return api('audit_list').then(function (r) {
      if (!r.ok) return err(r);
      return card('Audit trail (latest 300)', null, table(['When (UTC)', 'Who', 'Action', 'Detail'], r.entries.map(function (a) { return [a.at.replace('T', ' ').replace('Z', ''), a.user, a.action, a.detail]; })));
    });
  };

  // ===== business developer
  VIEWS.myschools = function () {
    return api('bd_schools').then(function (r) {
      if (!r.ok) return err(r);
      var earned = r.schools.reduce(function (a, s) { return a + s.commissionKobo; }, 0);
      var list = r.schools.map(function (s) {
        return row(initials(s.name), s.name, [sub([s.town, s.state].filter(Boolean).join(', ') + ' · registered ' + s.registeredAt.slice(0, 10)), el('span', { class: 'pill ' + s.status }, s.statusLabel), s.status === 'paid' ? sub(s.daysLeft + ' days of subscription left') : null], naira(s.commissionKobo), null, s.status === 'paid' ? 'green' : '');
      });
      return el('div', {}, hero('Schools registered by you', String(r.schools.length), 'Commission so far: ' + naira(earned)),
        card('My schools', null, list.length ? el('div', { class: 'rows' }, list) : empty('You have not registered a school yet. Tap Register to add one.')));
    });
  };

  VIEWS.register = function () {
    var f = {}; ['name', 'town', 'contactName', 'contactPhone', 'contactEmail'].forEach(function (k) { f[k] = el('input', { required: k === 'name' || k === 'contactName' || k === 'contactPhone' }); });
    var st = stateSelect(), hits = el('div'), timer = null;
    f.name.addEventListener('input', function () {
      clearTimeout(timer); var q = f.name.value;
      if (q.trim().length < 3) { hits.textContent = ''; return; }
      timer = setTimeout(function () {
        api('bd_check_name', { q: q }).then(function (r) {
          hits.textContent = '';
          if (r.ok && r.results.length) hits.appendChild(el('div', { class: 'msg warn', style: 'margin-top:12px' }, 'Already on STEVEXA: ' + r.results.map(function (x) { return x.name + (x.yours ? ' (yours)' : ''); }).join(', ')));
        });
      }, 350);
    });
    var btn = el('button', { class: 'btn block', type: 'submit' }, 'Register school');
    return Promise.resolve(el('form', { class: 'card', onsubmit: function (e) {
      e.preventDefault();
      busy(btn, api('bd_register', { name: f.name.value, state: st.value, town: f.town.value, contactName: f.contactName.value, contactPhone: f.contactPhone.value, contactEmail: f.contactEmail.value })).then(function (x) {
        if (x.ok) { flash('ok', 'School registered. It is now protected in your name for 90 days.'); S.tab = 'myschools'; } else flash('err', x.error);
        render();
      });
    } }, el('h2', {}, 'Register a school'), el('p', { class: 'sub' }, 'A registered school is protected in your name for 90 days, and for as long as it subscribes.'),
      el('div', { class: 'grid' }, field('School name', f.name), field('State', st), field('Town', f.town), field('Contact person', f.contactName), field('Contact phone', f.contactPhone), field('Contact email (optional)', f.contactEmail)), hits, btn));
  };

  VIEWS.commission = function () {
    return api('bd_commission').then(function (r) {
      if (!r.ok) return err(r);
      var list = r.lines.map(function (l) { return row('₦', l.school, [sub(l.paidOn), el('span', { class: 'pill ' + l.status }, l.status === 'paid_out' ? 'Paid out ' + l.paidOutOn : 'Waiting to be paid')], naira(l.amountKobo), null, l.status === 'paid_out' ? 'green' : 'orange'); });
      return el('div', {}, hero('Waiting to be paid', naira(r.totals.pending), pct(r.rate) + ' on a school\u2019s first payment, ' + pct(Math.min(r.rate, 5)) + ' on every renewal', 'orange'),
        el('div', { class: 'kpis' }, kpi('Already paid out', naira(r.totals.paidOut), 'ok'), kpi('Total earned', naira(r.totals.total))),
        card('My commission', null, list.length ? el('div', { class: 'rows' }, list) : empty('No commission yet. It appears when a school you registered pays.')));
    });
  };

  // ===== partner
  VIEWS.share = function () {
    return api('partner_summary').then(function (r) {
      if (!r.ok) return err(r);
      var rows = [];
      r.table.forEach(function (t) {
        rows.push({ cls: t.pool ? 'pool' : '', cells: [t.name, t.rule, naira(t.kobo)] });
        if (t.pool) r.partners.forEach(function (p) { rows.push({ cls: p.mine ? 'me' : '', cells: [' ' + p.name + (p.mine ? '  (you)' : ''), p.rule, naira(p.kobo)] }); });
      });
      if (r.unallocatedKobo) rows.push(['Not yet allocated', '', naira(r.unallocatedKobo)]);
      rows.push({ cls: 'total', cells: ['Total collected', '100%', naira(r.gross)] });
      var lines = r.lines.map(function (l) {
        return row('₦', l.school, [sub(l.paidOn + ' · ' + pct(l.pctOfGross) + ' of ' + naira(l.grossKobo)), el('span', { class: 'pill ' + l.status }, l.status === 'paid_out' ? 'Paid out ' + l.paidOutOn : 'Waiting to be paid')], naira(l.amountKobo), null, l.status === 'paid_out' ? 'green' : 'orange');
      });
      return el('div', {}, hero('Total earned by you', naira(r.totals.total), 'Your share is ' + pct(r.poolShare) + ' of the remaining pool'),
        el('div', { class: 'kpis' }, kpi('Waiting to be paid', naira(r.totals.pending), 'warn'), kpi('Already paid out', naira(r.totals.paidOut), 'ok')),
        card('How the revenue is shared', 'Worked out on money actually collected.', table(['Beneficiary', 'Rule', 'Amount'], rows, [2])),
        card('My share, payment by payment', null, lines.length ? el('div', { class: 'rows' }, lines) : empty('Nothing yet. Your share appears here whenever a school payment is recorded.')));
    });
  };

  /* ---------- start ---------- */
  if (tok()) api('me').then(function (r) { if (r.ok) S.user = r.user; else setTok(''); render(); }); else render();
})();
