import { h } from './dom.js';

let root = null;

export function initNotifications(container) {
  root = container;
}

/** Show a transient message. type: 'info' | 'success' | 'warning' | 'error'. */
export function notify(message, { type = 'info', timeout } = {}) {
  if (!root) {
    console.log(`[${type}] ${message}`);
    return;
  }
  const el = h('div', { class: `toast toast-${type}`, role: type === 'error' ? 'alert' : 'status' }, message);
  root.append(el);
  requestAnimationFrame(() => el.classList.add('show'));
  const ms = timeout ?? (type === 'error' ? 7000 : 3200);
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, ms);
  while (root.children.length > 5) root.firstElementChild.remove();
}
