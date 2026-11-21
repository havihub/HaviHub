// What Havikun's channels show when their row is opened in the side column:
// the links of the Linktree, the latest YouTube videos, and on Twitch whether
// the channel is live plus its past broadcasts. Kept for 15 minutes.
// (Instagram, X and TikTok publish no open feed: the app shows their own
// embeddable page instead, see shared/socials.js.)
const http = require('./util/http');
const { cleanText } = require('../shared/limits');
const { SOCIALS } = require('../shared/socials');

const TTL = 15 * 60 * 1000;
const cache = new Map(); // id -> { at, data }
const BROWSER = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36', 'Accept-Language': 'es-CL,es;q=0.9,en;q=0.8' };

const decode = (s) =>
  String(s)
    .replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
const httpsUrl = (u) => (/^https:\/\/[^\s"'<>]+$/i.test(String(u || '')) ? String(u) : '');

async function text(url, opts = {}) {
  const res = await http.request(url, { timeout: 15000, retries: 1, ...opts, headers: { ...BROWSER, ...(opts.headers || {}) } });
  if (!res.ok) throw new http.HttpError(res.status, url);
  return res.text();
}

// ------------------------------------------------------------------ YouTube
// The channel's public feed (the same one feed readers use)
function parseYoutubeFeed(xml) {
  const out = [];
  for (const block of String(xml).split('<entry>').slice(1)) {
    const pick = (re) => {
      const m = block.match(re);
      return m ? decode(m[1]) : '';
    };
    const id = pick(/<yt:videoId>([^<]+)<\/yt:videoId>/);
    if (!/^[\w-]{6,20}$/.test(id)) continue;
    const link = pick(/<link rel="alternate" href="([^"]+)"/);
    out.push({
      id,
      title: cleanText(pick(/<title>([^<]*)<\/title>/), 200),
      published: pick(/<published>([^<]+)<\/published>/),
      views: Number(pick(/<media:statistics views="(\d+)"/)) || 0,
      url: /^https:\/\/www\.youtube\.com\//.test(link) ? link : `https://www.youtube.com/watch?v=${id}`,
      short: /\/shorts\//.test(link),
      thumbnail: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
    });
  }
  return out;
}

// The videos listed on a channel page (what YouTube's own site shows), for
// when its feeds are down: YouTube answers them with errors now and then.
function parseYoutubePage(html) {
  const m = html.match(/ytInitialData\s*=\s*(\{[\s\S]*?\});\s*<\/script>/);
  if (!m) return [];
  let data;
  try {
    data = JSON.parse(m[1]);
  } catch {
    return [];
  }
  const out = [];
  const seen = new Set();
  const plain = (t) => (t ? t.simpleText || t.content || (Array.isArray(t.runs) ? t.runs.map((r) => r.text).join('') : '') : '');
  const add = (id, title, when, views, short) => {
    if (!/^[\w-]{11}$/.test(String(id || '')) || seen.has(id) || !title) return;
    seen.add(id);
    const n = String(views || '').replace(/[^\d]/g, '');
    out.push({ id, title: cleanText(title, 140), url: `https://www.youtube.com/watch?v=${id}`, thumbnail: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`, published: '', ago: cleanText(when || '', 40), views: n ? Number(n) : 0, short: Boolean(short) });
  };
  const walk = (node, depth) => {
    if (!node || typeof node !== 'object' || depth > 40 || out.length >= 12) return;
    if (Array.isArray(node)) {
      for (const x of node) walk(x, depth + 1);
      return;
    }
    const v = node.videoRenderer || node.gridVideoRenderer;
    if (v) add(v.videoId, plain(v.title), plain(v.publishedTimeText), plain(v.viewCountText), false);
    const l = node.lockupViewModel;
    if (l && l.contentId) add(l.contentId, plain(l.metadata && l.metadata.lockupMetadataViewModel && l.metadata.lockupMetadataViewModel.title), '', '', false);
    for (const k of Object.keys(node)) walk(node[k], depth + 1);
  };
  walk(data, 0);
  return out;
}

// Three ways to the latest videos, each given a few seconds: the channel's
// feed, the feed of its "uploads" list (YouTube serves it apart, and it often
// answers when the first does not), and the channel's own page.
async function youtube(s) {
  const quick = { timeout: 7000, retries: 0 };
  const sources = [
    async () => parseYoutubeFeed(await text(`https://www.youtube.com/feeds/videos.xml?channel_id=${s.channelId}`, quick)),
    async () => parseYoutubeFeed(await text(`https://www.youtube.com/feeds/videos.xml?playlist_id=UU${s.channelId.slice(2)}`, quick)),
    async () => parseYoutubePage(await text(`https://www.youtube.com/${s.handle}/videos`, { ...quick, timeout: 12000, headers: { Cookie: 'SOCS=CAI; CONSENT=YES+1' } })),
  ];
  let last = new Error('no videos');
  for (const get of sources) {
    try {
      const videos = await get();
      if (videos.length) return { videos: videos.slice(0, 6) };
    } catch (e) {
      last = e;
    }
  }
  throw last;
}

// ------------------------------------------------------------------ Twitch
const TWITCH_WEB = 'kimne78kx3ncx6brgo4mv6wki5h1ko'; // the ID Twitch's own website uses
const TWITCH_QUERY =
  'query($login:String!){user(login:$login){stream{title viewersCount createdAt game{name}} videos(first:6,type:ARCHIVE,sort:TIME){edges{node{id title publishedAt lengthSeconds viewCount previewThumbnailURL(width:320,height:180) game{name}}}}}}';

function parseTwitch(json) {
  const user = json && json.data && json.data.user;
  if (!user) return null;
  const st = user.stream;
  const edges = (user.videos && user.videos.edges) || [];
  return {
    live: st ? { title: cleanText(st.title || '', 200), viewers: Number(st.viewersCount) || 0, since: st.createdAt || '', game: cleanText((st.game && st.game.name) || '', 80) } : null,
    videos: edges
      .map((e) => e && e.node)
      .filter((n) => n && /^\d+$/.test(String(n.id)))
      .map((n) => ({
        id: String(n.id),
        title: cleanText(n.title || '', 200),
        published: n.publishedAt || '',
        seconds: Number(n.lengthSeconds) || 0,
        views: Number(n.viewCount) || 0,
        game: cleanText((n.game && n.game.name) || '', 80),
        thumbnail: httpsUrl(n.previewThumbnailURL),
        url: `https://www.twitch.tv/videos/${n.id}`,
      })),
  };
}

async function twitch(s) {
  const out = { live: null, videos: [], details: false };
  const preview = `https://static-cdn.jtvnw.net/previews-ttv/live_user_${s.login}-440x248.jpg`;
  // Live or not: Twitch's own preview picture exists only while the channel is
  // live (offline channels are sent to a placeholder). Needs no key.
  try {
    const res = await http.request(preview, { redirect: 'manual', retries: 0, timeout: 10000, headers: BROWSER });
    if (res.status === 200) out.live = { title: '', viewers: 0, since: '', game: '' };
  } catch {
    /* unknown: treated as offline */
  }
  // Title, game and past broadcasts come from the data of Twitch's website.
  // It isn't a public interface: if it stops answering, the live mark above
  // and the link to the channel are what's left.
  try {
    const parsed = parseTwitch(await http.postJson('https://gql.twitch.tv/gql', { query: TWITCH_QUERY, variables: { login: s.login } }, { headers: { 'Client-Id': TWITCH_WEB }, timeout: 12000, retries: 0 }));
    if (parsed) {
      out.live = parsed.live || null;
      out.videos = parsed.videos;
      out.details = true;
    }
  } catch {
    /* only the live mark */
  }
  if (out.live) out.live.thumbnail = `${preview}?t=${Math.floor(Date.now() / 60000)}`;
  return out;
}

// ------------------------------------------------------------------ Linktree
// What the page listed the last time this was written, for when it can't be read
const LINKTREE_KNOWN = [
  { title: 'Sin Drama by Havikun', url: 'https://push.fm/fl/Hc8Wz28g' },
  { title: 'Server Discord', url: 'https://discord.gg/PFtMpSjsU3' },
  { title: 'Satoru Gojo Totem (Curseforge)', url: 'https://www.curseforge.com/minecraft/texture-packs/satoru-gojo-totem' },
  { title: 'Satoru Gojo Totem (Modrinth)', url: 'https://modrinth.com/resourcepack/satoru-gojo-totem' },
];

function parseLinktree(html) {
  const out = [];
  const add = (title, url) => {
    const u = httpsUrl(decode(url || ''));
    const name = cleanText(decode(String(title || '').replace(/<[^>]+>/g, ' ')), 120);
    if (u && name && !/linktr\.ee\/(s\/|login|register|help|privacy)/i.test(u) && !out.some((x) => x.url === u)) out.push({ title: name, url: u });
  };
  // the page's own data
  const m = String(html).match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (m) {
    try {
      const props = JSON.parse(m[1]).props.pageProps;
      for (const l of props.links || (props.account && props.account.links) || []) if (l && l.url && l.title && l.type !== 'HEADER' && !l.locked) add(l.title, l.url);
    } catch {
      /* fall through to the page's links */
    }
  }
  // or its visible link buttons
  if (!out.length) {
    for (const a of String(html).matchAll(/<a\b[^>]*data-testid="LinkButton"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)) add(a[2], a[1]);
    for (const a of String(html).matchAll(/<a\b[^>]*href="([^"]+)"[^>]*data-testid="LinkButton"[^>]*>([\s\S]*?)<\/a>/g)) add(a[2], a[1]);
  }
  return out.slice(0, 12);
}

async function linktree(s) {
  try {
    const links = parseLinktree(await text(s.url));
    if (links.length) return { links, live: true };
  } catch {
    /* the last known list */
  }
  return { links: LINKTREE_KNOWN, live: false };
}

const FEEDS = { youtube, twitch, linktree };

// What was fetched is kept on disk too, so a channel shows at once the next
// time (also right after opening Havi Hub) while fresh data is fetched behind.
let store = null; // { file, emit }
let loaded = false;
const pending = new Map();
function configure({ file, emit } = {}) {
  store = { file, emit };
  loaded = false;
}
function load() {
  if (loaded || !store || !store.file) return;
  loaded = true;
  try {
    const saved = JSON.parse(require('fs').readFileSync(store.file, 'utf8'));
    for (const [id, hit] of Object.entries(saved)) if (hit && hit.data && !cache.has(id)) cache.set(id, hit);
  } catch {
    // nothing saved yet
  }
}
// Written to a temporary file and renamed: whoever reads it (or the next
// start, if Havi Hub closes half way) sees the old copy or the new one, never
// a file cut in the middle (tests/social.test.js read it empty on a busy CI).
function save() {
  if (!store || !store.file) return;
  require('./util/fsx')
    .writeFileAtomic(store.file, JSON.stringify(Object.fromEntries(cache)))
    .catch(() => {});
}

function refresh(id, s) {
  if (pending.has(id)) return pending.get(id);
  const job = FEEDS[id](s)
    .then((data) => {
      cache.set(id, { at: Date.now(), data });
      save();
      if (store && store.emit) store.emit('social:feed', { id, data });
      return data;
    })
    .finally(() => pending.delete(id));
  pending.set(id, job);
  return job;
}

// What is known is answered at once; when it is older than 15 minutes (or
// `force`), fresh data is fetched and announced ('social:feed') when it arrives.
// `cachedOnly`: only what is already on disk, without connecting to anything
// (asked for without the person opening a channel while the automatic loading
// is turned off, Ajustes → Privacidad).
async function socialFeed(id, { force = false, wait = false, cachedOnly = false } = {}) {
  const s = SOCIALS.find((x) => x.id === id);
  if (!s || !FEEDS[id]) return null;
  load();
  const hit = cache.get(id);
  if (cachedOnly) return hit ? hit.data : null;
  const fresh = hit && Date.now() - hit.at < TTL;
  if (hit && fresh && !force) return hit.data;
  if (hit && !wait && !force) {
    refresh(id, s).catch(() => {});
    return hit.data;
  }
  try {
    return await refresh(id, s);
  } catch (e) {
    if (hit) return hit.data; // what was shown before beats nothing
    throw e;
  }
}

// Shortly after start: everything is fetched once, so opening a channel is
// instant. Only while the automatic loading is on (see main.js).
function warm() {
  for (const id of Object.keys(FEEDS)) socialFeed(id).catch(() => {});
}

module.exports = { configure, warm, parseYoutubePage, socialFeed, parseYoutubeFeed, parseTwitch, parseLinktree, LINKTREE_KNOWN, cache };
