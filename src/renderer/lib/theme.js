// Theme presets and the fully customizable palette. Every token is a CSS
// variable; the user can override any of them in Settings → Themes.

import { TOKENS, PRESETS, PRESET_ORDER, hexToRgb, rgbToHex, mix, luminance, isValidHex, resolvePalette } from '../../shared/themes.js';
import { SEASON_THEMES, SEASON_THEMES_MODRINTH } from '../../shared/seasons.js';

export { TOKENS, PRESETS, PRESET_ORDER, hexToRgb, rgbToHex, mix, luminance, isValidHex, resolvePalette };

const cssName = (k) => '--' + k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());

// season: 'halloween' | 'christmas' | 'newyear' puts that season's colors on
// top of the user's theme (only while it lasts; nothing is saved)
// layout: 'curseforge' | 'modrinth' (how the app is arranged, see App.jsx)
export function applyTheme(presetKey, overrides, { reduceMotion = false, season = null, layout = 'curseforge' } = {}) {
  const seasonal = layout === 'modrinth' ? SEASON_THEMES_MODRINTH : SEASON_THEMES;
  const p = season && seasonal[season] ? { ...seasonal[season] } : resolvePalette(presetKey, overrides);
  const root = document.documentElement;
  for (const [k, v] of Object.entries(p)) root.style.setProperty(cssName(k), v);
  const light = luminance(p.bg) > 0.5;
  // light or dark theme, for colors that need one value for each (e.g. the loader tags)
  root.dataset.tone = light ? 'light' : 'dark';
  const [ar, ag, ab] = hexToRgb(p.accent);
  root.style.setProperty('--accent-hover', mix(p.accent, light ? '#000000' : '#ffffff', 0.12));
  root.style.setProperty('--accent-press', mix(p.accent, '#000000', 0.15));
  root.style.setProperty('--accent-soft', `rgba(${ar}, ${ag}, ${ab}, 0.16)`);
  root.style.setProperty('--accent-rgb', `${ar}, ${ag}, ${ab}`);
  root.style.setProperty('--overlay', light ? 'rgba(20, 20, 30, 0.35)' : 'rgba(0, 0, 0, 0.6)');
  root.style.setProperty('--shadow', light ? '0 8px 28px rgba(0,0,0,0.15)' : '0 10px 32px rgba(0,0,0,0.55)');
  root.style.setProperty('--hover', light ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.06)');
  root.style.setProperty('--scrollbar', mix(p.surface3, p.textMuted, 0.25));
  // Interface size is applied by the main process (Electron zoom), not CSS zoom
  root.style.setProperty('--zoom', '1');
  root.dataset.light = light ? '1' : '0';
  root.dataset.reduceMotion = reduceMotion ? '1' : '0';
  root.dataset.season = season || '';
  root.dataset.layout = layout === 'modrinth' ? 'modrinth' : 'curseforge';
  return p;
}
