// no-mistakes harness: taste-NEUTRAL rendered design-system measurement, run in the page
// via agent-browser eval (snippets.md `in_page`). Plain JS, no imports, so the file can be
// inlined into one eval. Emits measurements + objective a11y flags +
// "slop" signals; encodes NO aesthetic opinion (the judge decides vs the app's own baseline).
const collectMetrics = () => {
  const els = [...document.querySelectorAll('*')].slice(0, 1500);
  const cs = (e) => getComputedStyle(e);
  const fonts = new Set(), colors = new Set();
  const radii = {}, padding = {}, fontSizes = {};
  const emojiRe = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/u;
  let textCount = 0, centeredText = 0, gradientBackdrops = 0, coloredLeftBorders = 0;
  const emojiInText = [];
  for (const e of els) {
    const s = cs(e);
    if (s.fontFamily) fonts.add(s.fontFamily.split(',')[0].trim().replace(/["']/g, ''));
    if (s.color && s.color !== 'rgba(0, 0, 0, 0)') colors.add(s.color);
    const bg = s.backgroundColor;
    if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') colors.add(bg);
    if (s.borderRadius && s.borderRadius !== '0px') radii[s.borderRadius] = (radii[s.borderRadius] || 0) + 1;
    for (const p of [s.paddingTop, s.paddingLeft]) if (p && p !== '0px') padding[p] = (padding[p] || 0) + 1;
    if (s.fontSize) fontSizes[s.fontSize] = (fontSizes[s.fontSize] || 0) + 1;
    if (s.backgroundImage && s.backgroundImage.includes('gradient')) gradientBackdrops++;
    if (parseFloat(s.borderLeftWidth) >= 3 && s.borderLeftStyle === 'solid'
        && s.borderLeftColor && s.borderLeftColor !== 'rgba(0, 0, 0, 0)'
        && parseFloat(s.borderTopWidth) === 0 && parseFloat(s.borderRightWidth) === 0 && parseFloat(s.borderBottomWidth) === 0) {
      coloredLeftBorders++;
    }
    const hasDirectText = [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (hasDirectText) {
      textCount++;
      if (s.textAlign === 'center') centeredText++;
      if (emojiRe.test(e.textContent) && emojiInText.length < 10) emojiInText.push((e.textContent || '').trim().slice(0, 30));
    }
  }
  const headings = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].slice(0, 40).map((h) => ({
    tag: h.tagName, text: (h.textContent || '').trim().slice(0, 40), size: cs(h).fontSize, weight: cs(h).fontWeight,
  }));
  const smallTargets = [...document.querySelectorAll('a,button,input,select,textarea,[role=button],[onclick]')]
    .map((e) => ({ e, r: e.getBoundingClientRect() }))
    .filter(({ r }) => r.width > 0 && r.height > 0 && (r.width < 44 || r.height < 44))
    .slice(0, 30)
    .map(({ e, r }) => ({ tag: e.tagName, text: (e.textContent || '').trim().slice(0, 30), w: Math.round(r.width), h: Math.round(r.height) }));
  const lum = (c) => {
    const m = c.match(/\d+(\.\d+)?/g);
    if (!m) return null;
    const [r, g, b] = m.slice(0, 3).map(Number).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const effBg = (e) => { let n = e; while (n) { const b = cs(n).backgroundColor; if (b && b !== 'rgba(0, 0, 0, 0)' && b !== 'transparent') return b; n = n.parentElement; } return 'rgb(255, 255, 255)'; };
  const ratio = (a, b) => { const la = lum(a), lb = lum(b); if (la == null || lb == null) return null; return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); };
  const lowContrast = [];
  const textEls = [...document.querySelectorAll('p,span,a,button,li,td,th,label,h1,h2,h3,h4,h5,h6,div')].slice(0, 800)
    .filter((e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()));
  for (const e of textEls) {
    const s = cs(e); const size = parseFloat(s.fontSize); const weight = parseInt(s.fontWeight) || 400;
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    const r = ratio(s.color, effBg(e));
    if (r != null && r < (large ? 3 : 4.5)) lowContrast.push({ text: (e.textContent || '').trim().slice(0, 30), color: s.color, ratio: Math.round(r * 100) / 100, min: large ? 3 : 4.5 });
    if (lowContrast.length >= 25) break;
  }
  const docW = document.documentElement.clientWidth;
  const overflow = els.filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > docW + 1; })
    .slice(0, 15).map((e) => ({ tag: e.tagName, cls: (e.className && e.className.toString().slice(0, 40)) || '', right: Math.round(e.getBoundingClientRect().right) }));
  const topN = (obj, n) => Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n).map(([value, count]) => ({ value, count }));
  return {
    counts: { fonts: fonts.size, colors: colors.size, radii: Object.keys(radii).length },
    fonts: [...fonts], colors: [...colors], radii: topN(radii, 12),
    spacing: topN(padding, 12), fontSizes: topN(fontSizes, 12),
    headings, smallTargets, lowContrast, overflow,
    slopSignals: {
      centeredTextRatio: textCount ? Math.round((centeredText / textCount) * 100) / 100 : 0,
      centeredText, textCount, gradientBackdrops, coloredLeftBorders,
      emojiInText, dominantRadius: topN(radii, 1)[0] || null,
    },
  };
};
