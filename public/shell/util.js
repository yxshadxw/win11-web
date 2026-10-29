export const $ = (sel, root = document) => root.querySelector(sel);

export const store = {
  get(key, fallback) { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch { /* storage blocked */ } },
  getJSON(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  },
  setJSON(key, value) { this.set(key, JSON.stringify(value)); },
};

/** App icon: the SVG from the registry, falling back to the emoji if it fails to load. */
export function appIcon(app, size) {
  const span = document.createElement('span');
  span.className = 'app-icon';
  span.style.setProperty('--size', `${size}px`);
  span.setAttribute('aria-hidden', 'true');
  const fallback = () => { span.textContent = app.icon; span.classList.add('emoji'); };
  if (!app.image) { fallback(); return span; }
  const img = document.createElement('img');
  img.src = app.image;
  img.alt = '';
  img.width = size;
  img.height = size;
  img.draggable = false;
  img.addEventListener('error', () => { img.remove(); fallback(); }, { once: true });
  span.append(img);
  return span;
}
