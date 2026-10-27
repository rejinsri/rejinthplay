import { h } from './dom.js';

/** Accessible modal dialog. Only one is open at a time. */
export class Modal {
  static current = null;

  constructor({ title, content, onClose, className = '' }) {
    this.onClose = onClose;
    this.closeButton = h('button', { type: 'button', class: 'btn btn-ghost modal-close', 'aria-label': 'Close', onClick: () => this.close() }, '✕');
    this.dialog = h(
      'div',
      { class: `modal ${className}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('div', { class: 'modal-header' }, h('h2', { class: 'modal-title' }, title), this.closeButton),
      h('div', { class: 'modal-body' }, content),
    );
    this.overlay = h('div', { class: 'modal-overlay' }, this.dialog);
    this.overlay.addEventListener('pointerdown', (e) => {
      if (e.target === this.overlay) this.close();
    });
  }

  get isOpen() {
    return this.overlay.isConnected;
  }

  open() {
    if (Modal.current && Modal.current !== this) Modal.current.close();
    document.getElementById('modal-root').append(this.overlay);
    Modal.current = this;
    this.closeButton.focus();
  }

  close() {
    if (!this.isOpen) return;
    this.overlay.remove();
    if (Modal.current === this) Modal.current = null;
    this.onClose?.();
  }

  toggle() {
    if (this.isOpen) this.close();
    else this.open();
  }
}
