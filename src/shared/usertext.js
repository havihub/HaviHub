// Texts the main process shows to the person: errors, the downloads panel,
// the reasons an install skipped something. Like the rest of the interface
// they are written in Spanish, with {name} placeholders, and the interface
// shows them in the person's language with t() (src/renderer/lib/i18n.js):
// each one keeps its template and values for that.
//
//   throw new UserError('{name} tiene que iniciar sesión de nuevo.', { name })
//   tasks.run(tr('Importando {file}', { file }), …)
//
// scripts/i18n/gen.mjs collects the templates given to tr and to
// new UserError, so they get an English translation like any other.
// Only plain quotes: a template literal with ${…} cannot be translated.

function fill(text, vars) {
  const s = String(text);
  return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : m)) : s;
}

// A text and its values: plain data, so it can go to the interface as it is.
function tr(text, vars) {
  return vars ? { text, vars } : { text };
}

function isText(v) {
  return Boolean(v) && typeof v === 'object' && typeof v.text === 'string';
}

// The Spanish text, with its values (for logs, tests and anything that needs a string).
function plain(v) {
  if (isText(v)) return fill(v.text, v.vars);
  if (v instanceof Error) return v.message;
  return v === undefined || v === null ? '' : String(v);
}

// What the interface needs to translate a value: a text, or an error's.
function textOf(v) {
  if (isText(v)) return v;
  if (v && isText(v.i18n)) return v.i18n;
  return { text: plain(v) };
}

// An error the person reads. Its message is the Spanish text (tests and logs
// keep reading it as before); i18n is what the interface translates.
class UserError extends Error {
  constructor(text, vars, props) {
    super(fill(text, vars));
    this.i18n = tr(text, vars);
    if (props) Object.assign(this, props);
  }
}

module.exports = { fill, tr, plain, textOf, isText, UserError };
