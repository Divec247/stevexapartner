/* STEVEXA Partners - web page. All security is enforced by the Apps Script backend; this page only decides what to show. */
(function () {
  'use strict';
  var root = document.getElementById('app');
  var S = { user: null, tab: null, flash: null };

  /* ---------- tiny helpers (everything user-supplied goes through textContent: no HTML injection) ---------- */
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
  function naira(kobo) { var v = (Number(kobo) || 0) / 100; return '₦' + v.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function pct(p) { return (Math.round(p * 100) / 100) + '%'; }
  function tok() { try { return sessionStorage.getItem('sx_token') || ''; } catch (e) { return ''; } }
  function setTok(t) { try { if (t) sessionStorage.setItem('sx_token', t); else sessionStorage.removeItem('sx_token'); } catch (e) {} }

  function api(action, data) {
    if (!window.STEVEXA_API) return Promise.resolve({ ok: false, error: 'The server address is not set yet (docs/config.js).' });
    return fetch(window.STEVEXA_API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(Object.assign({ action: action, token: tok() }, data || {})) })
      .then(function (r) { return r.json(); })
      .then(function (j) { if (j && j.expired) { signOut(true); } return j; })
      .catch(function () { return { ok: false, error: 'Could not reach the server. Check your internet connection.' }; });
  }
  function flash(type, text) { S.flash = { type: type, text: text }; }
  function flashBox() { var f = S.flash; S.flash = null; return f ? el('div', { class: 'msg ' + f.type }, f.text) : null; }
  function table(heads, rows, numCols) {
    numCols = numCols || [];
    return el('table', {}, el('thead', {}, el('tr', {}, heads.map(function (h, i) { return el('th', { class: numCols.indexOf(i) >= 0 ? 'n' : '' }, h); }))),
      el('tbody', {}, rows.map(function (r) {
        var cls = r.cls; var cells = r.cells || r;
        return el('tr', { class: cls || '' }, cells.map(function (c, i) { return el('td', { class: numCols.indexOf(i) >= 0 ? 'n' : '' }, c); }));
      })));
  }
  function field(label, input) { return el('div', {}, el('label', {}, label), input); }
  function busy(btn, p) { btn.disabled = true; return p.then(function (r) { btn.disabled = false; return r; }); }

  /* ---------- shell ---------- */
  var TABS = {
    owner: [['overview', 'Overview'], ['people', 'People'], ['schools', 'Schools'], ['payments', 'Payments'], ['payouts', 'Payouts'], ['audit', 'Audit trail']],
    partner: [['share', 'My share']],
    bd: [['myschools', 'My schools'], ['register', 'Register a school'], ['commission', 'My commission']]
  };
  var ROLE_NAME = { owner: 'IP Owner', partner: 'Partner', bd: 'Business developer' };

  function signOut(expired) {
    setTok(''); S.user = null; S.tab = null;
    if (expired) flash('warn', 'Your session ended. Please sign in again.');
    render();
  }

  function render() {
    root.textContent = '';
    if (!S.user) return renderLogin();
    if (S.user.mustChange) return renderChangePw(true);
    var tabs = TABS[S.user.role] || [];
    if (!S.tab || (S.tab !== '_pw' && !tabs.some(function (t) { return t[0] === S.tab; }))) S.tab = tabs[0] && tabs[0][0];
    var fl = flashBox(), body = el('main', {}, fl, el('div', { class: 'card' }, 'Loading…'));
    root.appendChild(el('header', {}, el('b', {}, 'STEVEXA Partners'),
      el('span', { class: 'who' }, S.user.name + ' · ' + ROLE_NAME[S.user.role] + '  ',
        el('button', { class: 'b s g', onclick: function () { S.tab = '_pw'; render(); } }, 'Password'), ' ',
        el('button', { class: 'b s g', onclick: function () { signOut(); } }, 'Sign out'))));
    root.appendChild(el('nav', {}, tabs.map(function (t) { return el('button', { class: S.tab === t[0] ? 'on' : '', onclick: function () { S.tab = t[0]; render(); } }, t[1]); })));
    root.appendChild(body);
    if (S.tab === '_pw') { body.textContent = ''; add(body, fl); body.appendChild(pwCard(false)); return; }
    (VIEWS[S.tab] || function () { return Promise.resolve(el('div')); })().then(function (node) { body.textContent = ''; add(body, fl); body.appendChild(node); });
  }

  function renderLogin() {
    var email = el('input', { type: 'email', autocomplete: 'username', required: true }), pw = el('input', { type: 'password', autocomplete: 'current-password', required: true });
    var btn = el('button', { class: 'b', type: 'submit' }, 'Sign in');
    var form = el('form', { class: 'card', onsubmit: function (e) {
      e.preventDefault();
      busy(btn, api('login', { email: email.value, password: pw.value })).then(function (r) {
        if (!r.ok) { flash('err', r.error || 'Could not sign in.'); return render(); }
        setTok(r.token); S.user = r.user; S.tab = null; render();
      });
    } }, el('h2', {}, 'STEVEXA Partners'), flashBox(), field('Email', email), field('Password', pw), btn);
    root.appendChild(el('div', { class: 'login' }, form));
  }

  function pwCard(forced) {
    var cur = el('input', { type: 'password', autocomplete: 'current-password', required: true }), np = el('input', { type: 'password', autocomplete: 'new-password', required: true }), cf = el('input', { type: 'password', autocomplete: 'new-password', required: true });
    var btn = el('button', { class: 'b', type: 'submit' }, 'Change password');
    return el('form', { class: 'card', onsubmit: function (e) {
      e.preventDefault();
      if (np.value !== cf.value) { flash('err', 'The new passwords do not match.'); return render(); }
      busy(btn, api('change_password', { current: cur.value, password: np.value })).then(function (r) {
        if (!r.ok) { flash('err', r.error); return render(); }
        S.user.mustChange = false; S.tab = null; flash('ok', 'Your password has been changed.'); render();
      });
    } }, el('h2', {}, forced ? 'Choose your own password' : 'Change password'),
      forced ? el('p', { class: 'hint' }, 'You signed in with a temporary password. Choose a new one (10+ characters, upper and lower case, and a number).') : null,
      field(forced ? 'Temporary password' : 'Current password', cur), field('New password', np), field('Repeat new password', cf), btn);
  }
  function renderChangePw() { root.appendChild(el('main', {}, el('div', { class: 'login' }, flashBox(), pwCard(true)))); }

  /* ---------- views ---------- */
  var VIEWS = {};

  // ----- owner
  VIEWS.overview = function () {
    return api('owner_summary').then(function (r) {
      if (!r.ok) return el('div', { class: 'msg err' }, r.error);
      var by = { developer: 0, bd: 0, partner: 0, unallocated: 0 };
      r.rows.forEach(function (x) { by[x.kind] += x.total; });
      var warn = Math.abs(r.poolShareTotal - 100) > 0.001 ? el('div', { class: 'msg warn' }, 'Partner shares of the pool add up to ' + pct(r.poolShareTotal) + ', not 100%. Money is being left unallocated until this is 100%.') : null;
      var order = { developer: 0, bd: 1, partner: 2, unallocated: 3 }, names = { developer: 'IP Owner (developer)', bd: 'Business developer', partner: 'Partner', unallocated: 'Unallocated' };
      var rows = r.rows.slice().sort(function (a, b) { return order[a.kind] - order[b.kind] || a.name.localeCompare(b.name); }).map(function (x) {
        return [names[x.kind], x.kind === 'unallocated' ? 'Rounding, and the business-developer % when a payment has no commission' : (x.kind === 'partner' && x.label && x.label !== x.name ? x.name + ' \u2013 ' + x.label : x.name), naira(x.total), x.kind === 'unallocated' ? '' : naira(x.pending), x.kind === 'unallocated' ? '' : naira(x.paidOut)];
      });
      return el('div', {}, warn,
        el('div', { class: 'kpis' }, kpi('Revenue collected', naira(r.gross)), kpi('IP Owner (' + r.config.devPct + '%)', naira(by.developer)), kpi('Business developers', naira(by.bd)), kpi('Partner pool (' + r.config.poolPct + '%)', naira(by.partner))),
        el('div', { class: 'card' }, el('h2', {}, 'Who gets what'), rows.length ? table(['Role', 'Name', 'Total', 'To pay out', 'Paid out'], rows, [2, 3, 4]) : el('p', { class: 'hint' }, 'No payments recorded yet.')));
    });
  };
  function kpi(label, value) { return el('div', { class: 'card' }, el('small', {}, label), el('div', { class: 'big' }, value)); }

  VIEWS.people = function () {
    return api('users_list').then(function (r) {
      if (!r.ok) return el('div', { class: 'msg err' }, r.error);
      var shown = el('div');
      var role = el('select', {}, el('option', { value: 'bd' }, 'Business developer'), el('option', { value: 'partner' }, 'Partner (shares the remaining pool)'));
      var name = el('input', { required: true }), email = el('input', { type: 'email', required: true }), phone = el('input'), label = el('input', { placeholder: 'e.g. DE-TECHPATHSOL, Legal Adviser' });
      var rate = el('input', { type: 'number', step: '0.01', min: '0', max: '10', value: '10' }), pool = el('input', { type: 'number', step: '0.01', min: '0.01', max: '100' });
      var rateF = field('Commission rate (% of the school payment, max 10)', rate), poolF = field('Share of the remaining pool (%)', pool);
      function sync() { rateF.style.display = role.value === 'bd' ? '' : 'none'; poolF.style.display = role.value === 'partner' ? '' : 'none'; }
      role.addEventListener('change', sync); sync();
      var btn = el('button', { class: 'b', type: 'submit' }, 'Create account');
      var form = el('form', { class: 'card', onsubmit: function (e) {
        e.preventDefault();
        busy(btn, api('user_create', { role: role.value, name: name.value, email: email.value, phone: phone.value, label: label.value, rate: rate.value, poolShare: pool.value })).then(function (x) {
          if (!x.ok) { flash('err', x.error); return render(); }
          S.tempShown = { who: name.value, pw: x.tempPassword }; render();
        });
      } }, el('h2', {}, 'Register a business developer or partner'), el('p', { class: 'hint' }, 'Only you can do this. They sign in with the temporary password shown once, and must choose their own.'),
        el('div', { class: 'row' }, field('Account type', role), field('Full name', name), field('Email', email), field('Phone', phone), field('Label (optional)', label), rateF, poolF), btn);
      var temp = null;
      if (S.tempShown) { temp = el('div', { class: 'card' }, el('div', { class: 'msg ok' }, 'Account created for ' + S.tempShown.who + '. Send them this temporary password now; it is not shown again:'), el('div', { class: 'pw' }, S.tempShown.pw)); S.tempShown = null; }
      var rows = r.users.map(function (u) {
        var acts = u.role === 'owner' ? '' : [
          el('button', { class: 'b s g', onclick: function () { if (confirm('Reset the password for ' + u.name + '?')) api('user_reset_password', { id: u.id }).then(function (x) { if (x.ok) S.tempShown = { who: u.name, pw: x.tempPassword }; else flash('err', x.error); render(); }); } }, 'Reset password'), ' ',
          el('button', { class: 'b s g', onclick: function () { api('user_update', { id: u.id, name: u.name, phone: u.phone, label: u.label, rate: u.rate, poolShare: u.poolShare, active: !u.active }).then(function (x) { flash(x.ok ? 'ok' : 'err', x.ok ? u.name + (u.active ? ' deactivated.' : ' activated.') : x.error); render(); }); } }, u.active ? 'Deactivate' : 'Activate')];
        return [u.name, ROLE_NAME[u.role] + (u.label && u.role === 'partner' ? ' – ' + u.label : ''), u.email, u.role === 'bd' ? pct(u.rate) + ' of payment' : u.role === 'partner' ? pct(u.poolShare) + ' of pool' : '', u.active ? 'Active' : 'Off', acts];
      });
      return el('div', {}, temp, form, el('div', { class: 'card' }, el('h2', {}, 'Everyone with access'), table(['Name', 'Role', 'Email', 'Share', 'Status', ''], rows)));
    });
  };

  VIEWS.schools = function () {
    return Promise.all([api('schools_all'), api('users_list')]).then(function (rs) {
      var r = rs[0], u = rs[1];
      if (!r.ok) return el('div', { class: 'msg err' }, r.error);
      var bds = (u.users || []).filter(function (x) { return x.role === 'bd' && x.active; });
      var sel = el('select', { required: true }, el('option', { value: '' }, 'Choose…'), r.schools.map(function (s) { return el('option', { value: s.id }, s.name + ' (' + s.state + ')'); }));
      var amount = el('input', { required: true, inputmode: 'decimal', placeholder: '150000' }), paid = el('input', { type: 'date', required: true, value: new Date().toISOString().slice(0, 10) }),
        ps = el('input', { type: 'date', required: true }), pe = el('input', { type: 'date', required: true }), lab = el('input', { placeholder: '2026/2027 first term' }), ref = el('input'),
        com = el('input', { type: 'checkbox', checked: 'checked', style: 'width:auto' });
      var pbtn = el('button', { class: 'b', type: 'submit' }, 'Record payment');
      var payForm = el('form', { class: 'card', onsubmit: function (e) {
        e.preventDefault();
        busy(pbtn, api('payment_add', { schoolId: sel.value, amount: amount.value, paidOn: paid.value, periodStart: ps.value, periodEnd: pe.value, label: lab.value, reference: ref.value, commissionable: com.checked })).then(function (x) {
          flash(x.ok ? 'ok' : 'err', x.ok ? 'Payment recorded and split between everyone.' : x.error); render();
        });
      } }, el('h2', {}, 'Record a payment'), el('div', { class: 'row' }, field('School', sel), field('Amount collected (₦)', amount), field('Date received', paid), field('Period starts', ps), field('Period ends', pe), field('Label (optional)', lab), field('Reference (optional)', ref)),
        el('label', {}, com, ' New-customer payment: business developer earns commission'), pbtn);
      var bdSel = el('select', { required: true }, el('option', { value: '' }, 'Choose…'), bds.map(function (b) { return el('option', { value: b.id }, b.name); }));
      var f = {}; ['name', 'town', 'contactName', 'contactPhone', 'contactEmail'].forEach(function (k) { f[k] = el('input', { required: k === 'name' || k === 'contactName' || k === 'contactPhone' }); });
      var rbtn = el('button', { class: 'b', type: 'submit' }, 'Register school');
      var regForm = el('form', { class: 'card', onsubmit: function (e) {
        e.preventDefault();
        busy(rbtn, api('school_register_for', { bdId: bdSel.value, name: f.name.value, state: stateSel.value, town: f.town.value, contactName: f.contactName.value, contactPhone: f.contactPhone.value, contactEmail: f.contactEmail.value })).then(function (x) {
          flash(x.ok ? 'ok' : 'err', x.ok ? 'School registered.' : x.error); render();
        });
      } }, el('h2', {}, 'Register a school for a business developer'), el('div', { class: 'row' }, field('Business developer', bdSel), field('School name', f.name), field('State', null), field('Town', f.town), field('Contact person', f.contactName), field('Contact phone', f.contactPhone), field('Contact email', f.contactEmail)), rbtn);
      var stateSel = stateSelect(); regForm.querySelectorAll('label')[2].after(stateSel);
      var rows = r.schools.map(function (s) { return [s.name, [s.town, s.state].filter(Boolean).join(', '), s.contactName + ' · ' + s.contactPhone, s.bd, el('span', { class: 'pill ' + s.status }, s.statusLabel)]; });
      return el('div', {}, payForm, regForm, el('div', { class: 'card' }, el('h2', {}, 'All schools (' + r.schools.length + ')'), table(['School', 'Location', 'Contact', 'Business developer', 'Status'], rows)));
    });
  };

  var STATES = ['Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue', 'Borno', 'Cross River', 'Delta', 'Ebonyi', 'Edo', 'Ekiti', 'Enugu', 'FCT Abuja', 'Gombe', 'Imo', 'Jigawa', 'Kaduna', 'Kano', 'Katsina', 'Kebbi', 'Kogi', 'Kwara', 'Lagos', 'Nasarawa', 'Niger', 'Ogun', 'Ondo', 'Osun', 'Oyo', 'Plateau', 'Rivers', 'Sokoto', 'Taraba', 'Yobe', 'Zamfara'];
  function stateSelect() { return el('select', { required: true }, el('option', { value: '' }, 'Choose…'), STATES.map(function (s) { return el('option', { value: s }, s); })); }

  VIEWS.payments = function () {
    return api('payments_list').then(function (r) {
      if (!r.ok) return el('div', { class: 'msg err' }, r.error);
      var rows = r.payments.map(function (p) {
        return { cls: p.voided ? 'void' : '', cells: [p.paidOn, p.school, p.label || '', p.periodStart + ' → ' + p.periodEnd, naira(p.amountKobo), p.commissionable ? 'New customer' : 'Renewal / no commission',
          p.voided ? 'Voided' : el('button', { class: 'b s g', onclick: function () { var why = prompt('Reason for voiding this payment?'); if (why) api('payment_void', { id: p.id, reason: why }).then(function (x) { flash(x.ok ? 'ok' : 'err', x.ok ? 'Payment voided.' : x.error); render(); }); } }, 'Void')] };
      });
      return el('div', { class: 'card' }, el('h2', {}, 'Payments'), rows.length ? table(['Received', 'School', 'Label', 'Period', 'Amount', 'Type', ''], rows, [4]) : el('p', { class: 'hint' }, 'No payments yet.'));
    });
  };

  VIEWS.payouts = function () {
    return api('owner_summary').then(function (r) {
      if (!r.ok) return el('div', { class: 'msg err' }, r.error);
      var due = r.rows.filter(function (x) { return x.kind !== 'unallocated' && x.pending > 0; });
      var rows = due.map(function (x) {
        return [x.name, x.kind === 'bd' ? 'Business developer' : x.kind === 'partner' ? (x.label || 'Partner') : 'IP Owner', naira(x.pending),
          el('button', { class: 'b s', onclick: function () { if (confirm('Mark ' + naira(x.pending) + ' as paid out to ' + x.name + '? Do this only after the money has been sent.')) api('payout_mark', { userId: x.userId }).then(function (y) { flash(y.ok ? 'ok' : 'err', y.ok ? naira(y.totalKobo) + ' marked as paid to ' + x.name + '.' : y.error); render(); }); } }, 'Mark as paid')];
      });
      return el('div', { class: 'card' }, el('h2', {}, 'Money still to pay out'), rows.length ? table(['Name', 'Role', 'Amount', ''], rows, [2]) : el('p', { class: 'hint' }, 'Nothing is waiting to be paid out.'));
    });
  };

  VIEWS.audit = function () {
    return api('audit_list').then(function (r) {
      if (!r.ok) return el('div', { class: 'msg err' }, r.error);
      return el('div', { class: 'card' }, el('h2', {}, 'Audit trail (latest 300)'), table(['When (UTC)', 'Who', 'Action', 'Detail'], r.entries.map(function (a) { return [a.at.replace('T', ' ').replace('Z', ''), a.user, a.action, a.detail]; })));
    });
  };

  // ----- business developer
  VIEWS.myschools = function () {
    return api('bd_schools').then(function (r) {
      if (!r.ok) return el('div', { class: 'msg err' }, r.error);
      var rows = r.schools.map(function (s) { return [s.name, [s.town, s.state].filter(Boolean).join(', '), s.registeredAt.slice(0, 10), el('span', { class: 'pill ' + s.status }, s.statusLabel), s.status === 'paid' ? s.daysLeft + ' days left' : '', naira(s.commissionKobo)]; });
      return el('div', { class: 'card' }, el('h2', {}, 'My schools (' + r.schools.length + ')'), rows.length ? table(['School', 'Location', 'Registered', 'Status', 'Subscription', 'My commission'], rows, [5]) : el('p', { class: 'hint' }, 'You have not registered a school yet.'));
    });
  };

  VIEWS.register = function () {
    var f = {}; ['name', 'town', 'contactName', 'contactPhone', 'contactEmail'].forEach(function (k) { f[k] = el('input', { required: k === 'name' || k === 'contactName' || k === 'contactPhone' }); });
    var st = stateSelect(), hits = el('div', { class: 'hint' }), timer = null;
    f.name.addEventListener('input', function () {
      clearTimeout(timer); var q = f.name.value;
      if (q.trim().length < 3) { hits.textContent = ''; return; }
      timer = setTimeout(function () {
        api('bd_check_name', { q: q }).then(function (r) {
          hits.textContent = '';
          if (r.ok && r.results.length) hits.appendChild(el('div', { class: 'msg warn' }, 'Already on STEVEXA: ' + r.results.map(function (x) { return x.name + (x.yours ? ' (yours)' : ''); }).join(', ')));
        });
      }, 350);
    });
    var btn = el('button', { class: 'b', type: 'submit' }, 'Register school');
    return Promise.resolve(el('form', { class: 'card', onsubmit: function (e) {
      e.preventDefault();
      busy(btn, api('bd_register', { name: f.name.value, state: st.value, town: f.town.value, contactName: f.contactName.value, contactPhone: f.contactPhone.value, contactEmail: f.contactEmail.value })).then(function (x) {
        if (x.ok) { flash('ok', 'School registered. It is now protected in your name for 90 days.'); S.tab = 'myschools'; } else flash('err', x.error);
        render();
      });
    } }, el('h2', {}, 'Register a school'), el('div', { class: 'row' }, field('School name', f.name), field('State', st), field('Town', f.town), field('Contact person', f.contactName), field('Contact phone', f.contactPhone), field('Contact email (optional)', f.contactEmail)), hits, btn));
  };

  VIEWS.commission = function () {
    return api('bd_commission').then(function (r) {
      if (!r.ok) return el('div', { class: 'msg err' }, r.error);
      var rows = r.lines.map(function (l) { return [l.paidOn, l.school, naira(l.amountKobo), l.status === 'paid_out' ? 'Paid out ' + l.paidOutOn : 'Waiting to be paid']; });
      return el('div', {}, el('div', { class: 'kpis' }, kpi('Waiting to be paid', naira(r.totals.pending)), kpi('Already paid out', naira(r.totals.paidOut)), kpi('Total earned', naira(r.totals.total)), kpi('My rate', pct(r.rate))),
        el('div', { class: 'card' }, el('h2', {}, 'My commission'), rows.length ? table(['Payment date', 'School', 'Commission', 'Status'], rows, [2]) : el('p', { class: 'hint' }, 'No commission yet. It appears when a school you registered pays.')));
    });
  };

  // ----- partner
  VIEWS.share = function () {
    return api('partner_summary').then(function (r) {
      if (!r.ok) return el('div', { class: 'msg err' }, r.error);
      var rows = [];
      r.table.forEach(function (t) {
        rows.push([t.name, t.rule, naira(t.kobo)]);
        if (t.pool) r.partners.forEach(function (p) { rows.push({ cls: p.mine ? 'me' : '', cells: [' ' + p.name + (p.mine ? '  (you)' : ''), p.rule, naira(p.kobo)] }); });
      });
      if (r.unallocatedKobo) rows.push(['Not yet allocated', 'Rounding / payments with no business-developer commission', naira(r.unallocatedKobo)]);
      rows.push({ cls: 'total', cells: ['Total revenue collected', '100%', naira(r.gross)] });
      var lines = r.lines.map(function (l) { return [l.paidOn, l.school, naira(l.grossKobo), pct(l.pctOfGross), naira(l.amountKobo), l.status === 'paid_out' ? 'Paid out ' + l.paidOutOn : 'Waiting to be paid']; });
      return el('div', {}, el('div', { class: 'kpis' }, kpi('My share is', pct(r.poolShare) + ' of the pool'), kpi('Waiting to be paid', naira(r.totals.pending)), kpi('Already paid out', naira(r.totals.paidOut)), kpi('Total earned', naira(r.totals.total))),
        el('div', { class: 'card' }, el('h2', {}, 'How the revenue is shared'), table(['Beneficiary', 'Rule', 'Amount'], rows, [2]), el('p', { class: 'hint' }, 'Worked out on money actually collected. Company expenses come only out of the company’s own share.')),
        el('div', { class: 'card' }, el('h2', {}, 'My share, payment by payment'), lines.length ? table(['Date', 'School', 'Payment', '% of payment', 'My share', 'Status'], lines, [2, 3, 4]) : el('p', { class: 'hint' }, 'Nothing yet. Your share appears here whenever a school payment is recorded.')));
    });
  };

  /* ---------- start ---------- */
  if (tok()) api('me').then(function (r) { if (r.ok) S.user = r.user; else setTok(''); render(); }); else render();
})();
