// Usui-chan (SPEC 6.4): the corner portrait, the one-time warning after an affected verdict,
// and the question sheet with its 7 chips. Pattern from AstroSphere src/guide/.
import './assistant.css';
import avatarUrl from '../assets/guide/usui-avatar.webp';
import poseUrl from '../assets/guide/usui-pose.webp';
import type { Actions } from '../app';
import { t } from '../i18n';
import { logEvent } from '../log';
import type { Store } from '../state';
import { vnTime } from '../storm/format';
import { h, nextId } from '../ui/dom';
import { CHIP_IDS, cardAnswer, prepareAnswer, sourceAnswer, whenAnswer, whereAnswer, type Answer, type ChipId } from './answers';

export function assistant(store: Store, actions: Actions): HTMLElement {
  const sheetId = nextId('assistant-sheet');
  const titleId = nextId('assistant-title');

  const avatar = h(
    'button',
    {
      test: 'assistant-avatar',
      class: 'assistant-avatar',
      type: 'button',
      'aria-label': t('assistant.avatar'),
      'aria-expanded': 'false',
      'aria-controls': sheetId,
      onclick: () => (sheet.hidden ? openSheet() : closeSheet()),
    },
    h('img', { class: 'assistant-avatar__img', src: avatarUrl, alt: '', width: 56, height: 56, decoding: 'async' }),
  );

  // ---- Warning pop-up: once per page session, only after an affected verdict.
  let warned = false;
  const warningText = h('p', { class: 'assistant-warning__text' });
  const warning = h(
    'div',
    { test: 'assistant-warning', class: 'assistant-warning', role: 'status', hidden: true },
    h('img', { class: 'assistant-warning__face', src: avatarUrl, alt: '', width: 40, height: 40, decoding: 'async' }),
    warningText,
    h('button', { class: 'assistant-x', type: 'button', 'aria-label': t('assistant.close'), title: t('assistant.close'), text: '×', onclick: () => closeWarning() }),
  );
  const closeWarning = () => {
    warning.hidden = true;
  };

  // ---- Question sheet.
  const answer = h('div', { test: 'assistant-answer', class: 'assistant-answer', 'aria-live': 'polite', hidden: true });
  const chips = h(
    'div',
    { class: 'assistant-chips' },
    ...CHIP_IDS.map((id) => h('button', { test: 'chip', 'data-chip': id, class: 'assistant-chip', type: 'button', text: t(`assistant.chips.${id}`), onclick: () => onChip(id) })),
  );
  const sheet = h(
    'section',
    { test: 'assistant-sheet', id: sheetId, class: 'assistant-sheet', role: 'dialog', 'aria-labelledby': titleId, hidden: true },
    h(
      'div',
      { class: 'assistant-sheet__head' },
      h('img', { class: 'assistant-sheet__pose', src: poseUrl, alt: t('assistant.poseAlt'), width: 596, height: 560, decoding: 'async' }),
      h('h2', { class: 'assistant-sheet__title', id: titleId, text: t('assistant.sheetTitle') }),
      h('button', { class: 'assistant-x', type: 'button', 'aria-label': t('assistant.close'), title: t('assistant.close'), text: '×', onclick: () => closeSheet(true) }),
    ),
    chips,
    answer,
  );

  function openSheet(): void {
    closeWarning();
    sheet.hidden = false;
    avatar.setAttribute('aria-expanded', 'true');
    logEvent('assistant_open');
    chips.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
  }
  function closeSheet(returnFocus = false): void {
    if (sheet.hidden) return;
    sheet.hidden = true;
    avatar.setAttribute('aria-expanded', 'false');
    if (returnFocus) avatar.focus({ preventScroll: true });
  }

  function show(a: Answer | null): void {
    if (!a) {
      answer.replaceChildren();
      answer.hidden = true;
      return;
    }
    const parts: Node[] = [h('p', { class: 'assistant-answer__line', text: a.line })];
    if (a.items?.length) parts.push(h(a.ordered ? 'ol' : 'ul', { class: 'assistant-answer__items' }, ...a.items.map((x) => h('li', { text: x }))));
    if (a.source) parts.push(h('p', { class: 'source', text: a.source }));
    answer.replaceChildren(...parts);
    answer.hidden = false;
  }

  /** "when" asked before any verdict: answer once the check gives one. */
  let pendingWhen = false;

  function onChip(id: ChipId): void {
    logEvent('chip', { id });
    pendingWhen = false;
    const s = store.state;
    switch (id) {
      case 'affected':
        show(null);
        closeSheet();
        actions.runCheck();
        break;
      case 'when':
        if (s.verdict && s.place) show(whenAnswer(s.verdict, s.place));
        else {
          show(null);
          pendingWhen = true;
          closeSheet();
          actions.runCheck();
        }
        break;
      case 'prepare':
        show(prepareAnswer());
        break;
      case 'windlevel':
        show(cardAnswer('wind'));
        break;
      case 'radius':
        show(cardAnswer('radius'));
        break;
      case 'where':
        show(whereAnswer(s.timeMs));
        actions.flyToStorm();
        break;
      case 'source':
        show(sourceAnswer());
        closeSheet();
        actions.openSatellite();
        break;
    }
  }

  store.subscribe((s, prev) => {
    if (s.verdict === prev.verdict || !s.verdict || !s.place) return;
    if (pendingWhen) {
      pendingWhen = false;
      show(whenAnswer(s.verdict, s.place));
    }
    if (s.verdict.affected && !warned && s.verdict.firstInside !== null) {
      warned = true;
      warningText.textContent = t('assistant.warning', { place: s.place.label, firstInside: vnTime(s.verdict.firstInside) });
      warning.hidden = false;
      logEvent('assistant_warning_shown');
    }
  });

  // Esc closes the warning first, then the sheet. Capture phase, so the satellite view's Esc does not also run.
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Escape' || document.querySelector('dialog[open]')) return;
      if (!warning.hidden) closeWarning();
      else if (!sheet.hidden) closeSheet(sheet.contains(document.activeElement));
      else return;
      e.preventDefault();
      e.stopPropagation();
    },
    true,
  );

  return h('div', { test: 'assistant', class: 'assistant' }, avatar, warning, sheet);
}
