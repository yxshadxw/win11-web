/* 운빨 디펜스 · anime.js 전역 모션 레이어
 * React 트리는 건드리지 않고, DOM 변화를 관찰해서 등장/피드백 모션을 입힌다.
 * anime.js(vendor/anime.min.js)가 없거나 "동작 줄이기"가 켜져 있으면 아무것도 하지 않는다. */
(function () {
  'use strict';
  var A = window.anime;
  if (!A) return;
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) return;

  function clean(els) {
    [].concat(els instanceof NodeList ? [].slice.call(els) : els).forEach(function (el) {
      if (!el || !el.style) return;
      el.style.removeProperty('transform');
      el.style.removeProperty('opacity');
      el.style.removeProperty('will-change');
    });
  }
  function run(params, els) {
    var done = params.complete;
    params.complete = function (a) { clean(els); if (done) done(a); };
    return A(params);
  }

  /* ---------- 1. 등장 모션 ---------- */
  var seen = new WeakSet();
  function once(el) { if (seen.has(el)) return false; seen.add(el); return true; }

  function intro(root) {
    var q = function (sel) {
      return [].slice.call(root.querySelectorAll(sel)).filter(once);
    };
    var top = q('.topbar');
    var hud = q('.hud-cell');
    var cards = q('.team-rail > .card, .build-rail > .card, .map-card, .odds-card, .launch-card');
    var tiles = q('.tile-row');
    var rows = q('.rarity-row');
    if (top.length) { top.forEach(function (e) { e.style.opacity = 0; }); run({ targets: top, translateY: [-24, 0], opacity: [0, 1], duration: 600, easing: 'easeOutExpo' }, top); }
    if (hud.length) { hud.forEach(function (e) { e.style.opacity = 0; }); run({ targets: hud, translateY: [18, 0], opacity: [0, 1], delay: A.stagger(70, { start: 120 }), duration: 650, easing: 'easeOutBack' }, hud); }
    if (cards.length) { cards.forEach(function (e) { e.style.opacity = 0; }); run({ targets: cards, translateY: [26, 0], opacity: [0, 1], delay: A.stagger(60, { start: 200 }), duration: 700, easing: 'easeOutExpo' }, cards); }
    if (tiles.length) { tiles.forEach(function (e) { e.style.opacity = 0; }); run({ targets: tiles, opacity: [0, 1], translateX: function (el, i) { return [i % 2 ? 14 : -14, 0]; }, delay: A.stagger(28, { start: 300 }), duration: 500, easing: 'easeOutQuad' }, tiles); }
    if (rows.length) { rows.forEach(function (e) { e.style.opacity = 0; }); run({ targets: rows, translateX: [18, 0], opacity: [0, 1], delay: A.stagger(25, { start: 400 }), duration: 450, easing: 'easeOutQuad' }, rows); }
  }

  /* ---------- 2. 추가되는 노드(토스트/모달/코인 팝) ---------- */
  function added(node) {
    if (node.nodeType !== 1) return;
    var list = [node].concat([].slice.call(node.querySelectorAll ? node.querySelectorAll('.toast,.loot-toast,.modal-backdrop,.modal,.fx-pop') : []));
    list.forEach(function (el) {
      if (!el.classList) return;
      if (el.classList.contains('toast') || el.classList.contains('loot-toast')) {
        if (!once(el)) return;
        el.style.opacity = 0;
        run({ targets: el, translateY: [24, 0], scale: [.92, 1], opacity: [0, 1], duration: 520, easing: 'easeOutBack' }, el);
      } else if (el.classList.contains('modal-backdrop')) {
        if (!once(el)) return;
        el.style.opacity = 0;
        run({ targets: el, opacity: [0, 1], duration: 260, easing: 'linear' }, el);
      } else if (el.classList.contains('modal')) {
        if (!once(el)) return;
        el.style.opacity = 0;
        run({ targets: el, scale: [.88, 1], translateY: [26, 0], opacity: [0, 1], duration: 560, easing: 'easeOutElastic(1,.7)' }, el);
        var kids = [].slice.call(el.querySelectorAll('.guide-steps > *, h2, .modal-desc, .dialog-icon')).filter(once);
        if (kids.length) { kids.forEach(function (k) { k.style.opacity = 0; }); run({ targets: kids, translateY: [14, 0], opacity: [0, 1], delay: A.stagger(70, { start: 180 }), duration: 500, easing: 'easeOutQuad' }, kids); }
      } else if (el.classList.contains('fx-pop')) {
        if (!once(el)) return;
        el.style.animation = 'none';
        el.style.opacity = 0;
        run({ targets: el, translateY: [14, -52], scale: [.7, 1.15, 1], opacity: [0, 1, 1, 0], duration: 1300, easing: 'easeOutCubic' }, el);
      }
    });
    intro(node);
  }

  /* ---------- 3. 값 변화 펄스(코인/체력/처치) ---------- */
  var last = new WeakMap();
  function num(el) { var m = /-?[\d,]+(\.\d+)?/.exec(el.textContent || ''); return m ? parseFloat(m[0].replace(/,/g, '')) : null; }
  function pulse(el, up) {
    if (el.__ldPulse) el.__ldPulse.pause();
    var color = up ? '#b9ffd9' : '#ffb3b3';
    el.__ldPulse = A.timeline({ easing: 'easeOutQuad', complete: function () { clean(el); el.style.removeProperty('filter'); } })
      .add({ targets: el, scale: [1, up ? 1.1 : .96], duration: 130 })
      .add({ targets: el, scale: 1, duration: 520, easing: 'easeOutElastic(1,.5)' }, 130);
    if (getComputedStyle(el).display === 'inline') { el.style.display = 'inline-block'; setTimeout(function () { el.style.removeProperty('display'); }, 900); }
    if (!el.style.transformOrigin) el.style.transformOrigin = 'center';
    A({ targets: el, color: [color, getComputedStyle(el).color], duration: 700, easing: 'easeOutQuad', complete: function () { el.style.removeProperty('color'); } });
  }
  function watchValue(el) {
    var v = num(el);
    if (v === null) return;
    var p = last.get(el);
    last.set(el, v);
    if (p === undefined || p === v) return;
    pulse(el, v > p);
  }
  var valueSel = '.wallet strong, .wallet b, .hud-cell strong, .hud-cell b';
  function scanValues(root) {
    [].slice.call((root.querySelectorAll ? root.querySelectorAll(valueSel) : [])).forEach(function (el) { if (!last.has(el)) last.set(el, num(el)); });
  }

  /* ---------- 4. 버튼 피드백(이벤트 위임) ---------- */
  var btnSel = '.button, .header-btn, .class-number, .close-button, .map-zoom-buttons button, .mini-map-zones button';
  function btn(t) { return t && t.closest ? t.closest(btnSel) : null; }
  document.addEventListener('pointerdown', function (e) {
    var b = btn(e.target);
    if (!b || b.disabled) return;
    A.remove(b);
    A({ targets: b, scale: .95, duration: 90, easing: 'easeOutQuad' });
  }, true);
  function release(e) {
    var b = btn(e.target);
    if (!b) return;
    A.remove(b);
    A({ targets: b, scale: 1, duration: 520, easing: 'easeOutElastic(1,.5)', complete: function () { clean(b); } });
  }
  document.addEventListener('pointerup', release, true);
  document.addEventListener('pointercancel', release, true);
  document.addEventListener('mouseover', function (e) {
    var b = btn(e.target);
    if (!b || b.disabled || b.__ldHover) return;
    if (e.relatedTarget && b.contains(e.relatedTarget)) return;
    b.__ldHover = true;
    A.remove(b);
    A({ targets: b, translateY: -2, duration: 180, easing: 'easeOutQuad' });
  }, true);
  document.addEventListener('mouseout', function (e) {
    var b = btn(e.target);
    if (!b || !b.__ldHover) return;
    if (e.relatedTarget && b.contains(e.relatedTarget)) return;
    b.__ldHover = false;
    A.remove(b);
    A({ targets: b, translateY: 0, duration: 260, easing: 'easeOutQuad', complete: function () { clean(b); } });
  }, true);

  /* ---------- 5. 타일 선택/타워 배치 ---------- */
  function tileAttr(el) {
    if (el.getAttribute('aria-selected') === 'true') {
      A.remove(el);
      A({ targets: el, scale: [1.2, 1], duration: 650, easing: 'easeOutElastic(1,.5)', complete: function () { clean(el); } });
    }
  }

  /* ---------- 관찰자 ---------- */
  var mo = new MutationObserver(function (list) {
    for (var i = 0; i < list.length; i++) {
      var m = list[i];
      if (m.type === 'childList') {
        for (var j = 0; j < m.addedNodes.length; j++) { added(m.addedNodes[j]); scanValues(m.addedNodes[j]); }
        var host = m.target && m.target.nodeType === 1 ? m.target.closest && m.target.closest(valueSel) : null;
        if (host) watchValue(host);
      } else if (m.type === 'characterData') {
        var p = m.target.parentElement, h = p && p.closest ? p.closest(valueSel) : null;
        if (h) watchValue(h);
      } else if (m.type === 'attributes' && m.attributeName === 'aria-selected') {
        tileAttr(m.target);
      }
    }
  });

  function start() {
    var root = document.body;
    added(root); scanValues(root);
    mo.observe(root, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['aria-selected'] });
  }
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})();
