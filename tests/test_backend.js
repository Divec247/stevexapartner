const make = require('./harness'), assert = require('assert');
let passed = 0;
function test(name, fn) { try { fn(); passed++; console.log('  ok  ' + name); } catch (e) { console.log('FAIL  ' + name + '\n      ' + (e.message || e)); process.exitCode = 1; } }
const NAIRA = function (n) { return n * 100; };

function world(opts) {
  const w = make(opts);
  w.props.OWNER_NAME = 'Stephen'; w.props.OWNER_EMAIL = 'Owner@Example.com'; w.props.OWNER_PASSWORD = 'Owner-Pass-2026';
  w.api.setupOwner();
  w.owner = w.call('login', { email: 'owner@example.com', password: 'Owner-Pass-2026' }).token;
  const mk = function (data) {
    const r = w.call('user_create', data, w.owner);
    const t = w.call('login', { email: data.email, password: r.tempPassword }).token;
    w.call('change_password', { current: r.tempPassword, password: 'New-Pass-2026x' }, t);
    return { id: r.id, token: w.call('login', { email: data.email, password: 'New-Pass-2026x' }).token };
  };
  w.bd = mk({ role: 'bd', name: 'Ade BD', email: 'bd@example.com', rate: 10 });
  w.company = mk({ role: 'partner', name: 'DE-TECHPATHSOL', email: 'co@example.com', label: 'DE-TECHPATHSOL', poolShare: 50 });
  w.peter = mk({ role: 'partner', name: 'Mr. Peter', email: 'peter@example.com', poolShare: 20 });
  w.julius = mk({ role: 'partner', name: 'Engr. Julius', email: 'julius@example.com', poolShare: 20 });
  w.legal = mk({ role: 'partner', name: 'Legal Adviser', email: 'legal@example.com', poolShare: 10 });
  return w;
}
const school = { name: 'Alpha Light College', state: 'Lagos', town: 'Ikeja', contactName: 'Mrs A', contactPhone: '08031234567' };
const pay = function (w, schoolId, amount, extra) { return w.call('payment_add', Object.assign({ schoolId: schoolId, amount: String(amount), paidOn: '2026-11-10', periodStart: '2026-11-10', periodEnd: '2027-02-28' }, extra || {}), w.owner); };
const line = function (r, kind) { return r.lines.find(function (l) { return l.kind === kind; }); };

console.log('The split (governance pack section 15)');
test('N20,000,000 matches the table exactly', function () {
  const w = world(), s = w.call('bd_register', school, w.bd.token), r = pay(w, s.id, 20000000);
  const mine = function (u) { return r.lines.find(function (l) { return l.userId === u.id && l.kind === 'partner'; }).amountKobo; };
  assert.strictEqual(line(r, 'developer').amountKobo, NAIRA(10000000));
  assert.strictEqual(line(r, 'bd').amountKobo, NAIRA(2000000));
  assert.strictEqual(mine(w.company), NAIRA(4000000));
  assert.strictEqual(mine(w.peter), NAIRA(1600000));
  assert.strictEqual(mine(w.julius), NAIRA(1600000));
  assert.strictEqual(mine(w.legal), NAIRA(800000));
  assert.strictEqual(line(r, 'unallocated').amountKobo, 0);
});
test('lines always add up to the payment, even with awkward amounts', function () {
  const w = world(), s = w.call('bd_register', school, w.bd.token);
  [1, 99, 12345.67, 333333.33].forEach(function (a) {
    const r = pay(w, s.id, a);
    assert.strictEqual(r.lines.reduce(function (x, l) { return x + l.amountKobo; }, 0), Math.round(a * 100));
  });
});
test('a payment with no business-developer commission leaves that 10% visibly unallocated', function () {
  const w = world(), s = w.call('bd_register', school, w.bd.token), r = pay(w, s.id, 1000000, { commissionable: false });
  assert.ok(!line(r, 'bd'));
  assert.strictEqual(line(r, 'unallocated').amountKobo, NAIRA(100000));
});

console.log('Who can do what');
test('only the owner can create accounts', function () {
  const w = world();
  [w.bd.token, w.company.token, undefined].forEach(function (t) {
    assert.strictEqual(w.callSafe('user_create', { role: 'bd', name: 'X', email: 'x@example.com' }, t).ok, false);
  });
});
test('nobody can create or edit an owner', function () {
  const w = world();
  assert.strictEqual(w.callSafe('user_create', { role: 'owner', name: 'X', email: 'x@example.com' }, w.owner).ok, false);
  assert.strictEqual(w.callSafe('user_update', { id: '1', name: 'Hacked' }, w.owner).ok, false);
  assert.strictEqual(w.callSafe('user_reset_password', { id: '1' }, w.owner).ok, false);
});
test('business developer cannot reach owner or partner actions', function () {
  const w = world();
  ['users_list', 'schools_all', 'payments_list', 'owner_summary', 'audit_list', 'partner_summary', 'payment_add', 'payout_mark', 'user_create'].forEach(function (a) {
    assert.strictEqual(w.callSafe(a, {}, w.bd.token).ok, false, a);
  });
});
test('partner cannot reach owner or business-developer actions', function () {
  const w = world();
  ['users_list', 'schools_all', 'payments_list', 'owner_summary', 'bd_schools', 'bd_commission', 'bd_register', 'payout_mark', 'user_create'].forEach(function (a) {
    assert.strictEqual(w.callSafe(a, {}, w.peter.token).ok, false, a);
  });
});
test('owner cannot use the business-developer or partner screens', function () {
  const w = world();
  assert.strictEqual(w.callSafe('partner_summary', {}, w.owner).ok, false);
  assert.strictEqual(w.callSafe('bd_schools', {}, w.owner).ok, false);
});
test('forged and expired tokens are refused', function () {
  const w = world();
  assert.strictEqual(w.call('users_list', {}, w.owner + 'x').expired, true);
  assert.strictEqual(w.call('users_list', {}, '1.99999999999999.' + 'a'.repeat(40)).expired, true);
});
test('a deactivated account is refused straight away', function () {
  const w = world();
  w.call('user_update', { id: w.bd.id, name: 'Ade BD', rate: 10, active: false }, w.owner);
  assert.strictEqual(w.call('bd_schools', {}, w.bd.token).expired, true);
  assert.strictEqual(w.call('login', { email: 'bd@example.com', password: 'New-Pass-2026x' }).ok, false);
});
test('temporary password must be changed before anything else', function () {
  const w = world(), r = w.call('user_create', { role: 'bd', name: 'New BD', email: 'new@example.com' }, w.owner);
  const t = w.call('login', { email: 'new@example.com', password: r.tempPassword }).token;
  assert.strictEqual(w.callSafe('bd_schools', {}, t).ok, false);
  assert.strictEqual(w.call('change_password', { current: r.tempPassword, password: 'Better-Pass-2026' }, t).ok, true);
  assert.strictEqual(w.call('bd_schools', {}, t).ok, true);
});
test('five wrong passwords lock the account', function () {
  const w = world();
  for (let i = 0; i < 5; i++) w.call('login', { email: 'bd@example.com', password: 'wrong' });
  assert.ok(/Too many/.test(w.call('login', { email: 'bd@example.com', password: 'New-Pass-2026x' }).error));
});

console.log('What each view sees');
test('business developer sees only own schools and never the amount a school paid', function () {
  const w = world(), s = w.call('bd_register', school, w.bd.token);
  const o = w.call('user_create', { role: 'bd', name: 'Other', email: 'other@example.com' }, w.owner);
  const ot = w.call('login', { email: 'other@example.com', password: o.tempPassword }).token;
  w.call('change_password', { current: o.tempPassword, password: 'Other-Pass-2026' }, ot);
  const ot2 = w.call('login', { email: 'other@example.com', password: 'Other-Pass-2026' }).token;
  w.call('bd_register', { name: 'Beta School', state: 'Ogun', contactName: 'B', contactPhone: '08039999999' }, ot2);
  pay(w, s.id, 500000);
  assert.strictEqual(w.call('bd_schools', {}, w.bd.token).schools.length, 1);
  const c = w.call('bd_commission', {}, w.bd.token), txt = JSON.stringify(c);
  assert.ok(txt.indexOf('50000000') < 0 && !/gross/i.test(txt));
  assert.strictEqual(c.totals.total, NAIRA(50000));
  const names = w.call('bd_check_name', { q: 'Beta Academy' }, w.bd.token).results;
  assert.ok(names.length === 1 && Object.keys(names[0]).sort().join() === 'name,yours');
});
test('partner sees the split and own lines, not school contacts', function () {
  const w = world(), s = w.call('bd_register', school, w.bd.token);
  pay(w, s.id, 20000000);
  const r = w.call('partner_summary', {}, w.peter.token), txt = JSON.stringify(r);
  assert.strictEqual(r.gross, NAIRA(20000000));
  assert.strictEqual(r.totals.total, NAIRA(1600000));
  assert.strictEqual(r.partners.filter(function (p) { return p.mine; }).length, 1);
  assert.ok(txt.indexOf('08031234567') < 0 && txt.indexOf('Mrs A') < 0);
});
test('with PARTNERS_SEE_EACH_OTHER=FALSE a partner sees own line plus one combined line', function () {
  const w = world(); w.props.PARTNERS_SEE_EACH_OTHER = 'FALSE';
  const s = w.call('bd_register', school, w.bd.token); pay(w, s.id, 20000000);
  const r = w.call('partner_summary', {}, w.peter.token);
  assert.strictEqual(r.partners.length, 2);
  assert.strictEqual(r.partners[1].kobo, NAIRA(4000000 + 1600000 + 800000));
});

console.log('Rules');
test('partner shares of the pool cannot exceed 100%', function () {
  const w = world();
  assert.strictEqual(w.callSafe('user_create', { role: 'partner', name: 'Extra', email: 'extra@example.com', poolShare: 5 }, w.owner).ok, false);
});
test('business developer rate cannot exceed the 10% that is left', function () {
  const w = world();
  assert.strictEqual(w.callSafe('user_create', { role: 'bd', name: 'Greedy', email: 'g@example.com', rate: 15 }, w.owner).ok, false);
});
test('a protected school cannot be registered twice (same name+state, or same phone)', function () {
  const w = world(); w.call('bd_register', school, w.bd.token);
  assert.strictEqual(w.callSafe('bd_register', school, w.bd.token).ok, false);
  assert.strictEqual(w.callSafe('bd_register', { name: 'Totally Different', state: 'Kano', contactName: 'Z', contactPhone: '0803 123 4567' }, w.bd.token).ok, false);
});
test('a lapsed lead can be registered again, a paid one never', function () {
  const w = world({ today: '2026-11-10' });
  w.call('bd_register', school, w.bd.token);
  const b = w.call('bd_register', { name: 'Paid School', state: 'Oyo', contactName: 'P', contactPhone: '08055555555' }, w.bd.token);
  pay(w, b.id, 100000);
  w.tabs.Schools[1][11] = '2026-01-01';
  assert.strictEqual(w.callSafe('bd_register', school, w.bd.token).ok, true);
  w.tabs.Schools[2][11] = '2026-01-01';
  assert.strictEqual(w.callSafe('bd_register', { name: 'Paid School', state: 'Oyo', contactName: 'P', contactPhone: '08055555555' }, w.bd.token).ok, false);
});
test('payout marks pending lines paid; a payment with a payout cannot be voided', function () {
  const w = world(), s = w.call('bd_register', school, w.bd.token), p = pay(w, s.id, 1000000);
  assert.strictEqual(w.call('payout_mark', { userId: w.peter.id }, w.owner).marked, 1);
  assert.strictEqual(w.call('partner_summary', {}, w.peter.token).totals.paidOut, NAIRA(80000));
  assert.strictEqual(w.callSafe('payment_void', { id: p.id, reason: 'mistake' }, w.owner).ok, false);
});
test('voiding removes the shares from every view', function () {
  const w = world(), s = w.call('bd_register', school, w.bd.token), p = pay(w, s.id, 1000000);
  assert.strictEqual(w.call('payment_void', { id: p.id, reason: 'entered twice' }, w.owner).ok, true);
  assert.strictEqual(w.call('partner_summary', {}, w.peter.token).gross, 0);
  assert.strictEqual(w.call('bd_commission', {}, w.bd.token).totals.total, 0);
});
test('important actions are in the audit trail', function () {
  const w = world(), s = w.call('bd_register', school, w.bd.token); pay(w, s.id, 1000);
  const acts = w.call('audit_list', {}, w.owner).entries.map(function (e) { return e.action; });
  ['user_created', 'school_registered', 'payment_added', 'login'].forEach(function (a) { assert.ok(acts.indexOf(a) >= 0, a); });
});
test('the sheet never stores a plain password', function () {
  const w = world();
  assert.ok(JSON.stringify(w.tabs.Users).indexOf('Owner-Pass-2026') < 0 && !w.props.OWNER_PASSWORD);
});

console.log('\n' + passed + ' passed' + (process.exitCode ? ', some FAILED' : ''));
