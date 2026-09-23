// no-mistakes-a11y harness: in-page collectors for the deep-a11y interaction axes.
// Run each in the page via agent-browser eval (-frontend snippets.md `in_page`). Plain JS, no
// imports, so the file inlines into one eval (same as -frontend/audit-metrics.js).
// The caller drives the keyboard (agent-browser press Tab) and calls
// readActiveFocus after each press; these functions only READ/TAG, they encode no verdict.

const FOCUS_PROPS = [
  'outlineStyle', 'outlineWidth', 'outlineColor', 'outlineOffset',
  'boxShadow', 'borderTopWidth', 'borderTopColor', 'borderTopStyle',
  'backgroundColor', 'color',
];

const INTERACTIVE_SEL = [
  'a[href]', 'button', 'input:not([type=hidden])', 'select', 'textarea',
  '[role=button]', '[role=link]', '[role=checkbox]', '[role=radio]',
  '[role=switch]', '[role=tab]', '[role=menuitem]', '[contenteditable=true]',
  '[tabindex]',
].join(',');

const COMPOSITE_ANCESTOR = '[role=menu],[role=menubar],[role=tablist],[role=toolbar],[role=grid],[role=listbox],[role=tree]';

const isVisible = (e) => {
  const r = e.getBoundingClientRect();
  const s = getComputedStyle(e);
  return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && parseFloat(s.opacity || '1') > 0.01;
};
const isEnabled = (e) => !e.disabled && e.getAttribute('aria-disabled') !== 'true';
const styleOf = (e) => { const s = getComputedStyle(e); const o = {}; for (const p of FOCUS_PROPS) o[p] = s[p]; return o; };
const accName = (e) => (e.getAttribute('aria-label') || e.textContent || e.getAttribute('title') || e.getAttribute('placeholder') || '').trim().slice(0, 40);

// 1. Pre-pass: tag every visible+enabled interactive control with a stable idx and record its
//    BLURRED focus-relevant computed style. Returns the baseline keyed by idx for the style diff.
const tagInteractiveCandidates = () => {
  // Start unfocused so every baseline style is the blurred one and the first Tab starts at the top.
  if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
  const els = [...document.querySelectorAll(INTERACTIVE_SEL)].filter((e) => isVisible(e) && isEnabled(e));
  const baseline = {};
  els.forEach((e, i) => {
    e.setAttribute('data-nm-a11y', String(i));
    const r = e.getBoundingClientRect();
    baseline[i] = {
      idx: i, tag: e.tagName, role: e.getAttribute('role') || '',
      name: accName(e), tabindex: e.getAttribute('tabindex'),
      inComposite: !!e.closest(COMPOSITE_ANCESTOR),
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      blurredStyle: styleOf(e),
    };
  });
  return { count: els.length, baseline };
};

// 2. Called after each Tab press. Reads document.activeElement (its FOCUSED style) so the outer
//    loop can build the focus path and later diff focused-vs-blurred per idx.
const readActiveFocus = () => {
  const e = document.activeElement;
  if (!e || e === document.body || e === document.documentElement) return { none: true };
  const r = e.getBoundingClientRect();
  return {
    idx: e.getAttribute('data-nm-a11y'),
    tag: e.tagName, role: e.getAttribute('role') || '', name: accName(e),
    tabindex: e.getAttribute('tabindex'), inComposite: !!e.closest(COMPOSITE_ANCESTOR),
    rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
    focusedStyle: styleOf(e),
  };
};

// Visible-focus delta for one stop: true if any focus-relevant property changed focused-vs-blurred.
// The outer script calls this in JS (not the page) over the recorded styles; provided here so the
// rule lives next to FOCUS_PROPS. `no delta on ANY stop` across a screen => no-visible-focus FAIL.
const hasFocusDelta = (blurredStyle, focusedStyle) =>
  FOCUS_PROPS.some((p) => blurredStyle && focusedStyle && blurredStyle[p] !== focusedStyle[p]);

// 3. Reflow pass: run AFTER resizing the viewport to 320x1024. Flags horizontal overflow; the outer
//    script decides FAIL (a required control clipped/off-screen) vs finding (h-scroll only).
const collectReflow = () => {
  const docEl = document.documentElement;
  const clientW = docEl.clientWidth;
  const els = [...document.querySelectorAll('*')].slice(0, 2000);
  const overflow = els
    .map((e) => ({ e, r: e.getBoundingClientRect() }))
    .filter(({ r }) => r.width > 0 && r.right > clientW + 1)
    .slice(0, 20)
    .map(({ e, r }) => ({
      tag: e.tagName, idx: e.getAttribute('data-nm-a11y'),
      cls: (e.className && e.className.toString().slice(0, 40)) || '',
      right: Math.round(r.right), name: accName(e),
    }));
  // required controls (tagged data-nm-a11y) clipped or pushed off the 320px viewport
  const offscreen = [...document.querySelectorAll('[data-nm-a11y]')]
    .map((e) => ({ idx: e.getAttribute('data-nm-a11y'), r: e.getBoundingClientRect() }))
    .filter(({ r }) => r.width > 0 && (r.right > clientW + 1 || r.left < -1))
    .map(({ idx, r }) => ({ idx, right: Math.round(r.right), left: Math.round(r.left) }));
  return {
    viewportWidth: clientW,
    horizontalScroll: docEl.scrollWidth > clientW + 1,
    scrollWidth: docEl.scrollWidth,
    overflow, offscreenTagged: offscreen,
  };
};
