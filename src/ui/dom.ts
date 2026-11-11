// Small DOM builder.

type Attrs = Record<string, string | number | boolean | null | undefined | EventListener>;
type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'text') el.textContent = String(v);
    else if (k === 'class') el.className = String(v);
    else if (k === 'test') el.dataset.test = String(v);
    else if (k === 'checked' || k === 'hidden' || k === 'disabled' || k === 'open' || k === 'selected') (el as unknown as Record<string, boolean>)[k] = !!v;
    else if (k === 'value') (el as unknown as { value: string }).value = String(v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

let uid = 0;
export const nextId = (prefix: string): string => `${prefix}-${++uid}`;

/** A radio group: fieldset with a legend and one label per option (label text is the option name only). */
export function radioGroup<V extends string | number>(opts: {
  test: string;
  legend: string;
  name: string;
  options: ReadonlyArray<{ value: V; label: string; describedBy?: string }>;
  value: V;
  onChange(v: V): void;
}): { el: HTMLFieldSetElement; set(v: V): void } {
  const inputs: Array<[V, HTMLInputElement]> = [];
  const el = h('fieldset', { test: opts.test, class: 'radios' }, h('legend', { text: opts.legend }));
  const row = h('div', { class: 'radios__row' });
  for (const o of opts.options) {
    const input = h('input', {
      type: 'radio',
      name: opts.name,
      value: String(o.value),
      checked: o.value === opts.value,
      'aria-describedby': o.describedBy,
      onchange: () => input.checked && opts.onChange(o.value),
    });
    inputs.push([o.value, input]);
    row.append(h('label', { class: 'radios__opt' }, input, h('span', { text: o.label })));
  }
  el.append(row);
  return {
    el,
    set(v) {
      for (const [val, input] of inputs) input.checked = val === v;
    },
  };
}
