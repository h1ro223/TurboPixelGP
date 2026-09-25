/* =========================================================
   ターボピクセルGP  (TURBO PIXEL GP)
   ドット絵・疑似3D（Mode7風）カートレース
   made by hiro/ヒロ  https://github.com/h1ro223
   ========================================================= */
(() => {
'use strict';

/* =========================================================
   1. 定数・ユーティリティ
   ========================================================= */
const TAU = Math.PI * 2;
const STEP_DT = 1 / 60;
const TEX = 1024;            // コーステクスチャのサイズ
const TRACK_STEP = 4;        // センターラインのサンプル間隔
const CAM_DIST = 46;         // カメラとカートの距離
const FAR = 760;             // 描画最遠距離
const FOG_START = 250;
const KART_R = 4.2;          // カートの当たり判定半径
const GRAVITY = 300;
const GLIDE_VZ = 95;          // カイト発射時の上昇速度
const SPRITE_N = 24;         // カートの向きのコマ数
const KART_SPR = 34;         // カートスプライトのサイズ(px)
const KART_WORLD = 14.5;     // カートスプライトのワールド幅
const KART_ANCHOR = 22 / 34; // スプライト内の接地位置
const GP_POINTS = [15, 12, 10, 8, 6, 4, 2, 1];

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const sign = (v) => (v < 0 ? -1 : v > 0 ? 1 : 0);
const wrapAngle = (a) => {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
};
function mulberry32(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashStr(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function hash2(x, y, s) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function hexRgb(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbStr(c) { return `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`; }
function shade(h, f) {
  const c = typeof h === 'string' ? hexRgb(h) : h;
  return rgbStr([clamp(c[0] * f, 0, 255), clamp(c[1] * f, 0, 255), clamp(c[2] * f, 0, 255)]);
}
function mixRgb(a, b, t) { return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]; }
const pack = (r, g, b) => ((255 << 24) | ((b & 255) << 16) | ((g & 255) << 8) | (r & 255)) >>> 0;
function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
function fmtTime(ms) {
  if (ms == null || !isFinite(ms)) return `-'--"--`;
  ms = Math.max(0, ms);
  const m = Math.floor(ms / 60000), s = Math.floor(ms / 1000) % 60, c = Math.floor(ms / 10) % 100;
  return `${m}'${String(s).padStart(2, '0')}"${String(c).padStart(2, '0')}`;
}
const ordinal = (n) => (n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th');
const isTouchDevice = (() => {
  try { return window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window; } catch (e) { return false; }
})();

/* =========================================================
   2. ゲームデータ（キャラ・クラス・アイテム・コース）
   ========================================================= */
const CHARS = [
  { id: 'leo', name: 'レオ', body: '#e8363d', accent: '#ffd23f', helmet: '#f4f4f4', suit: '#2b59c3', visor: '#39c6ff', acc: 'stripe', stats: { spd: 3, acc: 3, hdl: 3, wgt: 3 }, desc: 'なんでもこなすバランス型。まよったらコレ！' },
  { id: 'mimi', name: 'ミミ', body: '#ff7eb6', accent: '#ffffff', helmet: '#ffd1e6', suit: '#ff4f9a', visor: '#7a3cff', acc: 'ears', stats: { spd: 2, acc: 5, hdl: 4, wgt: 1 }, desc: '加速がとにかく速い。ぶつかりには弱め。' },
  { id: 'gantetsu', name: 'ガンテツ', body: '#3f8f3a', accent: '#d0d0d0', helmet: '#7a5230', suit: '#8a5a2b', visor: '#ff9d00', acc: 'mohawk', stats: { spd: 5, acc: 1, hdl: 1, wgt: 5 }, desc: '最高速と重さはナンバーワン。立ち上がりは遅い。' },
  { id: 'sora', name: 'ソラ', body: '#3aa0ff', accent: '#ffffff', helmet: '#e0f2ff', suit: '#1f5fbf', visor: '#ffe14d', acc: 'fin', stats: { spd: 3, acc: 3, hdl: 4, wgt: 2 }, desc: '曲がりやすさ重視のテクニック型。' },
  { id: 'crow', name: 'クロウ', body: '#43336a', accent: '#b04dff', helmet: '#26212f', suit: '#5a3d8c', visor: '#ff3355', acc: 'horns', stats: { spd: 4, acc: 2, hdl: 2, wgt: 4 }, desc: '重くて速いパワー型。体当たりが強い。' },
  { id: 'pico', name: 'ピコ', body: '#ffd21f', accent: '#ff6a00', helmet: '#fff3a0', suit: '#ff9a1f', visor: '#2ad4a0', acc: 'antenna', stats: { spd: 2, acc: 4, hdl: 5, wgt: 1 }, desc: 'ハンドリング最強。ドリフトが得意。' },
  { id: 'nagi', name: 'ナギ', body: '#ff8a2a', accent: '#262626', helmet: '#ffb46b', suit: '#d9481f', visor: '#1ec8ff', acc: 'band', stats: { spd: 4, acc: 3, hdl: 3, wgt: 2 }, desc: 'スピードと加速を両立したスピード型。' },
  { id: 'yuki', name: 'ユキ', body: '#e9f7ff', accent: '#29c6c9', helmet: '#8fe9ff', suit: '#29a4c9', visor: '#ff5fa2', acc: 'tail', stats: { spd: 3, acc: 4, hdl: 4, wgt: 1 }, desc: '軽快なオールラウンダー。雪のコースが好き。' },
];

const CLASSES = [
  { id: 'beginner', name: 'ビギナー', en: 'BEGINNER', speed: 112, cpu: 0.86, aiDrift: 0, desc: 'はじめての人向け。スピードもライバルもおだやか。' },
  { id: 'standard', name: 'スタンダード', en: 'STANDARD', speed: 132, cpu: 0.93, aiDrift: 0.5, desc: 'ほどよいスピード。ドリフトを覚えたらここ！' },
  { id: 'expert', name: 'エキスパート', en: 'EXPERT', speed: 152, cpu: 0.975, aiDrift: 1, desc: '超高速バトル。CPUも本気で走る。' },
  { id: 'mirror', name: 'ミラー', en: 'MIRROR', speed: 152, cpu: 0.975, aiDrift: 1, mirror: true, desc: 'コースが左右反転したエキスパート。' },
];

const ITEMS = {
  nitro: { name: 'ニトロ', desc: '一気に加速！オフロードでも減速しない。' },
  nitro3: { name: 'トリプルニトロ', desc: 'ニトロを3回使える。' },
  oil: { name: 'オイル缶', desc: 'うしろに置く。ふんだ相手はスリップ。' },
  bullet: { name: 'エナジー弾', desc: '前にまっすぐ発射。壁で反射する。ブレーキを押しながらで後ろに発射。' },
  drone: { name: '追尾ドローン', desc: 'ひとつ前の順位の相手を追いかけて攻撃。' },
  shield: { name: 'シールド', desc: 'しばらく無敵＆スピードアップ。ぶつかった相手をはじく。' },
  emp: { name: 'スタンウェーブ', desc: '自分より前にいる全員をしびれさせる。' },
};
const ITEM_KEYS = ['nitro', 'nitro3', 'oil', 'bullet', 'drone', 'shield', 'emp'];
const ITEM_TABLE = [
  [10, 0, 50, 40, 0, 0, 0],
  [22, 0, 28, 34, 16, 0, 0],
  [26, 6, 18, 28, 20, 2, 0],
  [28, 12, 12, 20, 20, 8, 0],
  [28, 16, 8, 14, 20, 10, 4],
  [24, 22, 4, 10, 18, 16, 6],
  [18, 28, 0, 6, 18, 20, 10],
  [14, 32, 0, 4, 14, 22, 14],
];

// テーマ（見た目）
const THEMES = {
  grass: {
    sky: ['#2f6fd0', '#4f93ea', '#7fb8ff', '#b4dcff', '#dff2ff'], fog: '#d6eeff', sun: '#fff6c8',
    outer: 'grass', off: 'grassOff', road: 'asphalt', curbA: '#f4f4f4', curbB: '#e0383d',
    edge: '#e8e8e8', center: '#f2d24b', wall: '#c9c9d1', boundary: 'wall',
    wallDeco: 'tire', wallGap: 13, wallOff: 4,
    scenery: [['tree', 6], ['bush', 3], ['flag', 1], ['tree2', 3]], sceneryMin: 8, sceneryRange: 120,
    props: [['cone', 1]], dust: ['#6d9a3c', '#92b85a', '#c9d88a'], mini: '#e9f1ff', miniOut: '#2c5a2a',
    hills: 'green', weather: null, night: false,
  },
  beach: {
    sky: ['#1b8fff', '#3aa8ff', '#6cc6ff', '#a6e2ff', '#e4fbff'], fog: '#dff7ff', sun: '#fffbe0',
    outer: 'water', off: 'sand', road: 'concrete', curbA: '#ffffff', curbB: '#ff8a2a',
    edge: '#fff4dc', center: null, wall: null, boundary: 'fall',
    wallDeco: 'buoy', wallGap: 34, wallOff: 16, islands: 'sand',
    scenery: [['palm', 7], ['umbrella', 2], ['rock', 2]], sceneryMin: 20, sceneryRange: 110,
    props: [['palm', 2], ['crab', 1]], dust: ['#e8c982', '#f3dca4', '#fff0c8'], mini: '#fff6de', miniOut: '#1a6aa0',
    hills: 'sea', weather: null, night: false, splash: ['#9fe3ff', '#ffffff', '#4fb4e8'],
  },
  snow: {
    sky: ['#5d7fb8', '#7f9ccc', '#a9bfe0', '#d1def0', '#eef3fa'], fog: '#e9f0fa', sun: '#ffffff',
    outer: 'snow', off: 'snowOff', road: 'iceRoad', curbA: '#f6fbff', curbB: '#2f7de0',
    edge: '#dfeaff', center: '#9fd8ff', wall: '#ffffff', boundary: 'wall',
    wallDeco: 'snowbank', wallGap: 12, wallOff: 4,
    scenery: [['pine', 8], ['snowman', 1], ['crystal', 2]], sceneryMin: 8, sceneryRange: 120,
    props: [['pine', 2], ['snowman', 1]], dust: ['#ffffff', '#dce9fa', '#bcd3f0'], mini: '#ffffff', miniOut: '#5b79a8',
    hills: 'snow', weather: 'snow', night: false,
  },
  lava: {
    sky: ['#0e0620', '#1e0a36', '#3a0f3e', '#6a1a38', '#b4352c'], fog: '#5a1a2c', sun: '#ffd0a0',
    outer: 'lava', off: 'rock', road: 'brick', curbA: '#ffcc00', curbB: '#2a2230',
    edge: '#ffb050', center: null, wall: null, boundary: 'fall',
    wallDeco: 'torch', wallGap: 46, wallOff: 7, islands: 'rock',
    scenery: [['pillar', 4], ['tower', 2], ['lavarock', 3]], sceneryMin: 22, sceneryRange: 120,
    props: [['lavarock', 2]], dust: ['#7a5a6a', '#ff7a2a', '#ffc04a'], mini: '#ffd9a0', miniOut: '#6a1020',
    hills: 'volcano', weather: 'ember', night: true, splash: ['#ff5a1f', '#ffc04a', '#ff2a10'],
  },
  reef: {
    sky: ['#0f7fd8', '#2a9fe8', '#5cc0f2', '#9ee0f8', '#dcf8ff'], fog: '#c4ecf8', sun: '#fffbe0',
    outer: 'water', off: 'sand', road: 'boardwalk', curbA: '#ffffff', curbB: '#2fc2b8',
    edge: '#fff4dc', center: null, wall: '#d8b37a', boundary: 'wall', islands: 'sand',
    wallDeco: 'coral', wallGap: 24, wallOff: 5,
    scenery: [['palm', 4], ['coral', 3], ['reefrock', 2], ['kelp', 2]], sceneryMin: 18, sceneryRange: 110,
    props: [['reefrock', 1]], dust: ['#e8c982', '#f3dca4', '#fff0c8'], mini: '#fff6de', miniOut: '#137a8a',
    hills: 'sea', weather: null, night: false, splash: ['#9fe3ff', '#ffffff', '#4fb4e8'],
    waterRoad: 'seabed', waterOff: 'reefOff', waterEdge: '#7ff0ff',
  },
  sky: {
    sky: ['#3f8fe8', '#6aaef2', '#9cccf8', '#cde6fb', '#f4fbff'], fog: '#eef7ff', sun: '#fffdf0',
    outer: 'cloud', off: 'meadow', road: 'skytile', curbA: '#ffffff', curbB: '#ff8fc8',
    edge: '#ffffff', center: '#ffd9ec', wall: null, boundary: 'fall', islands: 'meadow',
    wallDeco: 'lantern', wallGap: 44, wallOff: 6,
    scenery: [['skytree', 5], ['column', 2], ['balloon', 2], ['windmill', 1]], sceneryMin: 20, sceneryRange: 120,
    props: [['column', 1]], dust: ['#9fd67a', '#c8eea0', '#ffffff'], mini: '#ffffff', miniOut: '#4f8fd0',
    hills: 'clouds', weather: null, night: false, splash: ['#ffffff', '#e6f2ff', '#cfe6ff'], chasm: 'cloud', islandEdge: '#9a7a52',
  },
  neon: {
    sky: ['#070312', '#120829', '#231040', '#3a1557', '#5e1f6b'], fog: '#2a0f45', sun: '#ffffff',
    outer: 'cityfloor', off: 'neonoff', road: 'neonroad', curbA: '#ff3d7f', curbB: '#38d6ff',
    edge: '#38d6ff', center: '#ff3d7f', wall: '#ff3d7f', boundary: 'wall',
    wallDeco: 'neonpost', wallGap: 18, wallOff: 4,
    scenery: [['building', 7], ['sign', 2], ['lamp', 2]], sceneryMin: 10, sceneryRange: 110,
    props: [['cone', 1]], dust: ['#5a4a7a', '#8a6ad0', '#38d6ff'], mini: '#ffe6ff', miniOut: '#5a1a7a',
    hills: 'city', weather: 'rain', night: true, splash: ['#38d6ff', '#8a6ad0', '#ffffff'], chasm: 'canal',
  },
  fort: {
    sky: ['#2a1c4a', '#5a2f6a', '#a24a6a', '#e2785a', '#ffc27a'], fog: '#d8a08c', sun: '#ffe0a0',
    outer: 'crag', off: 'grating', road: 'metal', curbA: '#ffd23f', curbB: '#2a2440',
    edge: '#ffd23f', center: null, wall: '#5a5060', boundary: 'wall',
    wallDeco: 'rail', wallGap: 14, wallOff: 3,
    scenery: [['gear', 3], ['stack', 3], ['crate', 2]], sceneryMin: 10, sceneryRange: 150,
    props: [['crate', 1]], dust: ['#6a6070', '#8a8090', '#b0a8b8'], mini: '#fff0d8', miniOut: '#4a3a5a',
    hills: 'ridge', weather: null, night: false, splash: ['#ffd23f', '#ffffff', '#b0a8b8'], chasm: 'grating',
  },
  mountain: {
    sky: ['#2f78d8', '#4f98ec', '#80bcff', '#b8dcff', '#e4f4ff'], fog: '#cfe6fa', sun: '#fff6c8',
    outer: 'grass', off: 'grassOff', road: 'asphalt', curbA: '#f4f4f4', curbB: '#e0383d',
    edge: '#e8e8e8', center: '#f2d24b', wall: '#8a8490', boundary: 'wall',
    wallDeco: 'fencepost', wallGap: 18, wallOff: 3,
    scenery: [['tree', 4], ['pine', 4], ['bush', 2]], sceneryMin: 10, sceneryRange: 150,
    props: [['rock', 1]], dust: ['#6d9a3c', '#92b85a', '#c9d88a'], mini: '#e9f1ff', miniOut: '#2c5a2a',
    hills: 'snow', weather: null, night: false, splash: ['#9fe3ff', '#ffffff', '#4fb4e8'], chasm: 'water',
  },
  galaxy: {
    sky: ['#02010a', '#07041a', '#10082e', '#1d0c44', '#2e1060'], fog: '#1a0a3a', sun: '#ffffff',
    outer: 'space', off: 'nebula', road: 'starroad', curbA: '#ffffff', curbB: '#ff5fd2', rainbow: true,
    edge: '#ffffff', center: null, wall: null, boundary: 'fall',
    wallDeco: 'starpole', wallGap: 40, wallOff: 6,
    scenery: [['asteroid', 4], ['planet', 1], ['satellite', 1], ['crystal', 2]], sceneryMin: 24, sceneryRange: 140,
    props: [['crystal', 1]], dust: ['#8a6ad0', '#ff5fd2', '#38d6ff'], mini: '#fff0ff', miniOut: '#4a1a8a',
    hills: 'space', weather: null, night: true, splash: ['#ffffff', '#ff5fd2', '#38d6ff'], chasm: 'space',
  },
};

// コース（座標は1024x1024のテクスチャ空間。f=周回位置の割合）
const COURSES = [
  {
    id: 'sunrise', name: 'サンライズサーキット', en: 'SUNRISE CIRCUIT', theme: 'grass', roadW: 56, offW: 34, music: 'sunrise',
    pts: [[400, 870], [700, 870], [870, 830], [925, 700], [870, 575], [745, 545], [665, 465], [700, 360], [835, 300], [900, 195], [820, 105], [600, 110], [420, 115], [300, 175], [320, 300], [430, 385], [410, 505], [295, 565], [165, 545], [105, 665], [145, 800], [255, 870]],
    items: [0.12, 0.395, 0.64, 0.87],
    boosts: [{ f: 0.474, d: -12 }, { f: 0.498, d: 12 }, { f: 0.955, d: 0 }],
    ramps: [{ f: 0.70, d: 0, w: 26 }],
    gaps: [], ice: [], pools: [],
    desc: '朝日にかがやく基本のサーキット。S字とヘアピンでドリフトを練習しよう。',
  },
  {
    id: 'beach', name: 'パームビーチ', en: 'PALM BEACH', theme: 'beach', roadW: 64, offW: 30, music: 'beach',
    pts: [[130, 560], [130, 380], [205, 195], [385, 120], [560, 180], [630, 330], [710, 445], [850, 465], [920, 585], [880, 765], [740, 865], [565, 845], [470, 725], [335, 760], [235, 870], [135, 800]],
    items: [0.11, 0.35, 0.53, 0.86],
    boosts: [{ f: 0.29, d: -14 }, { f: 0.30, d: 14 }, { f: 0.925, d: 0 }],
    ramps: [], gaps: [{ f: 0.618, len: 46 }], ice: [], pools: [],
    desc: 'ヤシの木がゆれる海辺のコース。コースの外は海！大ジャンプで入り江をこえろ。',
  },
  {
    id: 'snow', name: 'スノーピーク', en: 'SNOW PEAK', theme: 'snow', roadW: 58, offW: 34, music: 'snow',
    pts: [[300, 895], [560, 895], [820, 865], [915, 750], [855, 640], [680, 630], [485, 650], [345, 615], [300, 505], [380, 410], [580, 430], [770, 420], [890, 320], [870, 190], [730, 120], [520, 150], [345, 110], [185, 150], [110, 300], [110, 560], [125, 760], [190, 870]],
    items: [0.08, 0.31, 0.56, 0.83],
    boosts: [{ f: 0.425, d: 0 }, { f: 0.80, d: -13 }, { f: 0.822, d: 13 }],
    ramps: [], gaps: [],
    ice: [{ f: 0.355, len: 0.09 }, { f: 0.655, len: 0.065 }],
    pools: [],
    desc: '雪山のテクニカルコース。アイスバーンはすべりやすいので注意！',
  },
  {
    id: 'lava', name: 'マグマキャッスル', en: 'MAGMA CASTLE', theme: 'lava', roadW: 56, offW: 30, music: 'lava',
    pts: [[300, 885], [520, 885], [760, 880], [885, 800], [885, 620], [760, 560], [560, 560], [455, 480], [470, 340], [600, 280], [820, 280], [905, 180], [820, 100], [560, 100], [300, 110], [160, 190], [140, 360], [265, 440], [285, 565], [165, 645], [120, 780], [185, 870]],
    items: [0.09, 0.345, 0.60, 0.845],
    boosts: [{ f: 0.045, d: 0 }, { f: 0.562, d: -13 }, { f: 0.585, d: 13 }],
    ramps: [], gaps: [{ f: 0.285, len: 40 }, { f: 0.705, len: 46 }],
    ice: [],
    pools: [{ f: 0.115, d: -15, r: 10 }, { f: 0.17, d: 17, r: 11 }, { f: 0.455, d: -16, r: 10 }, { f: 0.64, d: 14, r: 11 }],
    desc: '溶岩にかこまれた最終コース。マグマのジャンプとたまりに要注意！',
  },
  {
    id: 'reef', name: 'コーラルリーフ', en: 'CORAL REEF', theme: 'reef', roadW: 60, offW: 30, music: 'reef',
    pts: [[250, 890], [520, 895], [780, 880], [900, 780], [880, 640], [760, 590], [640, 640], [520, 700], [380, 680], [300, 580], [330, 450], [470, 400], [640, 420], [800, 400], [900, 300], [880, 160], [740, 100], [540, 120], [360, 110], [190, 150], [110, 290], [120, 460], [100, 640], [130, 800]],
    items: [0.15, 0.40, 0.63, 0.83],
    boosts: [{ f: 0.075, d: -14 }, { f: 0.095, d: 14 }, { f: 0.47, d: 0 }, { f: 0.875, d: 0 }],
    ramps: [{ f: 0.52, d: 0, w: 34 }], gaps: [], ice: [], pools: [],
    zones: [{ f: 0.235, len: 0.30, kind: 'water' }, { f: 0.655, len: 0.13, kind: 'water' }],
    movers: [{ f: 0.30, amp: 18, period: 3.2, kind: 'puffer' }, { f: 0.43, amp: 20, period: 2.6, kind: 'puffer' }, { f: 0.72, amp: 22, period: 3.0, kind: 'puffer' }],
    desc: 'サンゴ礁の海。道がそのまま海にもぐる！水中はふわっと跳ねてハンドルが重くなる。',
  },
  {
    id: 'sky', name: 'スカイガーデン', en: 'SKY GARDEN', theme: 'sky', roadW: 60, offW: 26, music: 'sky',
    pts: [[200, 880], [480, 885], [760, 880], [900, 800], [910, 660], [800, 590], [620, 600], [450, 560], [340, 470], [380, 350], [540, 320], [720, 330], [870, 260], [890, 140], [760, 90], [520, 100], [300, 110], [160, 180], [110, 330], [150, 480], [120, 640], [120, 790]],
    items: [0.14, 0.33, 0.57, 0.80],
    boosts: [{ f: 0.49, d: -13 }, { f: 0.505, d: 13 }, { f: 0.92, d: 0 }],
    ramps: [], gaps: [{ f: 0.09, len: 44 }], ice: [], pools: [],
    glides: [{ f: 0.645, len: 300 }],
    winds: [{ f: 0.355, len: 0.09, force: 60 }, { f: 0.835, len: 0.07, force: 55 }],
    desc: '雲の上の空中庭園。カイトで大空を飛びこえろ！横風にふきとばされないように。',
  },
  {
    id: 'neon', name: 'ネオンシティ', en: 'NEON CITY', theme: 'neon', roadW: 56, offW: 22, music: 'neon',
    pts: [[260, 880], [560, 880], [820, 875], [895, 820], [900, 700], [880, 610], [800, 575], [670, 570], [600, 520], [590, 420], [630, 340], [760, 320], [870, 290], [905, 200], [870, 120], [760, 95], [560, 100], [360, 105], [200, 110], [125, 170], [115, 300], [160, 390], [300, 420], [380, 480], [370, 580], [260, 640], [150, 690], [125, 790], [170, 860]],
    items: [0.13, 0.36, 0.64, 0.88],
    boosts: [{ f: 0.385, d: 0 }, { f: 0.94, d: -12 }, { f: 0.96, d: 12 }],
    ramps: [], gaps: [], ice: [], pools: [],
    glides: [{ f: 0.53, len: 250 }],
    bumpers: [{ f: 0.055, d: -13 }, { f: 0.085, d: 13 }, { f: 0.105, d: -4 }, { f: 0.805, d: -11 }, { f: 0.825, d: 11 }],
    movers: [{ f: 0.215, amp: 20, period: 2.8, kind: 'robot' }, { f: 0.745, amp: 18, period: 2.4, kind: 'robot' }],
    desc: '雨のネオン街。ピンボールみたいなバンパーとロボットに注意。ビルの谷間をカイトで飛べ！',
  },
  {
    id: 'galaxy', name: 'ギャラクシーロード', en: 'GALAXY ROAD', theme: 'galaxy', roadW: 58, offW: 24, music: 'galaxy',
    pts: [[300, 900], [560, 905], [800, 890], [900, 820], [915, 680], [915, 480], [905, 300], [860, 160], [740, 90], [600, 110], [540, 220], [560, 360], [600, 480], [520, 580], [380, 590], [300, 500], [330, 380], [340, 250], [260, 120], [140, 120], [90, 260], [110, 450], [100, 650], [140, 820]],
    items: [0.12, 0.39, 0.67, 0.90],
    boosts: [{ f: 0.06, d: -12 }, { f: 0.08, d: 12 }, { f: 0.955, d: 0 }],
    ramps: [{ f: 0.60, d: 0, w: 30 }], gaps: [{ f: 0.835, len: 44 }], ice: [], pools: [],
    glides: [{ f: 0.205, len: 270 }],
    zones: [{ f: 0.44, len: 0.20, kind: 'lowg' }],
    movers: [{ f: 0.50, amp: 18, period: 3.0, kind: 'meteor' }, { f: 0.575, amp: 20, period: 2.6, kind: 'meteor' }],
    desc: '星の海をかける最終コース。無重力ゾーンで大ジャンプ、宇宙カイトで星をこえろ！',
  },
];

// スペシャルコース（高低差あり・1周だけの超ロングコース）
COURSES.push({
  id: 'dragon', name: 'ドラゴンマウンテン', en: 'DRAGON MOUNTAIN', theme: 'mountain', roadW: 60, offW: 26, music: 'dragon',
  special: true, size: 2048, laps: 1, sections: 3,
  pts: [[300, 1850], [650, 1885], [1000, 1860], [1300, 1790], [1600, 1850], [1850, 1800], [1930, 1650], [1820, 1560], [1500, 1570], [1260, 1520], [1230, 1400], [1400, 1350], [1700, 1370], [1900, 1300], [1920, 1170], [1780, 1110], [1450, 1130], [1250, 1060], [1260, 930], [1450, 880], [1750, 900], [1920, 800], [1900, 600], [1720, 470], [1640, 330], [1660, 190], [1540, 100], [1150, 120], [800, 160], [480, 180], [260, 260], [180, 450], [330, 600], [600, 620], [860, 700], [1000, 880], [900, 1060], [640, 1100], [420, 1030], [230, 1120], [180, 1330], [350, 1480], [650, 1450], [900, 1540], [860, 1700], [560, 1720], [330, 1680], [200, 1750]],
  // 高低差（周回位置f, 高さ）。直線でつないでからなめらかにする
  elev: [[0, 0], [0.065, 0], [0.098, 8], [0.110, 24], [0.119, 6], [0.14, 8], [0.151, 12], [0.192, 32], [0.225, 48], [0.266, 70], [0.297, 88], [0.339, 106], [0.370, 122], [0.413, 144], [0.448, 166], [0.486, 192], [0.502, 206], [0.53, 220], [0.556, 226], [0.595, 186], [0.611, 178], [0.649, 160], [0.69, 132], [0.703, 144], [0.712, 124], [0.735, 106], [0.777, 84], [0.815, 64], [0.845, 46], [0.853, 52], [0.862, 34], [0.904, 24], [0.92, 14], [0.94, 4], [0.952, 10], [0.96, 0], [0.975, 0]],
  // 道の外の地形の険しさ（周回位置f, 傾き）
  terrain: [[0, 0.28], [0.12, 0.35], [0.16, 1.0], [0.44, 1.1], [0.5, 0.7], [0.6, 0.75], [0.8, 0.55], [0.92, 0.3], [1, 0.28]],
  river: [[905, 2080], [880, 1870], [1000, 1760], [1070, 1640], [1120, 1500], [1070, 1360], [1060, 1250]],
  lake: { x: 1080, y: 1200, r: 64 },
  scenery: [[0, [['house', 5], ['tree', 3], ['bush', 2], ['flag', 1]]], [0.15, [['pine', 5], ['tree', 3], ['rock', 2]]], [0.42, [['pine', 4], ['rock', 3], ['snowman', 1], ['crystal', 1]]], [0.6, [['pine', 4], ['tree', 3], ['rock', 1]]], [0.88, [['house', 4], ['tree', 3], ['bush', 2]]]],
  items: [0.035, 0.17, 0.305, 0.44, 0.535, 0.665, 0.795, 0.93],
  boosts: [{ f: 0.178, d: 0 }, { f: 0.392, d: 0 }, { f: 0.615, d: -13 }, { f: 0.625, d: 13 }, { f: 0.885, d: 0 }],
  ramps: [{ f: 0.262, d: 14, w: 24 }, { f: 0.79, d: -13, w: 24 }], gaps: [], ice: [], pools: [],
  glides: [{ f: 0.558, len: 330 }],
  desc: '【スペシャル・1周のみ】村から山頂へのぼり、カイトで谷をこえて一気にくだる超ロングコース。坂と丘のジャンプに注意！',
});

// スペシャルコース2：ギアフォートレス（ベルトコンベア・大砲・らせん塔・ショートカット）
COURSES.push({
  id: 'gear', name: 'ギアフォートレス', en: 'GEAR FORTRESS', theme: 'fort', roadW: 60, offW: 18, music: 'fort',
  special: true, size: 3072, laps: 1, sections: 3, snowLine: 290,
  pts: (() => {
    const CX = 1150, CY = 1050, cp = [620, 540];
    let vx = CX - cp[0], vy = CY - cp[1];
    const l = Math.hypot(vx, vy); vx /= l; vy /= l;
    const th0 = Math.atan2(-vx, vy), b = 150 / (2 * Math.PI), sp = [];
    for (let th = 0; th <= 3 * 2 * Math.PI + 1e-6; th += 0.5) { const r = 115 + b * th, a = th0 + th; sp.push([Math.round(CX + Math.cos(a) * r), Math.round(CY + Math.sin(a) * r)]); }
    const last = sp[sp.length - 1];
    return [[520, 2880], [900, 2900], [1300, 2880], [1650, 2800], [1760, 2640], [1600, 2520], [1200, 2500], [800, 2470], [560, 2330], [640, 2170], [1000, 2150], [1400, 2170], [1800, 2230], [2150, 2380], [2500, 2550], [2850, 2560], [2950, 2380], [2800, 2200], [2450, 2140], [2250, 2000],
      [2350, 1840], [2700, 1830], [2930, 1700], [2880, 1520], [2600, 1480], [2330, 1420], [2280, 1250], [2500, 1170], [2800, 1150], [2950, 1000], [2880, 820], [2600, 780], [2350, 700], [2330, 520], [2560, 430], [2850, 380], [2930, 220], [2750, 120], [2400, 130], [2000, 150], [1500, 140], [1000, 130], [560, 150], [300, 260], [260, 430], [400, 520],
      cp, ...sp, [last[0] + 330, last[1] + 120], [1980, 1000], [1960, 1350], [1820, 1640], [1500, 1850], [1000, 1880], [640, 1850], [330, 1900], [180, 2100], [220, 2400], [180, 2650], [260, 2850]];
  })(),
  elev: [[0, 0], [0.018, 0], [0.032, 30], [0.046, 30], [0.05, 34], [0.056, 10], [0.08, 6], [0.09, -12], [0.104, -12], [0.113, 4], [0.13, 36], [0.15, 42], [0.168, 42], [0.174, 58], [0.182, 36], [0.205, 24], [0.248, 40], [0.281, 90], [0.319, 140], [0.349, 180], [0.387, 230], [0.416, 262], [0.43, 270], [0.436, 286], [0.444, 262], [0.46, 290], [0.475, 300], [0.482, 318], [0.49, 296], [0.505, 306], [0.53, 326], [0.547, 336], [0.556, 336], [0.583, 252], [0.826, 70], [0.845, 62], [0.855, 62], [0.862, 80], [0.87, 60], [0.90, 42], [0.92, 30], [0.935, 30], [0.942, 46], [0.95, 26], [0.975, 4], [1, 0]],
  terrain: [[0, 0.18], [0.21, 0.25], [0.25, 0.9], [0.42, 0.8], [0.55, 0.4], [0.83, 0.3], [0.9, 0.2], [1, 0.18]],
  scenery: [[0, [['stack', 3], ['gear', 3], ['crate', 3], ['lamp', 1]]], [0.21, [['pine', 5], ['rock', 3], ['gear', 1]]], [0.415, [['pine', 3], ['rock', 3], ['banner', 2], ['snowman', 1]]], [0.55, [['banner', 3], ['torch', 3], ['gear', 2], ['crate', 1]]], [0.83, [['stack', 3], ['gear', 3], ['crate', 3]]]],
  items: [0.025, 0.10, 0.19, 0.27, 0.345, 0.42, 0.505, 0.61, 0.68, 0.76, 0.855, 0.93],
  boosts: [{ f: 0.124, d: 0 }, { f: 0.293, d: -12 }, { f: 0.30, d: 12 }, { f: 0.366, d: 0 }, { f: 0.456, d: 0 }, { f: 0.536, d: 0 }, { f: 0.645, d: 12 }, { f: 0.72, d: -12 }, { f: 0.80, d: 0 }, { f: 0.885, d: 0 }],
  ramps: [{ f: 0.098, d: 0, w: 26 }, { f: 0.695, d: -12, w: 22 }], gaps: [], ice: [], pools: [],
  cannons: [{ f: 0.5475, to: 0.585 }],
  belts: [
    { f: 0.006, len: 330, lanes: [{ d0: -30, d1: 0, v: 75 }, { d0: 0, d1: 30, v: -55 }] },
    { f: 0.068, len: 300, lanes: [{ d0: -30, d1: 0, v: -55 }, { d0: 0, d1: 30, v: 75 }] },
    { f: 0.146, len: 340, lanes: [{ d0: -30, d1: -10, v: 85 }, { d0: -10, d1: 10, v: -60 }, { d0: 10, d1: 30, v: 85 }] },
    { f: 0.905, len: 320, lanes: [{ d0: -30, d1: 0, v: 80 }, { d0: 0, d1: 30, v: -60 }] },
    { f: 0.958, len: 260, lanes: [{ d0: -30, d1: 0, v: -60 }, { d0: 0, d1: 30, v: 80 }] },
  ],
  // side：-1=左側 / 1=右側、need：必要なスピード（最高速に対する割合。1以上はブーストが必要）
  shortcuts: [{ f: 0.178, side: -1, to: 0.238, need: 0.92 }, { f: 0.388, side: -1, to: 0.444, need: 0.88 }, { f: 0.598, side: -1, to: 0.6666, need: 1.12 }],
  movers: [{ f: 0.094, amp: 20, period: 2.6, kind: 'robot' }, { f: 0.195, amp: 22, period: 3.0, kind: 'robot' }, { f: 0.468, amp: 22, period: 3.4, kind: 'boulder' }, { f: 0.515, amp: 24, period: 3.0, kind: 'boulder' }],
  winds: [{ f: 0.448, len: 0.07, force: 50 }],
  desc: '【スペシャル・1周のみ】工場のベルトコンベア、山の要塞への登り、大砲でらせん塔の頂上へ！ぐるぐる下って工場へ戻る超ロングコース。隠しショートカットもあるぞ。',
});

// グランプリのカップ
const CUPS = [
  { id: 'star', name: 'スターカップ', en: 'STAR CUP', courses: [0, 1, 2, 3], color: '#ffd23f', desc: 'サーキット・海・雪山・溶岩。基本がつまった4コース。' },
  { id: 'sky', name: 'スカイカップ', en: 'SKY CUP', courses: [4, 5, 6, 7], color: '#38d6ff', desc: '水中・空中・ネオン街・宇宙。ギミック満載の4コース。' },
];

/* =========================================================
   3. セーブデータ
   ========================================================= */
const Store = {
  key: 'tpgp_save_v1',
  data: null,
  defaults() {
    return {
      settings: { bgm: 0.6, se: 0.8, quality: 'mid', shake: true, autoAccel: isTouchDevice, gyro: false, minimap: true, gyroSens: 1, motionJA: isTouchDevice },
      records: {}, trophies: {}, unlock: { mirror: false }, lastChar: 0,
    };
  },
  load() {
    const def = this.defaults();
    let d = null;
    try { const raw = localStorage.getItem(this.key); d = raw ? JSON.parse(raw) : null; } catch (e) { d = null; }
    if (!d || typeof d !== 'object') d = {};
    this.data = {
      settings: Object.assign({}, def.settings, d.settings || {}),
      records: Object.assign({}, d.records || {}),
      trophies: Object.assign({}, d.trophies || {}),
      unlock: Object.assign({}, def.unlock, d.unlock || {}),
      lastChar: typeof d.lastChar === 'number' ? clamp(d.lastChar | 0, 0, CHARS.length - 1) : 0,
    };
    // 旧バージョン（カップ無し）のトロフィーをスターカップへ移行
    const tr = this.data.trophies;
    CLASSES.forEach((c) => { if (typeof tr[c.id] === 'number') { if (!tr['star_' + c.id]) tr['star_' + c.id] = tr[c.id]; delete tr[c.id]; } });
  },
  save() { try { localStorage.setItem(this.key, JSON.stringify(this.data)); } catch (e) { /* 容量超過など */ } },
  getGhost(id) { try { const r = localStorage.getItem('tpgp_ghost_' + id); return r ? JSON.parse(r) : null; } catch (e) { return null; } },
  setGhost(id, g) { try { localStorage.setItem('tpgp_ghost_' + id, JSON.stringify(g)); return true; } catch (e) { return false; } },
  reset() {
    try {
      const del = [];
      for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.indexOf('tpgp_') === 0) del.push(k); }
      del.forEach((k) => localStorage.removeItem(k));
    } catch (e) { /* noop */ }
    this.data = this.defaults();
    this.save();
  },
};
const S = () => Store.data.settings;

/* =========================================================
   4. サウンド（Web Audio APIで全部生成）
   ========================================================= */
const AudioSys = (() => {
  let ctx = null, master = null, bgmBus = null, seBus = null, noiseBuf = null, bgmLpf = null, waterOn = false;
  const pulse = {};
  let engine = null;
  let muted = false;

  function init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume().catch(() => {}); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try { ctx = new AC(); } catch (e) { ctx = null; return; }
    master = ctx.createGain(); master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.2;
    comp.connect(master); master.connect(ctx.destination);
    // BGM → ローパス（水中でこもる音） → コンプ
    bgmLpf = ctx.createBiquadFilter(); bgmLpf.type = 'lowpass'; bgmLpf.frequency.value = 20000; bgmLpf.Q.value = 0.7;
    bgmLpf.connect(comp);
    bgmBus = ctx.createGain(); bgmBus.connect(bgmLpf);
    seBus = ctx.createGain(); seBus.connect(comp);
    const len = ctx.sampleRate * 2;
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const nd = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) nd[i] = Math.random() * 2 - 1;
    [0.125, 0.25, 0.5].forEach((d) => { pulse[d] = makePulse(d); });
    applyVolumes();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    Music._ready();
  }
  function makePulse(d) {
    const n = 48;
    const re = new Float32Array(n), im = new Float32Array(n);
    for (let i = 1; i < n; i++) re[i] = (2 / (i * Math.PI)) * Math.sin(i * Math.PI * d);
    return ctx.createPeriodicWave(re, im);
  }
  function applyVolumes() {
    if (!ctx) return;
    const st = S();
    bgmBus.gain.value = muted ? 0 : st.bgm * 0.5;
    seBus.gain.value = muted ? 0 : st.se * 0.75;
  }
  function setMuted(m) { muted = m; applyVolumes(); }
  function setWater(on) {
    if (!ctx || on === waterOn) return;
    waterOn = on;
    bgmLpf.frequency.setTargetAtTime(on ? 650 : 20000, ctx.currentTime, on ? 0.08 : 0.25);
  }
  const now = () => (ctx ? ctx.currentTime : 0);

  function osc(type, freq, t, dur, vol, dest, slideTo) {
    if (!ctx || dur <= 0) return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    if (type === 'p12') o.setPeriodicWave(pulse[0.125]);
    else if (type === 'p25') o.setPeriodicWave(pulse[0.25]);
    else if (type === 'p50') o.setPeriodicWave(pulse[0.5]);
    else o.type = type;
    o.frequency.setValueAtTime(Math.max(20, freq), t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    const a = Math.min(0.006, dur * 0.2);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + a);
    g.gain.setValueAtTime(vol, t + Math.max(a, dur - Math.min(0.04, dur * 0.4)));
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest || seBus);
    o.start(t); o.stop(t + dur + 0.03);
  }
  function noise(t, dur, vol, ftype, freq, dest, freqTo, q) {
    if (!ctx || dur <= 0) return;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = ftype || 'bandpass';
    f.frequency.setValueAtTime(freq || 2000, t);
    if (freqTo) f.frequency.exponentialRampToValueAtTime(Math.max(30, freqTo), t + dur);
    f.Q.value = q || 1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    src.connect(f); f.connect(g); g.connect(dest || seBus);
    src.start(t, Math.random() * 1.5, dur + 0.05);
  }
  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
  function seq(notes, type, vol, stepT, startDelay) {
    if (!ctx) return;
    let t = now() + (startDelay || 0);
    notes.forEach((n) => {
      if (n != null) osc(type, mtof(n), t, stepT * 0.95, vol);
      t += stepT;
    });
  }

  function sfx(name, opt) {
    if (!ctx || muted) return;
    const t = now();
    switch (name) {
      case 'cursor': osc('p25', 880, t, 0.05, 0.12); break;
      case 'select': osc('p25', 660, t, 0.06, 0.14); osc('p25', 990, t + 0.06, 0.09, 0.14); break;
      case 'back': osc('p25', 520, t, 0.06, 0.12); osc('p25', 350, t + 0.06, 0.08, 0.12); break;
      case 'deny': osc('p50', 160, t, 0.18, 0.14); break;
      case 'count': osc('p50', 440, t, 0.22, 0.18); break;
      case 'go': osc('p50', 880, t, 0.55, 0.18); osc('p25', 1320, t, 0.55, 0.06); break;
      case 'tick': osc('p12', 1250 + Math.random() * 300, t, 0.025, 0.06); break;
      case 'itemget': seq([76, 81, 88], 'p25', 0.12, 0.05); break;
      case 'boost': noise(t, 0.5, 0.35, 'bandpass', 400, null, 2600, 1.2); osc('sawtooth', 180, t, 0.4, 0.07, null, 520); break;
      case 'mini': {
        const lv = (opt && opt.lv) || 1;
        noise(t, 0.25 + lv * 0.1, 0.25, 'bandpass', 600, null, 3000, 1.5); osc('p25', 500 + lv * 150, t, 0.2, 0.07, null, 1400); break;
      }
      case 'spark': osc('p12', 1400 + ((opt && opt.lv) || 1) * 350, t, 0.08, 0.08, null, 2600); break;
      case 'hop': osc('p25', 330, t, 0.08, 0.07, null, 620); break;
      case 'jump': osc('p25', 300, t, 0.2, 0.1, null, 900); noise(t, 0.2, 0.12, 'highpass', 3000); break;
      case 'land': noise(t, 0.12, 0.2, 'lowpass', 500); break;
      case 'trick': seq([79, 84, 91], 'p25', 0.1, 0.05); break;
      case 'hit': osc('sawtooth', 520, t, 0.55, 0.14, null, 60); noise(t, 0.35, 0.3, 'bandpass', 1200, null, 200, 0.8); break;
      case 'bump': osc('triangle', 150, t, 0.12, 0.28, null, 60); noise(t, 0.1, 0.22, 'lowpass', 700); break;
      case 'kartbump': osc('triangle', 220, t, 0.09, 0.2, null, 110); noise(t, 0.07, 0.15, 'bandpass', 1500); break;
      case 'lap': seq([79, 83, 86, 91], 'p25', 0.12, 0.07); break;
      case 'final': seq([72, 76, 79, 84, null, 84, 88, 91], 'p25', 0.12, 0.09); seq([60, 64, 67, 72, null, 72, 76, 79], 'triangle', 0.18, 0.09); break;
      case 'goal': seq([72, 76, 79, 84, 79, 84, 88, 91, 96], 'p25', 0.13, 0.1); seq([48, 52, 55, 60, 55, 60, 64, 67, 72], 'triangle', 0.2, 0.1); break;
      case 'goalbad': seq([67, 64, 60, 62, 59, 55], 'p50', 0.12, 0.13); break;
      case 'fall': osc('triangle', 900, t, 0.9, 0.16, null, 90); break;
      case 'splash': noise(t, 0.5, 0.35, 'lowpass', 1800, null, 300); break;
      case 'bullet': osc('p25', 1500, t, 0.22, 0.12, null, 380); break;
      case 'drone': osc('p12', 500, t, 0.3, 0.1, null, 1100); break;
      case 'oil': noise(t, 0.25, 0.25, 'lowpass', 600); osc('triangle', 260, t, 0.2, 0.12, null, 90); break;
      case 'shield': seq([72, 79, 84, 91], 'triangle', 0.18, 0.05); break;
      case 'emp': osc('sawtooth', 80, t, 0.7, 0.14, null, 40); noise(t, 0.7, 0.3, 'bandpass', 3500, null, 400, 2); seq([96, 91, 96, 91], 'p12', 0.06, 0.05); break;
      case 'nitro': noise(t, 0.6, 0.35, 'bandpass', 300, null, 3200, 1.1); osc('sawtooth', 150, t, 0.5, 0.08, null, 700); break;
      case 'explode': noise(t, 0.6, 0.45, 'lowpass', 2400, null, 80); osc('square', 120, t, 0.3, 0.12, null, 40); break;
      case 'wrong': osc('p50', 220, t, 0.2, 0.12); osc('p50', 185, t + 0.22, 0.25, 0.12); break;
      case 'record': seq([84, 88, 91, 96, 91, 96, 100], 'p25', 0.13, 0.08); break;
      case 'rocket': noise(t, 0.8, 0.4, 'bandpass', 250, null, 3500, 1.2); seq([72, 79, 84], 'p25', 0.1, 0.06); break;
      case 'stall': noise(t, 0.4, 0.25, 'lowpass', 400); osc('sawtooth', 90, t, 0.4, 0.1, null, 50); break;
      case 'intro': seq([60, 64, 67, 72, 67, 72, 76, 79], 'p25', 0.1, 0.11); seq([48, null, 55, null, 52, null, 55, null], 'triangle', 0.18, 0.11); break;
      case 'unlock': seq([72, 76, 79, 84, 88, 91, 96], 'p25', 0.12, 0.07); break;
      case 'dive': noise(t, 0.6, 0.35, 'lowpass', 2200, null, 250); osc('sine', 500, t, 0.5, 0.12, null, 120); break;
      case 'surface': noise(t, 0.35, 0.3, 'highpass', 1500, null, 5000); osc('sine', 300, t, 0.25, 0.1, null, 900); break;
      case 'bubble': osc('sine', 700 + Math.random() * 500, t, 0.07, 0.05, null, 1600); break;
      case 'bumper': osc('p25', 880, t, 0.08, 0.16, null, 1760); osc('triangle', 220, t, 0.18, 0.2, null, 110); seq([96, 100], 'p12', 0.07, 0.04, 0.05); break;
      case 'glide': noise(t, 0.9, 0.22, 'bandpass', 500, null, 1800, 0.8); seq([72, 79, 84, 88], 'p25', 0.1, 0.06); break;
      case 'ring': seq([88, 93, 100], 'p25', 0.12, 0.045); osc('triangle', 1760, t, 0.2, 0.06); break;
      case 'gust': noise(t, 1.0, 0.18, 'bandpass', 400, null, 900, 0.6); break;
      case 'robot': osc('square', 180, t, 0.1, 0.06, null, 90); break;
      case 'cannon': noise(t, 0.9, 0.7, 'lowpass', 900, null, 120); osc('sine', 110, t, 0.6, 0.5, null, 35); osc('square', 220, t, 0.12, 0.12, null, 60); break;
      case 'shortcut': seq([79, 84, 88, 91, 96], 'p25', 0.1, 0.05); break;
      default: break;
    }
  }

  /* --- エンジン音・スキール音 --- */
  function engineStart() {
    if (!ctx || engine) return;
    const o1 = ctx.createOscillator(); o1.type = 'sawtooth';
    const o2 = ctx.createOscillator(); o2.setPeriodicWave(pulse[0.25]);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 700; f.Q.value = 2;
    const g = ctx.createGain(); g.gain.value = 0;
    o1.frequency.value = 60; o2.frequency.value = 30;
    o1.connect(f); o2.connect(f); f.connect(g); g.connect(seBus);
    const ns = ctx.createBufferSource(); ns.buffer = noiseBuf; ns.loop = true;
    const nf = ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 2600; nf.Q.value = 3;
    const ng = ctx.createGain(); ng.gain.value = 0;
    ns.connect(nf); nf.connect(ng); ng.connect(seBus);
    o1.start(); o2.start(); ns.start();
    engine = { o1, o2, f, g, ns, nf, ng };
  }
  function engineUpdate(ratio, throttle, boosting, drifting, lv) {
    if (!engine) return;
    const t = ctx.currentTime;
    const fr = 48 + ratio * 150 + (boosting ? 45 : 0);
    engine.o1.frequency.setTargetAtTime(fr, t, 0.06);
    engine.o2.frequency.setTargetAtTime(fr * 0.5 + 2, t, 0.06);
    engine.f.frequency.setTargetAtTime(420 + ratio * 1500 + (boosting ? 600 : 0), t, 0.08);
    engine.g.gain.setTargetAtTime(muted ? 0 : 0.045 + throttle * 0.05, t, 0.08);
    engine.ng.gain.setTargetAtTime(muted || !drifting ? 0 : 0.05 + lv * 0.015, t, 0.05);
    engine.nf.frequency.setTargetAtTime(2200 + lv * 600, t, 0.05);
  }
  function engineSilence() {
    if (!engine) return;
    const t = ctx.currentTime;
    engine.g.gain.setTargetAtTime(0, t, 0.05);
    engine.ng.gain.setTargetAtTime(0, t, 0.05);
  }
  function engineStop() {
    if (!engine) return;
    const e = engine; engine = null;
    try {
      const t = ctx.currentTime;
      e.g.gain.setTargetAtTime(0, t, 0.05); e.ng.gain.setTargetAtTime(0, t, 0.05);
      e.o1.stop(t + 0.3); e.o2.stop(t + 0.3); e.ns.stop(t + 0.3);
    } catch (err) { /* noop */ }
  }

  return {
    init, sfx, osc, noise, mtof, applyVolumes, setMuted, setWater, engineStart, engineUpdate, engineStop, engineSilence,
    get ctx() { return ctx; }, get bgmBus() { return bgmBus; }, get ready() { return !!ctx; },
  };
})();

/* --- BGM（チップチューン自動作曲シーケンサー） --- */
const SONGS = {
  title: { bpm: 132, root: 60, mode: 'major', prog: [0, 4, 5, 3, 0, 4, 3, 4, 5, 3, 0, 4, 5, 3, 4, 4], lead: 'p25', drum: 'rock', bass: 'octave', arp: 'up', seed: 1101 },
  sunrise: { bpm: 152, root: 62, mode: 'major', prog: [0, 3, 4, 3, 0, 5, 1, 4, 3, 4, 2, 5, 3, 4, 0, 4], lead: 'p25', drum: 'rock', bass: 'octave', arp: 'up', seed: 2207 },
  beach: { bpm: 140, root: 65, mode: 'major', prog: [0, 5, 1, 4, 0, 5, 1, 4, 3, 2, 1, 4, 3, 4, 0, 0], lead: 'p50', drum: 'four', bass: 'walk', arp: 'updown', seed: 3301 },
  snow: { bpm: 136, root: 64, mode: 'minor', prog: [0, 5, 2, 6, 0, 5, 3, 4, 5, 6, 2, 0, 3, 6, 4, 4], lead: 'p12', drum: 'half', bass: 'pulse', arp: 'up', seed: 4409 },
  lava: { bpm: 162, root: 62, mode: 'minor', prog: [0, 0, 5, 4, 0, 3, 4, 4, 5, 6, 0, 0, 3, 4, 5, 4], lead: 'p25', drum: 'rock', bass: 'drive', arp: 'down', seed: 5503 },
  result: { bpm: 116, root: 60, mode: 'major', prog: [0, 3, 4, 0, 5, 3, 1, 4], lead: 'p50', drum: 'four', bass: 'walk', arp: 'up', seed: 6607 },
  reef: { bpm: 128, root: 67, mode: 'major', prog: [0, 5, 3, 4, 0, 5, 1, 4, 3, 4, 5, 2, 3, 1, 4, 4], lead: 'p50', drum: 'four', bass: 'walk', arp: 'updown', seed: 7711 },
  sky: { bpm: 146, root: 64, mode: 'major', prog: [0, 4, 5, 3, 0, 4, 3, 4, 3, 4, 5, 5, 3, 4, 0, 0], lead: 'p25', drum: 'rock', bass: 'octave', arp: 'up', seed: 8819 },
  neon: { bpm: 158, root: 57, mode: 'minor', prog: [0, 5, 6, 4, 0, 5, 6, 4, 3, 4, 0, 5, 3, 6, 4, 4], lead: 'p12', drum: 'rock', bass: 'drive', arp: 'up', seed: 9923 },
  fort: { bpm: 154, root: 57, mode: 'minor', prog: [0, 6, 5, 4, 0, 6, 3, 4, 5, 6, 0, 4, 5, 3, 6, 4], lead: 'p12', drum: 'rock', bass: 'drive', arp: 'updown', seed: 12329 },
  dragon: { bpm: 148, root: 62, mode: 'major', prog: [0, 4, 5, 3, 0, 4, 1, 4, 3, 4, 5, 2, 3, 6, 4, 4], lead: 'p25', drum: 'rock', bass: 'octave', arp: 'updown', seed: 11213 },
  galaxy: { bpm: 150, root: 62, mode: 'minor', prog: [0, 3, 5, 4, 0, 3, 6, 4, 5, 6, 3, 4, 5, 6, 0, 4], lead: 'p25', drum: 'half', bass: 'octave', arp: 'updown', seed: 10037 },
};
const songCache = {};
function genSong(sp) {
  const rnd = mulberry32(sp.seed);
  const SC = sp.mode === 'major' ? [0, 2, 4, 5, 7, 9, 11] : [0, 2, 3, 5, 7, 8, 10];
  const bars = sp.prog.length, len = bars * 16;
  const lead = new Array(len).fill(null), bass = new Array(len).fill(null), arp = new Array(len).fill(0), drum = new Uint8Array(len);
  const dm = (d, base) => base + 12 * Math.floor(d / 7) + SC[((d % 7) + 7) % 7];
  const RH = [
    [[0, 2], [2, 2], [4, 4], [8, 2], [10, 2], [12, 4]],
    [[0, 3], [3, 3], [6, 2], [8, 4], [12, 2], [14, 2]],
    [[0, 4], [4, 2], [6, 2], [8, 2], [10, 2], [12, 4]],
    [[0, 2], [2, 1], [3, 1], [4, 2], [6, 2], [8, 6], [14, 2]],
    [[2, 2], [4, 2], [6, 2], [8, 2], [10, 2], [12, 2], [14, 2]],
    [[0, 3], [3, 3], [6, 3], [9, 3], [12, 4]],
    [[0, 1], [1, 1], [2, 2], [4, 1], [5, 1], [6, 2], [8, 4], [12, 4]],
    [[0, 6], [6, 2], [8, 6], [14, 2]],
  ];
  const CAD = [[[0, 4], [4, 4], [8, 8]], [[0, 2], [2, 2], [4, 12]], [[0, 8], [8, 8]]];
  const form = bars >= 16 ? ['A', 'B', 'A', 'C', 'A', 'B', 'D', 'Z', 'E', 'E', 'F', 'G', 'E', 'E', 'H', 'Y'] : ['A', 'B', 'A', 'Z', 'A', 'B', 'C', 'Y'];
  const rhythmOf = {}, motifOf = {};
  let cur = 9;
  for (let b = 0; b < bars; b++) {
    const lab = form[b % form.length];
    const chord = sp.prog[b];
    const cadence = lab === 'Z' || lab === 'Y';
    let rh = rhythmOf[lab];
    if (!rh) { rh = cadence ? CAD[Math.floor(rnd() * CAD.length)] : RH[Math.floor(rnd() * RH.length)]; rhythmOf[lab] = rh; }
    const second = bars >= 16 && b >= 8;
    const lo = second ? 8 : 6, hi = second ? 16 : 14;
    const nearestCT = (target) => {
      let best = clamp(Math.round(target), lo, hi), bd = 99;
      for (let o = -2; o <= 3; o++) {
        for (const tt of [0, 2, 4]) {
          const d = chord + tt + 7 * o;
          if (d < lo || d > hi) continue;
          const dd = Math.abs(d - target) + (tt === 0 ? -0.25 : 0);
          if (dd < bd) { bd = dd; best = d; }
        }
      }
      return best;
    };
    const motif = motifOf[lab];
    const deltas = [];
    rh.forEach(([st, ln], i) => {
      let n;
      const strong = st % 4 === 0;
      if (i === 0) n = nearestCT(cur + (motif ? 0 : Math.round(rnd() * 4 - 2)));
      else if (motif && i < motif.length && rnd() < 0.85) { n = cur + motif[i]; if (strong) n = nearestCT(n); }
      else if (strong) n = nearestCT(cur + [-2, -1, 1, 2][Math.floor(rnd() * 4)]);
      else n = cur + [-1, 1, -1, 1, 2, -2][Math.floor(rnd() * 6)];
      n = clamp(n, lo, hi);
      if (cadence && i === rh.length - 1) n = nearestCT(lab === 'Y' ? (second ? 14 : 7) : cur);
      deltas.push(n - cur);
      cur = n;
      lead[b * 16 + st] = { m: dm(n, sp.root + 12), d: ln };
    });
    if (!motif) motifOf[lab] = deltas;
    // ベース
    const r = dm(chord, sp.root - 24);
    const put = (st, m, d) => { bass[b * 16 + st] = { m, d }; };
    if (sp.bass === 'octave') for (let s = 0; s < 16; s += 2) put(s, (s / 2) % 2 ? r + 12 : r, 2);
    else if (sp.bass === 'drive') for (let s = 0; s < 16; s += 2) put(s, s >= 12 ? dm(chord + 4, sp.root - 24) : r, 2);
    else if (sp.bass === 'walk') [0, 4, 8, 12].forEach((s, k) => put(s, dm(chord + [0, 2, 4, 5][k], sp.root - 24), 4));
    else [0, 3, 6, 8, 11, 14].forEach((s, k) => put(s, k === 3 ? r + 12 : r, 2));
    // アルペジオ
    const ap = sp.arp === 'down' ? [7, 4, 2, 0] : sp.arp === 'updown' ? [0, 2, 4, 7, 4, 2] : [0, 2, 4, 7];
    for (let s = 0; s < 16; s++) arp[b * 16 + s] = dm(chord + ap[s % ap.length], sp.root);
    // ドラム (1:キック 2:スネア 4:ハット 8:クラッシュ)
    for (let s = 0; s < 16; s++) {
      let v = 0;
      if (sp.drum === 'rock') { if (s === 0 || s === 8 || s === 10) v |= 1; if (s === 4 || s === 12) v |= 2; if (s % 2 === 0) v |= 4; }
      else if (sp.drum === 'four') { if (s % 4 === 0) v |= 1; if (s === 4 || s === 12) v |= 2; if (s % 4 === 2) v |= 4; }
      else { if (s === 0 || s === 10) v |= 1; if (s === 8) v |= 2; if (s % 2 === 0) v |= 4; }
      if (b % 8 === 7 && s >= 12) v |= 2;
      if ((b === 0 || b === 8) && s === 0) v |= 8;
      drum[b * 16 + s] = v;
    }
  }
  return { bpm: sp.bpm, len, lead, bass, arp, drum, wave: sp.lead };
}
function getSong(name) {
  if (!songCache[name]) songCache[name] = genSong(SONGS[name] || SONGS.title);
  return songCache[name];
}

const Music = {
  name: null, song: null, step: 0, nextT: 0, timer: null, tempo: 1, paused: false,
  _ready() { if (this.name && !this.timer) this._start(); },
  play(name) {
    if (this.name === name && this.timer) { this.setTempo(1); return; }
    this.stop();
    this.name = name;
    this.tempo = 1;
    if (AudioSys.ready) this._start();
  },
  _start() {
    const ctx = AudioSys.ctx;
    this.song = getSong(this.name);
    this.step = 0;
    this.nextT = ctx.currentTime + 0.1;
    this.paused = false;
    clearInterval(this.timer);
    this.timer = setInterval(() => this.tick(), 25);
  },
  stop() { clearInterval(this.timer); this.timer = null; this.name = null; this.song = null; },
  pause(p) {
    this.paused = p;
    if (!p && AudioSys.ready) this.nextT = AudioSys.ctx.currentTime + 0.05;
  },
  setTempo(m) { this.tempo = m; },
  tick() {
    const ctx = AudioSys.ctx;
    if (!ctx || !this.song || this.paused) return;
    const sd = 60 / (this.song.bpm * this.tempo) / 4;
    if (this.nextT < ctx.currentTime - 0.2) this.nextT = ctx.currentTime + 0.05;
    while (this.nextT < ctx.currentTime + 0.15) {
      this.sched(this.step % this.song.len, this.nextT, sd);
      this.nextT += sd;
      this.step++;
    }
  },
  sched(i, t, sd) {
    const s = this.song, bus = AudioSys.bgmBus, o = AudioSys.osc, mt = AudioSys.mtof;
    const L = s.lead[i];
    if (L) {
      o(s.wave, mt(L.m), t, L.d * sd * 0.9, 0.085, bus);
      o(s.wave, mt(L.m), t + sd * 3, L.d * sd * 0.7, 0.022, bus);
    }
    const B = s.bass[i];
    if (B) o('triangle', mt(B.m), t, B.d * sd * 0.92, 0.21, bus);
    if (s.arp[i]) o('p12', mt(s.arp[i]), t, sd * 0.7, 0.028, bus);
    const D = s.drum[i];
    if (D & 1) o('sine', 150, t, 0.13, 0.42, bus, 42);
    if (D & 2) { AudioSys.noise(t, 0.13, 0.2, 'bandpass', 1900, bus); o('triangle', 190, t, 0.05, 0.1, bus); }
    if (D & 4) AudioSys.noise(t, 0.035, 0.06, 'highpass', 7500, bus);
    if (D & 8) AudioSys.noise(t, 0.7, 0.1, 'highpass', 5000, bus);
  },
};

/* =========================================================
   5. 入力（キーボード / タッチ / ゲームパッド / ジャイロ）
   ========================================================= */
const KEYS = {
  left: ['ArrowLeft', 'KeyA'], right: ['ArrowRight', 'KeyD'],
  accel: ['ArrowUp', 'KeyW'], brake: ['ArrowDown', 'KeyS'],
  drift: ['ShiftLeft', 'ShiftRight', 'KeyC', 'KeyK'], item: ['Space', 'KeyE', 'KeyJ'],
};
const GAME_CODES = new Set([].concat(...Object.values(KEYS)));
const Input = {
  keys: new Set(),
  kbSteer: 0,
  touch: { steer: 0, accel: false, brake: false, drift: false, item: false },
  pad: { connected: false, steer: 0, accel: false, brake: false, drift: false, item: false, nav: { up: false, down: false, left: false, right: false, a: false, b: false, start: false } },
  padPrev: { up: false, down: false, left: false, right: false, a: false, b: false, start: false },
  gyro: { steer: 0, active: false, bound: false },
  motion: { bound: false, last: null, pulseAt: -1e9 },
  state: { steer: 0, accel: false, accelManual: false, brake: false, drift: false, item: false, auto: false, shake: false },
  usedTouch: isTouchDevice,

  has(list) { for (let i = 0; i < list.length; i++) if (this.keys.has(list[i])) return true; return false; },

  init() {
    window.addEventListener('keydown', (e) => {
      AudioSys.init();
      if (Game.state === 'race' && !Game.paused && GAME_CODES.has(e.code)) e.preventDefault();
      if (e.repeat && GAME_CODES.has(e.code)) return;
      this.keys.add(e.code);
      if (e.code === 'Escape' || e.code === 'KeyP') {
        if (Game.state === 'race') { e.preventDefault(); Game.togglePause(); return; }
      }
      UI.onKey(e);
    });
    window.addEventListener('keyup', (e) => { this.keys.delete(e.code); });
    window.addEventListener('blur', () => { this.keys.clear(); this.resetTouch(); });
    window.addEventListener('pointerdown', (e) => {
      AudioSys.init();
      if (e.pointerType === 'touch') this.setTouchMode(true);
    }, { passive: true });
    this.initTouch();
    if (S().gyro) this.enableGyro();
    if (S().motionJA) this.enableMotion();
  },
  setTouchMode(on) {
    if (this.usedTouch === on) return;
    this.usedTouch = on;
    Game.refreshTouchUI();
  },
  resetTouch() {
    const t = this.touch;
    t.steer = 0; t.accel = t.brake = t.drift = t.item = false;
    $$('.tc-btn').forEach((b) => b.classList.remove('on'));
  },
  initTouch() {
    const zone = $('#tc-stick');
    if (!zone) return;
    const base = zone.querySelector('.tc-base'), knob = zone.querySelector('.tc-knob');
    let pid = null, ox = 0;
    const reset = () => {
      pid = null; this.touch.steer = 0; zone.classList.remove('on');
      knob.style.transform = 'translate(-50%,-50%)';
    };
    zone.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (pid !== null) return;
      pid = e.pointerId;
      try { zone.setPointerCapture(pid); } catch (err) { /* noop */ }
      const r = zone.getBoundingClientRect();
      ox = e.clientX;
      base.style.left = (e.clientX - r.left) + 'px';
      base.style.top = (e.clientY - r.top) + 'px';
      zone.classList.add('on');
      this.touch.steer = 0;
      knob.style.transform = 'translate(-50%,-50%)';
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== pid) return;
      const max = 46;
      const dx = clamp(e.clientX - ox, -max, max);
      let v = dx / max;
      if (Math.abs(v) < 0.1) v = 0;
      this.touch.steer = v;
      knob.style.transform = `translate(calc(-50% + ${dx}px), -50%)`;
    });
    const up = (e) => { if (e.pointerId === pid) reset(); };
    zone.addEventListener('pointerup', up);
    zone.addEventListener('pointercancel', up);
    zone.addEventListener('lostpointercapture', up);
    $$('.tc-btn').forEach((b) => {
      const k = b.dataset.k;
      const on = (e) => {
        e.preventDefault();
        try { b.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
        this.touch[k] = true; b.classList.add('on');
      };
      const off = () => { this.touch[k] = false; b.classList.remove('on'); };
      b.addEventListener('pointerdown', on);
      b.addEventListener('pointerup', off);
      b.addEventListener('pointercancel', off);
      b.addEventListener('lostpointercapture', off);
      b.addEventListener('contextmenu', (e) => e.preventDefault());
    });
  },
  async enableGyro() {
    try {
      if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        const r = await DeviceOrientationEvent.requestPermission();
        if (r !== 'granted') return false;
      }
    } catch (e) { return false; }
    if (typeof window.DeviceOrientationEvent === 'undefined') return false;
    if (!this.gyro.bound) {
      window.addEventListener('deviceorientation', (e) => this.onOrient(e));
      this.gyro.bound = true;
    }
    return true;
  },
  // スマホを振ってジャンプアクション（devicemotion）
  async enableMotion() {
    try {
      if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
        const r = await DeviceMotionEvent.requestPermission();
        if (r !== 'granted') return false;
      }
    } catch (e) { return false; }
    if (typeof window.DeviceMotionEvent === 'undefined') return false;
    if (!this.motion.bound) {
      window.addEventListener('devicemotion', (e) => this.onMotion(e));
      this.motion.bound = true;
    }
    return true;
  },
  onMotion(e) {
    const M = this.motion, now = performance.now();
    let hit = false;
    const a = e.acceleration;
    if (a && a.x != null) {
      hit = Math.hypot(a.x, a.y, a.z || 0) > 13;
    } else {
      const g = e.accelerationIncludingGravity;
      if (!g || g.x == null) return;
      const v = [g.x, g.y, g.z || 0];
      if (M.last) hit = Math.hypot(v[0] - M.last[0], v[1] - M.last[1], v[2] - M.last[2]) > 17;
      M.last = v;
    }
    if (hit && now - M.pulseAt > 380) M.pulseAt = now;
  },
  onOrient(e) {
    if (e.beta == null || e.gamma == null) return;
    let ang = 0;
    if (screen.orientation && typeof screen.orientation.angle === 'number') ang = screen.orientation.angle;
    else if (typeof window.orientation === 'number') ang = window.orientation;
    let tilt;
    if (ang === 90) tilt = e.beta;
    else if (ang === -90 || ang === 270) tilt = -e.beta;
    else if (ang === 180) tilt = -e.gamma;
    else tilt = e.gamma;
    const sens = S().gyroSens || 1;
    let v = clamp((tilt * sens) / 24, -1, 1);
    if (Math.abs(v) < 0.06) v = 0;
    this.gyro.steer = v;
    this.gyro.active = true;
  },
  pollPad() {
    const P = this.pad;
    let gp = null;
    try {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      for (let i = 0; i < pads.length; i++) { if (pads[i] && pads[i].connected) { gp = pads[i]; break; } }
    } catch (e) { gp = null; }
    const N = P.nav;
    if (!gp) {
      P.connected = false; P.steer = 0; P.accel = P.brake = P.drift = P.item = false;
      N.up = N.down = N.left = N.right = N.a = N.b = N.start = false;
      return;
    }
    P.connected = true;
    const b = (i) => !!(gp.buttons[i] && gp.buttons[i].pressed);
    const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
    let st = Math.abs(ax) > 0.15 ? (ax - sign(ax) * 0.15) / 0.85 : 0;
    if (b(14)) st = -1;
    if (b(15)) st = 1;
    P.steer = clamp(st, -1, 1);
    P.accel = b(0) || b(7);
    P.brake = b(1) || b(6);
    P.drift = b(5) || b(3);
    P.item = b(4) || b(2);
    N.up = b(12) || ay < -0.6; N.down = b(13) || ay > 0.6;
    N.left = b(14) || ax < -0.6; N.right = b(15) || ax > 0.6;
    N.a = b(0); N.b = b(1); N.start = b(9);
  },
  padEdges() {
    const N = this.pad.nav, pv = this.padPrev, out = {};
    for (const k in N) { out[k] = N[k] && !pv[k]; pv[k] = N[k]; }
    return out;
  },
  update(dt) {
    this.pollPad();
    const e = this.padEdges();
    if (e.start && Game.state === 'race') Game.togglePause();
    else if (Game.state !== 'race' || Game.paused) {
      if (e.up) UI.nav('up'); if (e.down) UI.nav('down'); if (e.left) UI.nav('left'); if (e.right) UI.nav('right');
      if (e.a) UI.activate(); if (e.b) UI.back();
    }
    const target = (this.has(KEYS.right) ? 1 : 0) - (this.has(KEYS.left) ? 1 : 0);
    if (target === 0) this.kbSteer = Math.abs(this.kbSteer) < dt * 14 ? 0 : this.kbSteer - sign(this.kbSteer) * dt * 14;
    else {
      if (sign(this.kbSteer) !== target) this.kbSteer = 0;
      this.kbSteer = clamp(this.kbSteer + target * dt * 11, -1, 1);
    }
    let steer = this.kbSteer;
    const cand = [this.touch.steer, this.pad.steer, (S().gyro && this.gyro.active) ? this.gyro.steer : 0];
    for (let i = 0; i < cand.length; i++) if (Math.abs(cand[i]) > Math.abs(steer)) steer = cand[i];
    const st = this.state;
    st.steer = steer;
    st.brake = this.has(KEYS.brake) || this.touch.brake || this.pad.brake;
    st.accelManual = this.has(KEYS.accel) || this.touch.accel || this.pad.accel;
    st.auto = !!(S().autoAccel && this.usedTouch);
    st.accel = st.accelManual || (st.auto && !st.brake);
    st.drift = this.has(KEYS.drift) || this.touch.drift || this.pad.drift;
    st.item = this.has(KEYS.item) || this.touch.item || this.pad.item;
    st.shake = !!S().motionJA && performance.now() - this.motion.pulseAt < 160;
  },
};

/* =========================================================
   6. ドット絵スプライト生成（ボクセルカート・背景物・アイコン）
   ========================================================= */
function crisp(c) {
  const g = c.getContext('2d');
  const id = g.getImageData(0, 0, c.width, c.height), d = id.data;
  for (let i = 3; i < d.length; i += 4) d[i] = d[i] < 110 ? 0 : 255;
  g.putImageData(id, 0, 0);
  return c;
}
function outline(c, col) {
  col = col || [22, 14, 32];
  const w = c.width, h = c.height, g = c.getContext('2d');
  const id = g.getImageData(0, 0, w, h), d = id.data, src = new Uint8ClampedArray(d);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (src[i + 3] > 0) continue;
      const on = (xx, yy) => xx >= 0 && yy >= 0 && xx < w && yy < h && src[(yy * w + xx) * 4 + 3] > 0;
      if (on(x - 1, y) || on(x + 1, y) || on(x, y - 1) || on(x, y + 1)) {
        d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; d[i + 3] = 255;
      }
    }
  }
  g.putImageData(id, 0, 0);
  return c;
}
// 画素処理用の作業キャンバス（読み出し最適化）→ 完成品は通常キャンバスへコピー
function workCanvas(w, h) {
  const c = makeCanvas(w, h);
  try { c.getContext('2d', { willReadFrequently: true }); } catch (e) { /* noop */ }
  return c;
}
function finalize(c) {
  const out = makeCanvas(c.width, c.height);
  out.getContext('2d').drawImage(c, 0, 0);
  return out;
}
function spr(w, h, draw, noOutline) {
  const c = workCanvas(w, h);
  const g = c.getContext('2d');
  draw(g, w, h);
  crisp(c);
  if (!noOutline) outline(c);
  return finalize(c);
}
function circ(g, x, y, r, col) { g.fillStyle = col; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); }
function poly(g, pts, col) {
  g.fillStyle = col; g.beginPath(); g.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
  g.closePath(); g.fill();
}
function rect(g, x, y, w, h, col) { g.fillStyle = col; g.fillRect(x, y, w, h); }

/* --- ボクセルのカート --- */
function buildKartModel(ch) {
  const V = new Map();
  const K = (x, y, z) => x + ',' + y + ',' + z;
  const set = (x, y, z, c) => V.set(K(x, y, z), { x, y, z, c });
  const box = (x0, x1, y0, y1, z0, z1, c) => {
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) set(x, y, z, c);
  };
  const del = (x, y, z) => V.delete(K(x, y, z));
  const body = ch.body, acc = ch.accent, dark = '#2a2633', metal = '#8a90a2', tire = '#1d1b24', hub = '#c9ccd6';
  // 車体
  box(-6, 5, -3, 3, 1, 1, dark);
  box(-5, 4, -3, -3, 1, 2, body); box(-5, 4, 3, 3, 1, 2, body);
  box(-6, -4, -3, 3, 2, 2, body);
  box(1, 4, -2, 2, 2, 2, body);
  box(5, 6, -2, 2, 1, 1, body);
  box(3, 4, -1, 1, 3, 3, body);
  box(7, 7, -4, 4, 1, 1, acc);
  set(6, 0, 1, acc); set(7, 0, 1, '#ffffff');
  box(-2, 2, -4, -4, 1, 2, acc); box(-2, 2, 4, 4, 1, 2, acc);
  // タイヤ
  box(-6, -4, -6, -5, 0, 2, tire); box(-6, -4, 5, 6, 0, 2, tire);
  box(3, 5, -5, -4, 0, 2, tire); box(3, 5, 4, 5, 0, 2, tire);
  set(-5, -6, 1, hub); set(-5, 6, 1, hub); set(4, -5, 1, hub); set(4, 5, 1, hub);
  // エンジン・ウイング
  box(-7, -7, -2, 2, 2, 3, metal);
  set(-8, -1, 3, '#555a66'); set(-8, 1, 3, '#555a66');
  set(-7, -3, 4, dark); set(-7, 3, 4, dark);
  box(-8, -7, -4, 4, 5, 5, acc);
  // シート・ドライバー
  box(-4, -4, -2, 2, 2, 4, dark);
  box(-3, -1, -2, 2, 3, 4, ch.suit);
  box(-1, 1, -3, -3, 3, 3, ch.suit); box(-1, 1, 3, 3, 3, 3, ch.suit);
  set(2, -2, 3, '#ffffff'); set(2, 2, 3, '#ffffff');
  set(2, -1, 4, '#333033'); set(2, 0, 4, '#333033'); set(2, 1, 4, '#333033');
  box(-3, -1, -2, 2, 5, 7, ch.helmet);
  del(-3, -2, 7); del(-3, 2, 7); del(-1, -2, 7); del(-1, 2, 7);
  [-2, -1, 0, 1, 2].forEach((y) => set(-1, y, 6, ch.visor));
  set(0, -1, 5, ch.helmet); set(0, 0, 5, ch.helmet); set(0, 1, 5, ch.helmet);
  switch (ch.acc) {
    case 'ears': set(-2, -2, 8, ch.helmet); set(-2, -2, 9, ch.helmet); set(-2, 2, 8, ch.helmet); set(-2, 2, 9, ch.helmet); set(-2, -2, 7, ch.helmet); set(-2, 2, 7, ch.helmet); break;
    case 'mohawk': box(-4, -1, 0, 0, 8, 8, acc); set(-3, 0, 9, acc); set(-2, 0, 9, acc); break;
    case 'fin': set(-3, 0, 8, acc); set(-2, 0, 8, acc); set(-3, 0, 9, acc); set(-4, 0, 8, acc); break;
    case 'horns': set(-2, -3, 7, acc); set(-2, -3, 8, acc); set(-2, 3, 7, acc); set(-2, 3, 8, acc); set(-1, -3, 9, acc); set(-1, 3, 9, acc); break;
    case 'antenna': set(-2, 0, 8, '#444444'); set(-2, 0, 9, '#444444'); set(-2, 0, 10, acc); set(-1, 0, 10, acc); break;
    case 'band': [-2, -1, 0, 1, 2].forEach((y) => set(-3, y, 6, acc)); set(-4, -1, 6, acc); set(-4, 1, 5, acc); set(-5, 1, 5, acc); break;
    case 'tail': set(-4, 0, 6, acc); set(-5, 0, 5, acc); set(-5, 0, 4, acc); set(-2, 0, 8, acc); break;
    default: set(-3, 0, 7, acc); set(-2, 0, 7, acc); set(-1, 0, 7, acc); break;
  }
  const list = [];
  V.forEach((v) => {
    const above = V.has(K(v.x, v.y, v.z + 1));
    const f = above ? 0.84 : 1.12;
    list.push({ x: v.x, y: v.y, z: v.z, col: shade(v.c, f) });
  });
  return list;
}
function renderVoxels(vox, theta, size, vs, cx, cy, pitch) {
  const c = workCanvas(size, size);
  const g = c.getContext('2d');
  const ct = Math.cos(theta), st = Math.sin(theta), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const pts = vox.map((v) => {
    const xr = v.x * ct - v.y * st;
    const yr = v.x * st + v.y * ct;
    const z = v.z + 0.5;
    return { sx: cx + yr * vs, sy: cy - (z * cp + xr * sp) * vs, dist: xr * cp - z * sp, col: v.col };
  });
  pts.sort((a, b) => b.dist - a.dist);
  const sz = Math.ceil(vs) + 1;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    g.fillStyle = p.col;
    g.fillRect(Math.round(p.sx - vs / 2), Math.round(p.sy - vs / 2), sz, sz);
  }
  outline(c);
  return finalize(c);
}

/* --- アイテムアイコン（16x16） --- */
function iconCanvas(key) {
  return spr(16, 16, (g) => {
    switch (key) {
      case 'nitro':
      case 'nitro3':
        poly(g, [5, 13, 11, 13, 8, 16], '#ff8a1f');
        poly(g, [6, 13, 10, 13, 8, 15], '#ffe14d');
        rect(g, 5, 3, 6, 10, '#e0383d'); rect(g, 5, 3, 2, 10, '#ff6a6f');
        rect(g, 5, 6, 6, 3, '#ffd23f'); rect(g, 7, 1, 2, 2, '#c9ccd6');
        if (key === 'nitro3') { rect(g, 1, 7, 3, 6, '#e0383d'); rect(g, 12, 7, 3, 6, '#e0383d'); rect(g, 1, 9, 3, 1, '#ffd23f'); rect(g, 12, 9, 3, 1, '#ffd23f'); }
        break;
      case 'oil':
        g.fillStyle = '#241634'; g.beginPath(); g.ellipse(8, 14, 7, 1.8, 0, 0, TAU); g.fill();
        rect(g, 4, 2, 8, 11, '#3d2b63'); rect(g, 4, 2, 2, 11, '#5c4592');
        rect(g, 4, 4, 8, 1, '#8b76c8'); rect(g, 4, 10, 8, 1, '#8b76c8');
        circ(g, 8, 8, 1.8, '#ffd23f'); poly(g, [7, 7, 9, 7, 8, 5], '#ffd23f');
        break;
      case 'bullet':
        rect(g, 0, 7, 4, 1, '#9ff0ff'); rect(g, 1, 10, 3, 1, '#9ff0ff'); rect(g, 1, 4, 3, 1, '#9ff0ff');
        circ(g, 10, 8, 5.2, '#1aa6e0'); circ(g, 10, 8, 3.8, '#38e1ff'); circ(g, 9, 7, 1.8, '#e8ffff');
        break;
      case 'drone':
        rect(g, 1, 3, 5, 2, '#d0d4de'); rect(g, 10, 3, 5, 2, '#d0d4de');
        rect(g, 3, 5, 1, 3, '#555a66'); rect(g, 12, 5, 1, 3, '#555a66');
        rect(g, 3, 7, 10, 6, '#484e5e'); rect(g, 3, 7, 10, 2, '#6b7386');
        circ(g, 8, 10.5, 1.8, '#ff3355'); rect(g, 5, 13, 1, 2, '#555a66'); rect(g, 10, 13, 1, 2, '#555a66');
        break;
      case 'shield':
        poly(g, [8, 1, 14, 3, 14, 8, 8, 15, 2, 8, 2, 3], '#2f7de0');
        poly(g, [8, 3, 12, 4.5, 12, 8, 8, 13, 4, 8, 4, 4.5], '#7fd0ff');
        poly(g, [8, 5, 9, 7.5, 11, 7.5, 9.4, 9, 10, 11.5, 8, 10, 6, 11.5, 6.6, 9, 5, 7.5, 7, 7.5], '#ffffff');
        break;
      case 'emp':
        circ(g, 8, 8, 7, '#5a2da8'); circ(g, 8, 8, 5.5, '#8a4dff');
        poly(g, [9, 2, 4, 9, 7.5, 9, 6, 14, 12, 6, 8.5, 6, 10, 2], '#ffe14d');
        break;
      default: break;
    }
  });
}

/* --- 背景オブジェクト --- */
function buildDecoSprites() {
  const R = mulberry32(777);
  const dots = (g, w, h, cols, n, test) => {
    for (let i = 0; i < n; i++) {
      const x = Math.floor(R() * w), y = Math.floor(R() * h);
      if (test && !test(x, y)) continue;
      rect(g, x, y, 1, 1, cols[Math.floor(R() * cols.length)]);
    }
  };
  const D = {};
  const add = (name, h, frames, opt) => { D[name] = Object.assign({ h, frames: Array.isArray(frames) ? frames : [frames] }, opt || {}); };

  add('tree', 24, spr(22, 28, (g) => {
    rect(g, 9, 17, 4, 11, '#7a4a26'); rect(g, 9, 17, 1, 11, '#5a3219');
    circ(g, 11, 11, 10, '#2b7331'); circ(g, 10, 9.5, 8, '#3e963c'); circ(g, 8, 7, 4.5, '#5cbf4a');
    dots(g, 22, 20, ['#1f5c26', '#76d15e'], 45, (x, y) => (x - 11) ** 2 + (y - 11) ** 2 < 81);
  }));
  add('tree2', 30, spr(14, 32, (g) => {
    rect(g, 6, 24, 2, 8, '#7a4a26');
    g.fillStyle = '#2f7d32'; g.beginPath(); g.ellipse(7, 13, 6, 12, 0, 0, TAU); g.fill();
    g.fillStyle = '#48a843'; g.beginPath(); g.ellipse(6, 11, 4, 9, 0, 0, TAU); g.fill();
    dots(g, 14, 26, ['#1f5c26', '#7dd865'], 25, (x, y) => ((x - 7) / 6) ** 2 + ((y - 13) / 12) ** 2 < 0.8);
  }));
  add('bush', 7, spr(18, 11, (g) => {
    circ(g, 5, 7, 4.5, '#2f7d32'); circ(g, 12, 7, 5, '#2f7d32'); circ(g, 9, 5, 4.5, '#43a040'); circ(g, 7, 4, 2, '#6fcf57');
    rect(g, 3, 9, 1, 1, '#ff6fa8'); rect(g, 12, 5, 1, 1, '#fff27a'); rect(g, 8, 8, 1, 1, '#ff6fa8');
  }));
  add('flag', 24, spr(16, 30, (g) => {
    rect(g, 2, 2, 2, 28, '#c9ccd6'); rect(g, 2, 2, 1, 28, '#ffffff');
    for (let y = 0; y < 4; y++) for (let x = 0; x < 5; x++) rect(g, 4 + x * 2, 3 + y * 2, 2, 2, (x + y) % 2 ? '#1d1b24' : '#ffffff');
  }));
  add('tire', 6, spr(12, 12, (g) => {
    rect(g, 1, 6, 10, 5, '#1d1b24'); rect(g, 1, 1, 10, 5, '#26232e');
    rect(g, 1, 3, 10, 1, '#e0383d'); rect(g, 1, 8, 10, 1, '#f4f4f4');
    rect(g, 3, 1, 6, 1, '#3a3644');
  }));
  add('cone', 4.5, spr(8, 10, (g) => {
    poly(g, [4, 0, 7, 8, 1, 8], '#ff7a1f'); rect(g, 2, 4, 4, 1, '#ffffff'); rect(g, 0, 8, 8, 2, '#ff7a1f');
  }));
  add('palm', 38, spr(30, 40, (g) => {
    for (let y = 12; y < 40; y++) {
      const x = 14 + Math.sin((y - 12) / 9) * 3;
      rect(g, Math.round(x), y, 3, 1, (y % 3 === 0) ? '#8a5a2b' : '#a8743c');
    }
    g.lineCap = 'round';
    const frond = (ang, col, len) => {
      g.strokeStyle = col; g.lineWidth = 3; g.beginPath(); g.moveTo(15, 11);
      g.quadraticCurveTo(15 + Math.cos(ang) * len * 0.6, 8 + Math.sin(ang) * len * 0.3 - 6, 15 + Math.cos(ang) * len, 11 + Math.sin(ang) * len * 0.5 + 5);
      g.stroke();
    };
    [[-2.7, '#2e8a3a', 14], [-0.4, '#2e8a3a', 14], [-2.1, '#46b04a', 12], [-1.0, '#46b04a', 12], [-1.57, '#5fcb56', 9], [3.0, '#2e8a3a', 13], [0.1, '#2e8a3a', 13]].forEach((f) => frond(f[0], f[1], f[2]));
    circ(g, 13, 13, 1.8, '#6b3f1c'); circ(g, 17, 13, 1.8, '#6b3f1c');
  }));
  add('umbrella', 15, spr(22, 22, (g) => {
    rect(g, 10, 8, 2, 14, '#e8e8e8');
    g.fillStyle = '#e0383d'; g.beginPath(); g.arc(11, 10, 10, Math.PI, 0); g.fill();
    g.fillStyle = '#ffffff';
    for (let i = 0; i < 5; i += 2) { g.beginPath(); g.moveTo(11, 10); g.arc(11, 10, 10, Math.PI + i * Math.PI / 5, Math.PI + (i + 1) * Math.PI / 5); g.fill(); }
  }));
  add('rock', 7, spr(16, 11, (g) => {
    poly(g, [1, 10, 3, 4, 7, 1, 12, 2, 15, 7, 15, 10], '#8a8594'); poly(g, [3, 5, 7, 2, 10, 3, 7, 6], '#b6b1c0');
    rect(g, 9, 7, 4, 2, '#6d6878');
  }));
  add('crab', 3, spr(10, 7, (g) => {
    g.fillStyle = '#e0383d'; g.beginPath(); g.ellipse(5, 4, 3.5, 2.2, 0, 0, TAU); g.fill();
    rect(g, 0, 1, 2, 2, '#e0383d'); rect(g, 8, 1, 2, 2, '#e0383d'); rect(g, 3, 2, 1, 1, '#ffffff'); rect(g, 6, 2, 1, 1, '#ffffff');
  }));
  add('buoy', 5, [0, 1].map((f) => spr(8, 10, (g) => {
    rect(g, 3, 0, 2, 3, '#555a66');
    rect(g, 1, 3 + f, 6, 5, '#e0383d'); rect(g, 1, 5 + f, 6, 1, '#ffffff'); rect(g, 0, 8, 8, 2, '#9fe3ff');
  })), { anim: 0.6 });
  add('pine', 36, spr(20, 34, (g) => {
    rect(g, 9, 28, 3, 6, '#6b3f1c');
    [[4, 13, 9], [11, 21, 8], [18, 29, 10]].forEach(([top, bot, hw]) => {
      poly(g, [10, top - 4, 10 + hw, bot, 10 - hw, bot], '#1f6a45');
      poly(g, [10, top - 4, 10 + hw * 0.5, bot - 2, 10 - hw, bot], '#2c8a5a');
      poly(g, [10, top - 4, 10 + hw * 0.55, top + 2, 10 - hw * 0.55, top + 2], '#ffffff');
    });
  }));
  add('snowman', 14, spr(14, 22, (g) => {
    circ(g, 7, 16, 5.5, '#ffffff'); circ(g, 7, 8, 4, '#ffffff'); circ(g, 6, 7, 1.5, '#eef6ff');
    rect(g, 3, 1, 8, 4, '#262233'); rect(g, 2, 4, 10, 1, '#262233');
    rect(g, 5, 7, 1, 1, '#1d1b24'); rect(g, 8, 7, 1, 1, '#1d1b24'); rect(g, 7, 9, 3, 1, '#ff8a2a');
    rect(g, 3, 12, 8, 1, '#e0383d'); rect(g, 8, 13, 2, 3, '#e0383d');
    rect(g, 7, 15, 1, 1, '#262233'); rect(g, 7, 18, 1, 1, '#262233');
  }));
  add('crystal', 13, spr(12, 20, (g) => {
    poly(g, [6, 0, 11, 7, 8, 20, 4, 20, 1, 7], '#6fd6ff'); poly(g, [6, 0, 6, 20, 4, 20, 1, 7], '#b8f0ff');
    poly(g, [6, 0, 8, 7, 6, 12], '#ffffff');
  }));
  add('snowbank', 6, spr(16, 9, (g) => {
    g.fillStyle = '#ffffff'; g.beginPath(); g.ellipse(8, 9, 8, 7, 0, Math.PI, 0); g.fill();
    g.fillStyle = '#d6e6fa'; g.beginPath(); g.ellipse(10, 9, 5, 4, 0, Math.PI, 0); g.fill();
  }));
  add('torch', 18, [0, 1, 2].map((f) => spr(10, 26, (g) => {
    rect(g, 3, 12, 4, 14, '#4a3a4e'); rect(g, 3, 12, 1, 14, '#6a5870'); rect(g, 2, 10, 6, 3, '#6a5870');
    const off = [0, 1, -1][f];
    poly(g, [5 + off, 0, 8, 7, 7, 10, 3, 10, 2, 7], '#ff5a1f');
    poly(g, [5 + off * 0.5, 3, 7, 8, 6, 10, 4, 10, 3, 8], '#ffc04a');
    rect(g, 4, 8, 2, 2, '#fff2b0');
  })), { anim: 0.12, glow: true });
  add('pillar', 34, spr(14, 40, (g) => {
    rect(g, 2, 6, 10, 32, '#5a5063'); rect(g, 2, 6, 3, 32, '#776b82');
    for (let y = 9; y < 38; y += 6) rect(g, 2, y, 10, 1, '#3d3446');
    rect(g, 0, 2, 14, 5, '#6a5f74'); rect(g, 0, 36, 14, 4, '#3d3446');
    rect(g, 5, 16, 4, 5, '#ff8a2a'); rect(g, 6, 17, 2, 3, '#ffe14d');
  }));
  add('tower', 72, spr(30, 60, (g) => {
    rect(g, 4, 10, 22, 50, '#4a4056'); rect(g, 4, 10, 6, 50, '#5e5270');
    for (let x = 2; x < 28; x += 6) rect(g, x, 3, 4, 8, '#4a4056');
    rect(g, 2, 10, 26, 3, '#3a3246');
    for (let y = 16; y < 60; y += 7) rect(g, 4, y, 22, 1, '#342c3f');
    rect(g, 12, 20, 6, 8, '#ffb040'); rect(g, 13, 21, 4, 6, '#ffe07a');
    rect(g, 12, 38, 6, 8, '#ff8a2a'); rect(g, 13, 39, 4, 6, '#ffd060');
  }));
  add('lavarock', 7, spr(16, 11, (g) => {
    poly(g, [1, 10, 3, 4, 7, 1, 12, 2, 15, 7, 15, 10], '#3a2c3c'); poly(g, [3, 5, 7, 2, 10, 3, 7, 6], '#54405a');
    rect(g, 6, 6, 5, 1, '#ff7a2a'); rect(g, 10, 4, 1, 3, '#ff7a2a'); rect(g, 4, 8, 3, 1, '#ffb040');
  }));
  /* ---- コーラルリーフ ---- */
  add('coral', 9, spr(16, 15, (g) => {
    const br = (x, y, h, col) => { rect(g, x, y, 2, h, col); };
    br(7, 3, 12, '#ff6f91'); br(3, 6, 9, '#ff6f91'); br(11, 5, 10, '#ff6f91');
    rect(g, 3, 9, 5, 2, '#ff6f91'); rect(g, 8, 8, 4, 2, '#ff6f91');
    br(1, 4, 4, '#ff9ab3'); br(13, 2, 5, '#ff9ab3'); br(6, 1, 3, '#ffc2d0'); br(9, 2, 3, '#ffc2d0');
    rect(g, 2, 13, 12, 2, '#e04a78');
  }));
  add('reefrock', 6, spr(16, 10, (g) => {
    poly(g, [1, 9, 3, 4, 7, 1, 12, 2, 15, 6, 15, 9], '#6f8a9a'); poly(g, [3, 5, 7, 2, 10, 3, 7, 6], '#9ab4c2');
    rect(g, 10, 6, 2, 2, '#ffd9a0'); rect(g, 4, 7, 2, 1, '#ff9ab3'); rect(g, 12, 3, 1, 1, '#ffffff');
  }));
  add('kelp', 18, [0, 1].map((f) => spr(10, 26, (g) => {
    for (let y = 0; y < 26; y++) {
      const x = 4 + Math.round(Math.sin(y / 4 + f * 1.6) * 2);
      rect(g, x, y, 2, 1, y % 6 < 3 ? '#2f9e5a' : '#3fbf6e');
      if (y % 7 === 3) rect(g, x + (f ? 2 : -2), y, 2, 2, '#56d98a');
    }
  })), { anim: 0.45 });
  /* ---- スカイガーデン ---- */
  add('skytree', 22, spr(22, 28, (g) => {
    rect(g, 9, 17, 4, 11, '#9a6a4a'); rect(g, 9, 17, 1, 11, '#7a4a30');
    circ(g, 11, 11, 10, '#ff9ccb'); circ(g, 10, 9.5, 8, '#ffc2e0'); circ(g, 8, 7, 4, '#ffe6f2');
    dots(g, 22, 20, ['#ff7ab6', '#ffffff'], 40, (x, y) => (x - 11) ** 2 + (y - 11) ** 2 < 81);
  }));
  add('column', 22, spr(12, 32, (g) => {
    rect(g, 2, 5, 8, 24, '#f2f2f8'); rect(g, 2, 5, 2, 24, '#ffffff'); rect(g, 8, 5, 2, 24, '#c9cbe0');
    for (let x = 3; x < 10; x += 2) rect(g, x, 6, 1, 22, '#dcdcec');
    rect(g, 0, 1, 12, 4, '#ffffff'); rect(g, 0, 28, 12, 4, '#c9cbe0'); rect(g, 1, 4, 10, 1, '#dcdcec');
  }));
  add('balloon', 18, spr(16, 24, (g) => {
    circ(g, 8, 8, 7.5, '#ff5f6d'); rect(g, 5, 1, 2, 14, '#ffd23f'); rect(g, 9, 1, 2, 14, '#ffd23f');
    circ(g, 6, 5, 2, '#ff9aa4');
    rect(g, 4, 15, 1, 4, '#8a6a4a'); rect(g, 11, 15, 1, 4, '#8a6a4a');
    rect(g, 4, 19, 8, 5, '#b07a4a'); rect(g, 4, 19, 8, 1, '#d69a62');
  }), { fly: 26, bob: 3 });
  add('windmill', 28, [0, 1].map((f) => spr(26, 34, (g) => {
    poly(g, [9, 34, 11, 14, 15, 14, 17, 34], '#f4e8d8'); rect(g, 12, 26, 3, 8, '#8a5a3a');
    poly(g, [8, 15, 13, 8, 18, 15], '#c9504a');
    g.strokeStyle = '#6a4a3a'; g.lineWidth = 2;
    for (let k = 0; k < 4; k++) {
      const a = k * Math.PI / 2 + f * Math.PI / 4;
      g.beginPath(); g.moveTo(13, 12); g.lineTo(13 + Math.cos(a) * 11, 12 + Math.sin(a) * 11); g.stroke();
      rect(g, Math.round(13 + Math.cos(a) * 7) - 1, Math.round(12 + Math.sin(a) * 7) - 1, 3, 3, '#ffffff');
    }
  })), { anim: 0.18 });
  add('lantern', 14, [0, 1].map((f) => spr(8, 22, (g) => {
    rect(g, 3, 6, 2, 16, '#8a6a4a');
    rect(g, 1, 1, 6, 6, f ? '#ffe07a' : '#ffc04a'); rect(g, 2, 2, 4, 4, f ? '#fff6c8' : '#ffe07a'); rect(g, 1, 0, 6, 1, '#c9504a');
  })), { anim: 0.5, glow: true });
  /* ---- ネオンシティ ---- */
  const bld = (base, lit, seed) => spr(24, 64, (g) => {
    const r = mulberry32(seed);
    rect(g, 2, 4, 20, 60, base); rect(g, 2, 4, 3, 60, shade(base, 1.25));
    rect(g, 0, 2, 24, 3, shade(base, 0.8));
    for (let y = 8; y < 60; y += 5) for (let x = 6; x < 20; x += 4) if (r() < 0.55) rect(g, x, y, 2, 3, r() < 0.2 ? '#ff5fd2' : lit);
    rect(g, 10, 0, 2, 3, '#ff3d7f');
  });
  add('building', 70, [bld('#2a1f55', '#ffe07a', 11), bld('#1c2a55', '#7ff0ff', 12), bld('#3a1a4a', '#ffb0f0', 13)], { vari: true });
  add('sign', 20, [0, 1].map((f) => spr(22, 26, (g) => {
    rect(g, 10, 12, 2, 14, '#3a3350');
    rect(g, 0, 0, 22, 12, '#140a2a'); rect(g, 0, 0, 22, 1, f ? '#ff3d7f' : '#7a2a55'); rect(g, 0, 11, 22, 1, f ? '#ff3d7f' : '#7a2a55');
    rect(g, 0, 0, 1, 12, f ? '#ff3d7f' : '#7a2a55'); rect(g, 21, 0, 1, 12, f ? '#ff3d7f' : '#7a2a55');
    const c = f ? '#38d6ff' : '#1a5a70';
    [[3, 3], [3, 5], [3, 7], [4, 3], [5, 5], [8, 3], [8, 5], [8, 7], [9, 7], [10, 7], [13, 3], [13, 5], [13, 7], [14, 3], [15, 3], [14, 7], [15, 7], [18, 3], [18, 5], [18, 7]].forEach(([x, y]) => rect(g, x, y, 1, 2, c));
  })), { anim: 0.35, glow: true });
  add('lamp', 20, spr(12, 30, (g) => {
    rect(g, 5, 6, 2, 24, '#4a4460'); rect(g, 5, 4, 6, 2, '#4a4460');
    rect(g, 8, 6, 4, 2, '#fff6c8'); rect(g, 7, 8, 6, 1, '#ffe07a');
    rect(g, 3, 28, 6, 2, '#2a2440');
  }));
  add('neonpost', 8, [0, 1].map((f) => spr(8, 14, (g) => {
    rect(g, 2, 4, 4, 10, '#2a2440'); rect(g, 1, 0, 6, 5, f ? '#ff3d7f' : '#38d6ff'); rect(g, 2, 1, 4, 3, '#ffffff');
  })), { anim: 0.5, glow: true });
  /* ---- ギャラクシーロード ---- */
  add('asteroid', 10, spr(18, 14, (g) => {
    poly(g, [1, 8, 4, 3, 10, 1, 16, 4, 17, 10, 11, 13, 4, 12], '#6a5a7a'); poly(g, [4, 4, 10, 2, 13, 5, 7, 7], '#8a7a9a');
    circ(g, 12, 9, 1.8, '#4a3a5a'); circ(g, 6, 9, 1.2, '#4a3a5a');
  }), { fly: 10, bob: 4 });
  add('planet', 44, spr(44, 32, (g) => {
    circ(g, 22, 16, 12, '#7a4ad0'); circ(g, 19, 13, 8, '#9a6af0'); circ(g, 17, 11, 3, '#c9a8ff');
    rect(g, 10, 17, 24, 2, '#5a2ab0'); rect(g, 12, 21, 20, 2, '#5a2ab0');
    g.strokeStyle = '#ffd23f'; g.lineWidth = 2; g.beginPath(); g.ellipse(22, 17, 21, 5, -0.2, 0.1, Math.PI - 0.1); g.stroke();
  }), { fly: 90, bob: 2 });
  add('satellite', 10, spr(26, 14, (g) => {
    rect(g, 0, 4, 9, 6, '#2f5fbf'); rect(g, 17, 4, 9, 6, '#2f5fbf');
    for (let x = 1; x < 9; x += 3) { rect(g, x, 4, 1, 6, '#6f9fff'); rect(g, x + 17, 4, 1, 6, '#6f9fff'); }
    rect(g, 9, 6, 8, 2, '#8a90a2'); rect(g, 10, 2, 6, 10, '#d0d4de'); rect(g, 12, 0, 2, 3, '#ff3355');
  }), { fly: 45, bob: 3 });
  add('starpole', 14, [0, 1].map((f) => spr(12, 22, (g) => {
    rect(g, 5, 8, 2, 14, '#8a7aa0');
    poly(g, [6, 0, 7.5, 4, 12, 4, 8.5, 6.5, 10, 11, 6, 8, 2, 11, 3.5, 6.5, 0, 4, 4.5, 4], f ? '#ffe14d' : '#ffffff');
  })), { anim: 0.4, glow: true });
  /* ---- ドラゴンマウンテン：村 ---- */
  const house = (wall, roof, seed) => spr(28, 26, (g) => {
    const r = mulberry32(seed);
    rect(g, 3, 11, 22, 15, wall); rect(g, 3, 11, 4, 15, shade(wall, 1.12));
    poly(g, [0, 12, 14, 1, 28, 12], roof); poly(g, [0, 12, 14, 1, 14, 4, 3, 12], shade(roof, 1.2));
    rect(g, 18, 2, 3, 6, '#6a5a5a');
    rect(g, 11, 17, 6, 9, '#6a4428'); rect(g, 15, 21, 1, 1, '#ffd23f');
    rect(g, 5, 15, 4, 4, r() < 0.5 ? '#bfe6ff' : '#ffe07a'); rect(g, 20, 15, 4, 4, '#bfe6ff');
    rect(g, 5, 17, 4, 1, '#ffffff'); rect(g, 20, 17, 4, 1, '#ffffff');
  });
  add('house', 18, [house('#f4e8d0', '#c9504a', 21), house('#e8f0f8', '#3a7ac9', 22), house('#fff0c8', '#5a9a4a', 23)], { vari: true });
  add('fencepost', 5, spr(6, 10, (g) => {
    rect(g, 1, 0, 4, 10, '#8a5a3a'); rect(g, 1, 0, 1, 10, '#aa7a50'); rect(g, 0, 3, 6, 2, '#6a4428');
  }));
  /* ---- ギアフォートレス ---- */
  add('gear', 16, [0, 1].map((f) => spr(22, 22, (g) => {
    const cx = 11, cy = 11;
    for (let k = 0; k < 8; k++) { const a = (k / 8) * TAU + f * (TAU / 16); rect(g, Math.round(cx + Math.cos(a) * 9) - 2, Math.round(cy + Math.sin(a) * 9) - 2, 4, 4, '#8a7a5a'); }
    circ(g, cx, cy, 8, '#b09a6a'); circ(g, cx - 1, cy - 1, 6, '#d0b880'); circ(g, cx, cy, 3, '#5a4a3a'); circ(g, cx, cy, 1.5, '#2a2230');
  })), { anim: 0.25 });
  add('stack', 40, [0, 1].map((f) => spr(20, 44, (g) => {
    rect(g, 6, 12, 8, 32, '#7a5a4a'); rect(g, 6, 12, 2, 32, '#9a7a62'); rect(g, 5, 10, 10, 3, '#5a4038');
    for (let y = 18; y < 44; y += 6) rect(g, 6, y, 8, 1, '#5a4038');
    circ(g, 10 + f, 6, 4, '#8a8494'); circ(g, 7 - f, 3, 3, '#a8a2b0'); circ(g, 13, 2 + f, 2.5, '#c0bac6');
  })), { anim: 0.5 });
  add('crate', 7, spr(12, 11, (g) => {
    rect(g, 0, 0, 12, 11, '#b07a3a'); rect(g, 0, 0, 12, 2, '#d09a58'); rect(g, 0, 0, 2, 11, '#8a5a2a'); rect(g, 10, 0, 2, 11, '#8a5a2a');
    rect(g, 0, 9, 12, 2, '#8a5a2a'); poly(g, [2, 2, 4, 2, 10, 9, 8, 9], '#8a5a2a');
  }));
  add('banner', 22, [0, 1].map((f) => spr(16, 30, (g) => {
    rect(g, 2, 0, 2, 30, '#6a6474');
    poly(g, [4, 2, 15, 3 + f, 14, 9 + f, 15, 15, 4, 14], '#c9384a'); rect(g, 7, 6, 4, 4, '#ffd23f');
  })), { anim: 0.4 });
  add('rail', 5, spr(6, 10, (g) => {
    rect(g, 2, 0, 3, 10, '#6a6474'); rect(g, 2, 0, 1, 10, '#8a8494'); rect(g, 0, 2, 6, 2, '#ffd23f'); rect(g, 0, 6, 6, 1, '#2a2440');
  }));
  /* ---- バンパー（ネオン） ---- */
  add('bumper', 7, [0, 1].map((f) => spr(18, 14, (g) => {
    g.fillStyle = '#2a1a4a'; g.beginPath(); g.ellipse(9, 10, 8.5, 3.5, 0, 0, TAU); g.fill();
    rect(g, 3, 5, 12, 5, f ? '#ffe14d' : '#ff3d7f');
    g.fillStyle = f ? '#fff6a0' : '#ff7aa8'; g.beginPath(); g.ellipse(9, 5, 6, 3, 0, 0, TAU); g.fill();
    rect(g, 7, 3, 4, 2, '#ffffff');
    if (f) { rect(g, 0, 6, 2, 1, '#ffffff'); rect(g, 16, 6, 2, 1, '#ffffff'); rect(g, 8, 0, 2, 2, '#ffffff'); }
  })), { bumper: true });
  return D;
}

const Gfx = {
  karts: [], icons: {}, deco: null, capsule: [], charIcon: [], charFront: [],
  build() {
    CHARS.forEach((ch, ci) => {
      const vox = buildKartModel(ch);
      const frames = [];
      for (let i = 0; i < SPRITE_N; i++) frames.push(renderVoxels(vox, (i / SPRITE_N) * TAU, KART_SPR, 1.55, 17, 22, 0.40));
      this.karts[ci] = frames;
      // メニュー用（正面ななめ）
      const icon = renderVoxels(vox, Math.PI * 0.78, 34, 1.55, 17, 22, 0.55);
      this.charIcon[ci] = icon.toDataURL();
      this.charFront[ci] = icon;
    });
    ITEM_KEYS.forEach((k) => { this.icons[k] = iconCanvas(k); });
    this.iconURL = {};
    ITEM_KEYS.forEach((k) => { this.iconURL[k] = this.icons[k].toDataURL(); });
    this.deco = buildDecoSprites();
    // アイテムカプセル（回転するクリスタル）
    const pal = ['#38e1ff', '#7b6cff', '#ff5fd2', '#ffd23f', '#5dff9a'];
    for (let f = 0; f < 8; f++) {
      this.capsule.push(spr(16, 18, (g) => {
        const ph = (f / 8) * Math.PI;
        const w = 1.5 + 5.5 * Math.abs(Math.cos(ph));
        const c1 = pal[f % pal.length], c2 = pal[(f + 2) % pal.length];
        poly(g, [8, 1, 8 + w, 9, 8, 17, 8 - w, 9], c1);
        poly(g, [8, 1, 8, 17, 8 - w, 9], c2);
        poly(g, [8, 1, 8 + w * 0.5, 7, 8 - w * 0.5, 7], '#ffffff');
        rect(g, 7, 8, 2, 2, '#ffffff');
      }));
    }
    this.shadow = (() => {
      const c = makeCanvas(16, 6); const g = c.getContext('2d');
      g.fillStyle = 'rgba(10,6,20,0.38)'; g.beginPath(); g.ellipse(8, 3, 8, 3, 0, 0, TAU); g.fill();
      return c;
    })();
    this.bullet = [0, 1].map((f) => spr(10, 10, (g) => {
      circ(g, 5, 5, 4.4, f ? '#1aa6e0' : '#38e1ff'); circ(g, 5, 5, 3, f ? '#7ff0ff' : '#c8ffff'); circ(g, 4, 4, 1.2, '#ffffff');
    }));
    this.drone = [0, 1].map((f) => spr(16, 11, (g) => {
      rect(g, f ? 0 : 1, 1, 6, 1, '#e6e9f0'); rect(g, f ? 10 : 9, 1, 6, 1, '#e6e9f0');
      rect(g, 3, 2, 1, 3, '#555a66'); rect(g, 12, 2, 1, 3, '#555a66');
      rect(g, 3, 4, 10, 5, '#484e5e'); rect(g, 3, 4, 10, 1, '#6b7386');
      rect(g, 7, 6, 2, 2, f ? '#ff3355' : '#ff9aac'); rect(g, 5, 9, 1, 2, '#555a66'); rect(g, 10, 9, 1, 2, '#555a66');
    }));
    // 動く障害物
    this.movers = {
      puffer: [0, 1].map((f) => spr(20, 18, (g) => {
        const r = f ? 8 : 6.5;
        circ(g, 10, 9, r, '#ffd23f'); circ(g, 9, 7, r * 0.6, '#fff09a');
        if (f) for (let k = 0; k < 10; k++) { const a = k / 10 * TAU; rect(g, Math.round(10 + Math.cos(a) * 9), Math.round(9 + Math.sin(a) * 8), 1, 1, '#c98a1a'); }
        rect(g, 6, 7, 2, 2, '#1d1b24'); rect(g, 12, 7, 2, 2, '#1d1b24'); rect(g, 9, 11, 2, 1, '#ff6f91');
        poly(g, [18, 9, 20, 5, 20, 13], '#ffb030');
      })),
      robot: [0, 1].map((f) => spr(18, 20, (g) => {
        rect(g, 3, 4, 12, 10, '#4a4460'); rect(g, 3, 4, 12, 2, '#6a6480');
        rect(g, 5, 7, 8, 3, '#140a2a'); rect(g, f ? 6 : 10, 8, 2, 1, '#ff3d7f');
        rect(g, 8, 0, 2, 4, '#8a90a2'); rect(g, 7, 0, 4, 1, f ? '#38d6ff' : '#ff3d7f');
        rect(g, 4, 14, 3, 6 - f * 2, '#2a2440'); rect(g, 11, 14, 3, 4 + f * 2, '#2a2440');
        rect(g, 0, 7, 3, 2, '#6a6480'); rect(g, 15, 7, 3, 2, '#6a6480');
      })),
      boulder: [0, 1].map((f) => spr(20, 20, (g) => {
        circ(g, 10, 10, 9, '#7a6a62'); circ(g, 8, 8, 6, '#948478'); circ(g, 7, 6, 2.5, '#b0a094');
        const a = f * Math.PI / 2;
        rect(g, Math.round(10 + Math.cos(a) * 5), Math.round(10 + Math.sin(a) * 5), 3, 2, '#5a4a44');
        rect(g, Math.round(10 - Math.sin(a) * 4), Math.round(10 + Math.cos(a) * 4), 2, 2, '#5a4a44');
      })),
      meteor: [0, 1].map((f) => spr(22, 20, (g) => {
        poly(g, [0, 4 + f, 10, 7, 8, 11, 2, 14 - f], f ? '#ff9d1f' : '#ffd23f');
        poly(g, [3, 6, 10, 8, 9, 10, 4, 12], '#fff6a0');
        circ(g, 14, 10, 7, '#6a4a5a'); circ(g, 13, 8, 4.5, '#8a6a7a'); circ(g, 16, 12, 1.6, '#4a2a3a');
      })),
    };
    // カイト（滑空用のハンググライダー）
    this.kite = spr(30, 14, (g) => {
      poly(g, [15, 0, 30, 11, 15, 8, 0, 11], '#ff3d7f');
      poly(g, [15, 0, 22, 9.6, 15, 8, 8, 9.6], '#ffd23f');
      poly(g, [15, 0, 17, 8.2, 15, 8, 13, 8.2], '#38d6ff');
      rect(g, 14, 8, 2, 6, '#4a4460');
    });
    // 空中リング
    this.ring = [0, 1].map((f) => spr(24, 24, (g) => {
      g.strokeStyle = f ? '#ffe14d' : '#38e1ff'; g.lineWidth = 3;
      g.beginPath(); g.ellipse(12, 12, 10, 10, 0, 0, TAU); g.stroke();
      g.strokeStyle = '#ffffff'; g.lineWidth = 1;
      g.beginPath(); g.ellipse(12, 12, 10, 10, 0, Math.PI * 1.1, Math.PI * 1.5); g.stroke();
    }));
    this.oil = spr(22, 8, (g) => {
      g.fillStyle = '#2a1a44'; g.beginPath(); g.ellipse(11, 4, 10, 3.4, 0, 0, TAU); g.fill();
      g.fillStyle = '#4b3380'; g.beginPath(); g.ellipse(9, 3.5, 5, 1.6, 0, 0, TAU); g.fill();
      rect(g, 6, 3, 3, 1, '#a58bff'); rect(g, 14, 4, 2, 1, '#6f58b8');
    }, true);
  },
  trophy(kind) {
    const pal = kind === 1 ? ['#ffd23f', '#fff3a0', '#c9971a'] : kind === 2 ? ['#d6dbe6', '#ffffff', '#9aa1b3'] : ['#e08a4a', '#ffc49a', '#a45a26'];
    return spr(24, 28, (g) => {
      rect(g, 5, 2, 14, 11, pal[0]); rect(g, 6, 3, 3, 8, pal[1]);
      g.fillStyle = pal[0]; g.beginPath(); g.arc(12, 12, 7, 0, Math.PI); g.fill();
      g.strokeStyle = pal[2]; g.lineWidth = 2; g.beginPath(); g.arc(4, 7, 3, Math.PI * 0.5, Math.PI * 1.5); g.stroke();
      g.beginPath(); g.arc(20, 7, 3, -Math.PI * 0.5, Math.PI * 0.5); g.stroke();
      rect(g, 10, 18, 4, 4, pal[2]); rect(g, 7, 22, 10, 3, pal[0]); rect(g, 5, 25, 14, 3, '#5a3a22');
      poly(g, [12, 5, 13, 8, 16, 8, 13.5, 10, 14.5, 13, 12, 11, 9.5, 13, 10.5, 10, 8, 8, 11, 8], '#ffffff');
    });
  },
};

/* =========================================================
   7. コース生成（テクスチャ・空・ミニマップ・配置物）
   ========================================================= */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
function matColor(name, x, y) {
  const n = hash2(x, y, 17), n2 = hash2(x >> 1, y >> 1, 31), n3 = hash2(x >> 2, y >> 2, 53);
  switch (name) {
    case 'grass': {
      const b = ((x >> 4) & 1) ? [74, 166, 70] : [64, 150, 60];
      if (n < 0.08) return [50, 124, 48];
      if (n > 0.955) return [118, 200, 98];
      if (n3 < 0.012 && n > 0.5) return [255, 238, 120];
      return b;
    }
    case 'grassOff': {
      if (n < 0.2) return [74, 114, 46];
      if (n > 0.9) return [132, 170, 78];
      return n2 < 0.3 ? [90, 134, 56] : [98, 144, 60];
    }
    case 'asphalt': {
      if (n > 0.975) return [134, 138, 150];
      if (n < 0.03) return [62, 64, 74];
      const v = 84 + Math.floor(n2 * 10);
      return [v, v + 3, v + 14];
    }
    case 'concrete': {
      if ((x & 31) === 0 || (y & 31) === 0) return [150, 138, 124];
      const v = Math.floor(n * 12);
      return [170 + v, 160 + v, 146 + v];
    }
    case 'water': {
      const wy = y + Math.round(Math.sin((x / 64) * TAU * 2) * 2);
      if (((wy % 16) + 16) % 16 === 0 && ((x >> 3) + (y >> 4)) % 3 !== 0) return [150, 220, 255];
      if (n < 0.1) return [26, 112, 186];
      return n3 < 0.5 ? [34, 132, 206] : [38, 140, 214];
    }
    case 'sand': {
      if (((y + (x >> 3)) % 12) === 0) return [248, 228, 172];
      if (n < 0.07) return [210, 180, 116];
      if (n > 0.97) return [255, 246, 214];
      return n2 < 0.5 ? [234, 208, 142] : [230, 202, 136];
    }
    case 'snow': {
      if (n < 0.12) return [210, 224, 244];
      if (n > 0.975) return [255, 255, 255];
      return n3 < 0.5 ? [236, 243, 252] : [230, 239, 250];
    }
    case 'snowOff': {
      if (n2 < 0.22) return [192, 210, 236];
      if (n > 0.95) return [240, 248, 255];
      return [214, 228, 246];
    }
    case 'iceRoad': {
      if (((x + y * 2) % 23) === 0) return [142, 162, 194];
      const v = Math.floor(n * 9);
      return [100 + v, 116 + v, 148 + v];
    }
    case 'ice': {
      if ((((x - y) % 13) + 13) % 13 === 0) return [244, 252, 255];
      if (n < 0.1) return [158, 212, 240];
      return [186, 232, 252];
    }
    case 'rock': {
      if (n3 < 0.09 && n < 0.45) return [226, 102, 38];
      if (n > 0.94) return [86, 68, 90];
      const v = Math.floor(n2 * 10);
      return [58 + v, 44 + v, 60 + v];
    }
    case 'lava': {
      const v = Math.sin((x / 64) * TAU * 2 + Math.sin((y / 64) * TAU) * 2) + Math.sin((y / 64) * TAU * 3 + Math.sin((x / 64) * TAU * 2));
      if (v > 1.15) return [255, 220, 96];
      if (v > 0.3) return [255, 142, 40];
      if (v > -0.7) return [236, 78, 24];
      return [150, 34, 20];
    }
    case 'brick': {
      const row = y >> 3;
      const bx = (x + (row & 1) * 8) & 15;
      if ((y & 7) === 0 || bx === 0) return [50, 44, 58];
      const bi = (x + (row & 1) * 8) >> 4;
      const v = Math.floor(hash2(bi, row, 5) * 18 + n * 6);
      return [90 + v, 82 + v, 100 + v];
    }
    case 'boardwalk': {
      if ((y & 7) === 0) return [120, 82, 52];
      const pl = (y >> 3) & 7;
      if (((x + pl * 23) & 31) === 0) return [132, 92, 58];
      const v = Math.floor(n2 * 10) + (pl % 2) * 6;
      return [196 + v, 150 + v, 98 + v];
    }
    case 'seabed': {
      const c = Math.sin((x / 64) * TAU * 2 + Math.sin((y / 64) * TAU * 2) * 1.5) + Math.sin((y / 64) * TAU * 3 - (x / 64) * TAU);
      if (c > 1.35) return [196, 244, 250];
      if (n < 0.06) return [150, 170, 150];
      return n3 < 0.5 ? [214, 198, 150] : [206, 190, 144];
    }
    case 'reefOff': {
      if (n < 0.05) return [255, 120, 150];
      if (n > 0.96) return [255, 200, 120];
      if (n3 < 0.2) return [70, 150, 120];
      return n2 < 0.5 ? [180, 170, 130] : [168, 160, 124];
    }
    case 'cloud': {
      const c = Math.sin((x / 64) * TAU + Math.sin((y / 64) * TAU) * 2) + Math.sin((y / 64) * TAU * 2 + Math.sin((x / 64) * TAU * 2));
      if (c > 1.1) return [255, 255, 255];
      if (c > 0.2) return [236, 244, 255];
      if (c > -0.8) return [208, 226, 250];
      return [184, 208, 244];
    }
    case 'meadow': {
      if (n3 < 0.02 && n > 0.5) return [255, 150, 200];
      if (n3 > 0.985 && n > 0.5) return [255, 255, 255];
      if (n < 0.1) return [96, 176, 84];
      return n2 < 0.5 ? [132, 206, 104] : [124, 198, 98];
    }
    case 'skytile': {
      if ((x & 15) === 0 || (y & 15) === 0) return [196, 200, 222];
      const t = ((x >> 4) + (y >> 4)) & 1;
      const v = Math.floor(n * 8);
      return t ? [238 + v, 236 + v, 246] : [224 + v, 222 + v, 238];
    }
    case 'neonroad': {
      if ((x & 31) === 0 || (y & 31) === 0) return [58, 36, 96];
      if (n > 0.985) return [120, 220, 255];
      const v = Math.floor(n2 * 8);
      return [34 + v, 28 + v, 52 + v];
    }
    case 'neonoff': {
      if ((x & 15) === 0 || (y & 15) === 0) return [26, 20, 44];
      const v = Math.floor(n * 10);
      return [44 + v, 38 + v, 66 + v];
    }
    case 'cityfloor': {
      if ((x & 15) === 2 && (y & 15) > 3 && (y & 15) < 12 && hash2(x >> 4, y >> 4, 9) < 0.35) return [255, 214, 120];
      if ((x & 15) === 0 || (y & 15) === 0) return [20, 12, 36];
      return n2 < 0.5 ? [30, 22, 50] : [34, 24, 56];
    }
    case 'canal': {
      const wy = y + Math.round(Math.sin((x / 64) * TAU * 2) * 2);
      if (((wy % 16) + 16) % 16 === 0) return ((x >> 3) & 1) ? [255, 61, 127] : [56, 214, 255];
      return n < 0.1 ? [10, 16, 40] : [16, 24, 56];
    }
    case 'space': {
      if (n > 0.992) return [255, 255, 255];
      if (n > 0.984) return [180, 170, 255];
      const c = Math.sin((x / 64) * TAU + Math.sin((y / 64) * TAU) * 2);
      return c > 0.9 ? [26, 12, 52] : [8, 4, 22];
    }
    case 'nebula': {
      const c = Math.sin((x / 64) * TAU * 2 + Math.sin((y / 64) * TAU * 2) * 2) + Math.sin((y / 64) * TAU + (x / 64) * TAU);
      if (n > 0.985) return [255, 255, 255];
      if (c > 1) return [150, 70, 190];
      if (c > 0) return [106, 50, 160];
      return [70, 34, 120];
    }
    case 'starroad': {
      if (n > 0.975) return [255, 255, 255];
      if (n > 0.96) return [255, 200, 255];
      if ((x & 31) === 0) return [90, 70, 160];
      const v = Math.floor(n2 * 10);
      return [40 + v, 26 + v, 86 + v];
    }
    case 'metal': {
      if ((x & 31) === 0 || (y & 31) === 0) return [70, 72, 86];
      if (((x & 31) === 3 || (x & 31) === 28) && ((y & 31) === 3 || (y & 31) === 28)) return [176, 180, 196];
      if (n > 0.97) return [150, 154, 168];
      const v = Math.floor(n2 * 8) + (((x >> 5) + (y >> 5)) & 1) * 6;
      return [108 + v, 112 + v, 126 + v];
    }
    case 'grating': {
      if ((x & 3) === 0 || (y & 3) === 0) return [84, 84, 98];
      return n < 0.2 ? [24, 22, 32] : [36, 34, 46];
    }
    case 'crag': {
      if (n3 < 0.06 && n < 0.5) return [70, 60, 58];
      if (n > 0.95) return [150, 136, 128];
      const v = Math.floor(n2 * 14);
      return [104 + v, 94 + v, 90 + v];
    }
    default: return [255, 0, 255];
  }
}
const matCache = {};
function materialTile(name) {
  if (matCache[name]) return matCache[name];
  const c = workCanvas(64, 64);
  const g = c.getContext('2d');
  const id = g.createImageData(64, 64);
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const col = matColor(name, x, y), i = (y * 64 + x) * 4;
      id.data[i] = col[0]; id.data[i + 1] = col[1]; id.data[i + 2] = col[2]; id.data[i + 3] = 255;
    }
  }
  g.putImageData(id, 0, 0);
  matCache[name] = c;
  return c;
}
function buildMips(base, size, levels) {
  const out = [{ size, data: base, mask: size - 1 }];
  let cur = base, s = size;
  for (let l = 1; l < levels; l++) {
    const ns = s >> 1, nd = new Uint32Array(ns * ns);
    for (let y = 0; y < ns; y++) {
      for (let x = 0; x < ns; x++) {
        const a = cur[(y * 2) * s + x * 2], b = cur[(y * 2) * s + x * 2 + 1], c = cur[(y * 2 + 1) * s + x * 2], d = cur[(y * 2 + 1) * s + x * 2 + 1];
        const r = ((a & 255) + (b & 255) + (c & 255) + (d & 255)) >> 2;
        const gg = (((a >> 8) & 255) + ((b >> 8) & 255) + ((c >> 8) & 255) + ((d >> 8) & 255)) >> 2;
        const bb = (((a >> 16) & 255) + ((b >> 16) & 255) + ((c >> 16) & 255) + ((d >> 16) & 255)) >> 2;
        nd[y * ns + x] = pack(r, gg, bb);
      }
    }
    out.push({ size: ns, data: nd, mask: ns - 1 });
    cur = nd; s = ns;
  }
  return out;
}

class Track {
  constructor(def, mirror, lite) {
    this.def = def;
    this.mirror = !!mirror;
    this.size = def.size || TEX;
    this.theme = THEMES[def.theme];
    this.halfRoad = def.roadW / 2;
    this.curb = 4;
    this.limit = this.halfRoad + this.curb + def.offW;
    this.boundary = this.theme.boundary;
    this.rnd = mulberry32(hashStr(def.id) + (this.mirror ? 99 : 0));
    this.buildGeometry();
    if (lite) { this.hasElev = false; this.buildMinimap(); return; } // メニューのミニマップ用（軽量）
    this.buildElevation();
    this.buildFeatures();
    this.buildHeightmap();
    this.placeDeco();
    this.buildTexture();
    this.buildSky();
    this.buildMinimap();
  }
  buildGeometry() {
    const pts = this.def.pts.map((p) => [this.mirror ? this.size - p[0] : p[0], p[1]]);
    const n = pts.length, dense = [];
    for (let i = 0; i < n; i++) {
      const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
      for (let k = 0; k < 32; k++) {
        const t = k / 32, t2 = t * t, t3 = t2 * t;
        const f = (a, b, c, d) => 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
        dense.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
      }
    }
    const cum = [0];
    for (let i = 1; i < dense.length; i++) cum.push(cum[i - 1] + Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]));
    const total = cum[cum.length - 1] + Math.hypot(dense[0][0] - dense[dense.length - 1][0], dense[0][1] - dense[dense.length - 1][1]);
    dense.push(dense[0]); cum.push(total);
    const N = Math.round(total / TRACK_STEP);
    const step = total / N;
    const X = new Float32Array(N), Y = new Float32Array(N);
    let j = 0;
    for (let i = 0; i < N; i++) {
      const s = i * step;
      while (j < cum.length - 2 && cum[j + 1] < s) j++;
      const seg = cum[j + 1] - cum[j];
      const t = seg > 0 ? (s - cum[j]) / seg : 0;
      X[i] = dense[j][0] + (dense[j + 1][0] - dense[j][0]) * t;
      Y[i] = dense[j][1] + (dense[j + 1][1] - dense[j][1]) * t;
    }
    const TX = new Float32Array(N), TY = new Float32Array(N), NX = new Float32Array(N), NY = new Float32Array(N), A = new Float32Array(N), K = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const a = (i - 1 + N) % N, b = (i + 1) % N;
      let tx = X[b] - X[a], ty = Y[b] - Y[a];
      const l = Math.hypot(tx, ty) || 1;
      tx /= l; ty /= l;
      TX[i] = tx; TY[i] = ty; NX[i] = -ty; NY[i] = tx; A[i] = Math.atan2(ty, tx);
    }
    for (let i = 0; i < N; i++) K[i] = wrapAngle(A[(i + 1) % N] - A[i]);
    Object.assign(this, { N, step, len: N * step, X, Y, TX, TY, NX, NY, A, K });
    // 大砲で飛ぶ区間は「道ではない」
    this.skipRanges = (this.def.cannons || []).map((c) => ({ s: c.f * this.len, e: c.to * this.len }));
    this.skip = new Uint8Array(N);
    this.skipRanges.forEach((r) => { for (let i = 0; i < N; i++) { const s = i * step; if (s >= r.s && s <= r.e) this.skip[i] = 1; } });
  }
  idxOf(s) { const L = this.len; s = ((s % L) + L) % L; return Math.floor(s / this.step) % this.N; }
  pointAt(s, d, out) {
    const L = this.len;
    s = ((s % L) + L) % L;
    const f = s / this.step;
    const i = Math.floor(f) % this.N, j = (i + 1) % this.N, t = f - Math.floor(f);
    const x = this.X[i] + (this.X[j] - this.X[i]) * t, y = this.Y[i] + (this.Y[j] - this.Y[i]) * t;
    const nx = this.NX[i] + (this.NX[j] - this.NX[i]) * t, ny = this.NY[i] + (this.NY[j] - this.NY[i]) * t;
    out = out || {};
    out.x = x + nx * (d || 0); out.y = y + ny * (d || 0);
    out.a = Math.atan2(-nx, ny);
    return out;
  }
  locate(o, full) {
    const N = this.N, X = this.X, Y = this.Y;
    let best = 0, bd = Infinity;
    if (full) {
      const sk = this.skip;
      for (let i = 0; i < N; i++) { if (sk && sk[i]) continue; const dx = o.x - X[i], dy = o.y - Y[i], dd = dx * dx + dy * dy; if (dd < bd) { bd = dd; best = i; } }
    } else {
      const h = o.ti | 0;
      for (let k = -26; k <= 26; k++) {
        const i = (((h + k) % N) + N) % N;
        const dx = o.x - X[i], dy = o.y - Y[i], dd = dx * dx + dy * dy;
        if (dd < bd) { bd = dd; best = i; }
      }
    }
    const dx = o.x - X[best], dy = o.y - Y[best];
    const t = (dx * this.TX[best] + dy * this.TY[best]);
    let s = best * this.step + t;
    s = ((s % this.len) + this.len) % this.len;
    o.ti = best; o.s = s; o.d = dx * this.NX[best] + dy * this.NY[best];
  }
  sDelta(s, s0) { const L = this.len; return (((s - s0) % L) + L) % L; }
  sSigned(s, s0) { let d = this.sDelta(s, s0); if (d > this.len / 2) d -= this.len; return d; }
  // 道の高低差：周回位置ごとの高さを作る（直線補間→なめらかに）
  buildElevation() {
    const def = this.def, N = this.N;
    this.hasElev = !!def.elev;
    if (!this.hasElev) return;
    const interp = (E, f) => {
      let k = 0;
      while (k < E.length - 1 && E[k + 1][0] <= f) k++;
      const a = E[k], b = k + 1 < E.length ? E[k + 1] : [1 + E[0][0], E[0][1]];
      const t = clamp((f - a[0]) / Math.max(1e-6, b[0] - a[0]), 0, 1);
      return a[1] + (b[1] - a[1]) * t;
    };
    const H = new Float32Array(N), KT = new Float32Array(N);
    for (let i = 0; i < N; i++) { H[i] = interp(def.elev, i / N); KT[i] = interp(def.terrain || [[0, 0.5]], i / N); }
    {
      const tmp = Float32Array.from(H);
      for (let i = 0; i < N; i++) { let sum = 0; for (let j = -3; j <= 3; j++) sum += tmp[(i + j + N) % N]; H[i] = sum / 7; }
    }
    const G1 = new Float32Array(N), G2 = new Float32Array(N), st = this.step;
    for (let i = 0; i < N; i++) {
      const a = H[(i - 1 + N) % N], b = H[i], c = H[(i + 1) % N];
      G1[i] = (c - a) / (2 * st); G2[i] = (c - 2 * b + a) / (st * st);
    }
    Object.assign(this, { H, G1, G2, KT });
    if (def.river) this.river = def.river.map((q) => [this.mirror ? this.size - q[0] : q[0], q[1]]);
    if (def.lake) this.lake = { x: this.mirror ? this.size - def.lake.x : def.lake.x, y: def.lake.y, r: def.lake.r };
  }
  // 地形の高さマップ：道は設定どおり、道の外は山がせり上がる。川・湖・谷は低く削る
  buildHeightmap() {
    if (!this.hasElev) return;
    const size = this.size, cs = 8, G = size / cs, N = this.N, X = this.X, Y = this.Y, H = this.H;
    const idx = new Int32Array(G * G).fill(-1), dist = new Float32Array(G * G).fill(1e9);
    const cd = (c, i) => { const cx = ((c % G) + 0.5) * cs, cy = (Math.floor(c / G) + 0.5) * cs; return Math.hypot(cx - X[i], cy - Y[i]); };
    for (let i = 0; i < N; i++) {
      if (this.skip[i]) continue;
      const gx = clamp(Math.floor(X[i] / cs), 0, G - 1), gy = clamp(Math.floor(Y[i] / cs), 0, G - 1), c = gy * G + gx;
      const d = cd(c, i);
      if (d < dist[c]) { dist[c] = d; idx[c] = i; }
    }
    const relax = (c, n) => { const i = idx[n]; if (i < 0) return; const d = cd(c, i); if (d < dist[c]) { dist[c] = d; idx[c] = i; } };
    for (let pass = 0; pass < 2; pass++) {
      for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) {
        const c = y * G + x;
        if (x > 0) relax(c, c - 1);
        if (y > 0) { relax(c, c - G); if (x > 0) relax(c, c - G - 1); if (x < G - 1) relax(c, c - G + 1); }
      }
      for (let y = G - 1; y >= 0; y--) for (let x = G - 1; x >= 0; x--) {
        const c = y * G + x;
        if (x < G - 1) relax(c, c + 1);
        if (y < G - 1) { relax(c, c + G); if (x < G - 1) relax(c, c + G + 1); if (x > 0) relax(c, c + G - 1); }
      }
    }
    const lim = this.limit, hm = new Float32Array(G * G), trackH = new Float32Array(G * G);
    const vn = (x, y) => {
      const ix = Math.floor(x), iy = Math.floor(y), tx = x - ix, ty = y - iy;
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      const a = hash2(ix, iy, 71), b = hash2(ix + 1, iy, 71), c = hash2(ix, iy + 1, 71), d = hash2(ix + 1, iy + 1, 71);
      return (a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy;
    };
    const segD = (px, py, a, b) => {
      const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
      const t = l2 ? clamp(((px - a[0]) * dx + (py - a[1]) * dy) / l2, 0, 1) : 0;
      return Math.hypot(px - a[0] - dx * t, py - a[1] - dy * t);
    };
    const ravines = this.glides.map((g) => ({ s: g.s - 30, len: g.len + 60 }));
    for (let c = 0; c < G * G; c++) {
      const i = idx[c], d = dist[c], hT = H[i];
      const cx = ((c % G) + 0.5) * cs, cy = (Math.floor(c / G) + 0.5) * cs;
      let h = hT;
      if (d > lim + 4) {
        const e = d - lim - 4;
        const nz = vn(cx / 56, cy / 56) * 0.7 + vn(cx / 17, cy / 17) * 0.3;
        h = hT + Math.min(260, e * this.KT[i] * (0.55 + 0.9 * nz));
      }
      // 滑空区間の下は深い谷
      const si = i * this.step;
      for (let r = 0; r < ravines.length; r++) {
        const rv = ravines[r], gl = this.glides[r];
        const onRoad = d <= lim + 4;
        if (onRoad ? this.sDelta(si, gl.s) < gl.len : (this.sDelta(si, rv.s) < rv.len && d < lim + 80)) {
          const t = clamp((d - lim - 12) / 68, 0, 1); h = lerp(hT - 95, h, t * t);
        }
      }
      // 川と湖（道の部分は橋として残す）
      if (d > lim + 2) {
        if (this.river) {
          let rd = 1e9;
          for (let k = 0; k < this.river.length - 1; k++) rd = Math.min(rd, segD(cx, cy, this.river[k], this.river[k + 1]));
          if (rd < 30) h = lerp(-16, h, clamp((rd - 18) / 12, 0, 1));
        }
        if (this.lake) {
          const ld = Math.hypot(cx - this.lake.x, cy - this.lake.y) - this.lake.r;
          if (ld < 12) h = lerp(-16, h, clamp(ld / 12, 0, 1));
        }
      }
      hm[c] = h;
      trackH[c] = hT;
    }
    // 道以外をなめらかに
    for (let pass = 0; pass < 2; pass++) {
      const tmp = Float32Array.from(hm);
      for (let y = 1; y < G - 1; y++) for (let x = 1; x < G - 1; x++) {
        const c = y * G + x;
        if (dist[c] <= lim + 6) continue;
        hm[c] = (tmp[c] * 4 + tmp[c - 1] + tmp[c + 1] + tmp[c - G] + tmp[c + G]) / 8;
      }
    }
    // 傾き（岩肌の色付け用）
    const slope = new Float32Array(G * G);
    for (let y = 1; y < G - 1; y++) for (let x = 1; x < G - 1; x++) {
      const c = y * G + x;
      slope[c] = Math.hypot(hm[c + 1] - hm[c - 1], hm[c + G] - hm[c - G]) / (2 * cs);
    }
    const light = new Float32Array(G * G).fill(1);
    for (let y = 1; y < G - 1; y++) for (let x = 1; x < G - 1; x++) {
      const c = y * G + x;
      const lx = (hm[c + 1] - hm[c - 1]) / (2 * cs), ly = (hm[c + G] - hm[c - G]) / (2 * cs);
      light[c] = clamp(1 + (lx * 0.55 + ly * 0.45) * 0.9, 0.6, 1.22);
    }
    Object.assign(this, { hm, hmG: G, hmCell: cs, hmDist: dist, hmSlope: slope, hmLight: light, hmTrackH: trackH });
  }
  // 地形の色付け：急斜面は岩肌、山頂付近は雪（ドットのディザで）
  tintTerrain(data) {
    const S = this.size, G = this.hmG, cs = this.hmCell, lim = this.limit;
    const px32 = new Uint32Array(data.buffer);
    const rockA = pack(126, 116, 124), rockB = pack(104, 96, 108), snowA = pack(240, 246, 255), snowB = pack(212, 226, 244);
    for (let y = 0; y < S; y++) {
      const fy = clamp(y / cs - 0.5, 0, G - 1.001), iy = fy | 0, ty = fy - iy;
      for (let x = 0; x < S; x++) {
        const fx = clamp(x / cs - 0.5, 0, G - 1.001), ix = fx | 0, tx = fx - ix, c = iy * G + ix;
        const d = (this.hmDist[c] * (1 - tx) + this.hmDist[c + 1] * tx) * (1 - ty) + (this.hmDist[c + G] * (1 - tx) + this.hmDist[c + G + 1] * tx) * ty;
        if (d < lim + 6) continue;
        const h = (this.hm[c] * (1 - tx) + this.hm[c + 1] * tx) * (1 - ty) + (this.hm[c + G] * (1 - tx) + this.hm[c + G + 1] * tx) * ty;
        if (h < -6 || h < this.hmTrackH[c] - 30) continue; // 川・湖・谷底
        const sl = this.hmSlope[c];
        const th = (BAYER[(y & 3) * 4 + (x & 3)] + 0.5) / 16;
        const snow = clamp((h - (this.def.snowLine || 172)) / 34, 0, 1), rock = clamp((sl - 0.5) / 0.45, 0, 1);
        const n = hash2(x, y, 5);
        const o = y * S + x;
        if (snow > th) px32[o] = n < 0.15 ? snowB : snowA;
        else if (rock > th) px32[o] = n < 0.3 ? rockB : rockA;
        // 陰影
        const lt = this.hmLight[c] * (1 - tx) * (1 - ty) + this.hmLight[c + 1] * tx * (1 - ty) + this.hmLight[c + G] * (1 - tx) * ty + this.hmLight[c + G + 1] * tx * ty;
        const q = Math.round(lt * 8) / 8;
        if (q !== 1) {
          const v = px32[o];
          const r = Math.min(255, ((v & 255) * q) | 0), gg = Math.min(255, (((v >> 8) & 255) * q) | 0), bb = Math.min(255, (((v >> 16) & 255) * q) | 0);
          px32[o] = pack(r, gg, bb);
        }
      }
    }
  }
  buildFeatures() {
    const def = this.def, L = this.len, m = this.mirror ? -1 : 1;
    this.itemRows = def.items.map((f) => f * L);
    this.boosts = def.boosts.map((b) => ({ s: b.f * L, d: b.d * m, len: 18, w: 18 }));
    this.ramps = def.ramps.map((r) => ({ s: r.f * L, d: r.d * m, len: 14, w: r.w, gap: false }));
    this.gaps = def.gaps.map((g) => ({ s: g.f * L, len: g.len }));
    this.gaps.forEach((g) => this.ramps.push({ s: g.s - 20, d: 0, len: 17, w: def.roadW + this.curb * 2, gap: true, ref: g }));
    this.ice = def.ice.map((i) => ({ s: i.f * L, len: i.len * L }));
    this.pools = def.pools.map((p) => ({ s: p.f * L, d: p.d * m, r: p.r }));
    // ---- 追加ギミック ----
    this.zones = (def.zones || []).map((z) => ({ s: z.f * L, len: z.len * L, kind: z.kind }));
    this.winds = (def.winds || []).map((w, i) => ({ s: w.f * L, len: w.len * L, force: w.force, ph: i * 2.1 }));
    this.glides = (def.glides || []).map((g) => ({ s: g.f * L, len: g.len }));
    this.glides.forEach((g) => this.ramps.push({ s: g.s - 20, d: 0, len: 17, w: def.roadW + this.curb * 2, gap: false, glide: true, ref: g }));
    // 空中リング：自然な滑空の高さに配置（左右に振ってある）
    this.rings = [];
    this.glides.forEach((g, gi) => {
      [0.3, 0.64].forEach((t, k) => {
        const dist = g.len * t + 12, v = 140, tt = dist / v, tp = GLIDE_VZ / (GRAVITY * 0.55);
        let z = tt < tp ? GLIDE_VZ * tt - 0.5 * GRAVITY * 0.55 * tt * tt : (GLIDE_VZ * GLIDE_VZ) / (2 * GRAVITY * 0.55) - 2.5 - 14 * Math.max(0, tt - tp - 0.39);
        z = clamp(z, 9, 26);
        if (this.hasElev) z = clamp(this.heightAt(g.s) + z - this.heightAt(g.s + g.len * t), 9, 80);
        const d = (k % 2 ? 1 : -1) * (gi % 2 ? -1 : 1) * 14 * m;
        const p = this.pointAt(g.s + g.len * t, d);
        this.rings.push({ s: g.s + g.len * t, d, z, x: p.x, y: p.y });
      });
    });
    this.movers = (def.movers || []).map((mv, i) => ({ s: mv.f * L, amp: mv.amp, period: mv.period, kind: mv.kind, ph: i * 1.7 }));
    // ベルトコンベア：レーンごとに進む向きと速さが違う（+は前へ、-は後ろへ）
    this.belts = (def.belts || []).map((b) => ({
      s: b.f * L, len: b.len,
      lanes: b.lanes.map((ln) => (m > 0 ? { d0: ln.d0, d1: ln.d1, v: ln.v } : { d0: -ln.d1, d1: -ln.d0, v: ln.v })),
    }));
    // 大砲：発射台に乗ると塔の頂上まで一気に飛ぶ
    this.cannons = (def.cannons || []).map((c) => ({ s: c.f * L, to: c.to * L }));
    // ショートカット：コース脇の隠しジャンプ台。スピードが足りれば先の地点へ飛べる
    this.shortcuts = (def.shortcuts || []).map((c) => ({ s: c.f * L, d: c.side * (this.halfRoad + this.curb + 7) * m, to: c.to * L, need: c.need || 0.92 }));
    this.bumpers = (def.bumpers || []).map((b) => { const p = this.pointAt(b.f * L, b.d * m); return { s: b.f * L, d: b.d * m, x: p.x, y: p.y, r: 5, lit: 0 }; });
    this.boxes = [];
    this.itemRows.forEach((s) => {
      [-0.62, -0.21, 0.21, 0.62].forEach((k) => {
        const p = this.pointAt(s, k * this.halfRoad);
        this.boxes.push({ x: p.x, y: p.y, s, d: k * this.halfRoad });
      });
    });
  }
  inBoost(s, d) { for (const b of this.boosts) if (this.sDelta(s, b.s) < b.len && Math.abs(d - b.d) < b.w / 2) return true; return false; }
  inRamp(s, d) { for (const r of this.ramps) if (this.sDelta(s, r.s) < r.len && Math.abs(d - r.d) < r.w / 2) return r; return null; }
  inIce(s, d) {
    if (Math.abs(d) > this.halfRoad + 1) return false;
    for (const i of this.ice) if (this.sDelta(s, i.s) < i.len) return true;
    return false;
  }
  isPit(s, d) {
    for (const r of this.skipRanges) if (s >= r.s && s <= r.e) return true;
    if (this.boundary === 'fall' && Math.abs(d) > this.limit) return true;
    for (const g of this.gaps) if (this.sDelta(s, g.s) < g.len) return true;
    for (const g of this.glides) if (this.sDelta(s, g.s) < g.len) return true;
    for (const p of this.pools) { const ds = this.sSigned(s, p.s), dd = d - p.d; if (ds * ds + dd * dd < p.r * p.r) return true; }
    return false;
  }
  heightAt(s) {
    if (!this.hasElev) return 0;
    const L = this.len; s = ((s % L) + L) % L;
    const f = s / this.step, i = Math.floor(f) % this.N, j = (i + 1) % this.N, t = f - Math.floor(f);
    return this.H[i] + (this.H[j] - this.H[i]) * t;
  }
  gradeAt(s) { return this.hasElev ? this.G1[this.idxOf(s)] : 0; }
  curvHAt(s) { return this.hasElev ? this.G2[this.idxOf(s)] : 0; }
  hXY(x, y) {
    if (!this.hasElev) return 0;
    const G = this.hmG, cs = this.hmCell, hm = this.hm;
    const fx = clamp(x / cs - 0.5, 0, G - 1.001), fy = clamp(y / cs - 0.5, 0, G - 1.001);
    const ix = fx | 0, iy = fy | 0, tx = fx - ix, ty = fy - iy, c = iy * G + ix;
    return (hm[c] * (1 - tx) + hm[c + 1] * tx) * (1 - ty) + (hm[c + G] * (1 - tx) + hm[c + G + 1] * tx) * ty;
  }
  beltAt(s, d) {
    for (const b of this.belts) {
      if (this.sDelta(s, b.s) < b.len) { for (const ln of b.lanes) if (d >= ln.d0 && d < ln.d1) return ln.v; return 0; }
    }
    return 0;
  }
  zoneAt(s) { for (const z of this.zones) if (this.sDelta(s, z.s) < z.len) return z.kind; return null; }
  glideAt(s) { for (const g of this.glides) if (this.sDelta(s, g.s) < g.len) return g; return null; }
  windAt(s, t) {
    for (const w of this.winds) {
      const ds = this.sDelta(s, w.s);
      if (ds < w.len) {
        const edge = clamp(Math.min(ds, w.len - ds) / 60, 0, 1);
        return w.force * edge * Math.sin(t * 0.9 + w.ph) * (this.mirror ? -1 : 1);
      }
    }
    return 0;
  }
  // 0:道 1:縁石 2:オフロード 3:氷
  surfaceAt(s, d) {
    const ad = Math.abs(d);
    if (ad <= this.halfRoad) return this.inIce(s, d) ? 3 : 0;
    if (ad <= this.halfRoad + this.curb) return 1;
    // ショートカット台へ続く隠し通路は減速しない
    for (const sc of this.shortcuts) { const ds = this.sSigned(s, sc.s); if (ds > -90 && ds < 16 && Math.abs(d - sc.d) < 11) return 1; }
    return 2;
  }
  maxCurv(s, dist) {
    const i0 = this.idxOf(s), n = Math.max(1, Math.ceil(dist / this.step));
    let m = 0;
    for (let j = 0; j < n; j++) {
      const i = (i0 + j) % this.N;
      const a = Math.abs(this.K[i] + this.K[(i + 1) % this.N] + this.K[(i + 2) % this.N]) / (3 * this.step);
      if (a > m) m = a;
    }
    return m;
  }
  curvAhead(s, dist) {
    const i0 = this.idxOf(s), n = Math.max(1, Math.round(dist / this.step));
    let sum = 0;
    for (let k = 0; k < n; k++) sum += this.K[(i0 + k) % this.N];
    return sum;
  }
  inSkipExact(s) { for (const r of this.skipRanges) if (s >= r.s && s <= r.e) return true; return false; }
  inSkip(s) { for (const r of this.skipRanges) if (s >= r.s - 30 && s <= r.e + 10) return true; return false; }
  nearTrack(x, y, minD) {
    const m2 = minD * minD;
    for (let i = 0; i < this.N; i += 2) {
      if (this.skip[i]) continue; const dx = x - this.X[i], dy = y - this.Y[i]; if (dx * dx + dy * dy < m2) return true; }
    return false;
  }
  nearFeature(s, pad) {
    if (this.sDelta(s, this.len - 150) < 190) return true;
    for (const r of this.itemRows) if (Math.abs(this.sSigned(s, r)) < pad) return true;
    for (const g of this.gaps) if (Math.abs(this.sSigned(s, g.s + g.len / 2)) < pad + 30) return true;
    for (const g of this.glides) if (this.sDelta(s, g.s - 40) < g.len + 80) return true;
    for (const b of this.bumpers) if (Math.abs(this.sSigned(s, b.s)) < pad) return true;
    for (const sc of this.shortcuts) if (Math.abs(this.sSigned(s, sc.s)) < pad + 20) return true;
    for (const mv of this.movers) if (Math.abs(this.sSigned(s, mv.s)) < pad) return true;
    return false;
  }
  placeDeco() {
    const th = this.theme, R = this.rnd, L = this.len;
    this.deco = []; this.solids = []; this.islands = [];
    const pick = (list) => {
      let tot = 0; list.forEach((e) => { tot += e[1]; });
      let r = R() * tot;
      for (const e of list) { r -= e[1]; if (r <= 0) return e[0]; }
      return list[0][0];
    };
    if (th.wallDeco) {
      const p = {};
      for (let s = 0; s < L; s += th.wallGap) {
        for (const side of [-1, 1]) {
          if (this.inSkip(s)) continue;
          this.pointAt(s + (side > 0 ? th.wallGap / 2 : 0), side * (this.limit + th.wallOff), p);
          if (this.nearTrack(p.x, p.y, this.limit + th.wallOff - 1)) continue;
          this.deco.push({ t: th.wallDeco, x: p.x, y: p.y, ph: R() * 10 });
          if (th.islands && th.wallDeco === 'torch') this.islands.push({ x: p.x, y: p.y, r: 6 });
        }
      }
    }
    const count = Math.round(L / 11);
    const secScenery = (s) => {
      const f = s / L, sc = this.def.scenery;
      if (!sc) return th.scenery;
      let cur = sc[0][1];
      for (const e of sc) if (f >= e[0]) cur = e[1];
      return cur;
    };
    for (let i = 0; i < count; i++) {
      const s = R() * L, side = R() < 0.5 ? -1 : 1;
      if (this.inSkip(s)) continue;
      const dist = this.limit + th.sceneryMin + R() * th.sceneryRange;
      const p = this.pointAt(s, side * dist);
      if (p.x < -120 || p.y < -120 || p.x > this.size + 120 || p.y > this.size + 120) continue;
      if (this.nearTrack(p.x, p.y, this.limit + th.sceneryMin - 4)) continue;
      if (this.hasElev && this.hXY(p.x, p.y) < this.heightAt(s) - 8) continue; // 川・谷の中には置かない
      const t = pick(secScenery(s));
      this.deco.push({ t, x: p.x, y: p.y, ph: R() * 10 });
      if (th.islands) this.islands.push({ x: p.x, y: p.y, r: t === 'tower' ? 22 : 9 + R() * 8 });
    }
    const pc = Math.round(L / 170);
    for (let i = 0; i < pc; i++) {
      const s = R() * L;
      if (this.nearFeature(s, 45) || this.inSkip(s)) continue;
      const side = R() < 0.5 ? -1 : 1;
      const d = side * (this.halfRoad + this.curb + 9 + R() * (this.def.offW - 16));
      const p = this.pointAt(s, d);
      const t = pick(th.props);
      this.deco.push({ t, x: p.x, y: p.y, ph: R() * 10 });
      if (t !== 'crab') this.solids.push({ x: p.x, y: p.y, r: 3.2, s });
    }
    this.bumpers.forEach((b) => {
      this.deco.push({ t: 'bumper', x: b.x, y: b.y, ph: 0, bumper: b });
      this.solids.push({ x: b.x, y: b.y, r: b.r, s: b.s, bumper: b });
    });
    if (this.hasElev) this.deco.forEach((d) => { d.h = this.hXY(d.x, d.y); });
  }
  buildTexture() {
    const th = this.theme;
    const SZ = this.size;
    const c = workCanvas(SZ, SZ), g = c.getContext('2d');
    const pat = (name) => g.createPattern(materialTile(name), 'repeat');
    g.fillStyle = pat(th.outer); g.fillRect(0, 0, SZ, SZ);
    g.lineJoin = 'round'; g.lineCap = 'round';
    const tracePath = () => {
      g.beginPath();
      if (!this.skipRanges.length) {
        g.moveTo(this.X[0], this.Y[0]);
        for (let i = 1; i < this.N; i++) g.lineTo(this.X[i], this.Y[i]);
        g.closePath();
        return;
      }
      let pen = false;
      for (let i = 0; i <= this.N; i++) {
        const j = i % this.N;
        if (this.skip[j]) { pen = false; continue; }
        if (!pen) { g.moveTo(this.X[j], this.Y[j]); pen = true; } else g.lineTo(this.X[j], this.Y[j]);
      }
    };
    const stroke = (w, style, dash) => { g.lineWidth = w; g.strokeStyle = style; g.setLineDash(dash || []); tracePath(); g.stroke(); g.setLineDash([]); };
    // 島（ビーチ・溶岩）
    if (th.islands) {
      const ip = pat(th.islands);
      this.islands.forEach((is) => {
        g.fillStyle = 'rgba(0,0,0,0.25)'; g.beginPath(); g.arc(is.x + 2, is.y + 2, is.r + 2, 0, TAU); g.fill();
        g.fillStyle = ip; g.beginPath(); g.arc(is.x, is.y, is.r, 0, TAU); g.fill();
      });
      stroke(2 * this.limit + 8, th.islandEdge || (th.outer === 'water' ? '#f8e7b4' : '#2a1a24'));
    }
    if (this.boundary === 'wall') stroke(2 * this.limit + 8, th.wall);
    stroke(2 * this.limit, pat(th.off));
    if (this.river) {
      const rv = this.river;
      const trace = () => { g.beginPath(); rv.forEach((q, i) => { if (i === 0) g.moveTo(q[0], q[1]); else g.lineTo(q[0], q[1]); }); };
      g.lineWidth = 46; g.strokeStyle = '#c9b27a'; g.setLineDash([]); trace(); g.stroke();
      g.lineWidth = 34; g.strokeStyle = pat('water'); trace(); g.stroke();
      if (this.lake) {
        const lk = this.lake;
        g.fillStyle = '#c9b27a'; g.beginPath(); g.arc(lk.x, lk.y, lk.r + 6, 0, TAU); g.fill();
        g.fillStyle = pat('water'); g.beginPath(); g.arc(lk.x, lk.y, lk.r, 0, TAU); g.fill();
      }
    }
    const cw = 2 * (this.halfRoad + this.curb);
    stroke(cw, th.curbA);
    if (th.rainbow) {
      const RB = ['#ff4f6d', '#ff9d1f', '#ffe14d', '#5dff9a', '#38d6ff', '#9a6aff'];
      RB.forEach((col, i) => { g.lineDashOffset = -i * 8; stroke(cw, col, [8, 40]); });
      g.lineDashOffset = 0;
    } else stroke(cw, th.curbB, [8, 8]);
    stroke(2 * this.halfRoad, pat(th.road));
    // 白線
    const traceOffset = (d, s0, len) => {
      const q = {};
      const n = Math.max(2, Math.ceil(len / this.step));
      g.beginPath();
      let pen = false;
      for (let k = 0; k <= n; k++) {
        const ss = s0 + (k / n) * len;
        if (this.skipRanges.length && this.inSkipExact(((ss % this.len) + this.len) % this.len)) { pen = false; continue; }
        this.pointAt(ss, d, q);
        if (!pen) { g.moveTo(q.x, q.y); pen = true; } else g.lineTo(q.x, q.y);
      }
    };
    g.lineWidth = 1.6; g.strokeStyle = th.edge;
    traceOffset(this.halfRoad - 2.5, 0, this.len); g.stroke();
    traceOffset(-(this.halfRoad - 2.5), 0, this.len); g.stroke();
    if (th.center) { g.setLineDash([10, 14]); g.lineWidth = 1.6; g.strokeStyle = th.center; tracePath(); g.stroke(); g.setLineDash([]); }
    // 帯状の領域
    const fillStrip = (s0, len, d0, d1) => {
      const q = {};
      const n = Math.max(2, Math.ceil(len / 2));
      g.beginPath();
      for (let k = 0; k <= n; k++) { this.pointAt(s0 + (k / n) * len, d0, q); if (k === 0) g.moveTo(q.x, q.y); else g.lineTo(q.x, q.y); }
      for (let k = n; k >= 0; k--) { this.pointAt(s0 + (k / n) * len, d1, q); g.lineTo(q.x, q.y); }
      g.closePath();
      g.fill();
    };
    this.ice.forEach((ic) => { g.fillStyle = pat('ice'); fillStrip(ic.s, ic.len, -this.halfRoad, this.halfRoad); });
    // 落下ゾーン（ギャップ）
    this.gaps.forEach((gp) => {
      g.fillStyle = pat(th.outer);
      fillStrip(gp.s, gp.len, -this.limit - 14, this.limit + 14);
      g.lineWidth = 3; g.strokeStyle = th.outer === 'water' ? '#f8e7b4' : '#1a1016';
      [gp.s, gp.s + gp.len].forEach((s) => {
        const a = this.pointAt(s, -this.limit - 14), b = this.pointAt(s, this.limit + 14);
        g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
      });
    });
    // 水中ゾーン／無重力ゾーン
    this.zones.forEach((z) => {
      if (z.kind === 'water') {
        g.fillStyle = pat(th.waterOff || 'reefOff'); fillStrip(z.s, z.len, -this.limit, this.limit);
        g.fillStyle = pat(th.waterRoad || 'seabed'); fillStrip(z.s, z.len, -this.halfRoad, this.halfRoad);
        g.lineWidth = 1.6; g.strokeStyle = th.waterEdge || '#7ff0ff'; g.setLineDash([6, 6]);
        traceOffset(this.halfRoad - 2.5, z.s, z.len); g.stroke();
        traceOffset(-(this.halfRoad - 2.5), z.s, z.len); g.stroke();
        g.setLineDash([]);
      } else {
        g.lineWidth = 2; g.strokeStyle = '#ff5fd2'; g.setLineDash([4, 10]);
        traceOffset(this.halfRoad - 2.5, z.s, z.len); g.stroke();
        traceOffset(-(this.halfRoad - 2.5), z.s, z.len); g.stroke();
        g.strokeStyle = '#38d6ff'; traceOffset(0, z.s, z.len); g.stroke();
        g.setLineDash([]);
      }
    });
    // 滑空区間（下は谷）
    this.glides.forEach((gl) => {
      g.fillStyle = pat(th.chasm || th.outer);
      fillStrip(gl.s, gl.len, -this.limit - 14, this.limit + 14);
      g.lineWidth = 3; g.strokeStyle = th.islandEdge || '#6a5a8a';
      [gl.s, gl.s + gl.len].forEach((s) => {
        const a = this.pointAt(s, -this.limit - 14), b = this.pointAt(s, this.limit + 14);
        g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
      });
    });
    // ベルトコンベア
    this.belts.forEach((b) => {
      g.fillStyle = '#2e2a36'; fillStrip(b.s, b.len, -this.halfRoad, this.halfRoad);
      g.lineWidth = 1; g.strokeStyle = '#403a4a';
      for (let k = 0; k < b.len; k += 5) {
        const a = this.pointAt(b.s + k, -this.halfRoad + 1), c = this.pointAt(b.s + k, this.halfRoad - 1);
        g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(c.x, c.y); g.stroke();
      }
      const edges = new Set([-this.halfRoad + 1, this.halfRoad - 1]);
      b.lanes.forEach((ln) => { if (ln.d0 > -this.halfRoad + 1) edges.add(ln.d0); });
      edges.forEach((d) => {
        g.lineWidth = 2.5; g.strokeStyle = '#ffd23f'; g.setLineDash([]); traceOffset(d, b.s, b.len); g.stroke();
        g.strokeStyle = '#1b1440'; g.setLineDash([5, 5]); traceOffset(d, b.s, b.len); g.stroke(); g.setLineDash([]);
      });
    });
    // 溶岩だまり
    this.pools.forEach((pl) => {
      const p = this.pointAt(pl.s, pl.d);
      g.fillStyle = '#1a1016'; g.beginPath(); g.arc(p.x, p.y, pl.r + 2, 0, TAU); g.fill();
      g.fillStyle = pat(th.outer); g.beginPath(); g.arc(p.x, p.y, pl.r, 0, TAU); g.fill();
    });
    // ローカル座標で描く
    const local = (s, d, fn) => {
      const p = this.pointAt(s, d);
      g.save(); g.translate(p.x, p.y); g.rotate(p.a); fn(); g.restore();
    };
    this.boosts.forEach((b) => local(b.s + b.len / 2, b.d, () => {
      g.fillStyle = '#3a2a10'; g.fillRect(-b.len / 2 - 1, -b.w / 2 - 1, b.len + 2, b.w + 2);
      g.fillStyle = '#ff9d1f'; g.fillRect(-b.len / 2, -b.w / 2, b.len, b.w);
      for (let k = 0; k < 3; k++) {
        const x0 = -b.len / 2 + 2 + k * 5.5;
        g.fillStyle = k === 1 ? '#fff6a0' : '#ffe14d';
        g.beginPath(); g.moveTo(x0, -b.w / 2 + 2); g.lineTo(x0 + 4, 0); g.lineTo(x0, b.w / 2 - 2); g.lineTo(x0 + 2, b.w / 2 - 2); g.lineTo(x0 + 6, 0); g.lineTo(x0 + 2, -b.w / 2 + 2); g.closePath(); g.fill();
      }
    }));
    this.ramps.forEach((r) => local(r.s + r.len / 2, r.d, () => {
      g.fillStyle = r.glide ? '#10204a' : '#2a1a10'; g.fillRect(-r.len / 2 - 1, -r.w / 2 - 1, r.len + 2, r.w + 2);
      const ca = r.glide ? '#38a6ff' : '#c98a3a', cb = r.glide ? '#7fd6ff' : '#e8b35a';
      for (let k = 0; k < r.len; k += 3) { g.fillStyle = (k / 3) % 2 ? ca : cb; g.fillRect(-r.len / 2 + k, -r.w / 2, Math.min(3, r.len - k), r.w); }
      g.fillStyle = r.glide ? '#ff5fd2' : '#ffe14d';
      for (let yy = -r.w / 2 + 4; yy < r.w / 2 - 3; yy += 9) { g.beginPath(); g.moveTo(-3, yy); g.lineTo(3, yy + 2.5); g.lineTo(-3, yy + 5); g.closePath(); g.fill(); }
    }));
    // 大砲の発射台
    this.cannons.forEach((cn) => local(cn.s - 9, 0, () => {
      const w = this.def.roadW + this.curb * 2;
      g.fillStyle = '#1b1440'; g.fillRect(-10, -w / 2, 20, w);
      g.fillStyle = '#c9384a'; g.fillRect(-8, -w / 2 + 2, 16, w - 4);
      g.fillStyle = '#ffd23f';
      for (let yy = -w / 2 + 6; yy < w / 2 - 6; yy += 12) { g.beginPath(); g.moveTo(-5, yy); g.lineTo(5, yy + 4); g.lineTo(-5, yy + 8); g.closePath(); g.fill(); }
      g.strokeStyle = '#ffffff'; g.lineWidth = 1.5; g.strokeRect(-8, -w / 2 + 2, 16, w - 4);
    }));
    // ショートカット台（紫）と、そこへ続く隠し通路
    this.shortcuts.forEach((sc) => {
      g.fillStyle = pat('metal');
      fillStrip(sc.s - 90, 104, sc.d - 10, sc.d + 10);
      g.lineWidth = 1.5; g.strokeStyle = '#b98aff'; g.setLineDash([4, 6]);
      traceOffset(sc.d - 10, sc.s - 90, 104); g.stroke(); traceOffset(sc.d + 10, sc.s - 90, 104); g.stroke();
      g.setLineDash([]);
    });
    this.shortcuts.forEach((sc) => local(sc.s + 7, sc.d, () => {
      g.fillStyle = '#1b1440'; g.fillRect(-8, -10, 16, 20);
      for (let k = 0; k < 14; k += 3) { g.fillStyle = (k / 3) % 2 ? '#8a4dff' : '#b98aff'; g.fillRect(-7 + k, -9, Math.min(3, 14 - k), 18); }
      g.fillStyle = '#ffffff'; g.fillRect(-1, -5, 2, 6); g.fillRect(-1, 3, 2, 2);
    }));
    // スタートライン
    local(3, 0, () => {
      const w = this.def.roadW, sz = 4;
      for (let yy = 0; yy < w / sz; yy++) for (let xx = 0; xx < 2; xx++) {
        g.fillStyle = (xx + yy) % 2 ? '#1d1b24' : '#ffffff';
        g.fillRect(-4 + xx * sz, -w / 2 + yy * sz, sz, sz);
      }
    });
    for (let i = 0; i < 8; i++) {
      const gp = this.gridPos(i);
      local(gp.s, gp.d, () => {
        g.fillStyle = 'rgba(255,255,255,0.85)';
        g.fillRect(4, -6, 1.5, 12); g.fillRect(1, -6, 4, 1.5); g.fillRect(1, 4.5, 4, 1.5);
      });
    }
    const id = g.getImageData(0, 0, SZ, SZ);
    if (this.hasElev) this.tintTerrain(id.data);
    this.tex = buildMips(new Uint32Array(id.data.buffer), SZ, 4);
    const tc = materialTile(th.outer);
    const tid = tc.getContext('2d').getImageData(0, 0, 64, 64);
    this.tile = buildMips(new Uint32Array(tid.data.buffer.slice(0)), 64, 4);
    this.fogRgb = hexRgb(th.fog);
  }
  gridPos(i) {
    return { s: this.len - (16 + i * 12), d: (i % 2 === 0 ? -1 : 1) * this.halfRoad * 0.42 };
  }
  buildSky() {
    const th = this.theme, R = mulberry32(hashStr(this.def.id + 'sky'));
    const SW = 1536, SH = 128, buf = new Uint32Array(SW * SH);
    const cols = th.sky.map(hexRgb);
    const set = (x, y, c) => { if (y < 0 || y >= SH) return; x = ((Math.round(x) % SW) + SW) % SW; buf[y * SW + x] = pack(c[0], c[1], c[2]); };
    for (let y = 0; y < SH; y++) {
      const f = (y / (SH - 1)) * (cols.length - 1);
      const i = Math.min(cols.length - 2, Math.floor(f)), fr = f - i;
      for (let x = 0; x < SW; x++) {
        const tt = (BAYER[(y & 3) * 4 + (x & 3)] + 0.5) / 16;
        const c = fr > tt ? cols[i + 1] : cols[i];
        buf[y * SW + x] = pack(c[0], c[1], c[2]);
      }
    }
    // 星・太陽・月
    if (th.night) {
      for (let i = 0; i < 260; i++) set(R() * SW, Math.floor(R() * 80), R() < 0.2 ? [255, 240, 200] : [200, 190, 255]);
      const mx = SW * 0.3, my = 26;
      for (let y = -9; y <= 9; y++) for (let x = -9; x <= 9; x++) if (x * x + y * y <= 81 && !((x - 4) ** 2 + (y + 2) ** 2 <= 64)) set(mx + x, my + y, [255, 236, 200]);
    } else {
      const sx = SW * 0.72, sy = 34, sun = hexRgb(th.sun);
      for (let y = -14; y <= 14; y++) for (let x = -14; x <= 14; x++) {
        const d2 = x * x + y * y;
        if (d2 <= 100) set(sx + x, sy + y, sun);
        else if (d2 <= 196 && (x + y) % 2 === 0) set(sx + x, sy + y, mixRgb(sun, cols[1], 0.5));
      }
      // 雲
      for (let k = 0; k < 16; k++) {
        const cx = R() * SW, cy = 12 + R() * 46, w = 14 + R() * 30, h = 4 + R() * 6;
        for (let p = 0; p < 5; p++) {
          const px = cx + (R() - 0.5) * w, py = cy + (R() - 0.5) * h, rr = 3 + R() * h;
          for (let y = -rr; y <= rr; y++) for (let x = -rr * 1.6; x <= rr * 1.6; x++) {
            if ((x / 1.6) ** 2 + y * y <= rr * rr) set(px + x, Math.round(py + y), y > rr * 0.35 ? [220, 234, 252] : [255, 255, 255]);
          }
        }
      }
    }
    const wave = (x, seed, amp, freqs) => {
      let h = 0; const r2 = mulberry32(seed);
      freqs.forEach((f) => { h += Math.sin((x / SW) * TAU * f + r2() * TAU) * amp / freqs.length; });
      return h;
    };
    const jag = (x, f, ph) => { const t = ((x / SW) * f + ph) % 1; return Math.abs(t * 2 - 1); };
    const fill = (x, top, col, capCol, capH) => {
      for (let y = Math.max(0, Math.round(top)); y < SH; y++) set(x, y, capCol && y < top + capH ? capCol : col);
    };
    for (let x = 0; x < SW; x++) {
      if (th.hills === 'green') {
        fill(x, 70 + wave(x, 11, 40, [3, 7, 13]), [110, 150, 210], [200, 220, 245], 3);
        fill(x, 98 + wave(x, 12, 18, [5, 11, 17]), [64, 140, 76]);
        fill(x, 112 + wave(x, 13, 8, [9, 23]), [48, 116, 60]);
      } else if (th.hills === 'sea') {
        fill(x, 84 + wave(x, 21, 30, [2, 5, 9]) + (jag(x, 3, 0.2) > 0.3 ? 30 : 0), [70, 140, 120]);
        fill(x, 108, [30, 120, 200]);
        for (let y = 108; y < SH; y++) if ((x * 7 + y * 13) % 23 === 0) set(x, y, [170, 230, 255]);
      } else if (th.hills === 'snow') {
        const h1 = 58 + jag(x, 9, 0.1) * 30 + wave(x, 31, 10, [4, 13]);
        fill(x, h1, [120, 140, 180], [250, 252, 255], 8);
        const h2 = 86 + jag(x, 17, 0.4) * 16 + wave(x, 32, 6, [7]);
        fill(x, h2, [90, 112, 150], [236, 244, 255], 5);
        fill(x, 112 + wave(x, 33, 6, [11, 19]), [220, 232, 248]);
      } else if (th.hills === 'volcano') {
        const vx = SW * 0.62, dx = Math.abs(((x - vx + SW * 1.5) % SW) - SW / 2);
        const vt = dx < 26 ? 40 + (dx < 12 ? 0 : (dx - 12) * 0.2) : 40 + (dx - 26) * 0.55;
        fill(x, Math.min(118, vt + wave(x, 41, 4, [23])), [42, 18, 40]);
        if (dx < 12) for (let y = 40; y < 46; y++) set(x, y, [255, 120 + y, 40]);
        fill(x, 96 + wave(x, 42, 10, [6, 15]) + jag(x, 21, 0.3) * 8, [26, 12, 28]);
      }
    }
    // ---- 新テーマの遠景 ----
    if (th.hills === 'clouds') {
      // 遠くの浮島
      for (let k = 0; k < 7; k++) {
        const cx = R() * SW, cy = 58 + R() * 30, w = 16 + R() * 26;
        for (let x = -w; x <= w; x++) {
          const top = cy - Math.sqrt(Math.max(0, 1 - (x / w) ** 2)) * 5;
          const bot = cy + Math.sqrt(Math.max(0, 1 - (x / w) ** 2)) * w * 0.55;
          for (let y = Math.round(top); y < bot; y++) set(cx + x, y, y < top + 2 ? [120, 200, 110] : y < top + 4 ? [96, 170, 90] : [150, 120, 96]);
        }
        set(cx, cy - 7, [255, 150, 200]); set(cx + 1, cy - 7, [255, 150, 200]); set(cx, cy - 6, [110, 80, 60]);
      }
      // 雲海
      for (let x = 0; x < SW; x++) {
        const top = 100 + wave(x, 51, 8, [9, 17, 31]) + Math.abs(Math.sin(x / 11)) * -3;
        fill(x, top, [255, 255, 255]);
        for (let y = Math.round(top) + 5; y < SH; y++) if (((x >> 1) + y) % 7 === 0) set(x, y, [226, 238, 255]);
      }
    } else if (th.hills === 'city') {
      for (let layer = 0; layer < 2; layer++) {
        let x = 0;
        const col = layer ? [24, 14, 44] : [40, 24, 70];
        while (x < SW) {
          const w = 10 + Math.floor(R() * 22), h = (layer ? 26 : 44) + Math.floor(R() * (layer ? 30 : 40));
          const top = SH - 8 - h + layer * 14;
          for (let xx = x; xx < x + w; xx++) fill(xx, top, col);
          for (let yy = top + 3; yy < SH - 4; yy += 4) for (let xx = x + 2; xx < x + w - 2; xx += 3) if (R() < 0.35) set(xx, yy, R() < 0.2 ? [255, 95, 210] : layer ? [255, 214, 120] : [140, 220, 255]);
          if (!layer && R() < 0.3) { set(x + (w >> 1), top - 1, [255, 61, 127]); set(x + (w >> 1), top - 2, [255, 61, 127]); }
          x += w + Math.floor(R() * 3);
        }
      }
    } else if (th.hills === 'space') {
      // 星雲
      for (let k = 0; k < 900; k++) {
        const x = R() * SW, y = 20 + R() * 70;
        const v = Math.sin(x / SW * TAU * 3) * 20 + 55;
        if (Math.abs(y - v) < 18 * R()) set(x, y, R() < 0.5 ? [90, 40, 140] : [60, 30, 110]);
      }
      // 大きな惑星
      const px = SW * 0.2, py = 60;
      for (let y = -22; y <= 22; y++) for (let x = -22; x <= 22; x++) {
        const d2 = x * x + y * y;
        if (d2 <= 484) set(px + x, py + y, (y + x * 0.3) % 6 < 3 ? [230, 140, 90] : [200, 110, 70]);
      }
      for (let x = -40; x <= 40; x++) { const y = Math.round(x * -0.18); if (Math.abs(x) > 18) { set(px + x, py + y, [255, 220, 150]); set(px + x, py + y + 1, [200, 170, 110]); } }
      // 小さな惑星
      const qx = SW * 0.75, qy = 40;
      for (let y = -8; y <= 8; y++) for (let x = -8; x <= 8; x++) if (x * x + y * y <= 64) set(qx + x, qy + y, x + y < 0 ? [120, 220, 255] : [60, 140, 220]);
      for (let i = 0; i < 160; i++) set(R() * SW, 90 + Math.floor(R() * 38), [255, 255, 255]);
    }
    if (th.hills === 'ridge') {
      // 夕焼けの山並みと、遠くの要塞のシルエット
      for (let x = 0; x < SW; x++) {
        fill(x, 64 + jag(x, 7, 0.2) * 26 + wave(x, 61, 10, [5, 13]), [120, 64, 104]);
        fill(x, 90 + jag(x, 13, 0.6) * 14 + wave(x, 62, 6, [9, 21]), [78, 40, 82]);
      }
      for (let k = 0; k < 6; k++) {
        const bx = Math.floor(R() * SW), bw = 10 + Math.floor(R() * 14), bh = 20 + Math.floor(R() * 24), base = 96;
        for (let x = bx; x < bx + bw; x++) fill(x, base - bh, [58, 30, 64]);
        for (let x = bx - 2; x < bx + bw + 2; x += 3) for (let y = base - bh - 4; y < base - bh; y++) set(x, y, [58, 30, 64]);
        for (let y = base - bh + 5; y < base - 4; y += 6) set(bx + (bw >> 1), y, [255, 200, 110]);
        set(bx + (bw >> 1), base - bh - 5, [201, 56, 74]); set(bx + (bw >> 1) + 1, base - bh - 5, [201, 56, 74]);
      }
    }
    if (th.hills === 'volcano') {
      for (let k = 0; k < 40; k++) {
        const px = SW * 0.62 + (R() - 0.5) * 40 + k * 0.5, py = 38 - k * 0.9, rr = 2 + k * 0.18;
        for (let y = -rr; y <= rr; y++) for (let x = -rr; x <= rr; x++) if (x * x + y * y <= rr * rr && ((x + y + k) & 1)) set(px + x, Math.round(py + y), [70, 40, 60]);
      }
    }
    this.sky = { w: SW, h: SH, buf, top: buf[0] };
  }
  buildMinimap() {
    let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
    for (let i = 0; i < this.N; i++) { minX = Math.min(minX, this.X[i]); maxX = Math.max(maxX, this.X[i]); minY = Math.min(minY, this.Y[i]); maxY = Math.max(maxY, this.Y[i]); }
    const size = 128, pad = 12;
    const sc = (size - pad * 2) / Math.max(maxX - minX, maxY - minY);
    const ox = (size - (maxX - minX) * sc) / 2 - minX * sc, oy = (size - (maxY - minY) * sc) / 2 - minY * sc;
    this.mini = { sc, ox, oy, size };
    const c = makeCanvas(size, size), g = c.getContext('2d');
    g.lineJoin = 'round'; g.lineCap = 'round';
    const trace = () => {
      g.beginPath();
      let pen = false;
      for (let i = 0; i <= this.N; i += 2) {
        const j = i % this.N;
        if (this.skip[j]) { pen = false; continue; }
        const x = this.X[j] * sc + ox, y = this.Y[j] * sc + oy;
        if (!pen) { g.moveTo(x, y); pen = true; } else g.lineTo(x, y);
      }
      if (!this.skipRanges.length) g.closePath();
    };
    g.strokeStyle = 'rgba(10,6,24,0.85)'; g.lineWidth = 9; trace(); g.stroke();
    g.strokeStyle = this.theme.miniOut; g.lineWidth = 7; trace(); g.stroke();
    g.strokeStyle = this.theme.mini; g.lineWidth = 4; trace(); g.stroke();
    if (this.skipRanges.length) {
      g.setLineDash([3, 4]); g.strokeStyle = '#ffd23f'; g.lineWidth = 2;
      this.skipRanges.forEach((r) => { const a0 = this.pointAt(r.s, 0), a1 = this.pointAt(r.e, 0); g.beginPath(); g.moveTo(a0.x * sc + ox, a0.y * sc + oy); g.lineTo(a1.x * sc + ox, a1.y * sc + oy); g.stroke(); });
      g.setLineDash([]);
    }
    const a = this.pointAt(0, -this.halfRoad * 1.4), b = this.pointAt(0, this.halfRoad * 1.4);
    g.strokeStyle = '#ff3d7f'; g.lineWidth = 3; g.beginPath(); g.moveTo(a.x * sc + ox, a.y * sc + oy); g.lineTo(b.x * sc + ox, b.y * sc + oy); g.stroke();
    this.miniCanvas = c;
  }
}
const trackCache = new Map();
const miniCache = new Map();
function getMiniTrack(ci) {
  for (const [k, t] of trackCache) if (k === String(ci) || k === ci + '') return t;
  if (!miniCache.has(ci)) miniCache.set(ci, new Track(COURSES[ci], false, true));
  return miniCache.get(ci);
}
function getTrack(ci, mirror) {
  const key = ci + (mirror ? 'm' : '');
  if (trackCache.has(key)) { const t = trackCache.get(key); trackCache.delete(key); trackCache.set(key, t); return t; }
  const t = new Track(COURSES[ci], mirror);
  trackCache.set(key, t);
  while (trackCache.size > 3) trackCache.delete(trackCache.keys().next().value);
  return t;
}

/* =========================================================
   8. カート（物理・ドリフト・アイテム）
   ========================================================= */
const DRIFT_COLS = ['#fff2b0', '#38c8ff', '#ff9d1f', '#d05cff'];
class Kart {
  constructor(race, ci, slot, isPlayer) {
    this.race = race; this.ci = ci; this.ch = CHARS[ci]; this.isPlayer = isPlayer;
    const cls = CLASSES[race.cfg.cls], st = this.ch.stats;
    this.maxSpeed = cls.speed * (0.955 + 0.015 * st.spd);
    this.accelRate = 72 + 14 * st.acc;
    this.turnRate = 2.1 + 0.12 * st.hdl;
    this.weight = 0.7 + 0.15 * st.wgt;
    const T = race.track, gp = T.gridPos(slot), p = T.pointAt(gp.s, gp.d);
    this.x = p.x; this.y = p.y; this.a = p.a;
    this.vx = 0; this.vy = 0; this.speed = 0; this.z = 0; this.vz = 0; this.angVel = 0;
    this.ti = T.idxOf(gp.s); this.s = gp.s; this.d = gp.d; this.prevS = gp.s;
    this.progress = gp.s - T.len;
    this.lapsDone = 0; this.lapStart = 0; this.lapTimes = []; this.finished = false; this.finishTime = 0; this.finishRank = 0; this.place = slot + 1;
    this.drift = 0; this.driftCharge = 0; this.driftLevel = 0; this.hopDir = 0;
    this.boostT = 0; this.boostMul = 1; this.spinT = 0; this.spinA = 0; this.stunT = 0; this.shieldT = 0; this.invulnT = 0;
    this.fallT = 0; this.airType = 0; this.airT = 0; this.trick = false; this.trickA = 0;
    this.item = null; this.itemCount = 0; this.rouletteT = 0; this.rouletteItem = null;
    this.lastSafeS = gp.s; this.wrongT = 0; this.surf = 0; this.bumpCD = 0; this.steerVis = 0;
    this.zone = null; this.glideRef = null; this.bumpT = 0; this.ringCD = 0; this.prevShake = false; this.inWind = false;
    this.gh = T.heightAt(gp.s); this.fly = null;
    this.inp = { steer: 0, accel: false, brake: false, drift: false, item: false };
    this.prevDrift = false; this.prevItem = false;
    this.ai = isPlayer ? null : new AI(this, race.demo ? 0.7 : cls.aiDrift);
  }
  speedMul() { return this.ai ? this.ai.speedMul : 1; }
  near() { const c = this.race.cam; return (this.x - c.x) ** 2 + (this.y - c.y) ** 2 < 420 * 420; }
  sfx(name, opt) { if (this.isPlayer && !this.race.demo) AudioSys.sfx(name, opt); }
  boost(t, mul) {
    this.boostT = Math.max(this.boostT, t);
    this.boostMul = mul;
    this.speed = Math.max(this.speed, this.maxSpeed);
  }
  startDrift(dir) { this.drift = dir; this.driftCharge = 0; this.driftLevel = 0; }
  endDrift(release) {
    if (release && this.driftLevel > 0) {
      const lv = this.driftLevel;
      this.boost([0, 0.45, 0.95, 1.5][lv], 1.28 + 0.03 * lv);
      this.sfx('mini', { lv });
      if (this.near()) for (let i = 0; i < 10; i++) this.race.spawn(this.x, this.y, 3, (Math.random() - 0.5) * 60, (Math.random() - 0.5) * 60, 40 + Math.random() * 40, 0.4, DRIFT_COLS[lv], 1.2, 200);
    }
    this.drift = 0; this.driftCharge = 0; this.driftLevel = 0;
  }
  hit(kind) {
    if (this.shieldT > 0 || this.invulnT > 0 || this.fallT > 0) return false;
    this.spinT = kind === 'oil' ? 0.9 : 1.15;
    this.speed *= kind === 'oil' ? 0.5 : 0.3;
    this.drift = 0; this.driftCharge = 0; this.driftLevel = 0; this.boostT = 0;
    if (kind !== 'oil' && this.z <= 0) { this.vz = 70; this.z = 0.01; this.airType = 4; }
    this.invulnT = 1.6;
    this.sfx('hit');
    if (this.isPlayer) this.race.shake(0.8);
    if (this.near()) for (let i = 0; i < 12; i++) this.race.spawn(this.x, this.y, 5, (Math.random() - 0.5) * 80, (Math.random() - 0.5) * 80, 50 + Math.random() * 60, 0.6, ['#ffe14d', '#ffffff', '#ff5fd2'][i % 3], 1.3, 160);
    return true;
  }
  stun() {
    if (this.shieldT > 0 || this.fallT > 0) return false;
    this.stunT = 2.3; this.spinT = Math.max(this.spinT, 0.7); this.speed *= 0.5;
    this.drift = 0; this.driftCharge = 0; this.driftLevel = 0; this.boostT = 0;
    if (this.near()) for (let i = 0; i < 10; i++) this.race.spawn(this.x, this.y, 6, (Math.random() - 0.5) * 40, (Math.random() - 0.5) * 40, 30 + Math.random() * 40, 0.5, i % 2 ? '#ffe14d' : '#9f7bff', 1.2, 60);
    return true;
  }
  giveItemBox() {
    if (this.item || this.rouletteT > 0) return false;
    const R = this.race;
    const n = R.karts.length;
    const row = n > 1 ? Math.round(((this.place - 1) / (n - 1)) * 7) : 0;
    const w = ITEM_TABLE[clamp(row, 0, 7)];
    let tot = 0; w.forEach((v) => { tot += v; });
    let r = Math.random() * tot, pick = 'nitro';
    for (let i = 0; i < w.length; i++) { r -= w[i]; if (r <= 0) { pick = ITEM_KEYS[i]; break; } }
    if (pick === 'drone' && this.place === 1) pick = 'bullet';
    this.rouletteItem = pick;
    this.rouletteT = this.isPlayer ? 1.25 : 1.0;
    return true;
  }
  useItem(back) {
    if (this.rouletteT > 0 || !this.item) return;
    const R = this.race, it = this.item;
    switch (it) {
      case 'nitro': case 'nitro3': this.boost(1.35, 1.42); this.sfx('nitro'); break;
      case 'oil': R.addObj({ type: 'oil', x: this.x - Math.cos(this.a) * 11, y: this.y - Math.sin(this.a) * 11, z: 0, owner: this, life: 45 }); this.sfx('oil'); break;
      case 'bullet': R.fireBullet(this, back); this.sfx('bullet'); break;
      case 'drone': R.fireDrone(this); this.sfx('drone'); break;
      case 'shield': this.shieldT = 7; this.sfx('shield'); break;
      case 'emp': R.emp(this); break;
      default: break;
    }
    if (it === 'nitro3') { this.itemCount--; if (this.itemCount <= 0) { this.item = null; this.itemCount = 0; } }
    else { this.item = null; this.itemCount = 0; }
  }
  startFly(kind, toS, outMul) {
    const T = this.race.track;
    const p1 = T.pointAt(toS, 0);
    const h0 = T.heightAt(this.s) + Math.max(0, this.z), h1 = T.heightAt(toS);
    const dist = Math.hypot(p1.x - this.x, p1.y - this.y);
    const v = kind === 'cannon' ? 330 : Math.max(this.speed, 150);
    this.fly = {
      kind, x0: this.x, y0: this.y, x1: p1.x, y1: p1.y, h0, h1, a0: this.a, a1: p1.a,
      s0: this.s, ds: T.sDelta(toS, this.s), d0: this.d, t: 0, dur: Math.max(0.7, dist / v),
      arc: kind === 'cannon' ? 70 + dist * 0.12 : 24 + dist * 0.1, out: outMul,
    };
    this.airType = 6; this.z = 0.01; this.vz = 0; this.trick = false; this.airT = 0;
    this.drift = 0; this.driftCharge = 0; this.driftLevel = 0; this.boostT = 0; this.spinT = 0;
  }
  updateFly(dt) {
    const F = this.fly, T = this.race.track, R = this.race;
    F.t += dt;
    const u = Math.min(1, F.t / F.dur), e = u * u * (3 - 2 * u);
    this.x = lerp(F.x0, F.x1, u); this.y = lerp(F.y0, F.y1, u);
    this.a = wrapAngle(F.a0 + wrapAngle(F.a1 - F.a0) * e);
    const ns = (F.s0 + F.ds * u) % T.len;
    let ds = ns - this.prevS;
    if (ds < -T.len / 2) ds += T.len; else if (ds > T.len / 2) ds -= T.len;
    this.progress += ds; this.prevS = ns;
    this.s = ns; this.ti = T.idxOf(ns); this.d = F.d0 * (1 - u);
    const alt = lerp(F.h0, F.h1, u) + F.arc * 4 * u * (1 - u);
    this.gh = T.heightAt(ns); this.z = alt - this.gh;
    this.vx = (F.x1 - F.x0) / F.dur; this.vy = (F.y1 - F.y0) / F.dur;
    this.airT += dt;
    if (!this.finished) {
      const done = Math.floor(this.progress / T.len);
      if (done > this.lapsDone) { this.lapsDone = done; R.onLap(this); }
    }
    if (this.near() && Math.random() < 0.6) R.spawn(this.x, this.y, this.z, 0, 0, 0, 0.3, F.kind === 'cannon' ? '#ffb040' : '#b98aff', 1, 0);
    if (u >= 1) {
      this.fly = null; this.z = 0; this.vz = 0; this.airType = 2;
      T.locate(this);
      this.gh = T.heightAt(this.s); this.prevS = this.s; this.lastSafeS = this.s;
      this.speed = Math.max(this.speed, this.maxSpeed * F.out);
      this.vx = Math.cos(this.a) * this.speed; this.vy = Math.sin(this.a) * this.speed;
      this.land(this.speed);
      if (F.kind === 'cannon') this.boost(0.7, 1.28);
      if (this.isPlayer) R.shake(0.5);
    }
  }
  startFall() {
    const R = this.race;
    this.fallT = 1.1; this.airType = 0; this.z = 0; this.vz = 0;
    this.drift = 0; this.driftCharge = 0; this.driftLevel = 0; this.boostT = 0; this.speed = 0; this.vx = this.vy = 0;
    this.sfx('fall'); this.sfx('splash');
    const cols = R.track.theme.splash || ['#ffffff', '#cccccc'];
    if (this.near()) for (let i = 0; i < 18; i++) R.spawn(this.x, this.y, 1, (Math.random() - 0.5) * 70, (Math.random() - 0.5) * 70, 60 + Math.random() * 90, 0.8, cols[i % cols.length], 1.4, 260);
  }
  respawn() {
    const T = this.race.track;
    let s = this.lastSafeS - 10;
    for (const g of T.gaps.concat(T.glides)) { const ds = T.sSigned(s, g.s); if (ds > -140 && ds < g.len + 6) s = g.s + g.len + 16; }
    for (const cn of T.cannons) { const ds = T.sSigned(s, cn.s); if (ds > -60 && ds < T.sDelta(cn.to, cn.s) + 6) s = cn.to + 20; }
    for (let k = 0; k < 6 && T.isPit(s, 0); k++) s += 20;
    const p = T.pointAt(s, 0);
    this.x = p.x; this.y = p.y; this.a = p.a; this.ti = T.idxOf(s);
    this.z = 34; this.vz = 0; this.airType = 3; this.speed = 0; this.vx = this.vy = 0;
    this.invulnT = 2; this.spinT = 0; this.stunT = 0; this.fallT = 0; this.glideRef = null; this.bumpT = 0;
    this.gh = T.heightAt(s);
  }
  land(sp) {
    const t = this.airType, R = this.race;
    this.airType = 0; this.airT = 0;
    if (t === 1) {
      if (this.inp.drift && this.hopDir !== 0 && sp > 40 && this.spinT <= 0) this.startDrift(this.hopDir);
    } else if (t === 2 || t === 5) {
      this.glideRef = null;
      this.sfx('land');
      if (this.isPlayer) R.shake(0.25);
      if (this.near()) for (let i = 0; i < 8; i++) R.spawn(this.x, this.y, 1, (Math.random() - 0.5) * 50, (Math.random() - 0.5) * 50, 20 + Math.random() * 30, 0.5, R.track.theme.dust[i % 3], 1.3, 120);
      if (this.trick) { this.boost(0.8, 1.34); this.sfx('mini', { lv: 2 }); }
      this.trick = false; this.trickA = 0;
    }
  }
  update(dt) {
    const R = this.race, T = R.track, inp = this.inp;
    if (this.boostT > 0) this.boostT -= dt;
    if (this.spinT > 0) { this.spinT -= dt; this.spinA += dt * 17; if (this.spinT <= 0) this.spinA = 0; }
    if (this.stunT > 0) this.stunT -= dt;
    if (this.shieldT > 0) this.shieldT -= dt;
    if (this.invulnT > 0) this.invulnT -= dt;
    if (this.bumpCD > 0) this.bumpCD -= dt;
    if (this.bumpT > 0) this.bumpT -= dt;
    if (this.ringCD > 0) this.ringCD -= dt;
    if (this.trickA > 0) this.trickA = Math.max(0, this.trickA - dt * 3.2);
    if (this.rouletteT > 0) {
      this.rouletteT -= dt;
      if (this.rouletteT <= 0) {
        this.item = this.rouletteItem; this.itemCount = this.item === 'nitro3' ? 3 : 1;
        this.sfx('itemget');
        if (this.ai) this.ai.onItem();
      }
    }
    if (this.fallT > 0) {
      this.fallT -= dt; this.z -= 30 * dt;
      if (this.fallT <= 0) this.respawn();
      this.prevDrift = inp.drift; this.prevItem = inp.item;
      return;
    }
    const racing = R.phase === 'race' || R.phase === 'finish';
    if (!racing) { this.prevDrift = inp.drift; this.prevItem = inp.item; return; }
    if (this.fly) {
      // 大砲・ショートカットで飛行中（操作不可、トリックだけできる）
      const dd = inp.drift && !this.prevDrift, sh = !!inp.shake && !this.prevShake;
      this.prevDrift = inp.drift; this.prevItem = inp.item; this.prevShake = !!inp.shake;
      if ((dd || sh) && !this.trick) { this.trick = true; this.trickA = 1; this.sfx('trick'); if (this.isPlayer && !R.demo) HUD.sub(sh ? 'ふってトリック！' : 'トリック！', 'good'); }
      this.updateFly(dt);
      return;
    }

    const ctrl = this.spinT <= 0 && this.airType !== 3 && this.airType !== 4;
    const steer = ctrl ? inp.steer : 0;
    const accel = ctrl && inp.accel, brake = ctrl && inp.brake;
    const driftDown = inp.drift && !this.prevDrift, itemDown = inp.item && !this.prevItem;
    const shakeDown = !!inp.shake && !this.prevShake;
    this.prevDrift = inp.drift; this.prevItem = inp.item; this.prevShake = !!inp.shake;
    const onGround = this.z <= 0;
    const surf = this.surf;
    const sp = Math.abs(this.speed);
    const boosting = this.boostT > 0;
    this.steerVis = lerp(this.steerVis, steer, Math.min(1, dt * 10));

    if (itemDown && this.spinT <= 0 && this.fallT <= 0) this.useItem(inp.brake);

    // --- 速度 ---
    let maxV = this.maxSpeed * this.speedMul();
    if (surf === 2 && onGround && !boosting && this.shieldT <= 0) maxV *= 0.5;
    if (this.stunT > 0) maxV *= 0.6;
    if (this.shieldT > 0) maxV *= 1.1;
    if (this.zone === 'water') maxV *= 0.9;
    let target = 0;
    if (boosting) target = this.maxSpeed * this.boostMul;
    else if (brake) target = this.speed > 8 ? 0 : -this.maxSpeed * 0.32;
    else if (accel) target = maxV;
    if (onGround || boosting) {
      if (this.speed < target) {
        const rate = boosting ? 460 : (this.speed < 0 ? 220 : this.accelRate * (1 - 0.5 * clamp(this.speed / this.maxSpeed, 0, 1)));
        this.speed = Math.min(target, this.speed + rate * dt);
      } else if (this.speed > target) {
        const rate = brake ? 210 : (surf === 2 && onGround ? 170 : 42);
        this.speed = Math.max(target, this.speed - rate * dt);
      }
    }
    if (this.spinT > 0) this.speed *= Math.pow(0.2, dt);
    // 坂：上りは減速、下りは加速（最高速も少し伸びる）
    if (T.hasElev && onGround && this.speed > 0) {
      const gr = T.gradeAt(this.s) * (Math.cos(this.a) * T.TX[this.ti] + Math.sin(this.a) * T.TY[this.ti]);
      this.speed -= gr * 175 * dt;
      if (gr < 0 && !boosting && accel) this.speed = Math.min(this.speed, maxV * (1 + clamp(-gr * 1.6, 0, 0.16)));
      if (this.speed < 0) this.speed = 0;
    }

    // --- ドリフト ---
    if (driftDown && onGround && ctrl && this.airType === 0 && sp > 20) {
      this.vz = 52; this.z = 0.01; this.airType = 1; this.hopDir = 0; this.sfx('hop');
    }
    if (this.airType === 1 && Math.abs(steer) > 0.3) this.hopDir = sign(steer);
    if (this.drift === 0 && onGround && this.airType === 0 && inp.drift && ctrl && Math.abs(steer) > 0.6 && sp > 55) this.startDrift(sign(steer));
    if (this.drift !== 0 && (!inp.drift || sp < 38 || !ctrl)) this.endDrift(ctrl && !inp.drift);

    // --- 旋回 ---
    let angVel;
    const sf = clamp(sp / 45, 0, 1) * (1 - 0.1 * clamp(sp / this.maxSpeed, 0, 1.3));
    if (this.drift !== 0) {
      const dir = this.drift;
      angVel = (dir * 0.6 + steer * 0.46) * this.turnRate * 1.18 * clamp(sp / 70, 0.55, 1);
      if (onGround) {
        const inward = steer * dir;
        this.driftCharge += dt * (inward > 0.3 ? 1.55 : inward < -0.3 ? 0.65 : 1.05);
        const lv = this.driftCharge > 2.8 ? 3 : this.driftCharge > 1.75 ? 2 : this.driftCharge > 0.8 ? 1 : 0;
        if (lv > this.driftLevel) { this.driftLevel = lv; this.sfx('spark', { lv }); }
      }
    } else angVel = steer * this.turnRate * sf * (this.speed < 0 ? -1 : 1);
    if (!onGround && this.airType !== 5) angVel *= 0.8;
    if (this.zone === 'water' && onGround) angVel *= 0.88;
    if (this.spinT > 0) angVel = 0;
    this.a = wrapAngle(this.a + angVel * dt);
    this.angVel = angVel;

    // --- 移動（グリップ） ---
    const hx = Math.cos(this.a), hy = Math.sin(this.a);
    let grip = surf === 3 ? 1.7 : 9.5;
    if (this.drift !== 0) grip = surf === 3 ? 1.5 : 4;
    if (this.zone === 'water' && onGround) grip = this.drift !== 0 ? 3.2 : 6;
    if (!onGround) grip = this.airType === 5 ? 3.5 : 2.2;
    if (this.spinT > 0) grip = 2.2;
    if (this.bumpT > 0) grip = 1.6;
    const kk = Math.min(1, grip * dt);
    this.vx += (hx * this.speed - this.vx) * kk;
    this.vy += (hy * this.speed - this.vy) * kk;
    this.x += this.vx * dt; this.y += this.vy * dt;
    // ベルトコンベア（地面にいる時だけ流される）
    if (onGround && T.belts.length) {
      const bv = T.beltAt(this.s, this.d);
      if (bv) { this.x += T.TX[this.ti] * bv * dt; this.y += T.TY[this.ti] * bv * dt; }
    }
    // 横風（左右にゆれる突風）
    const wf = T.winds.length ? T.windAt(this.s, R.raceTime) : 0;
    if (wf) { this.x += T.NX[this.ti] * wf * 0.4 * dt; this.y += T.NY[this.ti] * wf * 0.4 * dt; }
    this.inWind = wf !== 0;

    // --- 上下 ---
    if (this.z > 0 || this.vz > 0) {
      let G = GRAVITY;
      if (this.zone === 'water') G *= 0.5; else if (this.zone === 'lowg') G *= 0.4;
      const gl = this.airType === 5 && this.glideRef && T.sDelta(this.s, this.glideRef.s - 30) < this.glideRef.len + 30 ? this.glideRef : null;
      if (gl) {
        // カイト滑空：上昇→ゆっくり降下。谷の上では落ちない
        G = this.vz > 0 ? GRAVITY * 0.55 : GRAVITY * 0.12;
        this.speed = Math.max(this.speed, this.maxSpeed * 0.95);
      }
      this.vz -= G * dt;
      if (gl) { if (this.vz < -14) this.vz = -14; if (this.z < 7 && this.vz < 10) this.vz = 10; }
      this.z += this.vz * dt; this.airT += dt;
      if (this.z <= 0) { this.z = 0; this.vz = 0; this.land(sp); }
    }

    // --- コース上の位置 ---
    T.locate(this);
    const L = T.len;
    let ds = this.s - this.prevS;
    if (ds < -L / 2) ds += L; else if (ds > L / 2) ds -= L;
    this.progress += ds; this.prevS = this.s;
    if (!this.finished) {
      const done = Math.floor(this.progress / L);
      if (done > this.lapsDone) { this.lapsDone = done; R.onLap(this); }
    }
    this.surf = T.surfaceAt(this.s, this.d);
    if (T.hasElev) {
      const nh = T.heightAt(this.s);
      if (this.z > 0 || this.vz > 0) {
        this.z -= nh - this.gh;
        if (this.z <= 0) { this.z = 0; this.vz = 0; this.land(sp); }
      } else if (this.airType === 0 && this.speed > 60 && this.spinT <= 0) {
        // 丘のてっぺんをスピードで越えると浮く（空中ではトリック可）
        const v = this.speed * (hx * T.TX[this.ti] + hy * T.TY[this.ti]);
        if (v * v * T.curvHAt(this.s) < -GRAVITY * 0.42) {
          this.z = 0.01; this.vz = Math.max(0, v * T.gradeAt(this.s)) + 12; this.airType = 2; this.airT = 0; this.trick = false;
          if (this.drift !== 0) { this.drift = 0; this.driftCharge = 0; this.driftLevel = 0; }
          this.sfx('hop');
        }
      }
      this.gh = nh;
    }

    // --- 壁 ---
    if (T.boundary === 'wall') {
      const lim = T.limit - KART_R * 0.8;
      if (Math.abs(this.d) > lim) {
        const sd = sign(this.d), i = this.ti;
        const nx = T.NX[i] * sd, ny = T.NY[i] * sd;
        const over = Math.abs(this.d) - lim;
        this.x -= nx * over; this.y -= ny * over; this.d = sd * lim;
        const vn = this.vx * nx + this.vy * ny;
        if (vn > 0) {
          this.vx -= 1.5 * vn * nx; this.vy -= 1.5 * vn * ny;
          if (vn > 25) {
            this.speed *= 0.62;
            if (this.bumpCD <= 0) {
              this.bumpCD = 0.3; this.sfx('bump');
              if (this.isPlayer) R.shake(0.45);
              if (this.near()) for (let k = 0; k < 6; k++) R.spawn(this.x + nx * 4, this.y + ny * 4, 3, (Math.random() - 0.5) * 60, (Math.random() - 0.5) * 60, 30 + Math.random() * 40, 0.35, '#ffe9a0', 1, 200);
            }
          } else this.speed *= 0.98;
        }
      }
    }
    // --- 障害物 ---
    for (const so of T.solids) {
      const dx = this.x - so.x, dy = this.y - so.y, rr = so.r + KART_R;
      if (dx * dx + dy * dy < rr * rr && this.z < 6) {
        const dd = Math.sqrt(dx * dx + dy * dy) || 0.01, nx = dx / dd, ny = dy / dd;
        this.x = so.x + nx * rr; this.y = so.y + ny * rr;
        const vn = this.vx * nx + this.vy * ny;
        if (so.bumper) {
          // ピンボールのバンパー：強くはじき返す
          const out = Math.max(125, Math.hypot(this.vx, this.vy) * 0.9);
          this.vx = nx * out + this.vx * 0.15; this.vy = ny * out + this.vy * 0.15;
          this.speed *= 0.82; this.bumpT = 0.35; this.drift = 0; this.driftCharge = 0; this.driftLevel = 0;
          so.bumper.lit = R.t + 0.3;
          if (this.bumpCD <= 0) { this.bumpCD = 0.25; this.sfx('bumper'); if (this.isPlayer) R.shake(0.35); }
          if (this.near()) for (let k = 0; k < 8; k++) R.spawn(so.x, so.y, 4, (Math.random() - 0.5) * 70, (Math.random() - 0.5) * 70, 20 + Math.random() * 30, 0.35, k % 2 ? '#ffe14d' : '#ff3d7f', 1.1, 120);
        } else if (vn < 0) { this.vx -= 1.6 * vn * nx; this.vy -= 1.6 * vn * ny; if (vn < -25) { this.speed *= 0.55; if (this.bumpCD <= 0) { this.bumpCD = 0.3; this.sfx('bump'); if (this.isPlayer) R.shake(0.4); } } }
      }
    }
    // 滑空中はコース幅の外へ出すぎない
    if (this.airType === 5) {
      const lim = T.halfRoad + T.curb + 12;
      if (Math.abs(this.d) > lim) {
        const sd = sign(this.d), over = Math.abs(this.d) - lim;
        this.x -= T.NX[this.ti] * sd * over; this.y -= T.NY[this.ti] * sd * over; this.d = sd * lim;
        const vn = this.vx * T.NX[this.ti] * sd + this.vy * T.NY[this.ti] * sd;
        if (vn > 0) { this.vx -= vn * T.NX[this.ti] * sd; this.vy -= vn * T.NY[this.ti] * sd; }
      }
      // 空中リング
      if (this.ringCD <= 0) {
        for (const rg of T.rings) {
          if (Math.abs(T.sSigned(this.s, rg.s)) < 7 && Math.abs(this.d - rg.d) < 9 && Math.abs(this.z - rg.z) < 11) {
            this.ringCD = 0.6; this.boost(0.8, 1.35); this.sfx('ring');
            if (this.near()) for (let k = 0; k < 14; k++) R.spawn(rg.x, rg.y, rg.z, (Math.random() - 0.5) * 60, (Math.random() - 0.5) * 60, (Math.random() - 0.5) * 40, 0.5, k % 2 ? '#ffe14d' : '#38e1ff', 1.1, 0);
            if (this.isPlayer && !R.demo) HUD.sub('リングで加速！', 'good');
            break;
          }
        }
      }
    }
    // 水中・無重力ゾーンの出入り
    const zn = T.zones.length ? T.zoneAt(this.s) : null;
    if (zn !== this.zone) {
      if (zn === 'water' || this.zone === 'water') {
        this.sfx(zn === 'water' ? 'dive' : 'surface');
        if (this.near()) for (let k = 0; k < 16; k++) R.spawn(this.x, this.y, 2, (Math.random() - 0.5) * 60, (Math.random() - 0.5) * 60, 40 + Math.random() * 60, 0.6, ['#ffffff', '#9fe3ff', '#4fb4e8'][k % 3], 1.3, 200);
      }
      this.zone = zn;
    }

    // --- 地形ギミック ---
    // 大砲：発射台の上なら少し浮いていても撃ち出す（飛び越えて落ちないように）
    for (const cn of T.cannons) {
      if (T.sDelta(this.s, cn.s - 22) < 28 && this.z < 24 && Math.abs(this.d) < T.halfRoad + T.curb + 6) {
        this.startFly('cannon', cn.to, 1.12);
        this.sfx('cannon');
        if (this.isPlayer && !R.demo) { HUD.msg('ドーン！', 'go', 1.2); R.shake(1); }
        return;
      }
    }
    if (this.z <= 0 && this.airType === 0) {
      for (const sc of T.shortcuts) {
        if (T.sDelta(this.s, sc.s) < 14 && Math.abs(this.d - sc.d) < 10 && sp > 20) {
          if (Math.max(sp, this.speed) >= this.maxSpeed * sc.need) {
            this.startFly('sc', sc.to, 1.0);
            this.sfx('shortcut');
            if (this.isPlayer && !R.demo) HUD.sub('ショートカット！', 'good');
            return;
          }
          if (this.z <= 0) { this.vz = 55; this.z = 0.01; this.airType = 2; this.airT = 0; this.trick = false; if (this.isPlayer && !R.demo) HUD.sub('スピードが足りない！', 'bad'); }
          break;
        }
      }
      if (this.airType !== 0) { /* ショートカット失敗の小ジャンプ */ }
      else if (T.isPit(this.s, this.d)) { this.startFall(); return; }
      const rp = T.inRamp(this.s, this.d);
      if (rp && rp.glide && this.speed > 4) {
        // カイト発射
        this.boost(0.6, 1.25);
        this.vz = GLIDE_VZ; this.z = 0.01; this.airType = 5; this.airT = 0; this.trick = false; this.glideRef = rp.ref;
        if (this.drift !== 0) { this.drift = 0; this.driftCharge = 0; this.driftLevel = 0; }
        this.sfx('glide');
        if (this.isPlayer && !R.demo) HUD.sub('カイトで滑空！リングをくぐれ', 'info');
      } else if (rp && (this.speed > 30 || (rp.gap && this.speed > 4))) {
        let vz = 78 + sp * 0.32;
        if (rp.gap) {
          // 大ジャンプ台：加速＋必ず向こう岸まで届く高さで飛ぶ
          this.boost(0.7, 1.3);
          const hs = Math.max(20, this.speed);
          const dist = T.sDelta(rp.ref.s + rp.ref.len + 28, this.s);
          vz = Math.max(vz, (GRAVITY * (dist / hs)) / 2);
        }
        this.vz = vz; this.z = 0.01; this.airType = 2; this.airT = 0; this.trick = false;
        if (this.drift !== 0) { this.drift = 0; this.driftCharge = 0; this.driftLevel = 0; }
        this.sfx('jump');
      } else if (T.inBoost(this.s, this.d)) {
        if (this.boostT < 0.8) this.sfx('boost');
        this.boost(1.1, 1.38);
      }
      if (this.surf !== 2) this.lastSafeS = this.s;
    }
    if ((driftDown || shakeDown) && !this.trick && ((this.airType === 2 && this.airT < 0.6) || this.airType === 5)) {
      this.trick = true; this.trickA = 1; this.sfx('trick');
      if (this.isPlayer && !R.demo) HUD.sub(shakeDown ? 'ふってトリック！' : 'トリック！', 'good');
    }

    // --- 逆走 ---
    if (this.isPlayer) {
      const dot = hx * T.TX[this.ti] + hy * T.TY[this.ti];
      if (dot < -0.35 && sp > 15 && this.spinT <= 0) this.wrongT += dt; else this.wrongT = Math.max(0, this.wrongT - dt * 2);
    }

    // --- エフェクト ---
    if (this.near()) {
      const bx = this.x - hx * 6, by = this.y - hy * 6, px = -hy, py = hx;
      if (this.drift !== 0 && onGround && Math.random() < 0.9) {
        const col = DRIFT_COLS[this.driftLevel];
        for (const side of [-1, 1]) R.spawn(bx + px * side * 5, by + py * side * 5, 0.5, (Math.random() - 0.5) * 30 - hx * 20, (Math.random() - 0.5) * 30 - hy * 20, 20 + Math.random() * 40, 0.22 + this.driftLevel * 0.05, col, this.driftLevel ? 1.1 : 0.8, 260);
      }
      if (boosting && Math.random() < 0.95) {
        R.spawn(this.x - hx * 9, this.y - hy * 9, 2.5, -hx * 40 + (Math.random() - 0.5) * 20, -hy * 40 + (Math.random() - 0.5) * 20, 10 + Math.random() * 15, 0.22, Math.random() < 0.5 ? '#ffe14d' : '#ff7a1f', 1.3, -20);
      }
      if (onGround && this.surf === 2 && sp > 30 && Math.random() < 0.5) {
        R.spawn(bx, by, 0.5, (Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30, 15 + Math.random() * 25, 0.5, T.theme.dust[Math.floor(Math.random() * 3)], 1.2, 80);
      }
      if (this.zone === 'water' && Math.random() < 0.3) R.spawn(this.x + (Math.random() - 0.5) * 8, this.y + (Math.random() - 0.5) * 8, 3, (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10, 12, 0.9, Math.random() < 0.5 ? '#dff8ff' : '#9fe3ff', 0.9, -25);
      if (this.zone === 'lowg' && Math.random() < 0.2) R.spawn(this.x, this.y, 1, (Math.random() - 0.5) * 20, (Math.random() - 0.5) * 20, 25, 0.6, ['#ff5fd2', '#38d6ff', '#ffffff'][Math.floor(Math.random() * 3)], 0.8, -10);
      if (this.airType === 5 && Math.random() < 0.5) R.spawn(this.x - hx * 6, this.y - hy * 6, this.z + 6, -hx * 20, -hy * 20, 0, 0.3, '#ffffff', 0.8, 0);
      if (this.stunT > 0 && Math.random() < 0.3) R.spawn(this.x, this.y, 8, (Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30, 20, 0.3, Math.random() < 0.5 ? '#ffe14d' : '#9f7bff', 1, 0);
    }
  }
}

/* =========================================================
   9. CPUのAI
   ========================================================= */
class AI {
  constructor(k, driftSkill) {
    this.k = k; this.driftSkill = driftSkill;
    this.lane = (Math.random() * 2 - 1) * 0.4; this.laneTarget = this.lane; this.laneT = Math.random() * 3;
    this.itemWait = 0; this.stuckT = 0; this.revT = 0; this.stuckCount = 0; this.stuckWin = 0;
    this.speedMul = 1; this.personal = 0.985 + Math.random() * 0.03; this.driftRoll = Math.random() < driftSkill;
  }
  onItem() { this.itemWait = 0.8 + Math.random() * 2.5; }
  think(dt) {
    const k = this.k, R = k.race, T = R.track, out = k.inp, sp = Math.abs(k.speed);
    let mul = (R.demo ? 0.95 : CLASSES[R.cfg.cls].cpu) * this.personal;
    if (R.player && !R.player.finished && !k.finished && !k.isPlayer) {
      const diff = R.player.progress - k.progress;
      mul *= 1 + clamp(diff / 1600, -0.07, 0.09);
    }
    if (k.isPlayer) mul = 0.96;
    this.speedMul = mul;
    this.laneT -= dt;
    if (this.laneT <= 0) {
      this.laneT = 2 + Math.random() * 4;
      this.laneTarget = (Math.random() * 2 - 1) * 0.55;
      this.driftRoll = Math.random() < this.driftSkill;
      if (!k.item && k.rouletteT <= 0 && R.cfg.items) {
        let best = null, bd = 1e9;
        for (const b of R.boxes) {
          if (!b.active) continue;
          const ds = T.sSigned(b.s, k.s);
          if (ds < 20 || ds > 260) continue;
          const dd = Math.abs(b.d - k.d);
          if (dd < bd) { bd = dd; best = b; }
        }
        if (best) { this.laneTarget = best.d / T.halfRoad; this.laneT = 1.8; }
      }
    }
    // ハザード（溶岩だまり・オイル）の回避：一番近いものを優先
    const laneD = this.lane * T.halfRoad, range = 50 + sp * 0.9;
    let avoid = null;
    const hz = (hs, hd, hr) => {
      const ds = T.sSigned(hs, k.s);
      if (ds > -hr && ds < range && Math.abs(hd - laneD) < hr + KART_R + 9) {
        const side = Math.abs(hd) < 3 ? (laneD >= hd ? 1 : -1) : -sign(hd);
        const tgt = hd + side * (hr + KART_R + 5);
        if (avoid === null || ds < avoid.ds) avoid = { ds, d: tgt };
      }
    };
    for (const pl of T.pools) hz(pl.s, pl.d, pl.r);
    for (const o of R.objs) if (o.type === 'oil') hz(o.s, o.d, 6);
    for (const b of T.bumpers) hz(b.s, b.d, b.r + 1);
    for (const mp of R.moverPos) hz(mp.s, mp.d, 7);
    let tgtLane = this.laneTarget, rate = 1.6;
    if (avoid) { tgtLane = clamp(avoid.d / T.halfRoad, -0.85, 0.85); rate = 5; this.laneTarget = tgtLane; this.laneT = Math.max(this.laneT, 0.8); }
    if (!avoid && T.belts.length) {
      for (const b of T.belts) {
        const ds = T.sSigned(b.s, k.s);
        if (ds < 180 && ds > -b.len) {
          let bl = null;
          for (const ln of b.lanes) if (!bl || ln.v > bl.v) bl = ln;
          if (bl && this.driftSkill > 0.25) { tgtLane = clamp(((bl.d0 + bl.d1) / 2) / T.halfRoad, -0.85, 0.85); rate = 3; }
          break;
        }
      }
    }
    if (k.airType === 5) {
      let best = null;
      for (const rg of T.rings) { const ds = T.sSigned(rg.s, k.s); if (ds > 0 && ds < 170 && (!best || ds < best.ds)) best = { ds, d: rg.d }; }
      if (best && this.driftSkill > 0.3) { tgtLane = clamp(best.d / T.halfRoad, -0.85, 0.85); rate = 3; }
      else tgtLane = 0;
    }
    this.lane += (tgtLane - this.lane) * Math.min(1, dt * rate);
    const kmax = T.maxCurv(k.s, 20 + sp * 0.8);
    const look = Math.min(22 + sp * 0.34, 14 + (kmax > 1e-4 ? 0.45 / kmax : 999));
    const p = T.pointAt(k.s + look, clamp(this.lane, -0.85, 0.85) * T.halfRoad);
    const desired = Math.atan2(p.y - k.y, p.x - k.x);
    const diff = wrapAngle(desired - k.a);
    // 目標点への追従＋横ずれ補正（カーブで外に膨らまないように）
    let st = diff * 3.0;
    if (Math.abs(wrapAngle(k.a - T.A[k.ti])) < 1.2) st -= ((k.d - clamp(this.lane, -0.85, 0.85) * T.halfRoad) / T.halfRoad) * 0.7;
    out.steer = clamp(st, -1, 1);
    out.accel = true; out.brake = false;
    if (Math.abs(diff) > 1.2 && sp > 50) out.accel = false;
    if (Math.abs(diff) > 1.8 && sp > 30) out.brake = true;
    const curv = T.curvAhead(k.s + 10, 30 + sp * 0.45);
    if (k.drift === 0) out.drift = this.driftRoll && Math.abs(curv) > 0.85 && sp > k.maxSpeed * 0.55 && sign(curv) === sign(out.steer) && k.airType === 0;
    else out.drift = Math.abs(curv) > 0.3 && sign(curv) === k.drift;
    // コーナー手前の減速（急カーブをオーバースピードで突っ込まない）
    const omega = (k.drift !== 0 || out.drift) ? k.turnRate * 1.2 : k.turnRate * 0.82;
    const vMax = kmax > 1e-4 ? (omega * 0.9) / kmax : 1e9;
    const margin = T.boundary === 'fall' ? 0 : 14;
    if (sp > vMax + 6 + margin) {
      // 落下コースで曲がり切れない加速は自分から打ち切る
      if (k.boostT > 0 && T.boundary === 'fall' && sp > vMax + 30) k.boostT = 0;
      if (k.boostT <= 0) { out.accel = false; if (sp > vMax + 28 + margin) out.brake = true; }
    }
    out.item = false;
    if (k.item && k.rouletteT <= 0) {
      this.itemWait -= dt;
      if (this.itemWait <= 0 && this.wantUse(curv)) { out.item = true; this.itemWait = 0.7 + Math.random() * 0.6; }
    }
    // スタック対策
    if (R.phase === 'race' || R.phase === 'finish') {
      this.stuckWin = Math.max(0, this.stuckWin - dt);
      if (this.revT > 0) {
        this.revT -= dt; out.accel = false; out.brake = true; out.steer = -out.steer; out.drift = false;
      } else if (sp < 10 && k.spinT <= 0 && k.fallT <= 0 && k.airType === 0) {
        this.stuckT += dt;
        if (this.stuckT > 1.1) {
          this.stuckT = 0; this.revT = 0.8; this.stuckCount = this.stuckWin > 0 ? this.stuckCount + 1 : 1; this.stuckWin = 8;
          if (this.stuckCount >= 3) { this.stuckCount = 0; this.revT = 0; k.startFall(); }
        }
      } else this.stuckT = Math.max(0, this.stuckT - dt);
    }
  }
  wantUse(curv) {
    const k = this.k, R = k.race;
    switch (k.item) {
      case 'nitro': case 'nitro3': {
        const safe = (k.turnRate * 1.2 * 0.9) / (k.maxSpeed * 1.42);
        const km = R.track.maxCurv(k.s, 300);
        return km < safe || (R.track.boundary === 'wall' && k.place > 5 && km < safe * 1.6);
      }
      case 'oil': return R.kartBehind(k, 70) || Math.random() < 0.004;
      case 'bullet': return R.kartAhead(k, 180, 0.35) || Math.random() < 0.003;
      case 'drone': return k.place > 1;
      case 'shield': return R.threatNear(k) || Math.random() < 0.01;
      case 'emp': return k.place > 1;
      default: return false;
    }
  }
}

/* =========================================================
   10. レース進行
   ========================================================= */
class Race {
  constructor(cfg) {
    this.cfg = cfg; this.demo = !!cfg.demo;
    this.track = getTrack(cfg.course, cfg.mirror);
    this.laps = cfg.laps;
    this.karts = []; this.player = null;
    cfg.grid.forEach((ci, slot) => {
      const k = new Kart(this, ci, slot, !this.demo && ci === cfg.player);
      this.karts.push(k);
      if (k.isPlayer) this.player = k;
    });
    if (cfg.mode === 'ta' && this.player) { this.player.item = 'nitro3'; this.player.itemCount = 3; }
    this.boxes = this.track.boxes.map((b) => ({ x: b.x, y: b.y, s: b.s, d: b.d, active: !!cfg.items, t: 0 }));
    this.objs = []; this.parts = [];
    this.moverPos = []; this.windNote = false;
    this.sections = (COURSES[cfg.course].sections && cfg.laps === 1) ? COURSES[cfg.course].sections : 0;
    this.lastSec = 1;
    this.track.bumpers.forEach((b) => { b.lit = 0; });
    this.updateMovers();
    this.phase = this.demo ? 'race' : 'intro';
    this.t = 0; this.raceTime = 0; this.rf = 0; this.finishCount = 0; this.finishT = 0; this.ended = false;
    this.cam = { x: 0, y: 0, a: 0, h: 15, dist: CAM_DIST, shake: 0, orbit: 0 };
    this.camTarget = this.player || this.karts[0];
    this.demoT = 0; this.demoMode = 0;
    this.rk = { prev: false, press: null };
    this.cd = -1; this.flashT = 0; this.skipReq = false;
    this.ghostRec = cfg.mode === 'ta' ? [] : null;
    this.ghost = cfg.ghost || null; this.ghostPos = null;
    this.cam.a = this.camTarget.a;
    this.updatePositions();
    this.updateCam(0);
  }
  spawn(x, y, z, vx, vy, vz, life, col, size, g) {
    if (this.parts.length > 650) return;
    this.parts.push({ x, y, z, vx, vy, vz, life, max: life, col, size, g });
  }
  shake(v) { if (S().shake) this.cam.shake = Math.max(this.cam.shake, v); }
  addObj(o) { o.age = 0; o.ti = this.track.idxOf(0); this.track.locate(o, true); this.objs.push(o); }
  fireBullet(k, back) {
    const dir = back ? k.a + Math.PI : k.a, sp = 270;
    this.addObj({ type: 'bullet', x: k.x + Math.cos(dir) * 9, y: k.y + Math.sin(dir) * 9, z: 3, vx: Math.cos(dir) * sp, vy: Math.sin(dir) * sp, owner: k, life: 7, bounces: 0 });
  }
  fireDrone(k) {
    const target = this.order.find((o) => o.place === k.place - 1) || null;
    this.addObj({ type: 'drone', x: k.x, y: k.y, z: 8, vx: 0, vy: 0, owner: k, target, life: 14, along: k.s, dOff: k.d, mode: 'track' });
  }
  emp(k) {
    let hitAny = false;
    this.karts.forEach((o) => { if (o !== k && o.place < k.place && o.stun()) { hitAny = true; if (o.isPlayer) this.flashT = 0.6; } });
    if (k.isPlayer || (this.player && this.player.place < k.place)) { this.flashT = Math.max(this.flashT, 0.35); if (!this.demo) AudioSys.sfx('emp'); }
    return hitAny;
  }
  kartAhead(k, dist, cone) {
    for (const o of this.karts) {
      if (o === k || o.fallT > 0) continue;
      const dx = o.x - k.x, dy = o.y - k.y, d = Math.hypot(dx, dy);
      if (d > dist || d < 5) continue;
      if (Math.abs(wrapAngle(Math.atan2(dy, dx) - k.a)) < cone) return true;
    }
    return false;
  }
  kartBehind(k, dist) {
    const T = this.track;
    for (const o of this.karts) {
      if (o === k) continue;
      const ds = T.sSigned(o.s, k.s);
      if (ds < -5 && ds > -dist && Math.abs(o.d - k.d) < 14) return true;
    }
    return false;
  }
  threatNear(k) {
    for (const o of this.objs) if ((o.type === 'bullet' || o.type === 'drone') && o.owner !== k && (o.x - k.x) ** 2 + (o.y - k.y) ** 2 < 70 * 70) return true;
    return false;
  }
  go() {
    this.phase = 'race'; this.t = 0;
    HUD.msg('GO!', 'go', 1.1);
    AudioSys.sfx('go');
    Music.play(COURSES[this.cfg.course].music);
    const p = this.player;
    if (p) {
      const pr = this.rk.press;
      if (this.rk.prev && pr !== null) {
        if (pr >= 2.15 && pr <= 2.75) { p.boost(1.25, 1.4); AudioSys.sfx('rocket'); HUD.sub('ロケットスタート！', 'good'); }
        else if (pr < 1.5) { p.spinT = 0.7; AudioSys.sfx('stall'); HUD.sub('エンスト…', 'bad'); for (let i = 0; i < 8; i++) this.spawn(p.x, p.y, 3, (Math.random() - 0.5) * 20, (Math.random() - 0.5) * 20, 20, 0.8, '#8a8594', 1.6, -10); }
      }
    }
    const chance = [0.2, 0.4, 0.6, 0.6][this.cfg.cls] || 0.3;
    this.karts.forEach((k) => { if (k.ai && Math.random() < chance) k.boost(0.9, 1.3); });
  }
  onLap(k) {
    const lt = this.raceTime - k.lapStart;
    k.lapTimes.push(lt);
    k.lapStart = this.raceTime;
    if (k.lapsDone >= this.laps) { this.finishKart(k); return; }
    if (k.isPlayer && !this.demo) {
      if (k.lapsDone === this.laps - 1) { HUD.msg('FINAL LAP', 'final', 2); AudioSys.sfx('final'); Music.setTempo(1.12); }
      else { HUD.msg(`LAP ${k.lapsDone + 1}`, 'lap', 1.4); AudioSys.sfx('lap'); }
      HUD.sub(`LAP ${k.lapsDone}  ${fmtTime(lt * 1000)}`, 'info');
    }
  }
  finishKart(k) {
    if (this.demo) { k.lapsDone = 0; k.progress -= this.track.len * this.laps; return; }
    k.finished = true; k.finishTime = this.raceTime; k.finishRank = ++this.finishCount;
    if (k.isPlayer) {
      this.phase = 'finish'; this.finishT = 0;
      k.ai = new AI(k, 1);
      k.item = null; k.itemCount = 0; k.rouletteT = 0;
      this.updatePositions();
      const good = k.place <= 3 || this.cfg.mode === 'ta';
      HUD.msg('GOAL!', 'goal', 3);
      Music.stop();
      AudioSys.sfx(good ? 'goal' : 'goalbad');
      if (good) for (let i = 0; i < 70; i++) this.spawn(k.x + (Math.random() - 0.5) * 60, k.y + (Math.random() - 0.5) * 60, 30 + Math.random() * 30, (Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30, Math.random() * 20, 2.5, ['#ff3d7f', '#ffd23f', '#38d6ff', '#5dff9a', '#ffffff'][i % 5], 1.2, 30);
    }
  }
  collideKarts() {
    const ks = this.karts, rr = KART_R * 2;
    for (let i = 0; i < ks.length; i++) {
      const a = ks[i];
      if (a.fallT > 0) continue;
      for (let j = i + 1; j < ks.length; j++) {
        const b = ks[j];
        if (b.fallT > 0 || Math.abs(a.z - b.z) > 6) continue;
        const dx = b.x - a.x, dy = b.y - a.y, d2 = dx * dx + dy * dy;
        if (d2 >= rr * rr) continue;
        const d = Math.sqrt(d2) || 0.01, nx = dx / d, ny = dy / d, ov = rr - d;
        const wa = a.weight, wb = b.weight, tot = wa + wb;
        a.x -= nx * ov * (wb / tot); a.y -= ny * ov * (wb / tot);
        b.x += nx * ov * (wa / tot); b.y += ny * ov * (wa / tot);
        const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (rv < 0) {
          const jj = (-1.5 * rv) / (1 / wa + 1 / wb);
          a.vx -= (jj / wa) * nx; a.vy -= (jj / wa) * ny;
          b.vx += (jj / wb) * nx; b.vy += (jj / wb) * ny;
          if ((a.isPlayer || b.isPlayer) && rv < -20 && !this.demo) AudioSys.sfx('kartbump');
        }
        if (a.shieldT > 0 && b.shieldT <= 0) b.hit('bump');
        else if (b.shieldT > 0 && a.shieldT <= 0) a.hit('bump');
      }
    }
  }
  updateBoxes(dt) {
    for (const b of this.boxes) {
      if (!b.active) { if (this.cfg.items) { b.t -= dt; if (b.t <= 0) b.active = true; } continue; }
      for (const k of this.karts) {
        if (k.fallT > 0 || k.z > 10) continue;
        if ((k.x - b.x) ** 2 + (k.y - b.y) ** 2 < 81) {
          b.active = false; b.t = 2.5;
          k.giveItemBox();
          if (k.near()) for (let i = 0; i < 10; i++) this.spawn(b.x, b.y, 5, (Math.random() - 0.5) * 70, (Math.random() - 0.5) * 70, 30 + Math.random() * 40, 0.5, ['#38e1ff', '#ff5fd2', '#ffd23f', '#ffffff'][i % 4], 1.1, 120);
          break;
        }
      }
    }
  }
  updateObjs(dt) {
    const T = this.track;
    for (const o of this.objs) {
      o.age += dt; o.life -= dt;
      if (o.life <= 0) { o.dead = true; continue; }
      if (o.type === 'bullet') {
        o.x += o.vx * dt; o.y += o.vy * dt;
        T.locate(o);
        const lim = T.limit - 3;
        if (Math.abs(o.d) > lim) {
          const sd = sign(o.d), nx = T.NX[o.ti] * sd, ny = T.NY[o.ti] * sd;
          const vn = o.vx * nx + o.vy * ny;
          o.x -= nx * (Math.abs(o.d) - lim); o.y -= ny * (Math.abs(o.d) - lim);
          if (vn > 0) { o.vx -= 2 * vn * nx; o.vy -= 2 * vn * ny; o.bounces++; }
          if (o.bounces > 5) o.dead = true;
        }
        if (Math.random() < 0.6) this.spawn(o.x, o.y, 3, 0, 0, 0, 0.18, '#9ff0ff', 1, 0);
      } else if (o.type === 'drone') {
        const tg = o.target;
        const alive = tg && !tg.finished && tg.fallT <= 0;
        if (o.mode === 'track') {
          o.along += 330 * dt;
          if (alive) o.dOff = lerp(o.dOff, tg.d, Math.min(1, dt * 2));
          const p = T.pointAt(o.along, o.dOff);
          o.x = p.x; o.y = p.y; T.locate(o);
          if (alive && (tg.x - o.x) ** 2 + (tg.y - o.y) ** 2 < 85 * 85) o.mode = 'home';
        } else {
          if (!alive) { o.mode = 'track'; o.along = o.s; o.dOff = o.d; continue; }
          const dx = tg.x - o.x, dy = tg.y - o.y, d = Math.hypot(dx, dy) || 1;
          const sp = Math.max(300, Math.abs(tg.speed) + 120);
          o.vx = lerp(o.vx, (dx / d) * sp, Math.min(1, dt * 6)); o.vy = lerp(o.vy, (dy / d) * sp, Math.min(1, dt * 6));
          o.x += o.vx * dt; o.y += o.vy * dt; T.locate(o);
        }
        if (Math.random() < 0.4) this.spawn(o.x, o.y, 7, 0, 0, -5, 0.25, '#ff9aac', 0.9, 0);
      }
      // 命中判定
      for (const k of this.karts) {
        if (k.fallT > 0) continue;
        if (k === o.owner && o.age < (o.type === 'oil' ? 0.8 : 0.35)) continue;
        if (o.type === 'drone' && o.mode === 'track' && k !== o.target) continue;
        const r = o.type === 'oil' ? 8 : 7.5;
        if ((k.x - o.x) ** 2 + (k.y - o.y) ** 2 < r * r && Math.abs(k.z - (o.type === 'oil' ? 0 : o.z * 0.5)) < 9) {
          const was = k.shieldT > 0;
          const hit = k.hit(o.type);
          o.dead = true;
          if (o.type !== 'oil') {
            if (k.near()) for (let i = 0; i < 14; i++) this.spawn(o.x, o.y, 5, (Math.random() - 0.5) * 90, (Math.random() - 0.5) * 90, Math.random() * 70, 0.5, ['#ffffff', '#ffd23f', '#ff7a1f'][i % 3], 1.5, 100);
            if (k.isPlayer || o.owner.isPlayer) { if (!this.demo) AudioSys.sfx('explode'); }
          }
          if (hit && o.owner && o.owner.isPlayer && k !== o.owner && !this.demo) HUD.sub(`${k.ch.name}にヒット！`, 'good');
          if (was && k.isPlayer && !this.demo) HUD.sub('シールドでガード！', 'info');
          break;
        }
      }
    }
    if (this.objs.some((o) => o.dead)) this.objs = this.objs.filter((o) => !o.dead);
  }
  sectionOf(k) { return clamp(Math.floor((k.progress / this.track.len) * this.sections) + 1, 1, this.sections); }
  // 動く障害物（フグ・ロボ・隕石）：コースを左右に往復
  updateMovers() {
    const T = this.track, mp = this.moverPos;
    mp.length = 0;
    for (const mv of T.movers) {
      const d = mv.amp * Math.sin((TAU * this.t) / mv.period + mv.ph);
      const p = T.pointAt(mv.s, d);
      mp.push({ s: mv.s, d, x: p.x, y: p.y, kind: mv.kind });
    }
    if (!mp.length) return;
    const rr = KART_R + 4.5;
    for (const k of this.karts) {
      if (k.fallT > 0 || k.z > 7) continue;
      for (const m of mp) {
        const dx = k.x - m.x, dy = k.y - m.y;
        if (dx * dx + dy * dy >= rr * rr) continue;
        const dd = Math.sqrt(dx * dx + dy * dy) || 0.01;
        k.x = m.x + (dx / dd) * rr; k.y = m.y + (dy / dd) * rr;
        if (k.hit('oil')) {
          k.vx += (dx / dd) * 70; k.vy += (dy / dd) * 70;
          if (k.isPlayer && !this.demo) AudioSys.sfx('robot');
        }
      }
    }
  }
  updateParts(dt) {
    const P = this.parts;
    let w = 0;
    for (let i = 0; i < P.length; i++) {
      const p = P[i];
      p.life -= dt;
      if (p.life <= 0) continue;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.vz -= p.g * dt;
      if (p.z < 0) { p.z = 0; p.vz *= -0.3; p.vx *= 0.7; p.vy *= 0.7; }
      P[w++] = p;
    }
    P.length = w;
  }
  updatePositions() {
    const arr = this.karts.slice().sort((a, b) => {
      if (a.finished && b.finished) return a.finishRank - b.finishRank;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.progress - a.progress;
    });
    arr.forEach((k, i) => { k.place = i + 1; });
    this.order = arr;
  }
  updateCam(dt) {
    const c = this.cam, k = this.camTarget;
    if (!k) return;
    const want = CAM_DIST + (k.boostT > 0 ? 5 : 0);
    if (this.phase === 'intro') {
      const tt = clamp(this.t / 3, 0, 1), e = 1 - Math.pow(1 - tt, 3);
      c.a = k.a + Math.PI * (1 - e) * 1.15;
      c.dist = lerp(92, CAM_DIST, e);
    } else if (this.phase === 'finish' || (this.demo && this.demoMode === 1)) {
      c.orbit += dt * 0.42;
      c.a = k.a + Math.PI * 0.35 + c.orbit;
      c.dist = lerp(c.dist, 58, Math.min(1, dt * 2));
    } else {
      if (k.fallT <= 0) c.a += wrapAngle(k.a - c.a) * Math.min(1, dt * 6);
      c.dist = lerp(c.dist, want, Math.min(1, dt * 3));
    }
    c.x = k.x - Math.cos(c.a) * c.dist;
    c.y = k.y - Math.sin(c.a) * c.dist;
    c.h = Renderer.baseCamH * (c.dist / CAM_DIST) + Math.max(0, k.z) * 0.45;
    const T = this.track;
    if (T.hasElev) {
      const minA = T.hXY(c.x, c.y) + 7;
      const tgt = Math.max(T.heightAt(k.s) + c.h, minA);
      c.alt = c.alt == null || dt === 0 ? tgt : lerp(c.alt, tgt, Math.min(1, dt * 10));
      if (c.alt < minA) c.alt = minA;
      const pt = clamp(T.gradeAt(k.s + 30) * 0.3, -0.07, 0.07);
      c.pitch = c.pitch == null || dt === 0 ? pt : lerp(c.pitch, pt, Math.min(1, dt * 3));
    } else { c.alt = c.h; c.pitch = 0; }
    c.shake = Math.max(0, c.shake - dt * 2.5);
  }
  update(dt) {
    this.t += dt;
    const inp = Input.state;
    if (this.phase === 'intro') {
      if (this.t > 0.6 && (inp.accelManual || inp.item || this.skipReq)) this.t = 3.2;
      if (this.t >= 3.2) { this.phase = 'countdown'; this.t = 0; this.cd = -1; HUD.banner(null); }
    } else if (this.phase === 'countdown') {
      const n = Math.floor(this.t);
      if (n !== this.cd && n < 3) { this.cd = n; HUD.msg(String(3 - n), 'count', 0.9); AudioSys.sfx('count'); }
      const rk = inp.accelManual || (inp.auto && inp.drift);
      if (rk && !this.rk.prev) this.rk.press = this.t;
      if (!rk) this.rk.press = null;
      this.rk.prev = rk;
      if (this.t >= 3) this.go();
    }
    const racing = this.phase === 'race' || this.phase === 'finish';
    if (racing) this.raceTime += dt;
    for (const k of this.karts) {
      if (k.isPlayer && !k.finished) {
        const s = k.inp;
        s.steer = inp.steer; s.accel = inp.accel; s.brake = inp.brake; s.drift = inp.drift; s.item = inp.item; s.shake = inp.shake;
      } else if (k.ai) k.ai.think(dt);
      k.update(dt);
    }
    this.collideKarts();
    this.updateBoxes(dt);
    this.updateObjs(dt);
    this.updateMovers();
    if (!this.demo && this.player) {
      const p = this.player;
      AudioSys.setWater(p.zone === 'water' && this.phase !== 'finish');
      if (p.inWind && !this.windNote && this.phase === 'race') { this.windNote = true; HUD.sub('横風に注意！', 'bad'); AudioSys.sfx('gust'); }
      if (!p.inWind) this.windNote = false;
      if (this.sections && !p.finished && this.phase === 'race') {
        const sec = this.sectionOf(p);
        if (sec > this.lastSec) {
          this.lastSec = sec;
          if (sec === this.sections) { HUD.msg('FINAL SECTION', 'final', 2); AudioSys.sfx('final'); Music.setTempo(1.1); }
          else { HUD.msg(`SECTION ${sec}`, 'lap', 1.4); AudioSys.sfx('lap'); }
          HUD.sub(`SECTION ${sec - 1}  ${fmtTime(this.raceTime * 1000)}`, 'info');
        }
      }
    }
    this.updateParts(dt);
    this.updatePositions();
    if (this.flashT > 0) this.flashT -= dt;
    // ゴースト
    if (racing) {
      const rf = this.rf++;
      const p = this.player;
      if (this.ghostRec && p && !p.finished && rf % 2 === 0) this.ghostRec.push(Math.round(p.x * 8), Math.round(p.y * 8), Math.round(p.a * 1000), Math.round(p.z * 8));
      if (this.ghost) {
        const d = this.ghost.d, gi = Math.floor(rf / 2), fr = (rf % 2) / 2;
        if ((gi + 1) * 4 + 3 < d.length) {
          const i0 = gi * 4, i1 = i0 + 4;
          this.ghostPos = {
            x: lerp(d[i0], d[i1], fr) / 8, y: lerp(d[i0 + 1], d[i1 + 1], fr) / 8,
            a: d[i0 + 2] / 1000 + wrapAngle(d[i1 + 2] / 1000 - d[i0 + 2] / 1000) * fr, z: d[i0 + 3] / 8, ci: this.ghost.c,
          };
        } else this.ghostPos = null;
      }
    }
    // デモのカメラ切り替え
    if (this.demo) {
      this.demoT += dt;
      if (this.demoT > 9) {
        this.demoT = 0;
        this.demoMode = this.demoMode ? 0 : 1;
        const cand = this.karts[Math.floor(Math.random() * this.karts.length)];
        if (cand !== this.camTarget) { this.camTarget = cand; this.cam.a = cand.a; }
      }
    }
    this.updateCam(dt);
    if (this.phase === 'finish') {
      this.finishT += dt;
      if (this.finishT > 4.5 && !this.ended) { this.ended = true; Game.onRaceEnd(this); }
    }
  }
  results() {
    const L = this.track.len, total = this.laps * L;
    const fin = this.karts.filter((k) => k.finished).sort((a, b) => a.finishRank - b.finishRank);
    const rest = this.karts.filter((k) => !k.finished).sort((a, b) => b.progress - a.progress);
    let last = fin.length ? fin[fin.length - 1].finishTime : this.raceTime;
    const out = fin.map((k) => ({ ci: k.ci, time: k.finishTime, est: false, isPlayer: k.isPlayer, best: Math.min(...k.lapTimes) }));
    rest.forEach((k) => {
      const est = this.raceTime + Math.max(0, total - k.progress) / (k.maxSpeed * 0.82);
      last = Math.max(last + 0.35, est);
      out.push({ ci: k.ci, time: last, est: true, isPlayer: k.isPlayer, best: k.lapTimes.length ? Math.min(...k.lapTimes) : null });
    });
    out.forEach((r, i) => { r.place = i + 1; });
    return out;
  }
}

/* =========================================================
   11. レンダラー（Mode7風 疑似3D）
   ========================================================= */
const Renderer = {
  cvs: null, ctx: null, W: 320, H: 180, img: null, buf: null, horizon: 60, focal: 230, baseCamH: 15, portrait: false,
  list: [], flakes: [], prevCamA: 0, time: 0,
  init() {
    this.cvs = $('#screen');
    this.ctx = this.cvs.getContext('2d', { alpha: false });
    this.resize();
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 250));
  },
  resize() {
    const vw = Math.max(1, window.innerWidth || 800), vh = Math.max(1, window.innerHeight || 450), asp = vw / vh;
    const Q = { low: 150, mid: 190, high: 250 }[S().quality] || 190;
    let W, H;
    if (asp >= 1) { H = Q; W = Math.round(Q * asp); } else { W = Math.round(Q * 1.1); H = Math.round(W / asp); }
    W = clamp(W, 120, 760); H = clamp(H, 100, 900);
    if (W !== this.W || H !== this.H || !this.img) {
      this.cvs.width = W; this.cvs.height = H;
      this.img = this.ctx.createImageData(W, H);
      this.buf = new Uint32Array(this.img.data.buffer);
      this.W = W; this.H = H;
    }
    this.ctx.imageSmoothingEnabled = false;
    this.portrait = asp < 1;
    this.horizon = Math.round(H * (this.portrait ? 0.40 : 0.34));
    this.focal = Math.min(W * 0.74, H * 1.32);
    const kartY = H * (this.portrait ? 0.70 : 0.80);
    this.baseCamH = ((kartY - this.horizon) * CAM_DIST) / this.focal;
    this.flakes = [];
  },
  // 高低差コース用：画面の列ごとに視線を飛ばして地形との交点を探す（丘の向こうは隠れる）
  renderTerrain(T, cam, camAlt, hor, xc, ca, sa, focal) {
    const W = this.W, H = this.H, buf = this.buf;
    if (!this.depth || this.depth.length !== W * H) this.depth = new Float32Array(W * H);
    const depth = this.depth;
    const sky = T.sky, SW = sky.w, SH = sky.h, sb = sky.buf, angStep = SW / (TAU * focal), base = (cam.a / TAU) * SW;
    const fog = T.fogRgb, fogP = pack(fog[0], fog[1], fog[2]);
    const mips = T.tex, tiles = T.tile;
    const G = T.hmG, cs = T.hmCell, hm = T.hm, Gm = G - 1.001;
    const cx0 = cam.x, cy0 = cam.y;
    const rel = Math.max(2, camAlt - T.hXY(cx0, cy0));
    const z0 = Math.max(1.5, (0.5 * rel * focal) / Math.max(1, H - hor));
    for (let x = 0; x < W; x++) {
      const o = (x + 0.5 - xc) / focal, dx = ca - sa * o, dy = sa + ca * o;
      let z = z0, y = H - 1, wx = 0, wy = 0, hh = 0, stp = 0;
      for (; y >= 0; y--) {
        const t = (y + 0.5 - hor) / focal;
        for (;;) {
          wx = cx0 + dx * z; wy = cy0 + dy * z;
          let fx = wx / cs - 0.5, fy = wy / cs - 0.5;
          if (fx < 0) fx = 0; else if (fx > Gm) fx = Gm;
          if (fy < 0) fy = 0; else if (fy > Gm) fy = Gm;
          const ix = fx | 0, iy = fy | 0, tx = fx - ix, ty = fy - iy, c = iy * G + ix;
          const h = (hm[c] * (1 - tx) + hm[c + 1] * tx) * (1 - ty) + (hm[c + G] * (1 - tx) + hm[c + G + 1] * tx) * ty;
          hh = h;
          if (camAlt - t * z <= h) break;
          stp = z < 50 ? 0.3 + z * 0.012 : z * 0.014;
          z += stp;
          if (z >= FAR) break;
        }
        if (z >= FAR) break;
        const k = z / focal;
        const lvl = k < 1.25 ? 0 : k < 2.5 ? 1 : k < 5 ? 2 : 3;
        const m = mips[lvl], tl = tiles[lvl], inv = 1 / (1 << lvl), ms = m.size;
        const u = wx * inv, v = wy * inv;
        let c;
        const alt = camAlt - t * z;
        if (hh - alt > 2.4 + Math.abs(t) * stp * 1.6 + z * 0.012) {
          // 崖の面：岩の地層模様（高い所は雪）
          const band = ((alt * 0.35) | 0) & 1, dark = z < 120 ? 0 : 1;
          c = alt > (T.def.snowLine || 172) + 13 ? (band ? 0xfff0e2d6 : 0xfffae9e0) : (band ^ dark ? 0xff6a5a62 : 0xff7c6c74);
        } else c = (u >= 0 && v >= 0 && u < ms && v < ms) ? m.data[(v | 0) * ms + (u | 0)] : tl.data[((v | 0) & tl.mask) * tl.size + ((u | 0) & tl.mask)];
        if (z > FOG_START) {
          let f = Math.min(1, (z - FOG_START) / (FAR - FOG_START)); f = f * f * (3 - 2 * f);
          const fa = Math.round(f * 256), ia = 256 - fa;
          c = ((255 << 24) | ((((c >> 16) & 255) * ia + fog[2] * fa) >> 8 << 16) | ((((c >> 8) & 255) * ia + fog[1] * fa) >> 8 << 8) | (((c & 255) * ia + fog[0] * fa) >> 8)) >>> 0;
        }
        buf[y * W + x] = c; depth[x * H + y] = z;
      }
      const ix = ((Math.floor(base + (x - xc) * angStep) % SW) + SW) % SW;
      for (; y >= 0; y--) {
        const sy = SH - 1 - (hor - y);
        buf[y * W + x] = sy < 0 ? sky.top : sy >= SH ? fogP : sb[sy * SW + ix];
        depth[x * H + y] = 1e9;
      }
    }
  },
  // ベルトコンベアの矢印（前へ進むレーンは黄色、後ろへ戻るレーンはピンク）
  drawBelts(T, race, proj, tmp, elev, time) {
    const ctx = this.ctx, W = this.W, H = this.H, cam = race.cam, q = {};
    const P = [];
    for (const b of T.belts) {
      const mid = T.pointAt(b.s + b.len / 2, 0);
      if ((mid.x - cam.x) ** 2 + (mid.y - cam.y) ** 2 > (FAR * 0.6 + b.len / 2) ** 2) continue;
      const hb = T.heightAt(b.s + b.len / 2);
      for (const ln of b.lanes) {
        const dir = sign(ln.v), gap = 12, n = Math.floor(b.len / gap);
        const off = (((time * Math.abs(ln.v)) % gap) + gap) % gap;
        const dm = (ln.d0 + ln.d1) / 2, hw = (ln.d1 - ln.d0) / 2 - 2.5;
        ctx.fillStyle = dir > 0 ? '#ffd23f' : '#ff3d7f';
        for (let k = 0; k < n; k++) {
          const sp = b.s + ((k * gap + dir * off + b.len * 4) % b.len);
          const shape = [[3.5, 0], [-1.5, hw], [-4.5, hw], [0.5, 0], [-4.5, -hw], [-1.5, -hw]];
          P.length = 0;
          let ok = true, zc = 0;
          for (const [ds, dd] of shape) {
            T.pointAt(sp + ds * dir, dm + dd, q);
            if (!proj(q.x, q.y, 0.2, elev ? T.heightAt(sp) : hb * 0)) { ok = false; break; }
            P.push(tmp.sx, tmp.sy); zc = tmp.z;
          }
          if (!ok) continue;
          if (elev && this.depth) {
            const cx = clamp(Math.round(P[0]), 0, W - 1), cy = clamp(Math.round(P[1]), 0, H - 1);
            if (this.depth[cx * H + cy] < zc - 4) continue;
          }
          ctx.beginPath(); ctx.moveTo(P[0], P[1]);
          for (let i = 2; i < P.length; i += 2) ctx.lineTo(P[i], P[i + 1]);
          ctx.closePath(); ctx.fill();
        }
      }
    }
  },
  render(race, dt) {
    this.time += dt;
    const W = this.W, H = this.H, buf = this.buf, ctx = this.ctx;
    if (!race) { ctx.fillStyle = '#0b0820'; ctx.fillRect(0, 0, W, H); return; }
    const T = race.track, cam = race.cam;
    let shx = 0, shy = 0;
    if (cam.shake > 0) { shx = (Math.random() - 0.5) * cam.shake * 6; shy = Math.round((Math.random() - 0.5) * cam.shake * 5); }
    const elev = !!T.hasElev;
    const hor = this.horizon + shy + (elev ? Math.round((cam.pitch || 0) * this.focal) : 0);
    const xc = W / 2 + shx;
    const ca = Math.cos(cam.a), sa = Math.sin(cam.a), focal = this.focal, camH = elev ? cam.alt : cam.h;
    if (elev) this.renderTerrain(T, cam, camH, hor, xc, ca, sa, focal);
    else {
    // --- 空 ---
    const sky = T.sky, SW = sky.w, SH = sky.h, sb = sky.buf;
    const angStep = SW / (TAU * focal);
    const base = (cam.a / TAU) * SW;
    for (let y = 0; y <= hor && y < H; y++) {
      const row = y * W, sy = SH - 1 - (hor - y);
      if (sy < 0) { buf.fill(sky.top, row, row + W); continue; }
      const srow = sy * SW;
      let sx = base - xc * angStep;
      for (let x = 0; x < W; x++) {
        const ix = ((Math.floor(sx) % SW) + SW) % SW;
        buf[row + x] = sb[srow + ix];
        sx += angStep;
      }
    }
    // --- 地面 ---
    const fog = T.fogRgb, fogP = pack(fog[0], fog[1], fog[2]);
    const mips = T.tex, tiles = T.tile;
    for (let y = Math.max(0, hor + 1); y < H; y++) {
      const dy = y - hor, z = (camH * focal) / dy, row = y * W;
      if (z > FAR) { buf.fill(fogP, row, row + W); continue; }
      const k = z / focal;
      const lvl = k < 1.25 ? 0 : k < 2.5 ? 1 : k < 5 ? 2 : 3;
      const m = mips[lvl], tl = tiles[lvl], inv = 1 / (1 << lvl);
      const lat0 = (0.5 - xc) * k;
      let u = (cam.x + ca * z - sa * lat0) * inv, v = (cam.y + sa * z + ca * lat0) * inv;
      const du = -sa * k * inv, dv = ca * k * inv;
      const ms = m.size, md = m.data, ts = tl.size, tm = tl.mask, td = tl.data;
      let f = z <= FOG_START ? 0 : Math.min(1, (z - FOG_START) / (FAR - FOG_START));
      f = f * f * (3 - 2 * f);
      const fa = Math.round(f * 256);
      if (fa === 0) {
        for (let x = 0; x < W; x++) {
          buf[row + x] = (u >= 0 && v >= 0 && u < ms && v < ms) ? md[(v | 0) * ms + (u | 0)] : td[((v | 0) & tm) * ts + ((u | 0) & tm)];
          u += du; v += dv;
        }
      } else {
        const ia = 256 - fa, pr = fog[0] * fa, pg = fog[1] * fa, pb = fog[2] * fa;
        for (let x = 0; x < W; x++) {
          const c = (u >= 0 && v >= 0 && u < ms && v < ms) ? md[(v | 0) * ms + (u | 0)] : td[((v | 0) & tm) * ts + ((u | 0) & tm)];
          buf[row + x] = ((255 << 24) | ((((c >> 16) & 255) * ia + pb) >> 8 << 16) | ((((c >> 8) & 255) * ia + pg) >> 8 << 8) | (((c & 255) * ia + pr) >> 8)) >>> 0;
          u += du; v += dv;
        }
      }
    }
    }
    ctx.putImageData(this.img, 0, 0);

    // --- スプライト ---
    const list = this.list; list.length = 0;
    const tmp = { sx: 0, sy: 0, s: 0, z: 0 };
    // base：その地点の地面の高さ（省略時は地形から求める）
    const proj = (wx, wy, wz, base) => {
      const dx = wx - cam.x, dy = wy - cam.y, z = dx * ca + dy * sa;
      if (z < 3 || z > FAR) return false;
      const s = focal / z;
      const gb = elev ? (base !== undefined ? base : T.hXY(wx, wy)) : 0;
      tmp.sx = xc + (-dx * sa + dy * ca) * s; tmp.sy = hor + (camH - gb - wz) * s; tmp.s = s; tmp.z = z;
      return true;
    };
    const fade = (z) => (z > FAR * 0.8 ? clamp((FAR - z) / (FAR * 0.2), 0, 1) : 1);
    const addImg = (img, z, x, y, w, h, alpha) => {
      if (x > W || x + w < 0 || y > H || y + h < 0 || w < 1) return;
      list.push({ k: 0, img, z, x, y, w, h, a: alpha });
    };
    const time = this.time;
    const D = Gfx.deco;
    for (const d of T.deco) {
      const sp = D[d.t];
      const fly = sp.fly ? sp.fly + (sp.bob ? Math.sin(time * 1.3 + d.ph) * sp.bob : 0) : 0;
      if (!proj(d.x, d.y, fly, d.h)) continue;
      let fr;
      if (sp.bumper) fr = sp.frames[d.bumper && d.bumper.lit > race.t ? 1 : 0];
      else if (sp.anim) fr = sp.frames[Math.floor(time / sp.anim + d.ph) % sp.frames.length];
      else if (sp.vari) fr = sp.frames[Math.floor(d.ph) % sp.frames.length];
      else fr = sp.frames[0];
      const h = sp.h * tmp.s, w = (fr.width / fr.height) * h;
      addImg(fr, tmp.z, tmp.sx - w / 2, tmp.sy - h, w, h, fade(tmp.z) * clamp((tmp.z - 6) / 16, 0.3, 1));
    }
    for (const b of race.boxes) {
      if (!b.active || !proj(b.x, b.y, 0, T.heightAt(b.s))) continue;
      const s = tmp.s, z = tmp.z, gx = tmp.sx, gy = tmp.sy;
      const sw = 6 * s;
      addImg(Gfx.shadow, z + 0.2, gx - sw / 2, gy - sw * 0.18, sw, sw * 0.375, 0.8);
      const fr = Gfx.capsule[Math.floor(time * 10 + b.x) & 7];
      const h = 7.5 * s, w = h * (16 / 18), bob = (4 + Math.sin(time * 3 + b.x) * 1.2) * s;
      addImg(fr, z, gx - w / 2, gy - bob - h, w, h, fade(z));
    }
    for (const o of race.objs) {
      if (!proj(o.x, o.y, 0, T.heightAt(o.s))) continue;
      const s = tmp.s, z = tmp.z, gx = tmp.sx, gy = tmp.sy;
      if (o.type === 'oil') { const w = 13 * s, h = w * (8 / 22); addImg(Gfx.oil, z + 0.3, gx - w / 2, gy - h / 2, w, h, 1); continue; }
      const sw = 5 * s;
      addImg(Gfx.shadow, z + 0.2, gx - sw / 2, gy - sw * 0.18, sw, sw * 0.375, 0.7);
      if (o.type === 'bullet') { const h = 5 * s; addImg(Gfx.bullet[Math.floor(time * 12) & 1], z, gx - h / 2, gy - o.z * s - h, h, h, 1); }
      else { const w = 7 * s, h = w * (11 / 16); addImg(Gfx.drone[Math.floor(time * 20) & 1], z, gx - w / 2, gy - o.z * s - h - Math.sin(time * 8) * s, w, h, 1); }
    }
    // 動く障害物
    for (const m of race.moverPos) {
      if (!proj(m.x, m.y, 0, T.heightAt(m.s))) continue;
      const s = tmp.s, z = tmp.z, gx = tmp.sx, gy = tmp.sy;
      const frames = Gfx.movers[m.kind] || Gfx.movers.robot;
      const fr = frames[Math.floor(time * (m.kind === 'puffer' ? 1.5 : 6)) & 1];
      const hgt = m.kind === 'puffer' ? 3 + Math.sin(time * 2 + m.s) * 1.5 : m.kind === 'meteor' ? 2 : 0;
      const h = 8 * s, w = (fr.width / fr.height) * h, sw = 7 * s;
      addImg(Gfx.shadow, z + 0.2, gx - sw / 2, gy - sw * 0.18, sw, sw * 0.375, 0.7);
      addImg(fr, z, gx - w / 2, gy - hgt * s - h, w, h, fade(z));
    }
    // 空中リング
    for (const rg of T.rings) {
      if (!proj(rg.x, rg.y, rg.z, T.heightAt(rg.s))) continue;
      const w = 13 * tmp.s;
      addImg(Gfx.ring[Math.floor(time * 6) & 1], tmp.z, tmp.sx - w / 2, tmp.sy - w / 2, w, w, fade(tmp.z));
    }
    const drawKart = (x, y, z, a, ci, extra) => {
      if (!proj(x, y, 0, extra.base)) return null;
      const s = tmp.s, dz = tmp.z, gx = tmp.sx, gy = tmp.sy;
      const view = Math.atan2(y - cam.y, x - cam.x);
      const rel = wrapAngle(a - view);
      const idx = ((Math.round((rel / TAU) * SPRITE_N) % SPRITE_N) + SPRITE_N) % SPRITE_N;
      const w = KART_WORLD * s;
      const sw = 10 * s;
      if (extra.shadow) addImg(Gfx.shadow, dz + 0.3, gx - sw / 2, gy - sw * 0.2, sw, sw * 0.375, extra.alpha * 0.9);
      const e = { k: 0, img: Gfx.karts[ci][idx], z: dz, x: gx - w / 2, y: gy - (extra.fly ? z : Math.max(-8, z)) * s - KART_ANCHOR * w + (extra.bump || 0), w, h: w, a: extra.alpha };
      if (!(e.x > W || e.x + w < 0 || e.y > H)) list.push(e);
      return { gx, gy: gy - Math.max(0, z) * s, s, z: dz, w };
    };
    if (race.ghostPos) {
      const g = race.ghostPos;
      drawKart(g.x, g.y, g.z, g.a, g.ci, { alpha: 0.42, shadow: false });
    }
    for (const k of race.karts) {
      let alpha = 1;
      if (k.fallT > 0) alpha = clamp(k.fallT / 1.1, 0, 1);
      if (k.invulnT > 0 && k.fallT <= 0 && Math.floor(time * 16) % 2 === 0) alpha = 0.35;
      const vis = k.a + k.spinA + k.trickA * TAU + k.steerVis * 0.3 + k.drift * 0.45;
      const bump = (k.surf === 2 && k.z <= 0 && Math.abs(k.speed) > 30 && Math.floor(time * 20) % 2) ? 1 : 0;
      const kb = elev ? T.heightAt(k.s) : 0;
      const r = drawKart(k.x, k.y, k.z, vis, k.ci, { alpha, shadow: k.fallT <= 0 && !k.fly, bump, base: kb, fly: !!k.fly });
      if (r && k.airType === 5 && proj(k.x, k.y, k.z + 7.5, kb)) {
        const kw = 17 * tmp.s, kh = kw * (14 / 30);
        addImg(Gfx.kite, tmp.z - 0.2, tmp.sx - kw / 2, tmp.sy - kh, kw, kh, alpha);
      }
      if (r && k.shieldT > 0) list.push({ k: 2, z: r.z - 0.5, x: r.gx, y: r.gy - r.w * 0.28, r: r.w * 0.5, a: k.shieldT < 1.5 ? (Math.floor(time * 12) % 2 ? 0.25 : 0.6) : 0.55 });
    }
    for (const p of race.parts) {
      if (!proj(p.x, p.y, p.z)) continue;
      const sz = clamp(Math.round(p.size * tmp.s * 0.7), 1, 7);
      list.push({ k: 1, z: tmp.z - 0.1, x: Math.round(tmp.sx - sz / 2), y: Math.round(tmp.sy - sz / 2), w: sz, col: p.col, a: clamp(p.life / p.max * 2, 0, 1) });
    }
    if (T.belts.length) this.drawBelts(T, race, proj, tmp, elev, time);
    list.sort((a, b) => b.z - a.z);
    const depth = this.depth;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (elev) {
        // 手前の地形（丘など）に隠れる部分を切り取る
        const cx = clamp(Math.round(e.k === 2 ? e.x : e.x + (e.w || 0) / 2), 0, W - 1), col = cx * H;
        const top = Math.max(0, Math.ceil(e.k === 2 ? e.y - e.r : e.y));
        let clip = Math.min(H, Math.floor(e.k === 2 ? e.y + e.r : e.k === 1 ? e.y + e.w : e.y + e.h));
        while (clip - 1 >= top && depth[col + clip - 1] < e.z - 4) clip--;
        if (clip <= top) continue;
        if (e.k === 0 && clip < e.y + e.h - 0.5) {
          const fr = (clip - e.y) / e.h;
          if (fr <= 0) continue;
          ctx.globalAlpha = e.a;
          ctx.drawImage(e.img, 0, 0, e.img.width, Math.max(1, Math.round(e.img.height * fr)), Math.round(e.x), Math.round(e.y), Math.max(1, Math.round(e.w)), Math.max(1, Math.round(e.h * fr)));
          continue;
        }
      }
      ctx.globalAlpha = e.a;
      if (e.k === 0) ctx.drawImage(e.img, Math.round(e.x), Math.round(e.y), Math.max(1, Math.round(e.w)), Math.max(1, Math.round(e.h)));
      else if (e.k === 1) { ctx.fillStyle = e.col; ctx.fillRect(e.x, e.y, e.w, e.w); }
      else {
        ctx.strokeStyle = '#8fe9ff'; ctx.lineWidth = Math.max(1, e.r * 0.08);
        ctx.beginPath(); ctx.ellipse(e.x, e.y, e.r, e.r * 0.85, 0, 0, TAU); ctx.stroke();
        ctx.fillStyle = 'rgba(120,220,255,0.18)'; ctx.fill();
      }
    }
    ctx.globalAlpha = 1;

    // --- 画面エフェクト ---
    const tgt = race.camTarget;
    if (tgt && tgt.boostT > 0 && race.phase !== 'intro') {
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      const cx0 = W / 2, cy0 = hor + (H - hor) * 0.35, R0 = Math.max(W, H) * 0.42;
      for (let i = 0; i < 10; i++) {
        const ang = Math.random() * TAU, len = R0 * (0.25 + Math.random() * 0.3);
        const ca2 = Math.cos(ang), sa2 = Math.sin(ang);
        for (let r = R0; r < R0 + len; r += 2) ctx.fillRect(Math.round(cx0 + ca2 * r), Math.round(cy0 + sa2 * r * 0.75), 1, 1);
      }
    }
    const weather = T.theme.weather;
    if (weather) {
      const dA = wrapAngle(cam.a - this.prevCamA);
      if (this.flakes.length === 0) {
        const n = weather === 'snow' ? 70 : 34;
        for (let i = 0; i < n; i++) this.flakes.push({ x: Math.random() * W, y: Math.random() * H, v: 10 + Math.random() * 25, s: Math.random() < 0.3 ? 2 : 1, ph: Math.random() * 10 });
      }
      const up = weather === 'ember', rain = weather === 'rain';
      ctx.fillStyle = up ? '#ffb040' : rain ? '#8fa6ff' : '#ffffff';
      if (rain) ctx.globalAlpha = 0.55;
      for (const f of this.flakes) {
        f.x -= dA * focal * 0.8 - Math.sin(time + f.ph) * 0.15 + (rain ? f.v * 0.8 * dt : 0);
        f.y += (up ? -f.v * 0.6 : rain ? f.v * 7 : f.v) * dt;
        if (rain) { f.x = ((f.x % W) + W) % W; if (f.y > H) { f.y = -4; f.x = Math.random() * W; } ctx.fillRect(Math.round(f.x), Math.round(f.y), 1, 4); continue; }
        if (f.y > H) { f.y = -2; f.x = Math.random() * W; }
        if (f.y < -2) { f.y = H; f.x = Math.random() * W; }
        f.x = ((f.x % W) + W) % W;
        if (up) ctx.globalAlpha = 0.5 + 0.5 * Math.sin(time * 5 + f.ph);
        ctx.fillRect(Math.round(f.x), Math.round(f.y), f.s, f.s);
      }
      ctx.globalAlpha = 1;
    }
    this.prevCamA = cam.a;
    // 水中・無重力の画面効果
    const inW = tgt && tgt.zone === 'water' ? 1 : 0, inL = tgt && tgt.zone === 'lowg' ? 1 : 0;
    this.waterMix = lerp(this.waterMix || 0, inW, Math.min(1, dt * 4));
    this.lowgMix = lerp(this.lowgMix || 0, inL, Math.min(1, dt * 4));
    if (this.waterMix > 0.02) {
      const m = this.waterMix;
      ctx.fillStyle = `rgba(16,110,196,${0.3 * m})`; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = `rgba(8,70,150,${0.45 * m})`; ctx.fillRect(0, 0, W, Math.max(0, hor + 1));
      // 水面のゆらぎ（空との境目）
      ctx.fillStyle = `rgba(200,250,255,${0.35 * m})`;
      for (let x = 0; x < W; x += 3) ctx.fillRect(x, Math.round(hor * 0.55 + Math.sin(x * 0.08 + time * 2) * 3), 2, 1);
      // 差しこむ光
      ctx.fillStyle = `rgba(190,245,255,${0.1 * m})`;
      for (let i = 0; i < 4; i++) {
        const x0 = ((i * W) / 4 + Math.sin(time * 0.6 + i * 2) * W * 0.08 + time * 6) % (W + 40) - 20;
        for (let y = 0; y < H; y += 2) ctx.fillRect(Math.round(x0 + y * 0.35), y, 6 + i * 2, 2);
      }
      if (!this.bubbles) this.bubbles = [];
      if (this.bubbles.length < 26) this.bubbles.push({ x: Math.random() * W, y: H + Math.random() * 20, v: 14 + Math.random() * 26, ph: Math.random() * 10, s: Math.random() < 0.3 ? 2 : 1 });
      ctx.fillStyle = `rgba(230,250,255,${0.8 * m})`;
      for (const b of this.bubbles) {
        b.y -= b.v * dt; b.x += Math.sin(time * 3 + b.ph) * 0.3;
        if (b.y < -3) { b.y = H + 2; b.x = Math.random() * W; }
        ctx.fillRect(Math.round(b.x), Math.round(b.y), b.s, b.s);
      }
    }
    if (this.lowgMix > 0.02) { ctx.fillStyle = `rgba(140,60,220,${0.12 * this.lowgMix})`; ctx.fillRect(0, 0, W, H); }
    // 横風の線
    if (tgt && tgt.inWind && race.phase !== 'intro') {
      const wf = T.windAt(tgt.s, race.raceTime);
      const dir = -sign(wf);
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      for (let i = 0; i < 9; i++) {
        const y = Math.floor(Math.random() * H * 0.8), x = Math.random() * W, len = 8 + Math.random() * 18 * Math.min(1, Math.abs(wf) / 40);
        ctx.fillRect(Math.round(x), y, Math.round(len), 1);
        ctx.fillRect(Math.round(x + dir * len * 0.4), y + 1, 2, 1);
      }
    }
    if (race.flashT > 0) { ctx.fillStyle = `rgba(210,190,255,${clamp(race.flashT, 0, 0.7)})`; ctx.fillRect(0, 0, W, H); }
    if (tgt && tgt.stunT > 0 && tgt.isPlayer) { ctx.fillStyle = 'rgba(160,120,255,0.12)'; ctx.fillRect(0, 0, W, H); }
    if (!race.demo && (race.phase === 'intro' || race.phase === 'finish')) {
      const bh = Math.round(H * 0.09);
      ctx.fillStyle = '#07051a'; ctx.fillRect(0, 0, W, bh); ctx.fillRect(0, H - bh, W, bh);
    }
  },
};

/* =========================================================
   12. HUD
   ========================================================= */
const HUD = {
  el: {}, last: {}, rows: [], msgT: null, lastIcon: '',
  init() {
    const g = (id) => document.getElementById(id);
    this.el = {
      hud: g('hud'), pos: g('hud-pos'), lap: g('hud-lap'), time: g('hud-time'), item: g('item-cv'), count: g('item-count'), slot: g('item-slot'),
      mini: g('minimap'), rank: g('hud-rank'), speed: g('hud-speed'), msg: g('hud-msg'), sub: g('hud-sub'), banner: g('hud-banner'), wrong: g('hud-wrong'),
    };
    this.itemCtx = this.el.item.getContext('2d'); this.itemCtx.imageSmoothingEnabled = false;
    this.miniCtx = this.el.mini.getContext('2d'); this.miniCtx.imageSmoothingEnabled = false;
  },
  show(on) { this.el.hud.classList.toggle('hidden', !on); if (!on) { this.el.msg.className = 'hud-msg'; this.el.sub.innerHTML = ''; this.banner(null); } },
  msg(text, cls, dur) {
    const m = this.el.msg;
    m.textContent = text;
    m.className = 'hud-msg';
    void m.offsetWidth;
    m.className = 'hud-msg show ' + (cls || '');
    clearTimeout(this.msgT);
    this.msgT = setTimeout(() => { m.className = 'hud-msg'; }, (dur || 1) * 1000);
  },
  sub(text, cls) {
    const d = document.createElement('div');
    d.className = 'sub-item ' + (cls || '');
    d.textContent = text;
    this.el.sub.appendChild(d);
    while (this.el.sub.children.length > 3) this.el.sub.firstChild.remove();
    setTimeout(() => { if (d.parentNode) d.remove(); }, 2300);
  },
  banner(course) {
    const b = this.el.banner;
    if (!course) { b.classList.remove('show'); return; }
    const race = Game.race;
    const cls = race ? CLASSES[race.cfg.cls] : CLASSES[1];
    const modeName = race ? ({ gp: 'グランプリ', vs: 'フリーラン', ta: 'タイムアタック' }[race.cfg.mode] || '') : '';
    const gpInfo = race && race.cfg.mode === 'gp' && Game.gp ? `${CUPS[Game.gp.cup].name} RACE ${Game.gp.idx + 1}/${CUPS[Game.gp.cup].courses.length}` : '';
    b.innerHTML = `<small>${modeName} ${race && race.cfg.mode !== 'ta' ? cls.name : ''} ${gpInfo}</small><strong>${course.name}</strong><em>${course.en}${race && race.cfg.mirror ? ' / MIRROR' : ''}</em>`;
    b.classList.add('show');
  },
  setup(race) {
    this.last = {};
    this.lastIcon = '';
    this.itemCtx.clearRect(0, 0, 16, 16);
    this.el.count.textContent = '';
    this.el.sub.innerHTML = '';
    this.el.wrong.classList.remove('show');
    this.el.mini.parentNode.style.display = S().minimap ? '' : 'none';
    const r = this.el.rank;
    r.innerHTML = '';
    this.rows = race.karts.map((k) => {
      const d = document.createElement('div');
      d.className = 'rank-row' + (k.isPlayer ? ' me' : '');
      d.innerHTML = `<b></b><img alt="" src="${Gfx.charIcon[k.ci]}"><span>${k.ch.name}</span>`;
      r.appendChild(d);
      return { k, el: d, num: d.querySelector('b'), place: -1 };
    });
    r.style.height = (race.karts.length * 22) + 'px';
    this.el.hud.classList.toggle('solo', race.karts.length <= 1);
    this.el.hud.classList.toggle('noitems', !race.cfg.items && race.cfg.mode !== 'ta');
  },
  set(key, val, fn) { if (this.last[key] !== val) { this.last[key] = val; fn(val); } },
  update(race) {
    const p = race.player;
    if (!p) return;
    const E = this.el;
    const t = race.phase === 'intro' || race.phase === 'countdown' ? 0 : (p.finished ? p.finishTime : race.raceTime);
    this.set('time', fmtTime(t * 1000), (v) => { E.time.textContent = v; });
    if (race.sections) {
      const sec = race.sectionOf(p);
      this.set('lap', 'S' + sec, () => { E.lap.innerHTML = `SEC <b>${sec}</b><span>/${race.sections}</span>`; });
    } else {
      const lap = clamp(p.lapsDone + 1, 1, race.laps);
      this.set('lap', lap, (v) => { E.lap.innerHTML = `LAP <b>${v}</b><span>/${race.laps}</span>`; });
    }
    this.set('pos', p.place, (v) => {
      E.pos.innerHTML = `<b>${v}</b><span>${ordinal(v)}</span>`;
      E.pos.className = 'hud-pos p' + Math.min(v, 4);
      void E.pos.offsetWidth; E.pos.classList.add('pop');
    });
    this.set('speed', Math.round(Math.abs(p.speed) * 0.9), (v) => { E.speed.innerHTML = `<b>${v}</b><span>km/h</span>`; });
    // アイテム
    let key = p.item || '';
    if (p.rouletteT > 0) key = ITEM_KEYS[Math.floor(Renderer.time / 0.07) % ITEM_KEYS.length];
    if (key !== this.lastIcon) {
      this.lastIcon = key;
      this.itemCtx.clearRect(0, 0, 16, 16);
      if (key) this.itemCtx.drawImage(Gfx.icons[key], 0, 0);
      if (p.rouletteT > 0) AudioSys.sfx('tick');
    }
    this.set('roul', p.rouletteT > 0, (v) => { E.slot.classList.toggle('roulette', v); });
    this.set('cnt', p.item === 'nitro3' && p.rouletteT <= 0 ? p.itemCount : 0, (v) => { E.count.textContent = v > 1 ? '×' + v : ''; });
    this.set('has', !!p.item && p.rouletteT <= 0, (v) => { E.slot.classList.toggle('has', v); });
    // 逆走
    this.set('wrong', p.wrongT > 1.2, (v) => { E.wrong.classList.toggle('show', v); if (v) AudioSys.sfx('wrong'); });
    // 順位リスト
    for (const r of this.rows) {
      if (r.place !== r.k.place) {
        r.place = r.k.place;
        r.el.style.transform = `translateY(${(r.place - 1) * 22}px)`;
        r.num.textContent = r.place;
      }
    }
    // ミニマップ
    if (S().minimap) {
      const g = this.miniCtx, T = race.track, m = T.mini;
      g.clearRect(0, 0, m.size, m.size);
      g.drawImage(T.miniCanvas, 0, 0);
      const dot = (x, y, col, r) => { g.fillStyle = '#0b0820'; g.fillRect(Math.round(x * m.sc + m.ox - r - 1), Math.round(y * m.sc + m.oy - r - 1), r * 2 + 2, r * 2 + 2); g.fillStyle = col; g.fillRect(Math.round(x * m.sc + m.ox - r), Math.round(y * m.sc + m.oy - r), r * 2, r * 2); };
      if (race.ghostPos) dot(race.ghostPos.x, race.ghostPos.y, 'rgba(255,255,255,0.6)', 2);
      for (const k of race.karts) if (!k.isPlayer) dot(k.x, k.y, k.ch.body, 2);
      dot(p.x, p.y, '#ffffff', 3);
      g.fillStyle = '#ff3d7f'; g.fillRect(Math.round(p.x * m.sc + m.ox - 1), Math.round(p.y * m.sc + m.oy - 1), 2, 2);
    }
  },
};

/* =========================================================
   13. メニューUI
   ========================================================= */
function shuffle(a) { const r = a.slice(); for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; } return r; }
const STAT_LABELS = [['spd', 'スピード'], ['acc', '加速'], ['hdl', 'ハンドル'], ['wgt', '重さ']];
const UI = {
  cur: null,
  flow: { mode: 'gp', cls: 0, char: 0, course: 0, laps: 3, cpu: 7, items: true },
  charSel: 0, courseSel: 0, cupSel: 0, prePtr: -1, resetArm: false, trophyURL: {},
  init() {
    this.flow.char = Store.data.lastChar || 0;
    this.charSel = this.flow.char;
    [1, 2, 3].forEach((k) => { this.trophyURL[k] = Gfx.trophy(k).toDataURL(); });
    $('#ui').addEventListener('click', (e) => this.onClick(e));
    $('#ui').addEventListener('pointerdown', (e) => {
      const t = e.target.closest('[data-act="char"],[data-act="course"],[data-act="cup"]');
      this.prePtr = t ? ({ char: this.charSel, course: this.courseSel, cup: this.cupSel }[t.dataset.act]) : -1;
    }, true);
    $('#scr-title').addEventListener('click', () => this.pressStart());
    this.buildCharGrid();
    this.buildCourseGrid();
    this.buildHowto();
    this.bindOptions();
    $$('#ui button').forEach((b) => b.addEventListener('mouseenter', () => { if (document.activeElement !== b) { b.focus({ preventScroll: true }); } }));
  },
  pressStart() {
    if (this.cur !== 'title') return;
    AudioSys.init();
    if (S().motionJA) Input.enableMotion().then((ok) => { if (!ok && isTouchDevice) { S().motionJA = false; Store.save(); } });
    AudioSys.sfx('select');
    Music.play('title');
    this.show('main');
  },
  show(name) {
    this.cur = name;
    $$('.screen').forEach((s) => s.classList.toggle('active', s.id === 'scr-' + name));
    $('#ui').classList.toggle('open', true);
    const hook = { class: 'onClass', char: 'onChar', course: 'onCourse', cup: 'onCup', records: 'onRecords', options: 'onOptions' }[name];
    if (hook) this[hook]();
    const scr = $('#scr-' + name);
    const first = scr && (scr.querySelector('[data-autofocus]') || scr.querySelector('button:not([disabled])'));
    if (first) setTimeout(() => { if (this.cur !== name) return; try { first.focus({ preventScroll: true }); } catch (e) { first.focus(); } }, 20);
  },
  hideAll() { this.cur = null; $$('.screen').forEach((s) => s.classList.remove('active')); $('#ui').classList.remove('open'); },
  focusables() {
    const scr = this.cur && $('#scr-' + this.cur);
    if (!scr) return [];
    return $$('button:not([disabled]), input[type="range"]', scr).filter((e) => e.offsetParent !== null);
  },
  nav(dir) {
    const els = this.focusables();
    if (!els.length) return;
    const a = document.activeElement;
    if (!els.includes(a)) { els[0].focus(); return; }
    const ra = a.getBoundingClientRect(), ax = ra.left + ra.width / 2, ay = ra.top + ra.height / 2;
    let best = null, bs = Infinity;
    for (const e of els) {
      if (e === a) continue;
      const r = e.getBoundingClientRect(), ex = r.left + r.width / 2, ey = r.top + r.height / 2;
      const dx = ex - ax, dy = ey - ay;
      let main, cross;
      if (dir === 'up') { main = -dy; cross = Math.abs(dx); } else if (dir === 'down') { main = dy; cross = Math.abs(dx); }
      else if (dir === 'left') { main = -dx; cross = Math.abs(dy); } else { main = dx; cross = Math.abs(dy); }
      if (main <= 2) continue;
      const score = main + cross * 2.2;
      if (score < bs) { bs = score; best = e; }
    }
    if (best) { best.focus(); AudioSys.sfx('cursor'); }
  },
  activate() {
    const a = document.activeElement;
    if (this.cur === 'title') { this.pressStart(); return; }
    if (a && this.focusables().includes(a) && a.tagName === 'BUTTON') a.click();
  },
  back() {
    const f = this.flow;
    const map = { main: 'title', class: 'main', char: f.mode === 'ta' ? 'main' : 'class', course: 'char', cup: 'char', options: 'main', records: 'main', howto: 'main' };
    if (this.cur === 'pause') { Game.togglePause(); return; }
    const to = map[this.cur];
    if (!to) return;
    AudioSys.sfx('back');
    this.show(to);
  },
  onKey(e) {
    if (Game.state === 'race' && !Game.paused) {
      if (Game.race && Game.race.phase === 'intro' && (e.code === 'Enter' || e.code === 'Space')) Game.race.skipReq = true;
      return;
    }
    if (!this.cur) return;
    if (this.cur === 'title') { if (e.code === 'Enter' || e.code === 'Space') { e.preventDefault(); this.pressStart(); } return; }
    const a = document.activeElement;
    const isRange = a && a.type === 'range';
    const dirs = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right' };
    if (dirs[e.code]) {
      if (isRange && (dirs[e.code] === 'left' || dirs[e.code] === 'right')) return;
      e.preventDefault(); this.nav(dirs[e.code]); return;
    }
    if (e.code === 'Escape' || e.code === 'Backspace') { e.preventDefault(); this.back(); return; }
    if (e.code === 'Space' && a && a.tagName === 'BUTTON') { e.preventDefault(); a.click(); }
  },
  onClick(e) {
    const t = e.target.closest('button');
    if (!t) return;
    AudioSys.init();
    const go = t.dataset.go, act = t.dataset.act;
    if (go) {
      if (go === 'gp' || go === 'vs' || go === 'ta') {
        this.flow.mode = go;
        AudioSys.sfx('select');
        this.show(go === 'ta' ? 'char' : 'class');
        return;
      }
      AudioSys.sfx(go === 'main' ? 'back' : 'select');
      this.show(go);
      return;
    }
    if (!act) return;
    switch (act) {
      case 'back': this.back(); break;
      case 'class': {
        const i = +t.dataset.i;
        if (CLASSES[i].mirror && !Store.data.unlock.mirror) { AudioSys.sfx('deny'); $('#class-desc').textContent = 'エキスパートのグランプリで優勝すると解放されます。'; break; }
        this.flow.cls = i; AudioSys.sfx('select'); this.show('char'); break;
      }
      case 'char': {
        const i = +t.dataset.i;
        // キーボード/パッド：フォーカス済みのカードで決定。マウス/タッチ：押す前から選択済みなら決定
        const was = e.detail === 0 ? this.charSel === i : this.prePtr === i;
        if (was) { this.confirmChar(); break; }
        this.selectChar(i); AudioSys.sfx('cursor'); break;
      }
      case 'char-ok': this.confirmChar(); break;
      case 'cup': {
        const i = +t.dataset.i;
        const was = e.detail === 0 ? this.cupSel === i : this.prePtr === i;
        if (was) { this.confirmCup(); break; }
        this.selectCup(i); AudioSys.sfx('cursor'); break;
      }
      case 'cup-ok': this.confirmCup(); break;
      case 'course': {
        const i = +t.dataset.i;
        const was = e.detail === 0 ? this.courseSel === i : this.prePtr === i;
        if (was) { this.confirmCourse(); break; }
        this.selectCourse(i); AudioSys.sfx('cursor'); break;
      }
      case 'course-ok': this.confirmCourse(); break;
      case 'laps': this.flow.laps = this.flow.laps === 3 ? 5 : this.flow.laps === 5 ? 1 : 3; AudioSys.sfx('cursor'); this.updateCourseOpts(); break;
      case 'cpu': this.flow.cpu = (this.flow.cpu + 1) % 8; AudioSys.sfx('cursor'); this.updateCourseOpts(); break;
      case 'items': this.flow.items = !this.flow.items; AudioSys.sfx('cursor'); this.updateCourseOpts(); break;
      case 'resume': AudioSys.sfx('select'); Game.togglePause(); break;
      case 'restart': AudioSys.sfx('select'); Game.restart(); break;
      case 'quit': AudioSys.sfx('back'); Game.toMenu('main'); break;
      case 'next': AudioSys.sfx('select'); Game.nextAfterResult(); break;
      case 'retry': AudioSys.sfx('select'); Game.restart(); break;
      case 'tocourse': AudioSys.sfx('select'); Game.toMenu('course'); break;
      case 'gpnext': AudioSys.sfx('select'); Game.gpNext(); break;
      case 'opt': this.toggleOpt(t); break;
      case 'reset':
        if (!this.resetArm) { this.resetArm = true; t.textContent = 'もう一度おすとリセット'; t.classList.add('danger'); AudioSys.sfx('deny'); }
        else { Store.reset(); this.resetArm = false; AudioSys.applyVolumes(); Renderer.resize(); this.onOptions(); AudioSys.sfx('select'); t.textContent = 'リセットしました'; }
        break;
      default: break;
    }
  },
  /* --- クラス --- */
  onClass() {
    const box = $('#class-list');
    const gp = this.flow.mode === 'gp';
    $('#class-title').textContent = gp ? 'グランプリ：クラスをえらぶ' : 'フリーラン：クラスをえらぶ';
    box.innerHTML = CLASSES.map((c, i) => {
      const locked = c.mirror && !Store.data.unlock.mirror;
      const trImg = gp ? CUPS.map((cp) => { const tr = Store.data.trophies[cp.id + '_' + c.id]; return tr ? `<img class="tr" alt="${cp.name}${tr}位" src="${this.trophyURL[tr] || ''}">` : ''; }).join('') : '';
      return `<button class="btn big cls-btn${locked ? ' locked' : ''}" data-act="class" data-i="${i}" data-desc="${c.desc}"><span class="cls-en">${c.en}</span><span class="cls-jp">${locked ? '？？？' : c.name}</span>${trImg}</button>`;
    }).join('');
    $('#class-desc').textContent = CLASSES[0].desc;
    $$('.cls-btn', box).forEach((b) => b.addEventListener('focus', () => {
      const c = CLASSES[+b.dataset.i];
      $('#class-desc').textContent = c.mirror && !Store.data.unlock.mirror ? 'エキスパートのグランプリで優勝すると解放されます。' : c.desc;
    }));
    const cur = box.querySelector(`[data-i="${this.flow.cls}"]`);
    if (cur) cur.setAttribute('data-autofocus', '');
  },
  /* --- キャラ --- */
  buildCharGrid() {
    $('#char-grid').innerHTML = CHARS.map((c, i) => `<button class="char-card" data-act="char" data-i="${i}" style="--c:${c.body}"><img alt="" src="${Gfx.charIcon[i]}"><span>${c.name}</span></button>`).join('');
    $$('#char-grid .char-card').forEach((b) => b.addEventListener('focus', () => { if (this.cur === 'char') this.selectChar(+b.dataset.i); }));
  },
  onChar() {
    this.selectChar(this.charSel);
    $('#char-title').textContent = this.flow.mode === 'ta' ? 'タイムアタック：キャラクターをえらぶ' : 'キャラクターをえらぶ';
    $$('#char-grid .char-card').forEach((b) => b.removeAttribute('data-autofocus'));
    const cur = $(`#char-grid [data-i="${this.charSel}"]`);
    if (cur) cur.setAttribute('data-autofocus', '');
  },
  selectChar(i) {
    this.charSel = i;
    const c = CHARS[i];
    $$('#char-grid .char-card').forEach((b) => b.classList.toggle('sel', +b.dataset.i === i));
    $('#char-name').textContent = c.name;
    $('#char-desc').textContent = c.desc;
    $('#char-stats').innerHTML = STAT_LABELS.map(([k, lab]) => `<div class="stat"><span>${lab}</span><i>${'<b></b>'.repeat(c.stats[k])}${'<u></u>'.repeat(5 - c.stats[k])}</i></div>`).join('');
    $('#char-prev-wrap').style.setProperty('--c', c.body);
  },
  confirmChar() {
    this.flow.char = this.charSel;
    Store.data.lastChar = this.charSel; Store.save();
    AudioSys.sfx('select');
    this.show(this.flow.mode === 'gp' ? 'cup' : 'course');
  },
  drawCharPreview() {
    const cv = $('#char-prev');
    if (!cv) return;
    const g = cv.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, cv.width, cv.height);
    const idx = Math.floor(Renderer.time * 7) % SPRITE_N;
    g.drawImage(Gfx.karts[this.charSel][(SPRITE_N - idx) % SPRITE_N], 0, 0);
  },
  /* --- コース --- */
  /* --- カップ（グランプリ） --- */
  onCup() {
    const cls = CLASSES[this.flow.cls];
    $('#cup-title').textContent = `グランプリ（${cls.name}）：カップをえらぶ`;
    $('#cup-list').innerHTML = CUPS.map((cp, i) => {
      const tr = Store.data.trophies[cp.id + '_' + cls.id];
      const minis = cp.courses.map((ci) => `<canvas width="128" height="128" data-cupmini="${ci}"></canvas>`).join('');
      return `<button class="cup-card" data-act="cup" data-i="${i}" style="--cc:${cp.color}"><span class="cup-name">${cp.name}<small>${cp.en}</small></span><span class="cup-minis">${minis}</span><span class="cup-courses">${cp.courses.map((ci) => COURSES[ci].name).join(' / ')}</span>${tr ? `<img class="tr" alt="${tr}位" src="${this.trophyURL[tr]}">` : ''}</button>`;
    }).join('');
    $$('#cup-list canvas').forEach((cv) => { cv.getContext('2d').drawImage(getMiniTrack(+cv.dataset.cupmini).miniCanvas, 0, 0); });
    $$('#cup-list .cup-card').forEach((b) => b.addEventListener('focus', () => { if (this.cur === 'cup') this.selectCup(+b.dataset.i); }));
    this.selectCup(this.cupSel);
    const cur = $(`#cup-list [data-i="${this.cupSel}"]`);
    if (cur) cur.setAttribute('data-autofocus', '');
  },
  selectCup(i) {
    this.cupSel = i;
    $$('#cup-list .cup-card').forEach((b) => b.classList.toggle('sel', +b.dataset.i === i));
    $('#cup-desc').textContent = CUPS[i].desc;
  },
  confirmCup() {
    AudioSys.sfx('select');
    Game.startGP(this.cupSel);
  },
  buildCourseGrid() {
    const card = (i, cls) => { const c = COURSES[i]; return `<button class="course-card${cls || ''}" data-act="course" data-i="${i}"><canvas width="128" height="128" data-mini="${i}"></canvas><span class="c-jp">${c.name}</span><span class="c-en">${c.en}</span></button>`; };
    const specials = COURSES.map((c, i) => (c.special ? i : -1)).filter((i) => i >= 0);
    $('#course-grid').innerHTML = CUPS.map((cp) => `<div class="cup-head" style="--cc:${cp.color}">${cp.name}<small>${cp.en}</small></div>` + cp.courses.map((i) => card(i)).join('')).join('')
      + (specials.length ? `<div class="cup-head special-head" style="--cc:#ff8a2a">スペシャル<small>SPECIAL・フリーラン限定</small></div>` + specials.map((i) => card(i, ' special')).join('') : '');
    $$('#course-grid .course-card').forEach((b) => b.addEventListener('focus', () => { if (this.cur === 'course') this.selectCourse(+b.dataset.i); }));
  },
  ensureMinis() {
    if (this.minisDone) return;
    $$('#course-grid canvas').forEach((cv) => {
      const t = getMiniTrack(+cv.dataset.mini);
      cv.getContext('2d').drawImage(t.miniCanvas, 0, 0);
    });
    this.minisDone = true;
  },
  onCourse() {
    this.ensureMinis();
    const ta = this.flow.mode === 'ta';
    $('#course-grid').classList.toggle('no-special', ta);
    if (ta && COURSES[this.courseSel].special) this.courseSel = 0;
    $('#course-title').textContent = ta ? 'タイムアタック：コースをえらぶ' : 'フリーラン：コースをえらぶ';
    $('#course-opts').style.display = ta ? 'none' : '';
    this.updateCourseOpts();
    this.selectCourse(this.courseSel);
    $$('#course-grid .course-card').forEach((b) => b.removeAttribute('data-autofocus'));
    const cur = $(`#course-grid [data-i="${this.courseSel}"]`);
    if (cur) cur.setAttribute('data-autofocus', '');
  },
  selectCourse(i) {
    this.courseSel = i;
    if (this.cur === 'course') this.updateCourseOpts();
    const c = COURSES[i];
    $$('#course-grid .course-card').forEach((b) => b.classList.toggle('sel', +b.dataset.i === i));
    const rec = Store.data.records[c.id];
    const best = rec && rec.best ? fmtTime(rec.best) : `-'--"--`;
    const lap = rec && rec.lap ? fmtTime(rec.lap) : `-'--"--`;
    const ghost = this.flow.mode === 'ta' && Store.getGhost(c.id) ? '<span class="tag">ゴーストあり</span>' : '';
    $('#course-info').innerHTML = c.special
      ? `<p>${c.desc}</p><p class="rec">全長は通常コースの約3.5倍・3セクション構成（タイムアタック対象外）</p>`
      : `<p>${c.desc}</p><p class="rec">ベストタイム <b>${best}</b>　ベストラップ <b>${lap}</b> ${ghost}</p>`;
  },
  updateCourseOpts() {
    const f = this.flow;
    const sp = COURSES[this.courseSel] && COURSES[this.courseSel].laps;
    $('#opt-laps').textContent = sp ? `周回：${sp}（固定）` : `周回：${f.laps}`;
    $('#opt-laps').disabled = !!sp;
    $('#opt-cpu').textContent = `CPU：${f.cpu}台`;
    $('#opt-items').textContent = `アイテム：${f.items ? 'あり' : 'なし'}`;
  },
  confirmCourse() {
    this.flow.course = this.courseSel;
    AudioSys.sfx('select');
    if (this.flow.mode === 'ta') Game.startTA(); else Game.startVS();
  },
  /* --- 設定 --- */
  bindOptions() {
    const bgm = $('#opt-bgm'), se = $('#opt-se');
    bgm.addEventListener('input', () => { S().bgm = bgm.value / 100; AudioSys.applyVolumes(); Store.save(); $('#opt-bgm-v').textContent = bgm.value; });
    se.addEventListener('input', () => { S().se = se.value / 100; AudioSys.applyVolumes(); Store.save(); $('#opt-se-v').textContent = se.value; });
    se.addEventListener('change', () => AudioSys.sfx('itemget'));
  },
  onOptions() {
    const st = S();
    $('#opt-bgm').value = Math.round(st.bgm * 100); $('#opt-bgm-v').textContent = Math.round(st.bgm * 100);
    $('#opt-se').value = Math.round(st.se * 100); $('#opt-se-v').textContent = Math.round(st.se * 100);
    $$('[data-act="opt"]').forEach((b) => this.optLabel(b));
    const r = $('[data-act="reset"]'); r.textContent = 'セーブデータをリセット'; r.classList.remove('danger'); this.resetArm = false;
  },
  optLabel(b) {
    const k = b.dataset.opt, v = S()[k];
    if (k === 'quality') b.textContent = { low: '軽い', mid: 'ふつう', high: 'きれい' }[v] || 'ふつう';
    else b.textContent = v ? 'ON' : 'OFF';
    b.classList.toggle('on', k === 'quality' ? true : !!v);
  },
  toggleOpt(b) {
    const k = b.dataset.opt, st = S();
    if (k === 'quality') { const o = ['low', 'mid', 'high']; st.quality = o[(o.indexOf(st.quality) + 1) % 3]; Renderer.resize(); }
    else if (k === 'gyro') {
      if (!st.gyro) {
        Input.enableGyro().then((ok) => {
          st.gyro = ok; Store.save(); this.optLabel(b);
          if (!ok) $('#opt-note').textContent = 'この端末ではジャイロ操作が使えません。';
          else $('#opt-note').textContent = 'スマホをハンドルのように傾けて操作できます。';
        });
        return;
      }
      st.gyro = false;
    } else if (k === 'motionJA') {
      if (!st.motionJA) {
        Input.enableMotion().then((ok) => {
          st.motionJA = ok; Store.save(); this.optLabel(b);
          $('#opt-note').textContent = ok ? 'ジャンプ台やカイトで飛んだ時にスマホを振るとトリック！' : 'この端末では「ふってトリック」が使えません。';
        });
        return;
      }
      st.motionJA = false;
    } else st[k] = !st[k];
    Store.save(); this.optLabel(b); AudioSys.sfx('cursor');
    Game.refreshTouchUI();
  },
  /* --- 記録 --- */
  onRecords() {
    const rows = COURSES.filter((c) => !c.special).map((c) => {
      const r = Store.data.records[c.id] || {};
      return `<tr><th>${c.name}</th><td>${r.best ? fmtTime(r.best) : `-'--"--`}</td><td>${r.lap ? fmtTime(r.lap) : `-'--"--`}</td><td>${r.char != null ? `<img alt="" src="${Gfx.charIcon[r.char]}">` : ''}</td></tr>`;
    }).join('');
    const tr = CUPS.map((cp) => `<h4 class="tro-cup" style="--cc:${cp.color}">${cp.name}</h4><div class="tro-list">` + CLASSES.map((c) => {
      const v = Store.data.trophies[cp.id + '_' + c.id];
      const locked = c.mirror && !Store.data.unlock.mirror;
      return `<div class="tro"><span>${locked ? '？？？' : c.name}</span>${v ? `<img alt="${v}位" src="${this.trophyURL[v]}"><b>${v}位</b>` : '<em>まだ</em>'}</div>`;
    }).join('') + '</div>').join('');
    $('#records-body').innerHTML = `<h3>タイムアタック</h3><table class="rec-table"><tr><th></th><td>ベスト</td><td>ラップ</td><td></td></tr>${rows}</table><h3>グランプリのトロフィー</h3>${tr}`;
  },
  /* --- あそびかた --- */
  buildHowto() {
    $('#howto-items').innerHTML = ITEM_KEYS.map((k) => `<div class="hi"><img alt="" src="${Gfx.iconURL[k]}"><div><b>${ITEMS[k].name}</b><p>${ITEMS[k].desc}</p></div></div>`).join('');
  },
  /* --- リザルト --- */
  showResult(res, mode) {
    const gp = mode === 'gp';
    $('#result-title').textContent = gp ? `${CUPS[Game.gp.cup].en} RACE ${Game.gp.idx + 1}` : 'RESULT';
    $('#result-list').innerHTML = res.map((r, i) => `<div class="res-row p${Math.min(r.place, 4)}${r.isPlayer ? ' me' : ''}" style="animation-delay:${i * 70}ms"><span class="rp">${r.place}<small>${ordinal(r.place)}</small></span><img alt="" src="${Gfx.charIcon[r.ci]}"><span class="rn">${CHARS[r.ci].name}</span><span class="rt">${r.est ? `<i>${fmtTime(r.time * 1000)}</i>` : fmtTime(r.time * 1000)}</span>${gp ? `<span class="rpt">+${GP_POINTS[r.place - 1] || 0}</span>` : ''}</div>`).join('');
    $('#result-btns').innerHTML = gp
      ? '<button class="btn big" data-act="next" data-autofocus>つぎへ</button>'
      : '<button class="btn big" data-act="retry" data-autofocus>もう一度</button><button class="btn" data-act="tocourse">コースをえらぶ</button><button class="btn" data-act="quit">メニューへ</button>';
    this.show('result');
  },
  showStandings(gpState, lastRes) {
    const add = {};
    lastRes.forEach((r) => { add[r.ci] = GP_POINTS[r.place - 1] || 0; });
    const list = Object.keys(gpState.points).map((ci) => +ci).filter((ci) => gpState.members.includes(ci))
      .sort((a, b) => gpState.points[b] - gpState.points[a] || gpState.lastPlace[a] - gpState.lastPlace[b]);
    $('#stand-title').textContent = `${CUPS[gpState.cup].name} ランキング（${gpState.idx + 1}/${CUPS[gpState.cup].courses.length}レース）`;
    $('#stand-list').innerHTML = list.map((ci, i) => `<div class="res-row p${Math.min(i + 1, 4)}${ci === gpState.player ? ' me' : ''}" style="animation-delay:${i * 70}ms"><span class="rp">${i + 1}<small>${ordinal(i + 1)}</small></span><img alt="" src="${Gfx.charIcon[ci]}"><span class="rn">${CHARS[ci].name}</span><span class="rpt">+${add[ci] || 0}</span><span class="rt"><b>${gpState.points[ci]}</b>pt</span></div>`).join('');
    const last = gpState.idx >= CUPS[gpState.cup].courses.length - 1;
    $('#stand-btns').innerHTML = `<button class="btn big" data-act="gpnext" data-autofocus>${last ? 'けっかはっぴょう' : 'つぎのレースへ'}</button><button class="btn" data-act="quit">やめる</button>`;
    this.show('standings');
  },
  showPodium(order, playerCi, unlocked) {
    const rank = order.indexOf(playerCi) + 1;
    const cv = $('#podium-cv'), g = cv.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, cv.width, cv.height);
    const steps = [[80, 64, 40, 36, 1], [30, 76, 40, 24, 2], [130, 82, 40, 18, 3]];
    steps.forEach(([x, y, w, h, n]) => {
      g.fillStyle = n === 1 ? '#ffd23f' : n === 2 ? '#c9d0de' : '#e08a4a'; g.fillRect(x, y, w, h);
      g.fillStyle = 'rgba(0,0,0,0.2)'; g.fillRect(x, y + h - 4, w, 4);
      g.fillStyle = '#1b1440'; g.font = '10px "Press Start 2P", monospace'; g.textAlign = 'center'; g.fillText(String(n), x + w / 2, y + 14);
      const ci = order[n - 1];
      if (ci != null) g.drawImage(Gfx.charFront[ci], x + w / 2 - 17, y - 30);
    });
    if (rank >= 1 && rank <= 3) g.drawImage(Gfx.trophy(rank), 176, 18);
    const msg = rank === 1 ? '優勝おめでとう！' : rank <= 3 ? `${rank}位入賞！` : `${rank}位…次こそ表彰台！`;
    $('#podium-msg').innerHTML = `<strong>${msg}</strong>${unlocked ? '<em>ミラーモードが解放された！</em>' : ''}`;
    $('#podium-rank').innerHTML = `${rank}<small>${ordinal(rank)}</small>`;
    this.show('podium');
  },
  showTA(data) {
    $('#ta-body').innerHTML = `<div class="ta-time${data.newBest ? ' nb' : ''}">${fmtTime(data.time)}</div>${data.newBest ? '<div class="ta-new">NEW RECORD!</div>' : `<div class="ta-best">ベスト ${fmtTime(data.best)}</div>`}<ol class="ta-laps">${data.laps.map((l, i) => `<li${l === data.fastest ? ' class="fast"' : ''}><span>LAP ${i + 1}</span>${fmtTime(l)}</li>`).join('')}</ol>${data.newLap ? '<div class="ta-new small">ベストラップ更新！</div>' : ''}${data.ghostSaved ? '<p class="ta-note">ゴーストを保存したよ。次はゴーストと勝負！</p>' : ''}`;
    this.show('taresult');
  },
};

/* =========================================================
   14. ゲーム全体の制御
   ========================================================= */
const Game = {
  state: 'boot', race: null, demo: null, paused: false, gp: null, lastCfg: null,
  makeDemo() {
    const normal = COURSES.map((c, i) => (c.special ? -1 : i)).filter((i) => i >= 0);
    const ci = normal[Math.floor(Math.random() * normal.length)];
    this.demo = new Race({ demo: true, mode: 'demo', cls: 1, mirror: false, course: ci, laps: 99, items: true, grid: shuffle(CHARS.map((c, i) => i)), player: -1 });
  },
  loading(on) { $('#loading').classList.toggle('show', on); },
  toMenu(screen) {
    this.state = 'menu'; this.race = null; this.paused = false;
    AudioSys.setWater(false);
    HUD.show(false); this.refreshTouchUI();
    AudioSys.engineStop();
    Music.play('title');
    if (!this.demo) this.makeDemo();
    UI.show(screen || 'main');
  },
  refreshTouchUI() {
    const show = Input.usedTouch && this.state === 'race' && !this.paused && this.race && !this.race.ended;
    const t = $('#touch');
    t.classList.toggle('hidden', !show);
    t.classList.toggle('manual', !S().autoAccel);
    t.classList.toggle('noitem', !!(this.race && !this.race.cfg.items && this.race.cfg.mode !== 'ta'));
    $('#btn-pause').classList.toggle('touch', Input.usedTouch);
    $('#app').classList.toggle('touchmode', show);
    $('#app').classList.toggle('portrait', Renderer.portrait);
  },
  startRace(cfg) {
    this.lastCfg = cfg;
    UI.hideAll();
    this.loading(true);
    Music.stop();
    setTimeout(() => {
      let race;
      try { race = new Race(cfg); } catch (e) { console.error(e); this.loading(false); this.toMenu('main'); return; }
      this.loading(false);
      this.race = race; this.state = 'race'; this.paused = false;
      Input.resetTouch();
      HUD.setup(race); HUD.show(true); HUD.banner(COURSES[cfg.course]);
      this.refreshTouchUI();
      AudioSys.sfx('intro');
      AudioSys.engineStart();
    }, 60);
  },
  gridWith(player, others, playerBack) { return playerBack ? others.concat([player]) : [player].concat(others); },
  startGP(cup) {
    const f = UI.flow;
    const rivals = shuffle(CHARS.map((c, i) => i).filter((i) => i !== f.char));
    const points = {}, lastPlace = {};
    CHARS.forEach((c, i) => { points[i] = 0; lastPlace[i] = 9; });
    this.gp = { cup: cup || 0, cls: f.cls, mirror: !!CLASSES[f.cls].mirror, idx: 0, points, lastPlace, player: f.char, rivals, members: rivals.concat([f.char]) };
    this.startGPRace();
  },
  startGPRace() {
    const gp = this.gp;
    let grid;
    if (gp.idx === 0) grid = gp.rivals.concat([gp.player]);
    else grid = gp.members.slice().sort((a, b) => gp.points[b] - gp.points[a] || gp.lastPlace[a] - gp.lastPlace[b]);
    this.startRace({ mode: 'gp', cls: gp.cls, mirror: gp.mirror, course: CUPS[gp.cup].courses[gp.idx], laps: 3, items: true, grid, player: gp.player });
  },
  startVS() {
    const f = UI.flow;
    const others = shuffle(CHARS.map((c, i) => i).filter((i) => i !== f.char)).slice(0, f.cpu);
    const cd = COURSES[f.course];
    this.startRace({ mode: 'vs', cls: f.cls, mirror: !!CLASSES[f.cls].mirror, course: f.course, laps: cd.laps || f.laps, items: f.items, grid: others.concat([f.char]), player: f.char });
  },
  startTA() {
    const f = UI.flow;
    this.startRace({ mode: 'ta', cls: 1, mirror: false, course: f.course, laps: 3, items: false, grid: [f.char], player: f.char, ghost: Store.getGhost(COURSES[f.course].id) });
  },
  restart() {
    if (!this.lastCfg) return;
    const c = Object.assign({}, this.lastCfg);
    if (c.mode === 'ta') c.ghost = Store.getGhost(COURSES[c.course].id);
    AudioSys.engineStop();
    this.startRace(c);
  },
  togglePause() {
    if (this.state !== 'race' || !this.race || this.race.ended) return;
    this.paused = !this.paused;
    if (this.paused) { UI.show('pause'); Music.pause(true); AudioSys.engineSilence(); Input.resetTouch(); }
    else { UI.hideAll(); Music.pause(false); }
    this.refreshTouchUI();
  },
  onRaceEnd(race) {
    AudioSys.engineStop();
    AudioSys.setWater(false);
    this.state = 'results';
    HUD.show(false);
    this.refreshTouchUI();
    const res = race.results();
    this.lastRes = res;
    const mode = race.cfg.mode;
    if (mode === 'ta') {
      const p = race.player, id = COURSES[race.cfg.course].id;
      const time = Math.round(p.finishTime * 1000);
      const laps = p.lapTimes.map((l) => Math.round(l * 1000));
      const fastest = Math.min(...laps);
      const rec = Store.data.records[id] || {};
      const newBest = !rec.best || time < rec.best;
      const newLap = !rec.lap || fastest < rec.lap;
      let ghostSaved = false;
      if (newBest) { rec.best = time; rec.char = p.ci; ghostSaved = Store.setGhost(id, { t: time, c: p.ci, d: race.ghostRec }); }
      if (newLap) rec.lap = fastest;
      Store.data.records[id] = rec; Store.save();
      if (newBest) AudioSys.sfx('record');
      Music.play('result');
      UI.showTA({ time, laps, fastest, newBest, newLap, best: rec.best, ghostSaved });
      return;
    }
    Music.play('result');
    if (mode === 'gp') {
      const gp = this.gp;
      res.forEach((r) => { gp.points[r.ci] += GP_POINTS[r.place - 1] || 0; gp.lastPlace[r.ci] = r.place; });
    }
    UI.showResult(res, mode);
  },
  nextAfterResult() { if (this.gp && this.lastCfg && this.lastCfg.mode === 'gp') UI.showStandings(this.gp, this.lastRes); },
  gpNext() {
    const gp = this.gp;
    if (!gp) { this.toMenu('main'); return; }
    if (gp.idx < CUPS[gp.cup].courses.length - 1) { gp.idx++; this.startGPRace(); return; }
    const order = gp.members.slice().sort((a, b) => gp.points[b] - gp.points[a] || gp.lastPlace[a] - gp.lastPlace[b]);
    const rank = order.indexOf(gp.player) + 1;
    const cid = CUPS[gp.cup].id + '_' + CLASSES[gp.cls].id;
    const prev = Store.data.trophies[cid];
    if (rank <= 3 && (!prev || rank < prev)) Store.data.trophies[cid] = rank;
    let unlocked = false;
    if (CLASSES[gp.cls].id === 'expert' && rank === 1 && !Store.data.unlock.mirror) { Store.data.unlock.mirror = true; unlocked = true; }
    Store.save();
    AudioSys.sfx(rank <= 3 ? 'goal' : 'goalbad');
    if (unlocked) setTimeout(() => AudioSys.sfx('unlock'), 1200);
    this.state = 'menu'; this.race = null;
    if (!this.demo) this.makeDemo();
    UI.showPodium(order, gp.player, unlocked);
  },
  update(dt) {
    if ((this.state === 'race' && !this.paused) || this.state === 'results') { if (this.race) this.race.update(dt); }
    else if (this.state === 'menu' && this.demo) this.demo.update(dt);
  },
  render(dt) {
    const scene = (this.state === 'race' || this.state === 'results') ? this.race : this.demo;
    Renderer.render(scene, dt);
    if (this.state === 'race' && this.race && !this.paused) {
      const r = this.race, p = r.player;
      HUD.update(r);
      if (p) {
        if (r.phase === 'countdown' || r.phase === 'intro') {
          const rev = r.rk.prev ? 0.55 + Math.sin(Renderer.time * 30) * 0.05 : 0.04;
          AudioSys.engineUpdate(rev, r.rk.prev ? 1 : 0, false, false, 0);
        } else AudioSys.engineUpdate(Math.abs(p.speed) / p.maxSpeed, p.inp.accel ? 1 : 0, p.boostT > 0, p.drift !== 0 && p.z <= 0, p.driftLevel);
      }
    }
    if (UI.cur === 'char') UI.drawCharPreview();
  },
};

/* =========================================================
   15. 起動・メインループ
   ========================================================= */
// スマホ対策：長押しのコピー/保存メニュー、文字選択、ダブルタップ・ピンチ拡大を無効化
function installTouchGuards() {
  const opt = { passive: false };
  document.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('selectstart', (e) => { if (!(e.target instanceof HTMLInputElement)) e.preventDefault(); });
  document.addEventListener('dragstart', (e) => e.preventDefault());
  // iOS Safari のピンチ拡大
  ['gesturestart', 'gesturechange', 'gestureend'].forEach((t) => document.addEventListener(t, (e) => e.preventDefault(), opt));
  document.addEventListener('touchmove', (e) => {
    if (e.touches.length > 1 || (typeof e.scale === 'number' && e.scale !== 1)) e.preventDefault();
  }, opt);
  // ダブルタップ拡大（2回目のタップがボタンなら、クリックとして確実に処理する）
  let lastEnd = 0;
  document.addEventListener('touchend', (e) => {
    const now = Date.now();
    const t = e.target;
    const inPad = t && t.closest && t.closest('#touch');
    if (!inPad && now - lastEnd < 350 && e.changedTouches.length === 1 && e.cancelable) {
      e.preventDefault();
      const b = t && t.closest && t.closest('button, a');
      if (b && !b.disabled) b.click();
    }
    lastEnd = now;
  }, opt);
  document.addEventListener('dblclick', (e) => e.preventDefault(), opt);
  // 選択が残っていたら消す
  document.addEventListener('touchstart', () => {
    const sel = window.getSelection && window.getSelection();
    if (sel && sel.rangeCount && !sel.isCollapsed) sel.removeAllRanges();
  }, { passive: true });
}
function boot() {
  installTouchGuards();
  Store.load();
  Renderer.init();
  HUD.init();
  Input.init();
  Game.loading(true);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && Game.state === 'race' && !Game.paused && Game.race && Game.race.phase !== 'finish') Game.togglePause();
  });
  $('#screen').addEventListener('pointerdown', () => { if (Game.race && Game.race.phase === 'intro') Game.race.skipReq = true; });
  $('#btn-pause').addEventListener('click', (e) => { e.preventDefault(); Game.togglePause(); });
  setTimeout(() => {
    Gfx.build();
    UI.init();
    Game.makeDemo();
    Game.state = 'menu';
    Game.loading(false);
    UI.show('title');
    let last = performance.now(), acc = 0;
    const frame = (ts) => {
      requestAnimationFrame(frame);
      let dt = (ts - last) / 1000;
      last = ts;
      if (!(dt > 0)) dt = 0;
      if (dt > 0.1) dt = 0.1;
      acc += dt;
      let steps = 0;
      while (acc >= STEP_DT && steps < 5) { Input.update(STEP_DT); Game.update(STEP_DT); acc -= STEP_DT; steps++; }
      if (steps >= 5) acc = 0;
      Game.render(dt);
    };
    requestAnimationFrame(frame);
  }, 50);
  if (window.__TPGP_TEST__) window.__TPGP = { Game, Race, Renderer, UI, Input, Store, Gfx, getTrack, COURSES, HUD, AI, Kart, Music };
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
})();
