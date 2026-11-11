/**
 * STEVEXA PARTNERS - backend (Google Apps Script web app + Google Sheet as the database).
 * Three kinds of sign-in, three different views:
 *   owner    the IP owner. The ONLY role that can create other accounts, record payments and mark payouts.
 *   partner  a stakeholder (company, Mr. Peter, Engr. Julius, legal adviser). Sees the commission split and own share.
 *   bd       a business developer. Registers schools, sees only own schools and own commission.
 * Every rule is enforced HERE, on the server. The web page only hides buttons; it is never trusted.
 * Functions without a trailing underscore are the only ones reachable from the web: doGet, doPost,
 * plus setup / setupOwner which you run once from the editor.
 */

const HEAD = {
  Users:    ['Id', 'Name', 'Email', 'Phone', 'Role', 'Label', 'Rate', 'PoolShare', 'Active', 'PwHash', 'MustChange', 'CreatedAt'],
  Schools:  ['Id', 'Name', 'NameKey', 'State', 'Town', 'ContactName', 'ContactPhone', 'PhoneKey', 'ContactEmail', 'BdId', 'RegisteredAt', 'ProtectedUntil', 'Deleted', 'Pilot'],
  Payments: ['Id', 'SchoolId', 'Label', 'AmountKobo', 'PaidOn', 'PeriodStart', 'PeriodEnd', 'Commissionable', 'Voided', 'VoidReason', 'Reference', 'RecordedAt'],
  Shares:   ['Id', 'PaymentId', 'UserId', 'Kind', 'PctBp', 'AmountKobo', 'Status', 'PaidOn'],
  Audit:    ['At', 'UserId', 'Action', 'Detail']
};
// Commercial formula (section 15 of the governance pack). Change here only with the IP owner's agreement.
//   a school's FIRST payment : IP owner 50% . business developer 10% . partners' pool 40%
//   every RENEWAL after that : IP owner 50% . business developer  5% . partners' pool 45%   (for as long as the school keeps paying)
const DEV_PCT = 50;                          // % of gross collected revenue to the IP owner, always
const BD_FIRST_PCT = 10, BD_RENEWAL_PCT = 5; // business developer
const POOL_FIRST_PCT = 40, POOL_RENEWAL_PCT = 45;   // shared among the partners
const BD_MAX_PCT = BD_FIRST_PCT;             // the most a business developer can be given
const PROTECTION_DAYS = 90, TOKEN_HOURS = 8, MAX_FAILS = 5, LOCK_MINUTES = 15, PW_ROUNDS = 300, MIN_PW = 10;
const FOREVER = '2099-12-31';   // a pilot school is never open to business developers
const ROLES_OWNER_MAY_CREATE = ['bd', 'partner'];

/* ───────────────────────── one-time setup (run from the editor) ───────────────────────── */

function setup() {
  const p = PropertiesService.getScriptProperties();
  let ss = null;
  if (p.getProperty('DB_ID')) ss = SpreadsheetApp.openById(p.getProperty('DB_ID'));
  else { try { ss = SpreadsheetApp.getActiveSpreadsheet(); } catch (e) {} }
  if (!ss) ss = SpreadsheetApp.create('STEVEXA Partners database');
  p.setProperty('DB_ID', ss.getId());
  Object.keys(HEAD).forEach(function (n) {
    let sh = ss.getSheetByName(n);
    if (!sh) sh = ss.insertSheet(n);
    sh.getRange(1, 1, 1, HEAD[n].length).setValues([HEAD[n]]); sh.setFrozenRows(1);
  });
  const def = ss.getSheetByName('Sheet1'); if (def && ss.getSheets().length > 1) ss.deleteSheet(def);
  tokenSecret_();
  Logger.log('Database ready: ' + ss.getUrl());
}

/** Before running: Project Settings -> Script properties -> add OWNER_NAME, OWNER_EMAIL, OWNER_PASSWORD.
 *  The password property is deleted as soon as the account exists. */
function setupOwner() {
  const p = PropertiesService.getScriptProperties();
  const name = p.getProperty('OWNER_NAME'), email = String(p.getProperty('OWNER_EMAIL') || '').trim().toLowerCase(), pw = p.getProperty('OWNER_PASSWORD');
  if (!name || !email || !pw) throw new Error('Add OWNER_NAME, OWNER_EMAIL and OWNER_PASSWORD in Script properties first.');
  const bad = pwProblem_(pw); if (bad) throw new Error(bad);
  if (rows_('Users').some(function (u) { return u.Role === 'owner'; })) throw new Error('An owner already exists.');
  add_('Users', { Name: name, Email: email, Phone: '', Role: 'owner', Label: 'IP Owner', Rate: '0', PoolShare: '0', Active: 'TRUE',
    PwHash: hashPw_(pw), MustChange: 'FALSE', CreatedAt: now_() });
  p.deleteProperty('OWNER_PASSWORD');
  Logger.log('Owner created: ' + email);
}

/** Run ONCE after pasting this newer version into an existing deployment: adds the new 'Pilot' column. Safe to run again. */
function upgrade() {
  const sh = db_().getSheetByName('Schools'), h = HEAD.Schools;
  sh.getRange(1, 1, 1, h.length).setValues([h]);
  Logger.log('Schools sheet upgraded: Pilot column is ready.');
}

/* ───────────────────────── web entry points ───────────────────────── */

function doGet() {
  return ContentService.createTextOutput(JSON.stringify({ ok: true, service: 'stevexa-partners' })).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  let out;
  try {
    const d = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    out = handle_(d);
  } catch (err) {
    out = { ok: false, error: err && err.apiMessage ? err.apiMessage : 'Server error. Please try again.' };
    if (!(err && err.apiMessage)) console.error(err);
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

/** Who may call what. This table IS the access control. */
const ACTIONS = {
  login: { public: true },
  change_password: { roles: ['owner', 'partner', 'bd'], allowMustChange: true },
  me: { roles: ['owner', 'partner', 'bd'], allowMustChange: true },
  // owner only
  users_list: { roles: ['owner'] }, user_create: { roles: ['owner'], write: true }, user_update: { roles: ['owner'], write: true },
  user_reset_password: { roles: ['owner'], write: true },
  schools_all: { roles: ['owner'] }, school_register_for: { roles: ['owner'], write: true },
  school_register_pilot: { roles: ['owner'], write: true }, school_set_pilot: { roles: ['owner'], write: true },
  payment_add: { roles: ['owner'], write: true }, payment_void: { roles: ['owner'], write: true }, payments_list: { roles: ['owner'] },
  payout_mark: { roles: ['owner'], write: true }, owner_summary: { roles: ['owner'] }, audit_list: { roles: ['owner'] },
  // business developer
  bd_check_name: { roles: ['bd'] }, bd_register: { roles: ['bd'], write: true }, bd_schools: { roles: ['bd'] }, bd_commission: { roles: ['bd'] },
  // partner (stakeholder)
  partner_summary: { roles: ['partner'] }
};

function handle_(d) {
  const spec = ACTIONS[d.action];
  if (!spec) fail_('Unknown action.');
  if (spec.public) return login_(d);
  const user = userFromToken_(d.token);
  if (!user) return { ok: false, expired: true, error: 'Please sign in again.' };
  if (spec.roles.indexOf(user.Role) < 0) fail_('You do not have access to this.');
  if (user.MustChange === 'TRUE' && !spec.allowMustChange) fail_('Please change your temporary password first.');
  const run = function () { return FN_[d.action](user, d); };
  if (!spec.write) return run();
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try { return run(); } finally { lock.releaseLock(); }
}

/* ───────────────────────── sign-in ───────────────────────── */

function login_(d) {
  const email = String(d.email || '').trim().toLowerCase(), pw = String(d.password || '');
  const cache = CacheService.getScriptCache(), lockKey = 'lock:' + email, failKey = 'fail:' + email;
  if (cache.get(lockKey)) return { ok: false, error: 'Too many failed attempts. Try again in ' + LOCK_MINUTES + ' minutes.' };
  const u = findUser_('Email', email);
  const good = !!u && u.Active === 'TRUE' && checkPw_(pw, u.PwHash);
  if (!good) {
    const n = (parseInt(cache.get(failKey), 10) || 0) + 1;
    cache.put(failKey, String(n), LOCK_MINUTES * 60);
    if (n >= MAX_FAILS) { cache.put(lockKey, '1', LOCK_MINUTES * 60); cache.remove(failKey); }
    return { ok: false, error: 'The email or password is not correct.' };
  }
  cache.remove(failKey);
  audit_(u, 'login', '');
  return { ok: true, token: signToken_(u.Id), user: publicUser_(u) };
}

function publicUser_(u) { return { id: u.Id, name: u.Name, role: u.Role, label: u.Label, mustChange: u.MustChange === 'TRUE' }; }

/* ───────────────────────── actions ───────────────────────── */

const FN_ = {
  me: function (u) { return { ok: true, user: publicUser_(u) }; },

  change_password: function (u, d) {
    if (!checkPw_(String(d.current || ''), u.PwHash)) fail_('Your current password is not correct.');
    const np = String(d.password || '');
    if (np === String(d.current)) fail_('Choose a password you have not used before.');
    const bad = pwProblem_(np); if (bad) fail_(bad);
    u.PwHash = hashPw_(np); u.MustChange = 'FALSE'; put_('Users', u);
    audit_(u, 'password_changed', '');
    return { ok: true };
  },

  /* ----- owner: people ----- */
  users_list: function () {
    return { ok: true, users: rows_('Users').map(function (x) {
      return { id: x.Id, name: x.Name, email: x.Email, phone: x.Phone, role: x.Role, label: x.Label, rate: num_(x.Rate), poolShare: num_(x.PoolShare), active: x.Active === 'TRUE' };
    }) };
  },

  user_create: function (u, d) {
    const role = String(d.role || '');
    if (ROLES_OWNER_MAY_CREATE.indexOf(role) < 0) fail_('Only business developer and partner accounts can be created.');   // nobody can create a second owner
    const v = readPerson_(d, role, null);
    if (findUser_('Email', v.Email)) fail_('That email is already registered.');
    const temp = tempPassword_();
    const nu = add_('Users', { Name: v.Name, Email: v.Email, Phone: v.Phone, Role: role, Label: v.Label, Rate: String(v.Rate), PoolShare: String(v.PoolShare),
      Active: 'TRUE', PwHash: hashPw_(temp), MustChange: 'TRUE', CreatedAt: now_() });
    audit_(u, 'user_created', role + ' ' + v.Email);
    return { ok: true, id: nu.Id, tempPassword: temp };
  },

  user_update: function (u, d) {
    const t = findUser_('Id', d.id);
    if (!t || t.Role === 'owner') fail_('Account not found.');
    const v = readPerson_(d, t.Role, t);
    t.Name = v.Name; t.Phone = v.Phone; t.Label = v.Label; t.Rate = String(v.Rate); t.PoolShare = String(v.PoolShare);
    if ('active' in d) t.Active = d.active ? 'TRUE' : 'FALSE';
    put_('Users', t);
    audit_(u, 'user_updated', t.Email);
    return { ok: true };
  },

  user_reset_password: function (u, d) {
    const t = findUser_('Id', d.id);
    if (!t || t.Role === 'owner') fail_('Account not found.');
    const temp = tempPassword_();
    t.PwHash = hashPw_(temp); t.MustChange = 'TRUE'; put_('Users', t);
    CacheService.getScriptCache().remove('lock:' + t.Email);
    audit_(u, 'password_reset', t.Email);
    return { ok: true, tempPassword: temp };
  },

  /* ----- owner: schools, payments, payouts ----- */
  schools_all: function () {
    const users = byId_(rows_('Users')), pays = rows_('Payments');
    return { ok: true, schools: rows_('Schools').filter(notDeleted_).map(function (s) {
      const st = schoolStatus_(s, pays);
      return { id: s.Id, name: s.Name, state: s.State, town: s.Town, contactName: s.ContactName, contactPhone: s.ContactPhone, contactEmail: s.ContactEmail,
        bd: users[s.BdId] ? users[s.BdId].Name : '', bdId: s.BdId, pilot: s.Pilot === 'TRUE', registeredAt: s.RegisteredAt, status: st.code, statusLabel: st.label };
    }) };
  },

  school_register_for: function (u, d) {
    const bd = findUser_('Id', d.bdId);
    if (!bd || bd.Role !== 'bd') fail_('Choose a business developer.');
    return registerSchool_(u, d, bd);
  },

  /* A pilot school: the owner keeps 100% of its revenue. No business developer, no partners. */
  school_register_pilot: function (u, d) { return registerSchool_(u, d, null, true); },

  school_set_pilot: function (u, d) {
    const s = findRow_('Schools', 'Id', d.schoolId);
    if (!s || !notDeleted_(s)) fail_('School not found.');
    const on = d.pilot === true;
    if (on === (s.Pilot === 'TRUE')) fail_(on ? 'This school is already a pilot school.' : 'This school is not a pilot school.');
    s.Pilot = on ? 'TRUE' : 'FALSE';
    s.ProtectedUntil = on ? FOREVER : addDays_(today_(), PROTECTION_DAYS);
    put_('Schools', s);
    audit_(u, on ? 'school_made_pilot' : 'school_made_regular', s.Name + ' (applies to payments recorded from now on)');
    return { ok: true };
  },

  payments_list: function () {
    const schools = byId_(rows_('Schools')), shares = rows_('Shares'), pays = rows_('Payments');
    return { ok: true, payments: pays.map(function (p) {
      const isPilotPay = shares.some(function (s) { return s.PaymentId === p.Id && s.Kind === 'pilot'; });
      const earlier = pays.some(function (q) { return q.SchoolId === p.SchoolId && Number(q.Id) < Number(p.Id) && q.Voided !== 'TRUE' && !shares.some(function (x) { return x.PaymentId === q.Id && x.Kind === 'pilot'; }); });
      return { type: isPilotPay ? 'pilot' : earlier ? 'renewal' : 'first', id: p.Id, school: schools[p.SchoolId] ? schools[p.SchoolId].Name : '?', label: p.Label, amountKobo: num_(p.AmountKobo), paidOn: p.PaidOn,
        periodStart: p.PeriodStart, periodEnd: p.PeriodEnd, commissionable: p.Commissionable === 'TRUE', voided: p.Voided === 'TRUE', reference: p.Reference,
        pilot: shares.some(function (s) { return s.PaymentId === p.Id && s.Kind === 'pilot'; }),
        anyPaidOut: shares.some(function (s) { return s.PaymentId === p.Id && s.Status === 'paid_out'; }) };
    }).reverse() };
  },

  payment_add: function (u, d) {
    const school = findRow_('Schools', 'Id', d.schoolId);
    if (!school || !notDeleted_(school)) fail_('Choose a school.');
    const amount = toKobo_(d.amount);
    const paidOn = dateOrFail_(d.paidOn, 'Enter the date the payment was received.');
    const ps = dateOrFail_(d.periodStart, 'Enter the date the period starts.'), pe = dateOrFail_(d.periodEnd, 'Enter the date the period ends.');
    if (pe < ps) fail_('The period cannot end before it starts.');
    const commissionable = d.commissionable !== false;
    const pay = add_('Payments', { SchoolId: school.Id, Label: clip_(d.label, 120), AmountKobo: String(amount), PaidOn: paidOn, PeriodStart: ps, PeriodEnd: pe,
      Commissionable: commissionable ? 'TRUE' : 'FALSE', Voided: 'FALSE', VoidReason: '', Reference: clip_(d.reference, 120), RecordedAt: now_() });
    const users = rows_('Users');
    const owner = users.filter(function (x) { return x.Role === 'owner'; })[0];
    const isPilot = school.Pilot === 'TRUE';
    const bd = isPilot ? null : commissionable ? users.filter(function (x) { return x.Id === school.BdId && x.Role === 'bd'; })[0] : null;
    const partners = users.filter(function (x) { return x.Role === 'partner' && x.Active === 'TRUE'; });
    const isRenewal = !isPilot && hasEarlierSharedPayment_(school.Id, pay.Id);
    const lines = isPilot ? splitPilot_(amount, owner.Id) : splitPayment_(amount, owner.Id, bd ? { id: bd.Id, rate: num_(bd.Rate) } : null,
      partners.map(function (x) { return { id: x.Id, poolShare: num_(x.PoolShare) }; }), isRenewal);
    lines.forEach(function (l) {
      add_('Shares', { PaymentId: pay.Id, UserId: l.userId, Kind: l.kind, PctBp: String(l.pctBp), AmountKobo: String(l.amountKobo),
        Status: l.kind === 'unallocated' ? 'unallocated' : 'pending', PaidOn: '' });
    });
    audit_(u, 'payment_added', school.Name + ' ' + amount + ' kobo' + (isPilot ? ' (pilot: 100% owner)' : isRenewal ? ' (renewal)' : ' (first payment)'));
    return { ok: true, id: pay.Id, lines: lines, type: isPilot ? 'pilot' : isRenewal ? 'renewal' : 'first' };
  },

  payment_void: function (u, d) {
    const p = findRow_('Payments', 'Id', d.id);
    if (!p || p.Voided === 'TRUE') fail_('Payment not found.');
    const shares = rows_('Shares').filter(function (s) { return s.PaymentId === p.Id; });
    if (shares.some(function (s) { return s.Status === 'paid_out'; })) fail_('Some shares of this payment were already paid out, so it cannot be voided here. Reverse those payouts by hand first.');
    const reason = clip_(d.reason, 300); if (!reason) fail_('Give a reason for voiding.');
    p.Voided = 'TRUE'; p.VoidReason = reason; put_('Payments', p);
    shares.forEach(function (s) { s.Status = 'void'; put_('Shares', s); });
    audit_(u, 'payment_voided', p.Id + ': ' + reason);
    return { ok: true };
  },

  payout_mark: function (u, d) {
    const target = findUser_('Id', d.userId);
    if (!target) fail_('Account not found.');
    const date = d.paidOn ? dateOrFail_(d.paidOn, 'Enter a valid date.') : today_();
    let n = 0, total = 0;
    rows_('Shares').forEach(function (s) {
      if (s.UserId === target.Id && s.Status === 'pending' && (!d.shareIds || d.shareIds.map(String).indexOf(s.Id) >= 0)) {
        s.Status = 'paid_out'; s.PaidOn = date; put_('Shares', s); n++; total += num_(s.AmountKobo);
      }
    });
    audit_(u, 'payout_marked', target.Email + ' ' + n + ' lines ' + total + ' kobo');
    return { ok: true, marked: n, totalKobo: total };
  },

  owner_summary: function () {
    const sh = liveShares_(), users = byId_(rows_('Users'));
    const per = {};
    sh.forEach(function (s) {
      const k = s.UserId + '|' + s.Kind;
      per[k] = per[k] || { userId: s.UserId, kind: s.Kind, pending: 0, paidOut: 0, total: 0 };
      const a = num_(s.AmountKobo);
      per[k].total += a; if (s.Status === 'paid_out') per[k].paidOut += a; else if (s.Status === 'pending') per[k].pending += a;
    });
    const out = Object.keys(per).map(function (k) { const r = per[k]; r.name = users[r.userId] ? users[r.userId].Name : '?'; r.label = users[r.userId] ? users[r.userId].Label : ''; return r; });
    return { ok: true, gross: grossKobo_(), rows: out, config: { devPct: DEV_PCT, poolFirstPct: POOL_FIRST_PCT, poolRenewalPct: POOL_RENEWAL_PCT, bdFirstPct: BD_FIRST_PCT, bdRenewalPct: BD_RENEWAL_PCT }, poolShareTotal: poolShareTotal_() };
  },

  audit_list: function () {
    const users = byId_(rows_('Users'));
    return { ok: true, entries: rows_('Audit').slice(-300).reverse().map(function (a) { return { at: a.At, user: users[a.UserId] ? users[a.UserId].Name : '', action: a.Action, detail: a.Detail }; }) };
  },

  /* ----- business developer ----- */
  bd_check_name: function (u, d) {
    const q = nameKey_(d.q);
    if (q.length < 3) return { ok: true, results: [] };
    const pays = rows_('Payments');
    const hits = rows_('Schools').filter(notDeleted_).filter(function (s) {
      return blocking_(s, pays) && (s.NameKey.indexOf(q) >= 0 || q.indexOf(s.NameKey) >= 0);
    }).slice(0, 12).map(function (s) { return { name: s.Name, yours: s.BdId === u.Id }; });   // names only: nothing else about other people's schools
    return { ok: true, results: hits };
  },

  bd_register: function (u, d) { return registerSchool_(u, d, u); },

  bd_schools: function (u) {
    const pays = rows_('Payments'), shares = rows_('Shares');
    return { ok: true, schools: rows_('Schools').filter(function (s) { return notDeleted_(s) && s.BdId === u.Id; }).map(function (s) {
      const st = schoolStatus_(s, pays);
      const mine = shares.filter(function (x) { return x.UserId === u.Id && x.Kind === 'bd' && x.Status !== 'void' && payOf_(pays, x.PaymentId) && payOf_(pays, x.PaymentId).SchoolId === s.Id; });
      return { id: s.Id, name: s.Name, state: s.State, town: s.Town, registeredAt: s.RegisteredAt, protectedUntil: s.ProtectedUntil, status: st.code, statusLabel: st.label,
        periodEnd: st.periodEnd, daysLeft: st.daysLeft, commissionKobo: mine.reduce(function (a, x) { return a + num_(x.AmountKobo); }, 0) };
    }).reverse() };
  },

  bd_commission: function (u) {
    const pays = rows_('Payments'), schools = byId_(rows_('Schools'));
    const mine = rows_('Shares').filter(function (x) { return x.UserId === u.Id && x.Kind === 'bd' && x.Status !== 'void'; });
    // the amount the school paid is NOT shown to business developers
    return { ok: true, rate: num_(u.Rate), totals: totals_(mine), lines: mine.map(function (x) {
      const p = payOf_(pays, x.PaymentId);
      return { school: p && schools[p.SchoolId] ? schools[p.SchoolId].Name : '?', paidOn: p ? p.PaidOn : '', amountKobo: num_(x.AmountKobo), status: x.Status, paidOutOn: x.PaidOn };
    }).reverse() };
  },

  /* ----- partner (stakeholder) ----- */
  partner_summary: function (u) {
    const users = byId_(rows_('Users')), sh = liveShares_(), pays = rows_('Payments'), schools = byId_(rows_('Schools'));
    const see = PropertiesService.getScriptProperties().getProperty('PARTNERS_SEE_EACH_OTHER') !== 'FALSE';
    const pilotPays = {}; rows_('Shares').forEach(function (x) { if (x.Kind === 'pilot' && x.Status !== 'void') pilotPays[x.PaymentId] = 1; });
    const gross = rows_('Payments').filter(function (p) { return p.Voided !== 'TRUE' && !pilotPays[p.Id]; }).reduce(function (a, p) { return a + num_(p.AmountKobo); }, 0);   // pilot-school revenue is the owner's private business
    const sum = function (f) { return sh.filter(f).reduce(function (a, x) { return a + num_(x.AmountKobo); }, 0); };
    const pool = sum(function (x) { return x.Kind === 'partner'; });
    const mine = sh.filter(function (x) { return x.UserId === u.Id && x.Kind === 'partner'; });
    const table = [
      { name: 'IP Owner (developer)', rule: DEV_PCT + '% of gross', kobo: sum(function (x) { return x.Kind === 'developer'; }) },
      { name: 'Business developers', rule: BD_FIRST_PCT + '% first payment, ' + BD_RENEWAL_PCT + '% renewals', kobo: sum(function (x) { return x.Kind === 'bd'; }) },
      { name: 'Remaining pool', rule: POOL_FIRST_PCT + '% first payment, ' + POOL_RENEWAL_PCT + '% renewals', kobo: pool, pool: true }
    ];
    const partnerRows = [];
    rows_('Users').filter(function (x) { return x.Role === 'partner'; }).forEach(function (x) {
      const k = sum(function (s) { return s.Kind === 'partner' && s.UserId === x.Id; });
      if (see || x.Id === u.Id) partnerRows.push({ name: x.Label || x.Name, rule: num_(x.PoolShare) + '% of pool', kobo: k, mine: x.Id === u.Id });
    });
    if (!see) { const others = pool - sum(function (s) { return s.Kind === 'partner' && s.UserId === u.Id; }); partnerRows.push({ name: 'Other partners (combined)', rule: '', kobo: others }); }
    const unalloc = sum(function (x) { return x.Kind === 'unallocated'; });
    return { ok: true, gross: gross, table: table, partners: partnerRows, unallocatedKobo: unalloc, totals: totals_(mine),
      lines: mine.map(function (x) {
        const p = payOf_(pays, x.PaymentId);
        return { school: p && schools[p.SchoolId] ? schools[p.SchoolId].Name : '?', paidOn: p ? p.PaidOn : '', grossKobo: p ? num_(p.AmountKobo) : 0, pctOfGross: num_(x.PctBp) / 100, amountKobo: num_(x.AmountKobo), status: x.Status, paidOutOn: x.PaidOn };
      }).reverse(), poolShare: num_(u.PoolShare) };
  }
};

/* ───────────────────────── the split (pure: easy to test) ───────────────────────── */

/** Returns the lines for ONE collected payment. Whole kobo; rounding dust and any unused business-developer
 *  percentage stay in an 'unallocated' line the owner can see, so the lines always add up to the payment exactly. */
function splitPayment_(amountKobo, ownerId, bd, partners, isRenewal) {
  const lines = [], bp = function (pctBp) { return Math.floor(amountKobo * pctBp / 10000); };
  const bdCap = isRenewal ? BD_RENEWAL_PCT : BD_FIRST_PCT, poolPct = isRenewal ? POOL_RENEWAL_PCT : POOL_FIRST_PCT;
  lines.push({ userId: ownerId, kind: 'developer', pctBp: DEV_PCT * 100, amountKobo: bp(DEV_PCT * 100) });
  if (bd) { const r = Math.round(Math.min(Math.max(bd.rate, 0), bdCap) * 100); lines.push({ userId: bd.id, kind: 'bd', pctBp: r, amountKobo: bp(r) }); }
  partners.forEach(function (p) {
    const r = Math.round(poolPct * p.poolShare);        // percent of gross, in basis points
    if (r > 0) lines.push({ userId: p.id, kind: 'partner', pctBp: r, amountKobo: bp(r) });
  });
  const used = lines.reduce(function (a, l) { return a + l.amountKobo; }, 0);
  lines.push({ userId: ownerId, kind: 'unallocated', pctBp: 0, amountKobo: amountKobo - used });
  return lines;
}

/** True when this school already has an earlier payment (not voided, not a pilot payment) that was shared the normal way. */
function hasEarlierSharedPayment_(schoolId, thisPaymentId) {
  const shares = rows_('Shares');
  return rows_('Payments').some(function (p) {
    return p.SchoolId === schoolId && p.Id !== thisPaymentId && p.Voided !== 'TRUE' &&
      !shares.some(function (x) { return x.PaymentId === p.Id && x.Kind === 'pilot'; });
  });
}

function splitPilot_(amountKobo, ownerId) { return [{ userId: ownerId, kind: 'pilot', pctBp: 10000, amountKobo: amountKobo }]; }

/* ───────────────────────── schools ───────────────────────── */

function registerSchool_(actor, d, bd, pilot) {
  const name = clip_(d.name, 200), state = clip_(d.state, 60), phone = clip_(d.contactPhone, 40);
  if (!name) fail_("Enter the school's name.");
  if (!state) fail_("Choose the school's state.");
  if (!clip_(d.contactName, 120)) fail_('Enter the name of the contact person.');
  if (phoneKey_(phone).length < 10) fail_('Enter a valid contact phone number.');
  const email = clip_(d.contactEmail, 200).toLowerCase();
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail_('Enter a valid contact email address, or leave it empty.');
  const key = nameKey_(name), pk = phoneKey_(phone), pays = rows_('Payments');
  rows_('Schools').filter(notDeleted_).forEach(function (s) {
    if (!blocking_(s, pays)) return;
    if ((s.NameKey === key && String(s.State).toLowerCase() === state.toLowerCase()) || (pk && s.PhoneKey === pk))
      fail_('This school is already registered on STEVEXA and is protected, so it cannot be registered again.');
  });
  const s = add_('Schools', { Name: name, NameKey: key, State: state, Town: clip_(d.town, 120), ContactName: clip_(d.contactName, 120), ContactPhone: phone, PhoneKey: pk,
    ContactEmail: email, BdId: pilot ? '' : bd.Id, RegisteredAt: now_(), ProtectedUntil: pilot ? FOREVER : addDays_(today_(), PROTECTION_DAYS), Deleted: 'FALSE', Pilot: pilot ? 'TRUE' : 'FALSE' });
  audit_(actor, pilot ? 'pilot_school_registered' : 'school_registered', name + (pilot ? ' (pilot: 100% owner)' : ' (' + bd.Name + ')'));
  return { ok: true, id: s.Id };
}

function schoolStatus_(s, pays) {
  const st = schoolStatusCore_(s, pays);
  if (s.Pilot !== 'TRUE') return st;
  const label = st.code === 'paid' ? 'Pilot \u00B7 paid until ' + st.periodEnd : st.code === 'expired' ? 'Pilot \u00B7 ended ' + st.periodEnd : 'Pilot school (100% owner)';
  return { code: 'pilot', label: label, periodEnd: st.periodEnd, daysLeft: st.daysLeft };
}
function schoolStatusCore_(s, pays) {
  const paid = pays.filter(function (p) { return p.SchoolId === s.Id && p.Voided !== 'TRUE'; });
  const t = today_();
  if (paid.length) {
    const end = paid.map(function (p) { return p.PeriodEnd; }).sort().pop();
    const days = daysBetween_(t, end);
    return days >= 0 ? { code: 'paid', label: 'Paid until ' + end, periodEnd: end, daysLeft: days } : { code: 'expired', label: 'Subscription ended ' + end, periodEnd: end, daysLeft: days };
  }
  if (s.ProtectedUntil && s.ProtectedUntil >= t) return { code: 'protected', label: 'Protected until ' + s.ProtectedUntil, periodEnd: '', daysLeft: daysBetween_(t, s.ProtectedUntil) };
  return { code: 'lapsed', label: 'Protection lapsed', periodEnd: '', daysLeft: 0 };
}
function blocking_(s, pays) { return schoolStatus_(s, pays).code !== 'lapsed'; }   // paid at any time (even expired) or still protected

/* ───────────────────────── helpers ───────────────────────── */

function readPerson_(d, role, existing) {
  const name = clip_(d.name, 120), email = clip_(d.email, 200).toLowerCase();
  if (!name) fail_('Enter the full name.');
  if (!existing && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail_('Enter a valid email address.');
  const v = { Name: name, Email: existing ? existing.Email : email, Phone: clip_(d.phone, 40), Label: clip_(d.label, 60), Rate: 0, PoolShare: 0 };
  if (role === 'bd') {
    v.Rate = Number(d.rate == null || d.rate === '' ? BD_MAX_PCT : d.rate);
    if (!isFinite(v.Rate) || v.Rate < 0 || v.Rate > BD_MAX_PCT) fail_('The business developer rate must be between 0 and ' + BD_MAX_PCT + '%.');
    v.Label = v.Label || 'Business developer';
  } else {
    v.PoolShare = Number(d.poolShare);
    if (!isFinite(v.PoolShare) || v.PoolShare <= 0 || v.PoolShare > 100) fail_("Enter the partner's share of the remaining pool (a percentage above 0).");
    const others = rows_('Users').filter(function (x) { return x.Role === 'partner' && x.Active === 'TRUE' && (!existing || x.Id !== existing.Id); })
      .reduce(function (a, x) { return a + num_(x.PoolShare); }, 0);
    if (others + v.PoolShare > 100.0001) fail_('Partner shares of the pool would add up to ' + (Math.round((others + v.PoolShare) * 100) / 100) + '%. They cannot exceed 100%.');
  }
  return v;
}
function poolShareTotal_() { return rows_('Users').filter(function (x) { return x.Role === 'partner' && x.Active === 'TRUE'; }).reduce(function (a, x) { return a + num_(x.PoolShare); }, 0); }
function liveShares_() { return rows_('Shares').filter(function (s) { return s.Status !== 'void'; }); }
function grossKobo_() { return rows_('Payments').filter(function (p) { return p.Voided !== 'TRUE'; }).reduce(function (a, p) { return a + num_(p.AmountKobo); }, 0); }
function totals_(sh) {
  const t = { pending: 0, paidOut: 0, total: 0 };
  sh.forEach(function (x) { const a = num_(x.AmountKobo); t.total += a; if (x.Status === 'paid_out') t.paidOut += a; else if (x.Status === 'pending') t.pending += a; });
  return t;
}
function payOf_(pays, id) { return pays.filter(function (p) { return p.Id === id; })[0]; }
function notDeleted_(s) { return s.Deleted !== 'TRUE'; }
function byId_(list) { const m = {}; list.forEach(function (x) { m[x.Id] = x; }); return m; }
function findUser_(col, val) { return findRow_('Users', col, val); }
function findRow_(tab, col, val) { const v = String(val == null ? '' : val); return rows_(tab).filter(function (r) { return String(r[col]) === v && v !== ''; })[0] || null; }
function fail_(msg) { const e = new Error(msg); e.apiMessage = msg; throw e; }
function clip_(v, n) { return String(v == null ? '' : v).trim().substr(0, n); }
function num_(v) { const n = Number(v); return isFinite(n) ? n : 0; }
function nameKey_(s) { return String(s || '').toLowerCase().replace(/\b(the|of|and|school|schools|college|academy|international|nursery|primary|secondary|&)\b/g, ' ').replace(/[^a-z0-9]/g, ''); }
function phoneKey_(s) { const d = String(s || '').replace(/\D/g, ''); return d.length >= 10 ? d.slice(-10) : d; }
function toKobo_(text) {
  const t = String(text == null ? '' : text).replace(/[₦,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(t)) fail_('Enter the amount in naira, for example 150000 or 150000.50.');
  const k = Math.round(parseFloat(t) * 100);
  if (k <= 0) fail_('The amount must be more than zero.');
  return k;
}
function dateOrFail_(v, msg) { const t = String(v || '').trim(); if (!/^\d{4}-\d{2}-\d{2}$/.test(t) || isNaN(new Date(t + 'T00:00:00Z').getTime())) fail_(msg); return t; }
function pad_(n) { return (n < 10 ? '0' : '') + n; }
function today_() { return Utilities.formatDate(new Date(), 'Africa/Lagos', 'yyyy-MM-dd'); }
function now_() { return Utilities.formatDate(new Date(), 'Etc/UTC', "yyyy-MM-dd'T'HH:mm:ss'Z'"); }
function addDays_(iso, n) { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.getUTCFullYear() + '-' + pad_(d.getUTCMonth() + 1) + '-' + pad_(d.getUTCDate()); }
function daysBetween_(a, b) { return Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000); }

/* ───────────────────────── database layer ───────────────────────── */

function db_() { return SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('DB_ID')); }
function rows_(tab) {
  const sh = db_().getSheetByName(tab), lr = sh.getLastRow(), h = HEAD[tab];
  if (lr < 2) return [];
  return sh.getRange(2, 1, lr - 1, h.length).getValues().map(function (r, i) {
    const o = { _row: i + 2 }; h.forEach(function (k, j) { o[k] = r[j] == null ? '' : String(r[j]); }); return o;
  });
}
function put_(tab, o) {
  const h = HEAD[tab], rg = db_().getSheetByName(tab).getRange(o._row, 1, 1, h.length);
  rg.setNumberFormat('@'); rg.setValues([h.map(function (k) { return o[k] == null ? '' : String(o[k]); })]);
}
function add_(tab, o) {
  const sh = db_().getSheetByName(tab), h = HEAD[tab];
  if (h[0] === 'Id') o.Id = String(rows_(tab).reduce(function (m, r) { return Math.max(m, parseInt(r.Id, 10) || 0); }, 0) + 1);
  const row = sh.getLastRow() + 1, rg = sh.getRange(row, 1, 1, h.length);
  rg.setNumberFormat('@'); rg.setValues([h.map(function (k) { return o[k] == null ? '' : String(o[k]); })]);
  o._row = row; return o;
}
function audit_(user, action, detail) { add_('Audit', { At: now_(), UserId: user ? user.Id : '', Action: action, Detail: clip_(detail, 500) }); }

/* ───────────────────────── passwords and tokens ───────────────────────── */

function hex_(bytes) { return bytes.map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join(''); }
function sha_(s) { return hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8)); }
function hashPw_(pw) {
  const salt = Utilities.getUuid().replace(/-/g, '');
  let h = salt + pw; for (let i = 0; i < PW_ROUNDS; i++) h = sha_(h + salt + pw);
  return salt + '$' + h;
}
function checkPw_(pw, stored) {
  const parts = String(stored || '').split('$'); if (parts.length !== 2) return false;
  const salt = parts[0]; let h = salt + pw; for (let i = 0; i < PW_ROUNDS; i++) h = sha_(h + salt + pw);
  return h === parts[1];
}
function pwProblem_(p) {
  if (String(p).length < MIN_PW) return 'Use at least ' + MIN_PW + ' characters.';
  if (p.toLowerCase() === p || p.toUpperCase() === p || !/\d/.test(p)) return 'Mix upper and lower case letters and include at least one number.';
  return '';
}
function tempPassword_() {
  const A = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789', bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + Math.random(), Utilities.Charset.UTF_8);
  let o = ''; for (let i = 0; i < 10; i++) o += A.charAt((bytes[i] & 255) % A.length);
  return o + 'a7K';   // guarantees lower, upper and a digit
}
function tokenSecret_() {
  const p = PropertiesService.getScriptProperties(); let s = p.getProperty('TOKEN_SECRET');
  if (!s) { s = Utilities.getUuid() + Utilities.getUuid(); p.setProperty('TOKEN_SECRET', s); }
  return s;
}
function sig_(body) { return hex_(Utilities.computeHmacSha256Signature(body, tokenSecret_())).substr(0, 40); }
function signToken_(userId) { const body = userId + '.' + (Date.now() + TOKEN_HOURS * 3600000); return body + '.' + sig_(body); }
function userFromToken_(tok) {
  const p = String(tok || '').split('.'); if (p.length !== 3) return null;
  if (sig_(p[0] + '.' + p[1]) !== p[2] || Number(p[1]) < Date.now()) return null;
  const u = findUser_('Id', p[0]);
  return u && u.Active === 'TRUE' ? u : null;     // a deactivated account is signed out at once
}
