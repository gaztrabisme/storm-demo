// First run (SPEC 6.6): three steps; steps 1 and 2 have "Tiếp" and "Bỏ qua", step 3 only "Bắt đầu". Finishing or skipping saves the settings.
import type { Actions } from '../app';
import { t } from '../i18n';
import { MODES, modeOf, type Mode, type Store } from '../state';
import { h, radioGroup } from './dom';
import { textSizeGroup } from './settings';

export function showOnboarding(store: Store, actions: Actions): void {
  let step = 1;
  const body = h('div', { class: 'onboarding__body' });
  const next = h('button', { class: 'btn btn--primary', type: 'button', text: t('onboarding.next'), onclick: () => (step < 3 ? go(step + 1) : end(true)) });
  const skip = h('button', { class: 'btn', type: 'button', text: t('onboarding.skip'), onclick: () => end(false) });
  const counter = h('p', { class: 'onboarding__step' });
  const el = h('dialog', { test: 'onboarding', class: 'dialog onboarding', 'aria-labelledby': 'ob-title' }, counter, body, h('div', { class: 'onboarding__buttons' }, skip, next));

  function go(n: number): void {
    step = n;
    next.textContent = t(n < 3 ? 'onboarding.next' : 'onboarding.start');
    skip.hidden = n === 3;
    counter.textContent = t('onboarding.step', { n });
    if (n === 1) {
      const sizes = textSizeGroup(store, actions, 'ob-text');
      body.replaceChildren(h('h2', { id: 'ob-title', text: t('onboarding.textTitle') }), sizes.el, h('p', { class: 'onboarding__preview', text: t('onboarding.preview') }));
    } else if (n === 2) {
      const lines = MODES.map((m) => h('p', { id: `ob-mode-${m}`, class: 'onboarding__line' }, h('strong', { text: `${t(`settings.modeOptions.${m}`)}: ` }), t(`onboarding.${m}Line`)));
      const modes = radioGroup<Mode>({
        test: 'set-mode-onboarding',
        legend: t('settings.mode'),
        name: 'ob-mode',
        options: MODES.map((m) => ({ value: m, label: t(`settings.modeOptions.${m}`), describedBy: `ob-mode-${m}` })),
        value: modeOf(store.state),
        onChange: (v) => actions.setMode(v),
      });
      body.replaceChildren(h('h2', { id: 'ob-title', text: t('onboarding.modeTitle') }), modes.el, ...lines);
    } else {
      body.replaceChildren(h('h2', { id: 'ob-title', text: t('onboarding.geoTitle') }), h('p', { text: t('onboarding.geo') }));
    }
    next.focus({ preventScroll: true });
  }

  function end(done: boolean): void {
    if (!el.open) return;
    el.close();
    el.remove();
    actions.finishOnboarding(done);
  }

  el.addEventListener('cancel', (e) => {
    e.preventDefault();
    end(false);
  });
  document.body.append(el);
  go(1);
  el.showModal();
  next.focus({ preventScroll: true });
}
