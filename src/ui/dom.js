/** Tiny DOM helpers shared by the UI panels. */

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'text') el.textContent = value;
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key === 'style' && typeof value === 'object') Object.assign(el.style, value);
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (value === true) el.setAttribute(key, '');
    else el.setAttribute(key, String(value));
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

export function panelHeader(title, ...extra) {
  return h('div', { class: 'panel-header' }, h('h2', { class: 'panel-title' }, title), ...extra);
}

export function button(label, { title, onClick, className = '', disabled = false } = {}) {
  return h('button', { type: 'button', class: `btn ${className}`, title, disabled, onClick }, label);
}

/** Button with an LED that shows on/off state. */
export function ledButton({ label, title, active = false, onClick, className = '' }) {
  const btn = h('button', { type: 'button', class: `btn btn-led ${className}`, title, onClick }, h('span', { class: 'led' }), h('span', { class: 'btn-label' }, label));
  btn.setActive = (on) => {
    btn.classList.toggle('is-active', Boolean(on));
    btn.setAttribute('aria-pressed', String(Boolean(on)));
  };
  btn.setActive(active);
  return btn;
}

export function slider({ label, min, max, step = 1, value, format = (v) => String(v), onInput, vertical = false, className = '' }) {
  const input = h('input', { type: 'range', min, max, step, 'aria-label': label });
  input.value = String(value);
  const output = h('output', { class: 'slider-value' }, format(Number(input.value)));
  input.addEventListener('input', () => {
    const v = Number(input.value);
    output.textContent = format(v);
    onInput?.(v);
  });
  const root = h('label', { class: `slider ${vertical ? 'slider-vertical' : ''} ${className}` }, h('span', { class: 'slider-label' }, label), input, output);
  return {
    root,
    input,
    setValue(v) {
      input.value = String(v);
      output.textContent = format(Number(input.value));
    },
  };
}

/** Slider with a logarithmic scale (for filter frequencies). */
export function logSlider({ label, min, max, value, format, onInput, className = '' }) {
  const toPos = (v) => Math.round((1000 * Math.log(v / min)) / Math.log(max / min));
  const toValue = (pos) => min * Math.pow(max / min, pos / 1000);
  const s = slider({ label, min: 0, max: 1000, step: 1, value: toPos(value), format: (p) => format(toValue(p)), onInput: (p) => onInput?.(toValue(p)), className });
  return { ...s, setValue: (v) => s.setValue(toPos(v)) };
}

export function select({ label, options, value, onChange, className = '' }) {
  const el = h('select', { 'aria-label': label });
  const fill = (opts) => {
    el.replaceChildren();
    const groups = new Map();
    for (const opt of opts) {
      const option = h('option', { value: opt.value }, opt.label);
      if (opt.group) {
        if (!groups.has(opt.group)) {
          const group = h('optgroup', { label: opt.group });
          groups.set(opt.group, group);
          el.append(group);
        }
        groups.get(opt.group).append(option);
      } else {
        el.append(option);
      }
    }
  };
  fill(options);
  el.value = String(value);
  el.addEventListener('change', () => {
    onChange?.(el.value);
    el.blur();
  });
  const root = h('label', { class: `field ${className}` }, h('span', { class: 'field-label' }, label), el);
  return {
    root,
    select: el,
    setValue(v) {
      el.value = String(v);
    },
    setOptions(opts, v) {
      fill(opts);
      if (v !== undefined) el.value = String(v);
    },
  };
}

/** [-] value [+] control. */
export function stepper({ label, value, format = (v) => String(v), onStep, title }) {
  const display = h('span', { class: 'stepper-value' }, format(value));
  const root = h(
    'div',
    { class: 'stepper', title },
    h('span', { class: 'stepper-label' }, label),
    h('div', { class: 'stepper-controls' },
      h('button', { type: 'button', class: 'btn btn-step', 'aria-label': `${label} down`, onClick: () => onStep?.(-1) }, '−'),
      display,
      h('button', { type: 'button', class: 'btn btn-step', 'aria-label': `${label} up`, onClick: () => onStep?.(1) }, '+'),
    ),
  );
  return {
    root,
    setValue(v) {
      display.textContent = format(v);
    },
  };
}

export function formatTime(seconds) {
  const s = Math.max(0, seconds || 0);
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${(s - m * 60).toFixed(1).padStart(4, '0')}`;
}

export const signed = (n) => (n > 0 ? `+${n}` : String(n));
