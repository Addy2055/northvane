import Lenis from './vendor/lenis.mjs';
import { createWorld, STOPS } from './world.js';
import { SCENES, MAP_TAGS, MULTI_TAGS, SERVICE_TAGS, DETECT_LABELS, USE_CASES, GLOBE_TEXT, GLOBE_EVENTS, AUTONOMY, FOUNDERS, MENU, FOOTER } from './content.js';

const $ = (s, r = document) => r.querySelector(s);
const params = new URLSearchParams(location.search);
const isMobile = () => innerWidth < 768;
const clamp01 = (x) => Math.max(0, Math.min(1, x));

/* ------------------------------------------------------------ icons */
const ICON = {
  down: '<svg class="ico" viewBox="0 0 16 16" fill="none"><path d="M8 2v11M3.5 8.5 8 13l4.5-4.5" stroke="currentColor" stroke-width="1.4"/></svg>',
  right: '<svg class="ico" viewBox="0 0 16 16" fill="none"><path d="M2 8h11M8.5 3.5 13 8l-4.5 4.5" stroke="currentColor" stroke-width="1.4"/></svg>',
  target: '<svg class="ico" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="5.5" stroke="currentColor" stroke-width="1.2"/><circle cx="8" cy="8" r="1.6" fill="currentColor"/></svg>',
  alert: '<svg viewBox="0 0 18 18"><circle cx="9" cy="9" r="8" fill="currentColor"/><path d="M9 4.5v5.5" stroke="#000" stroke-width="2" stroke-linecap="round"/><circle cx="9" cy="13" r="1.1" fill="#000"/></svg>',
  shield: '<svg viewBox="0 0 18 18"><path d="M2 3.5 9 2l7 1.5v5c0 4-3 6.5-7 7.5-4-1-7-3.5-7-7.5z" fill="currentColor"/><path d="M5.5 8.8 8 11l4.5-4.5" stroke="#000" stroke-width="1.8" fill="none"/></svg>',
  arrowUR: '<svg viewBox="0 0 12 12" width="10" height="10" fill="none"><path d="M3 9 9 3M4 3h5v5" stroke="currentColor" stroke-width="1.2"/></svg>',
};

/* ------------------------------------------------------------ helpers */
function splitChars(html) {
  // returns markup of words -> chars, keeps <br>
  return html.split(/<br\s*\/?>/i).map((line) => line.split(' ').map((w) =>
    `<span style="display:inline-block;white-space:nowrap">${[...w].map((c) => `<span class="char">${c}</span>`).join('')}</span>`
  ).join('<span class="char"> </span>')).join('<br>');
}
function revealChars(root, total = 0.35, base = 0) {
  const chars = [...root.querySelectorAll('.char')];
  const order = chars.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  const timers = [];
  order.forEach((ci, k) => timers.push(setTimeout(() => chars[ci].classList.add('on'), (base + (k / chars.length) * total) * 1000)));
  return timers;
}
function hideChars(root) { root.querySelectorAll('.char.on').forEach((c) => c.classList.remove('on')); }
function hudLine(item) {
  if (Array.isArray(item[0])) return item[0].map(([t, c]) => `<span class="${c ? 'c-' + c : ''}">${t}</span>`).join('');
  const [t, c] = item; return `<span class="${c ? 'c-' + c : ''}">${t}</span>`;
}

/* ------------------------------------------------------------ build DOM */
const overlay = $('#overlay');
const sceneEls = SCENES.map((s, idx) => {
  const el = document.createElement('div');
  el.className = 'sc' + (s.hud ? ' has-hud' : '');
  el.dataset.id = s.id;
  let html = '';
  if (s.title) {
    html += `<div class="sc-title"><h1 class="${s.titleClass || 'h0'} t">${splitChars(s.title)}</h1>${s.badge ? `<span class="badge ${s.badge.color}">${s.badge.text}</span>` : ''}</div>`;
  }
  if (s.body) {
    html += `<div class="sc-body pos-${s.bodyPos}"><p class="h3">${s.body}</p>`;
    if (s.table) html += `<div class="sc-table body-l">${s.table.map(([a, b]) => `<div class="row"><span>${a}</span><span>${b}</span></div>`).join('')}</div>`;
    if (s.cta) html += `<button class="pill" data-action="${s.cta.action}">${s.cta.label}${ICON[s.cta.icon]}</button>`;
    html += '</div>';
  }
  if (s.hud) html += `<div class="hud mono">${s.hud.map((l) => `<div class="ln">${hudLine(l)}</div>`).join('')}</div>`;
  if (s.callouts) html += s.callouts.map((c, i) => `<div class="callout ${c.side}" data-i="${i}"><span class="v">${splitChars(c.value)}</span> <span class="k">${splitChars(c.label)}</span></div>`).join('');
  el.innerHTML = html;
  overlay.appendChild(el);
  return el;
});

// projected label layers
const labels = $('#labels');
const lines = $('#lines');
const droneTags = SCENES[2].tags.map((t) => { const d = document.createElement('div'); d.className = 'tag tag-drone'; d.textContent = t; d.style.opacity = 0; labels.appendChild(d); return d; });
const swarmPath = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
swarmPath.setAttribute('fill', 'none'); swarmPath.setAttribute('stroke', 'rgba(255,255,255,.75)'); swarmPath.setAttribute('stroke-dasharray', '3 4'); swarmPath.setAttribute('stroke-width', '1'); swarmPath.style.opacity = 0; swarmPath.style.transition = 'opacity .5s';
lines.appendChild(swarmPath);
const calloutLines = SCENES[1].callouts.map(() => {
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  const l = document.createElementNS('http://www.w3.org/2000/svg', 'line'); l.setAttribute('stroke', 'rgba(255,255,255,.55)'); l.setAttribute('stroke-width', '1');
  const c = document.createElementNS('http://www.w3.org/2000/svg', 'rect'); c.setAttribute('width', 4); c.setAttribute('height', 4); c.setAttribute('fill', '#fff');
  g.append(l, c); g.style.opacity = 0; g.style.transition = 'opacity .4s'; lines.appendChild(g); return { g, l, c, len: 0 };
});
const dboxes = DETECT_LABELS.map((t) => { const d = document.createElement('div'); d.className = 'dbox'; d.innerHTML = `<span>${t} ${80 + Math.floor(Math.random() * 5)}%</span>`; labels.appendChild(d); return d; });
const chipMain = document.createElement('div'); chipMain.className = 'tag tag-chip yellow'; chipMain.style.opacity = 0; labels.appendChild(chipMain);
const svcTags = SERVICE_TAGS.map((t) => { const d = document.createElement('div'); d.className = 'svc'; d.innerHTML = `<span class="svc-l">${t}</span><i class="svc-line"></i><b class="svc-pt"></b>`; labels.appendChild(d); return d; });
const multiChips = MULTI_TAGS.map((t) => { const d = document.createElement('div'); d.className = `tag tag-chip small ${t.color}`; d.innerHTML = `${ICON.shield}<span>${t.text}</span>`; d.style.opacity = 0; labels.appendChild(d); return d; });

// scene nav ticks
const navLabels = [...new Set(SCENES.map((s) => s.nav).filter(Boolean))];
const sceneNav = $('#scene-nav');
const navItems = navLabels.map((label) => {
  const b = document.createElement('button'); b.className = 'sn-item'; b.innerHTML = `<i class="tick"></i><span class="lbl">${label}</span>`; b.setAttribute('aria-label', label);
  b.addEventListener('click', () => jumpToScene(SCENES.findIndex((s) => s.nav === label)));
  sceneNav.appendChild(b); return b;
});

// tail content
const casesRow = $('#cases-row');
const caseEls = USE_CASES.map((c, i) => {
  const d = document.createElement('div'); d.className = 'case' + (i === 0 ? ' is-active' : '');
  d.innerHTML = `<img src="${c.img}" alt="" loading="lazy"><div class="case-copy"><h3>${c.title}</h3><p>${c.text}</p></div>`;
  d.addEventListener('click', () => caseEls.forEach((e, k) => e.classList.toggle('is-active', k === i)));
  casesRow.appendChild(d); return d;
});
$('#globe-text').textContent = GLOBE_TEXT;
const globeLabels = GLOBE_EVENTS.map((e) => { const d = document.createElement('div'); d.className = 'glabel'; d.textContent = e.text; d.style.opacity = 0; $('#globe-labels').appendChild(d); return d; });
$('#auto-title').innerHTML = AUTONOMY.title;
$('#auto-body').textContent = AUTONOMY.body;
$('#auto-cta').innerHTML = `${AUTONOMY.cta}${ICON.target}`;
$('#founders-text').textContent = FOUNDERS.text;
$('#logos').innerHTML = FOUNDERS.logos.map(logoSVG).join('');
$('#footer-cta').textContent = FOOTER.cta;
$('#footer-btn').innerHTML = `${FOOTER.button} ${ICON.right}`;
$('#footer-copy').textContent = `${FOOTER.copy} ${new Date().getFullYear()}`;
$('#footer-links').innerHTML = FOOTER.links.map((l) => `<a href="#" data-contact-link>${l}</a>`).join('');
$('#menu-links').innerHTML = MENU.links.map((l) => `<li><button data-go="${l.go}">${l.label}</button></li>`).join('');
$('#menu-extras').innerHTML = MENU.extras.map((e) => `<button data-contact><b>${e.title} ${ICON.arrowUR}</b><span>${e.text}</span></button>`).join('');
document.querySelectorAll('.menu-links button').forEach((b, i) => (b.style.transitionDelay = `${0.1 + i * 0.05}s`));

function logoSVG({ name, style }) {
  const fonts = {
    wide: `font-family:var(--sans);font-weight:600;letter-spacing:.32em;font-size:15px`,
    round: `font-family:var(--sans);font-weight:500;letter-spacing:-.02em;font-size:30px`,
    mono: `font-family:var(--mono);font-weight:500;letter-spacing:.24em;font-size:16px`,
    serif: `font-family:Georgia,serif;font-style:italic;font-size:24px`,
    mark: `font-family:var(--sans);font-weight:600;letter-spacing:.14em;font-size:15px`,
    thin: `font-family:var(--sans);font-weight:400;letter-spacing:.4em;font-size:14px`,
    bold: `font-family:var(--sans);font-weight:600;letter-spacing:-.05em;font-size:28px`,
  };
  const w = Math.max(120, name.length * (style === 'round' || style === 'bold' ? 16 : 14) + (style === 'wide' || style === 'thin' ? name.length * 5 : 0));
  const mark = style === 'mark' ? `<path d="M4 26 L14 8 L24 26 Z" fill="none" stroke="currentColor" stroke-width="2"/>` : style === 'round' ? `<circle cx="12" cy="19" r="8" fill="none" stroke="currentColor" stroke-width="2.2"/>` : '';
  const x = mark ? 34 : 0;
  return `<svg viewBox="0 0 ${w + x} 38" aria-label="${name}"><g fill="currentColor">${mark}<text x="${x}" y="27" style="${fonts[style]}">${name}</text></g></svg>`;
}

/* ------------------------------------------------------------ scroll */
let VH = innerHeight;
const spacer = $('#scroll-spacer');
const totalVh = STOPS[STOPS.length - 1];
function layout() { VH = innerHeight; spacer.style.height = `${(totalVh * VH) / 100}px`; }
layout();
const stopPx = (k) => (STOPS[k] * VH) / 100;
const LAST = 14; // multi-threat stop — free scroll after this

if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
const lenis = new Lenis({ lerp: 0.1, smoothWheel: true, syncTouch: false, virtualScroll: onVirtual });
lenis.stop();
if (!params.has('stop') && !params.has('t')) lenis.scrollTo(0, { immediate: true, force: true });
let stepping = false;
let booted = false;
let live = false;

function blockNativeScroll(event) {
  // Cancelling touchstart or touchend suppresses the click that follows. Only touchmove and wheel should be blocked.
  if (event.type === 'touchstart' || event.type === 'touchend') return;
  event.cancelable && event.preventDefault();
}
let jumpTimer = 0;
let jumpFadeTimer = 0;
function endStep() {
  stepping = false;
  if (jumpTimer) { clearTimeout(jumpTimer); jumpTimer = 0; }
  if (jumpFadeTimer) { clearTimeout(jumpFadeTimer); jumpFadeTimer = 0; }
  const stage = $('#stage');
  if (stage) stage.style.opacity = '1';
}
function stepTo(k, fast = false) {
  const y = lenis.animatedScroll;
  const target = stopPx(k);
  const dist = Math.abs(target - y);
  if (dist < 2) return;
  stepping = true;
  const speed = VH * 5 / 2.15; // one 500vh scene in ~2.15s
  const duration = fast ? 0.75 : Math.max(0.45, dist / speed);
  lenis.scrollTo(target, { duration, easing: (t) => t, lock: true, force: true, onComplete: endStep });
}
function nextStop(y, dir) {
  if (dir > 0) { for (let k = 0; k <= LAST; k++) if (stopPx(k) > y + 2) return k; return -1; }
  for (let k = LAST; k >= 0; k--) if (stopPx(k) < y - 2) return k; return -1;
}
function onVirtual({ deltaY, event }) {
  if (!live) { if (booted && Math.abs(deltaY) > 1) startExperience(); blockNativeScroll(event); return false; }
  if (menuOpen || modalOpen) return false;
  const y = lenis.animatedScroll;
  const zoneEnd = stopPx(LAST);
  const isTouch = event.type.includes('touch');
  if (stepping) { blockNativeScroll(event); return false; }
  if (Math.abs(deltaY) < (isTouch ? 6 : 1)) { if (y < zoneEnd - 2) blockNativeScroll(event); return y >= zoneEnd - 2; }
  const dir = Math.sign(deltaY);
  if (y < zoneEnd - 2 || (Math.abs(y - zoneEnd) <= 2 && dir < 0)) {
    blockNativeScroll(event);
    const k = nextStop(y, dir); if (k >= 0) stepTo(k);
    return false;
  }
  // tail: snap back into the scene zone when scrolling up past it
  if (dir < 0 && lenis.targetScroll + deltaY < zoneEnd) { blockNativeScroll(event); stepTo(LAST); return false; }
  return true;
}
addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { closeMenu(); closeModal(); }
  if (!live || menuOpen || modalOpen || /INPUT|TEXTAREA/.test(document.activeElement?.tagName)) return;
  const down = ['ArrowDown', 'PageDown', ' '].includes(e.key), up = ['ArrowUp', 'PageUp'].includes(e.key);
  if (!down && !up) return;
  const y = lenis.animatedScroll, zoneEnd = stopPx(LAST);
  if (y < zoneEnd - 2 || (up && y <= zoneEnd + 2)) { e.preventDefault(); if (!stepping) { const k = nextStop(y, down ? 1 : -1); if (k >= 0) stepTo(k); } }
});

function jumpToScene(idx) {
  if (idx < 0 || stepping) return;
  const k = Math.min(idx, LAST);
  const stage = $('#stage');
  stepping = true;
  stage.style.opacity = '0';
  jumpTimer = setTimeout(() => {
    jumpTimer = 0;
    lenis.scrollTo(stopPx(k), { duration: 0.75, lock: true, force: true, onComplete: endStep });
    jumpFadeTimer = setTimeout(() => requestAnimationFrame(() => { jumpFadeTimer = 0; stage.style.opacity = '1'; }), 750);
  }, 150);
}

document.addEventListener('click', (e) => {
  const a = e.target.closest('[data-action]');
  if (a && a.dataset.action === 'next') { const k = nextStop(lenis.animatedScroll, 1); if (k >= 0 && !stepping) stepTo(k); }
  if (e.target.closest('[data-contact], [data-contact-link]')) { e.preventDefault(); closeMenu(); openModal(); }
  const go = e.target.closest('[data-go]');
  if (go) {
    closeMenu();
    const t = go.dataset.go;
    if (t.startsWith('#')) lenis.scrollTo($(t), { duration: 1.4, force: true });
    else jumpToScene(SCENES.findIndex((s) => s.id === t));
  }
});
$('#logo').addEventListener('click', () => { endStep(); lenis.scrollTo(0, { immediate: true, force: true }); });

/* ------------------------------------------------------------ menu / modal */
let menuOpen = false, modalOpen = false;
const menu = $('#menu'), modal = $('#modal');
$('#burger').addEventListener('click', () => { endStep(); menuOpen = true; menu.classList.add('is-open'); menu.setAttribute('aria-hidden', 'false'); lenis.stop(); });
menu.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', closeMenu));
function closeMenu() { if (!menuOpen) return; menuOpen = false; menu.classList.remove('is-open'); menu.setAttribute('aria-hidden', 'true'); if (live) lenis.start(); }
function openModal() { endStep(); modalOpen = true; modal.classList.add('is-open'); modal.setAttribute('aria-hidden', 'false'); lenis.stop(); setTimeout(() => $('#f-name').focus(), 300); }
function closeModal() { if (!modalOpen) return; modalOpen = false; modal.classList.remove('is-open'); modal.setAttribute('aria-hidden', 'true'); if (live) lenis.start(); }
modal.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', closeModal));
$('#contact-form').addEventListener('submit', (e) => {
  e.preventDefault();
  let ok = true;
  e.target.querySelectorAll('.field').forEach((f) => {
    const inp = f.querySelector('input,textarea'); const err = f.querySelector('.err');
    let msg = '';
    if (!inp.value.trim()) msg = 'This field is required';
    else if (inp.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inp.value.trim())) msg = 'Invalid email address';
    err.textContent = msg; f.classList.toggle('bad', !!msg); if (msg) ok = false;
  });
  $('#form-note').textContent = ok ? 'Thanks. This is a demo build, so nothing was sent.' : '';
  if (ok) e.target.reset();
});

/* ------------------------------------------------------------ audio */
let audio = null;
function initAudio() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const len = ctx.sampleRate * 2; const buf = ctx.createBuffer(1, len, ctx.sampleRate); const d = buf.getChannelData(0);
    let last = 0; for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500; lp.Q.value = 0.7;
    const gain = ctx.createGain(); gain.gain.value = 0;
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    src.connect(lp); lp.connect(gain); (pan ? (gain.connect(pan), pan) : gain).connect(ctx.destination);
    src.start();
    audio = { ctx, lp, gain, pan };
  } catch (_) { audio = null; }
}
function updateAudio(t) {
  if (!audio) return;
  const now = audio.ctx.currentTime;
  const active = stepping && lenis.animatedScroll < stopPx(LAST) + 2;
  audio.gain.gain.setTargetAtTime(active ? 0.22 : 0.035, now, active ? 0.35 : 0.6);
  audio.lp.frequency.setTargetAtTime(active ? 1100 : 420, now, 0.5);
  if (audio.pan) audio.pan.pan.setTargetAtTime(Math.sin(t * 0.4) * 0.35, now, 0.3);
}
document.addEventListener('visibilitychange', () => { if (!audio) return; document.hidden ? audio.ctx.suspend() : audio.ctx.resume(); });

/* ------------------------------------------------------------ boot + world */
const boot = $('#boot');
const bootBar = $('.boot-bar i');
const bootLabel = $('.boot-label');
let world = null;
const t0 = performance.now();

function setProgress(p) { bootBar.style.transform = `scaleX(${p})`; }
function paintPerf() {
  if (!params.has('perf') || !world?.perf) return;
  let el = document.getElementById('perf');
  if (!el) { el = document.createElement('pre'); el.id = 'perf'; document.body.appendChild(el); }
  const lines = world.perf.stages.map((s) => `${s.name.padEnd(10)} ${s.ms} ms`);
  lines.push(`${'programs'.padEnd(10)} ${world.perf.programs()}`);
  el.textContent = lines.join('\n');
}

async function init() {
  setProgress(0.08);
  bootLabel.textContent = 'Building scene';
  try {
    world = await createWorld($('#gl'), { perf: params.has('perf'), onProgress: (p) => setProgress(0.1 + p * 0.85) });
  } catch (err) {
    console.error(err);
    bootLabel.textContent = 'WebGL unavailable';
  }
  if (world) { world.resize(innerWidth, innerHeight); world.update(0.016); world.render([]); paintPerf(); }
  if (params.has('bake')) return bakeMode();
  if (params.has('view')) return viewMode();
  const wait = params.has('stop') || params.has('t') ? 0 : Math.max(0, 900 - (performance.now() - t0));
  setTimeout(() => {
    setProgress(1);
    bootLabel.textContent = 'Ready';
    boot.classList.add('is-ready');
    booted = true;
    if (params.has('stop') || params.has('t')) startExperience(true);
    else setTimeout(() => { if (!live) startExperience(); }, 1400); // enter on its own if nobody scrolls
    // build the tail views while the visitor is still on the first scenes
    (window.requestIdleCallback || ((f) => setTimeout(f, 1200)))(() => { world.getViews(); paintPerf(); });
  }, wait);
}

function startExperience(instant = false) {
  if (live) return;
  live = true;
  boot.classList.add('is-done');
  setTimeout(() => { boot.remove(); }, 900);
  document.body.classList.remove('is-booting');
  document.body.classList.add('is-live');
  lenis.start();
  if (!instant && navigator.userActivation?.hasBeenActive) initAudio();
  if (world) world.state.intro = instant ? 1 : 0;
  if (params.has('stop')) lenis.scrollTo(stopPx(+params.get('stop')), { immediate: true, force: true });
  if (params.has('t')) lenis.scrollTo((+params.get('t') * VH) / 100, { immediate: true, force: true });
}
['pointerdown', 'touchstart', 'wheel', 'keydown'].forEach((ev) => addEventListener(ev, () => { if (booted && !live) startExperience(); if (live && !audio) initAudio(); }, { passive: true }));
addEventListener('keydown', () => { if (booted && !live) startExperience(); });

function viewMode() {
  // debug: render one tail view full screen, e.g. ?view=auto&p=0.5
  document.body.classList.remove('is-booting');
  document.querySelectorAll('#boot,.nav,#overlay,#labels,#lines,#main,.grain').forEach((e) => (e.style.display = 'none'));
  world.getViews();
  const name = params.get('view'), p = +(params.get('p') || 0.5);
  const loop = () => { world.update(0.016); world.state.v = 99999; world.render([{ name, rect: { left: 0, top: 0, width: innerWidth, height: innerHeight, right: innerWidth, bottom: innerHeight }, progress: p }]); requestAnimationFrame(loop); };
  world.state.v = 99999; world.state.snap = true; loop();
}

function bakeMode() {
  document.body.classList.remove('is-booting');
  document.querySelectorAll('#boot,.nav,#overlay,#labels,#lines,#main,.grain').forEach((e) => (e.style.display = 'none'));
  const [w, h] = (params.get('size') || '1200x1400').split('x').map(Number);
  const c = $('#gl'); c.style.width = w + 'px'; c.style.height = h + 'px';
  world.resize(w, h);
  world.update(0.016);
  world.bake(params.get('bake'));
  window.__baked = true;
}

/* ------------------------------------------------------------ per-frame */
const windows = SCENES.map((s, k) => {
  const st = STOPS[k];
  const next = k < SCENES.length - 1 ? STOPS[k + 1] : totalVh; // last caption leaves before the tail sections arrive
  return [k === 0 ? -1e9 : st - 25, Math.min(st + 135, next - 40)];
});
const sceneState = SCENES.map(() => ({ on: false, timers: [] }));
let currentScene = -1;

function enterScene(k) {
  const el = sceneEls[k], s = SCENES[k], st = sceneState[k];
  st.on = true; st.timers.forEach(clearTimeout); st.timers = []; st.t0 = performance.now();
  el.classList.remove('is-out'); el.classList.add('is-in');
  const title = el.querySelector('.sc-title h1');
  if (title) st.timers.push(...revealChars(title, 0.35, k === 0 ? 0.5 : 0.05));
  const body = el.querySelector('.sc-body');
  if (body) { body.classList.remove('on'); void body.offsetWidth; body.classList.add('on'); }
  el.querySelectorAll('.hud .ln').forEach((ln, i) => { ln.classList.remove('on'); st.timers.push(setTimeout(() => ln.classList.add('on'), 250 + i * 160)); });
  const badge = el.querySelector('.badge');
  if (badge) { badge.classList.remove('on'); st.timers.push(setTimeout(() => badge.classList.add('on'), s.badge.after * 1000)); }
  el.querySelectorAll('.callout').forEach((c, i) => st.timers.push(...revealChars(c, 0.6, 0.35 + i * 0.25)));
  if (s.id === 'detect') dboxes.forEach((b, i) => st.timers.push(setTimeout(() => b.classList.add('on'), 150 + i * 70)));
}
function exitScene(k) {
  const el = sceneEls[k], st = sceneState[k];
  st.on = false; st.timers.forEach(clearTimeout); st.timers = [];
  el.classList.add('is-out');
  el.querySelectorAll('.sc-title h1, .callout').forEach(hideChars);
  el.querySelectorAll('.hud .ln').forEach((ln) => ln.classList.remove('on'));
  el.querySelector('.badge')?.classList.remove('on');
  if (SCENES[k].id === 'detect') dboxes.forEach((b) => b.classList.remove('on'));
  setTimeout(() => { if (!sceneState[k].on) el.classList.remove('is-in', 'is-out'); }, 420);
}

let lastT = performance.now();
const PR_MAX = Math.min(window.devicePixelRatio || 1, 1.5);
let pr = PR_MAX, perfAcc = 0, perfN = 0, perfCool = 0;
function adaptResolution(dt) {
  if (!world || document.hidden) return;
  perfAcc += dt; perfN++; perfCool -= dt;
  if (perfAcc < 1.2) return;
  const avg = perfAcc / perfN; perfAcc = 0; perfN = 0;
  if (perfCool > 0) return;
  let next = pr;
  if (avg > 0.026 && pr > 0.75) next = Math.max(0.75, pr - 0.25);
  else if (avg < 0.0145 && pr < PR_MAX) next = Math.min(PR_MAX, pr + 0.25);
  if (next !== pr) { pr = next; world.setPixelRatio(pr); perfCool = 3; }
}
const views = [
  { name: 'globe', el: $('#globe-view'), sec: $('#globe') },
  { name: 'auto', el: $('#auto-view'), sec: $('#autonomy') },
  { name: 'land', el: $('#land-view'), sec: $('#footer') },
];
addEventListener('pointermove', (e) => { if (world) world.state.pointer.set((e.clientX / innerWidth) * 2 - 1, (e.clientY / innerHeight) * 2 - 1); });
let lastW = innerWidth;
addEventListener('resize', () => {
  if (innerWidth !== lastW || !isMobile()) { lastW = innerWidth; layout(); }
  world?.resize(innerWidth, innerHeight);
});

function frame(now) {
  requestAnimationFrame(frame);
  lenis.raf(now);
  const dt = Math.min(0.05, (now - lastT) / 1000); lastT = now;
  if (!world || params.has('bake') || params.has('view')) return;
  const y = lenis.animatedScroll;
  const v = (y / VH) * 100;
  world.state.v = v;
  if (world.state.intro < 1 && live) world.state.intro = Math.min(1, world.state.intro + dt / 2.6);

  // thermal event timer
  const thermalActive = live && Math.abs(v - STOPS[6]) < 30;
  world.state.thermalT = thermalActive ? (world.state.thermalT || 0) + dt : 0;

  const out = world.update(dt);

  // scenes on/off
  let active = -1;
  if (live) SCENES.forEach((s, k) => { const [a, b] = windows[k]; if (v >= a && v <= b) active = k; });
  if (active !== currentScene) {
    if (currentScene >= 0) exitScene(currentScene);
    if (active >= 0) enterScene(active);
    currentScene = active;
  }
  // nav
  const navK = active >= 0 ? active : SCENES.reduce((acc, s, k) => (v >= STOPS[k] - 250 ? k : acc), 0);
  const navLabel = SCENES[navK]?.nav;
  navItems.forEach((b, i) => b.classList.toggle('is-active', navLabels[i] === navLabel));
  sceneNav.classList.toggle('is-hidden', !navLabel || out.fade > 0.5);
  $('#nav').style.setProperty('--bg-opacity', out.fade.toFixed(3));

  const id = active >= 0 ? SCENES[active].id : '';
  // specs callouts
  SCENES[1].callouts.forEach((c, i) => {
    const p = out.callouts[c.anchor]; const cl = calloutLines[i]; const el = sceneEls[1].querySelector(`.callout[data-i="${i}"]`);
    const on = id === 'specs';
    cl.g.style.opacity = on ? 1 : 0;
    const x2 = c.side === 'r' ? innerWidth - (isMobile() ? 16 : 80) : (isMobile() ? 16 : 64);
    cl.l.setAttribute('x1', p.x); cl.l.setAttribute('y1', p.y); cl.l.setAttribute('x2', x2); cl.l.setAttribute('y2', p.y);
    cl.c.setAttribute('x', p.x - 2); cl.c.setAttribute('y', p.y - 2);
    el.style.top = `${p.y}px`;
  });
  // swarm tags
  const swarmOn = id === 'swarm';
  droneTags.forEach((t, i) => { const p = out.droneTags[i]; t.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%,-50%)`; t.style.opacity = swarmOn && p.vis ? 1 : 0; });
  const [a, b, c] = out.droneTags;
  swarmPath.setAttribute('points', `${b.x},${b.y} ${a.x},${a.y} ${c.x},${c.y}`);
  swarmPath.style.opacity = swarmOn ? 1 : 0;
  // detection boxes
  dboxes.forEach((d, i) => { const p = out.detect[i]; d.style.transform = `translate(${p.x - 23}px, ${p.y - 23}px)`; if (!p.vis) d.classList.remove('on'); });
  // map chip
  const tag = MAP_TAGS[id];
  if (tag) {
    const anchor = ['coord', 'support', 'secured'].includes(id) ? out.chips.r2 : out.chips.r1;
    const cls = `tag tag-chip ${tag.color}`;
    if (chipMain.className !== cls || chipMain.dataset.t !== tag.text) { chipMain.className = cls; chipMain.dataset.t = tag.text; chipMain.innerHTML = `${ICON[tag.icon]}<span>${tag.text}</span>`; }
    chipMain.style.transform = `translate(${anchor.x}px, ${anchor.y}px) translate(0,-100%)`;
    chipMain.style.opacity = 1;
  } else chipMain.style.opacity = 0;
  svcTags.forEach((d, i) => { const p = out.svc[i]; d.style.transform = `translate(${p.x}px, ${p.y}px)`; d.classList.toggle('on', id === 'alerts' && p.vis); d.style.transitionDelay = id === 'alerts' ? `${0.5 + i * 0.12}s` : '0s'; });
  multiChips.forEach((d, i) => { const p = out.multi[i]; d.style.transform = `translate(${p.x}px, ${p.y}px) translate(0,-100%)`; d.style.opacity = id === 'multi' && p.vis ? 1 : 0; });

  // tail views
  const viewList = [];
  for (const vw of views) {
    const r = vw.el.getBoundingClientRect();
    if (r.bottom < 0 || r.top > innerHeight) continue;
    const s = vw.sec.getBoundingClientRect();
    let p;
    if (vw.name === 'land') p = clamp01((innerHeight - s.top) / innerHeight);
    else p = clamp01((innerHeight - s.top) / (s.height + innerHeight));
    viewList.push({ name: vw.name, rect: r, progress: p });
    if (vw.name === 'globe') {
      const lp = world.getViews().globe.labelPositions(r);
      globeLabels.forEach((l, k) => { const q = lp[k]; l.style.transform = `translate(${q.x - s.left + 8}px, ${q.y - s.top - 14}px)`; l.style.opacity = q.vis && p * 2.2 - k * 0.12 > 1 ? 1 : 0; });
    }
  }
  world.render(viewList);
  adaptResolution(dt);
  updateAudio(now / 1000);
}
requestAnimationFrame(frame);
init();
