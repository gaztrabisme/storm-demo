// Settings (SPEC 6.5): text size, theme, mode, credits, and the test-only export and clear buttons (SPEC 7).
import type { Actions } from '../app';
import { t, tList } from '../i18n';
import { clearLog, exportLog } from '../log';
import { MODES, modeOf, TEXT_SIZES, THEMES, themeOf, type Mode, type State, type Store, type TextSize, type Theme } from '../state';
import { h, radioGroup } from './dom';

/** Root font size, theme and mode classes on <html>/<body> follow the store. */
export function bindAppearance(store: Store): void {
  const apply = (s: State) => {
    const root = document.documentElement;
    root.style.fontSize = `${s.settings.textSize}px`;
    root.dataset.theme = themeOf(s);
    root.style.colorScheme = themeOf(s);
    document.body.classList.toggle('mode-easy', modeOf(s) === 'easy');
    document.body.classList.toggle('mode-full', modeOf(s) === 'full');
    document.body.classList.toggle('view-satellite', s.view === 'satellite');
  };
  apply(store.state);
  store.subscribe((s, prev) => {
    if (s.settings !== prev.settings || s.systemDark !== prev.systemDark || s.modeOverride !== prev.modeOverride || s.view !== prev.view) apply(s);
  });
}

export const textSizeGroup = (store: Store, actions: Actions, name: string) =>
  radioGroup<TextSize>({
    test: 'set-text',
    legend: t('settings.text'),
    name,
    options: TEXT_SIZES.map((v) => ({ value: v, label: t(`settings.textOptions.${v}`) })),
    value: store.state.settings.textSize,
    onChange: (v) => actions.setTextSize(v),
  });

export function settingsDialog(store: Store, actions: Actions, testMode: boolean): { el: HTMLDialogElement; open(): void } {
  const text = textSizeGroup(store, actions, 'set-text');
  const theme = radioGroup<Theme>({
    test: 'set-theme',
    legend: t('settings.theme'),
    name: 'set-theme',
    options: THEMES.map((v) => ({ value: v, label: t(`settings.themeOptions.${v}`) })),
    value: themeOf(store.state),
    onChange: (v) => actions.setTheme(v),
  });
  const mode = radioGroup<Mode>({
    test: 'set-mode',
    legend: t('settings.mode'),
    name: 'set-mode',
    options: MODES.map((v) => ({ value: v, label: t(`settings.modeOptions.${v}`) })),
    value: modeOf(store.state),
    onChange: (v) => actions.setMode(v),
  });
  const sync = (s: State) => {
    text.set(s.settings.textSize);
    theme.set(themeOf(s));
    mode.set(modeOf(s));
  };
  store.subscribe((s) => sync(s));

  const credits = h('section', { test: 'credits', class: 'credits' }, h('h3', { text: t('settings.credits') }), h('ul', {}, ...tList('settings.creditLines').map((c) => h('li', { text: c }))));
  const notice = h('p', { class: 'status', role: 'status' });
  const testData = testMode
    ? h(
        'section',
        { class: 'testdata' },
        h('h3', { text: t('settings.testData') }),
        h(
          'div',
          { class: 'testdata__row' },
          h('button', { test: 'btn-export', class: 'btn', type: 'button', text: t('settings.export'), onclick: () => exportLog() }),
          h('button', {
            test: 'btn-clear-log',
            class: 'btn',
            type: 'button',
            text: t('settings.clear'),
            onclick: () => {
              clearLog();
              notice.textContent = t('settings.cleared');
            },
          }),
        ),
        notice,
      )
    : null;

  const close = h('button', { class: 'btn dialog__close', type: 'button', text: t('settings.close'), onclick: () => el.close() });
  const el = h(
    'dialog',
    { test: 'settings', class: 'dialog', 'aria-labelledby': 'settings-title' },
    h('div', { class: 'dialog__head' }, h('h2', { id: 'settings-title', text: t('settings.title') }), close),
    text.el,
    theme.el,
    mode.el,
    credits,
    testData,
  );
  let opener: HTMLElement | null = null;
  el.addEventListener('close', () => {
    notice.textContent = '';
    opener?.focus({ preventScroll: true });
  });
  return {
    el,
    open() {
      sync(store.state);
      opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      if (!el.open) el.showModal();
    },
  };
}
