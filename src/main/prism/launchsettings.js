// Settings of a profile that make this computer run something when the game
// starts, besides the game and its mods: its commands, a Java of its own,
// Java arguments and environment variables that load other programs into
// Java, and native libraries. A profile someone else exported (a Prism .zip)
// can bring them, and nothing in the window would show it: Havi Hub lists
// them before importing such a profile and the person chooses whether they
// stay (main.js, instances.import).
const { parseEnv, serializeEnv } = require('../../shared/envvars');

const COMMANDS = ['PreLaunchCommand', 'WrapperCommand', 'PostExitCommand'];
// Java options that load or run another program
const RISKY_JVM = /(^|\s)(-javaagent|-agentpath|-agentlib|-XX:OnError|-XX:OnOutOfMemoryError|-Xbootclasspath)/i;
// variables that make Java or the system load another program
const RISKY_ENV = /^(LD_PRELOAD|LD_LIBRARY_PATH|LD_AUDIT|DYLD_\w+|JAVA_TOOL_OPTIONS|_JAVA_OPTIONS|JDK_JAVA_OPTIONS|PATH)$/i;
const LIBRARIES = ['CustomGLFWPath', 'CustomOpenALPath'];

const isOn = (cfg, key) => String(cfg.get(key, '')) === 'true';
const valueOf = (cfg, key) => {
  const v = cfg.get(key, '');
  return v === undefined || v === null ? '' : String(v).trim();
};

// [{ key, value }]: what in this instance.cfg would run something
function riskyLaunchSettings(cfg) {
  const found = [];
  if (isOn(cfg, 'OverrideCommands')) for (const key of COMMANDS) if (valueOf(cfg, key)) found.push({ key, value: valueOf(cfg, key) });
  if (isOn(cfg, 'OverrideJavaLocation') && !isOn(cfg, 'AutomaticJava') && valueOf(cfg, 'JavaPath')) found.push({ key: 'JavaPath', value: valueOf(cfg, 'JavaPath') });
  if (isOn(cfg, 'OverrideJavaArgs') && RISKY_JVM.test(valueOf(cfg, 'JvmArgs'))) found.push({ key: 'JvmArgs', value: valueOf(cfg, 'JvmArgs') });
  if (isOn(cfg, 'OverrideEnv')) for (const r of parseEnv(valueOf(cfg, 'Env'))) if (RISKY_ENV.test(r.name)) found.push({ key: `Env ${r.name}`, value: r.value });
  if (isOn(cfg, 'OverrideNativeWorkarounds')) for (const key of LIBRARIES) if (valueOf(cfg, key)) found.push({ key, value: valueOf(cfg, key) });
  return found;
}

// Takes them out; the rest of the profile's settings stay. Returns how many.
function dropLaunchSettings(cfg) {
  const found = riskyLaunchSettings(cfg);
  if (!found.length) return 0;
  const keys = new Set(found.map((f) => f.key));
  for (const key of COMMANDS) cfg.remove(key);
  cfg.set('OverrideCommands', false);
  if (keys.has('JavaPath')) {
    cfg.remove('JavaPath');
    cfg.set('OverrideJavaLocation', false);
  }
  if (keys.has('JvmArgs')) {
    cfg.remove('JvmArgs');
    cfg.set('OverrideJavaArgs', false);
  }
  if ([...keys].some((k) => k.startsWith('Env '))) cfg.set('Env', serializeEnv(parseEnv(valueOf(cfg, 'Env')).filter((r) => !RISKY_ENV.test(r.name))));
  for (const key of LIBRARIES) if (keys.has(key)) cfg.remove(key);
  return found.length;
}

// What a profile shared as a Prism .zip would take of this computer: all of
// the above, and every environment variable (they often hold tokens or
// paths of this computer). Left out of the export unless the person chooses.
function personalSettings(cfg) {
  const found = riskyLaunchSettings(cfg);
  if (isOn(cfg, 'OverrideEnv')) for (const r of parseEnv(valueOf(cfg, 'Env'))) if (!found.some((f) => f.key === `Env ${r.name}`)) found.push({ key: `Env ${r.name}`, value: r.value });
  return found;
}

function dropPersonalSettings(cfg) {
  const n = personalSettings(cfg).length;
  if (!n) return 0;
  dropLaunchSettings(cfg);
  cfg.remove('Env');
  cfg.set('OverrideEnv', false);
  return n;
}

module.exports = { riskyLaunchSettings, dropLaunchSettings, personalSettings, dropPersonalSettings };
