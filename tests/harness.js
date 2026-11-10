// Runs backend/Code.gs in Node with in-memory stand-ins for the Google services.
const vm = require('vm'), fs = require('fs'), path = require('path'), crypto = require('crypto');

function make(opts) {
  opts = opts || {};
  const props = { DB_ID: 'x', TOKEN_SECRET: 'test-secret' }, cacheStore = {}, tabs = {};
  const sheet = function (name) {
    return {
      getLastRow: function () { return tabs[name].length; },
      getRange: function (r, c, nr, nc) {
        return {
          getValues: function () { const o = []; for (let i = 0; i < nr; i++) { const row = []; for (let j = 0; j < nc; j++) { const v = (tabs[name][r - 1 + i] || [])[c - 1 + j]; row.push(v === undefined ? '' : v); } o.push(row); } return o; },
          setValues: function (vals) { vals.forEach(function (row, i) { tabs[name][r - 1 + i] = tabs[name][r - 1 + i] || []; row.forEach(function (v, j) { tabs[name][r - 1 + i][c - 1 + j] = v; }); }); },
          setNumberFormat: function () {}
        };
      },
      setFrozenRows: function () {}
    };
  };
  const sb = function (bytes) { return Array.from(bytes).map(function (b) { return b > 127 ? b - 256 : b; }); };
  const sandbox = {
    console: console,
    Logger: { log: function () {} },
    PropertiesService: { getScriptProperties: function () { return { getProperty: function (k) { return k in props ? props[k] : null; }, setProperty: function (k, v) { props[k] = String(v); }, deleteProperty: function (k) { delete props[k]; } }; } },
    CacheService: { getScriptCache: function () { return { get: function (k) { return cacheStore[k] || null; }, put: function (k, v) { cacheStore[k] = v; }, remove: function (k) { delete cacheStore[k]; } }; } },
    LockService: { getScriptLock: function () { return { waitLock: function () {}, releaseLock: function () {} }; } },
    ContentService: { createTextOutput: function (s) { return { setMimeType: function () { return s; } }; }, MimeType: { JSON: 'json' } },
    SpreadsheetApp: { openById: function () { return { getSheetByName: function (n) { return tabs[n] ? sheet(n) : null; } }; } },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: function (a, s) { return sb(crypto.createHash('sha256').update(String(s)).digest()); },
      computeHmacSha256Signature: function (body, key) { return sb(crypto.createHmac('sha256', String(key)).update(String(body)).digest()); },
      getUuid: function () { return crypto.randomUUID(); },
      formatDate: function (d, tz, fmt) { const iso = (opts.today ? new Date(opts.today + 'T12:00:00Z') : d).toISOString(); return fmt.indexOf('HH') >= 0 ? iso.replace(/\.\d+Z/, 'Z') : iso.slice(0, 10); }
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'backend', 'Code.gs'), 'utf8') + '\n;this.__x={HEAD,handle_,splitPayment_,setupOwner};', sandbox);
  const api = sandbox.__x;
  Object.keys(api.HEAD).forEach(function (n) { tabs[n] = [api.HEAD[n].slice()]; });
  return {
    api: api, props: props, cache: cacheStore, tabs: tabs,
    call: function (action, data, token) { return api.handle_(Object.assign({ action: action, token: token }, data || {})); },
    callSafe: function (action, data, token) { try { return api.handle_(Object.assign({ action: action, token: token }, data || {})); } catch (e) { return { ok: false, error: e.apiMessage || String(e) }; } }
  };
}
module.exports = make;
