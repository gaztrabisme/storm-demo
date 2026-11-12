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

export interface AssistantParts {
  /** Avatar and question sheet, fixed to the viewport. */
  root: HTMLElement;
  /** The warning pop-up: a speech bubble from the portrait, in the corner outside the map (also inside root). */
  warning: HTMLElement;
  sheet: HTMLElement;
}

export function assistant(store: Store, actions: Actions): AssistantParts {
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
    warningText,
    h('button', { class: 'assistant-x', type: 'button', 'aria-label': t('assistant.close'), title: t('assistant.close'), text: '×', onclick: () => closeWarning() }),
  );
  const closeWarning = () => {
    if (warning.hidden) return;
    const hadFocus = warning.contains(document.activeElement);
    warning.hidden = true;
    syncFoot();
    if (hadFocus) avatar.focus({ preventScroll: true });
  };
  /**
   * While the warning shows, the page keeps a strip of ground at the bottom (under the panel) that holds the
   * bubble and the portrait, so the bubble never sits on the verdict it follows (styles.css, --foot-h).
   */
  const syncFoot = () => {
    const root = document.documentElement;
    if (warning.hidden) {
      root.style.removeProperty('--foot-h');
      root.classList.remove('has-foot');
      return;
    }
    root.style.setProperty('--foot-h', `${Math.max(88, Math.ceil(warning.offsetHeight) + 24)}px`);
    root.classList.add('has-foot');
  };
  new ResizeObserver(() => syncFoot()).observe(warning);

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
      // The title also brings the questions back into view (on a phone they fold away under an answer).
      h('h2', { class: 'assistant-sheet__title', id: titleId }, h('button', { class: 'assistant-sheet__title-btn', type: 'button', text: t('assistant.sheetTitle'), onclick: () => showChips(true) })),
      h('button', { class: 'assistant-x', type: 'button', 'aria-label': t('assistant.close'), title: t('assistant.close'), text: '×', onclick: () => closeSheet(true) }),
    ),
    h('div', { class: 'assistant-sheet__body' }, chips, answer),
  );
  const body = sheet.lastElementChild as HTMLElement;

  /** Unfold the question list and scroll to it. */
  function showChips(focus: boolean): void {
    sheet.classList.remove('is-answered');
    body.scrollTop = 0;
    if (focus) chips.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
  }

  function openSheet(): void {
    closeWarning();
    showChips(false);
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
      sheet.classList.remove('is-answered');
      return;
    }
    const parts: Node[] = [h('p', { class: 'assistant-answer__line', text: a.line })];
    if (a.items?.length) parts.push(h(a.ordered ? 'ol' : 'ul', { class: 'assistant-answer__items' }, ...a.items.map((x) => h('li', { text: x }))));
    if (a.source) parts.push(h('p', { class: 'source', text: a.source }));
    answer.replaceChildren(...parts);
    answer.hidden = false;
    sheet.classList.add('is-answered');
    revealAnswer();
  }
  /** Scroll the sheet so the answer starts at its top; the chips stay above it. */
  function revealAnswer(): void {
    if (sheet.hidden || answer.hidden) return;
    body.scrollTop = Math.max(0, answer.offsetTop - 4);
  }

  /** "when" asked before any verdict: answer in the sheet once the check gives one. */
  let pendingWhen = false;
  /** The sheet was closed so the province picker could be used; it opens again with the "when" answer. */
  let reopenForWhen = false;

  function onChip(id: ChipId): void {
    logEvent('chip', { id });
    pendingWhen = false;
    reopenForWhen = false;
    const s = store.state;
    switch (id) {
      case 'affected':
        show(null);
        closeSheet(true);
        actions.closeSatellite();
        actions.runCheck();
        break;
      case 'when':
        if (s.verdict && s.place) show(whenAnswer(s.verdict, s.place));
        else {
          show(null);
          pendingWhen = true;
          actions.closeSatellite();
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
        actions.closeSatellite();
        show(whereAnswer(s.timeMs));
        actions.flyToStorm();
        break;
      case 'source':
        show(sourceAnswer());
        closeSheet(true);
        actions.openSatellite();
        break;
    }
  }

  store.subscribe((s, prev) => {
    // The warning is about one place: a new check, the province picker or a new place closes it.
    if ((s.locating && !prev.locating) || (s.picker !== 'hidden' && prev.picker === 'hidden') || s.place !== prev.place) closeWarning();
    if (pendingWhen && s.picker !== 'hidden' && prev.picker === 'hidden' && !sheet.hidden) {
      // Location failed: the sheet would cover the picker on a phone.
      reopenForWhen = true;
      closeSheet();
    }
    if (s.verdict === prev.verdict || !s.verdict || !s.place) return;
    if (pendingWhen) {
      pendingWhen = false;
      if (reopenForWhen) {
        reopenForWhen = false;
        sheet.hidden = false;
        avatar.setAttribute('aria-expanded', 'true');
      }
      show(whenAnswer(s.verdict, s.place));
    }
    if (s.verdict.affected && !warned && s.verdict.firstInside !== null) {
      warned = true;
      warningText.textContent = t('assistant.warning', { place: s.place.label, firstInside: vnTime(s.verdict.firstInside) });
      warning.hidden = false;
      syncFoot();
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

  return { root: h('div', { test: 'assistant', class: 'assistant' }, warning, avatar, sheet), warning, sheet };
}
