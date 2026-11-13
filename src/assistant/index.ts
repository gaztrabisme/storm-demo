// Usui-chan (SPEC 6.4): the corner portrait and the question sheet with its 7 chips. She never speaks
// unprompted (SPEC 2.1): no pop-up. Pattern from AstroSphere src/guide/.
import './assistant.css';
import avatarUrl from '../assets/guide/usui-avatar.webp';
import type { Actions } from '../app';
import { t } from '../i18n';
import { logEvent } from '../log';
import type { Store } from '../state';
import { h, nextId } from '../ui/dom';
import { CHIP_IDS, cardAnswer, prepareAnswer, sourceAnswer, whenAnswer, whereAnswer, type Answer, type ChipId } from './answers';
import { createFigure, talkMs, type Figure } from './figure';
/** hello: one wave (4.2 s); nod: one nod (1.3 s). */
const HELLO_MS = 4300;
const NOD_MS = 1400;

export interface AssistantParts {
  /** Avatar and question sheet, fixed to the viewport. */
  root: HTMLElement;
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

  // ---- Question sheet.
  const answer = h('div', { test: 'assistant-answer', class: 'assistant-answer', 'aria-live': 'polite', hidden: true });
  const chips = h(
    'div',
    { class: 'assistant-chips' },
    ...CHIP_IDS.map((id) => h('button', { test: 'chip', 'data-chip': id, class: 'assistant-chip', type: 'button', text: t(`assistant.chips.${id}`), onclick: () => onChip(id) })),
  );
  const sheetFigure: Figure = createFigure('assistant-figure--sheet');
  /** hello on the sheet's first open in the page session, a nod after that. */
  let greeted = false;
  const sheet = h(
    'section',
    { test: 'assistant-sheet', id: sheetId, class: 'assistant-sheet', role: 'dialog', 'aria-labelledby': titleId, hidden: true },
    h(
      'div',
      { class: 'assistant-sheet__head' },
      sheetFigure.el,
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
    showChips(false);
    sheet.hidden = false;
    avatar.setAttribute('aria-expanded', 'true');
    logEvent('assistant_open');
    if (greeted) sheetFigure.play(['nod'], { holdMs: NOD_MS });
    else sheetFigure.play(['hello'], { holdMs: HELLO_MS });
    greeted = true;
    chips.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
  }
  function closeSheet(returnFocus = false): void {
    if (sheet.hidden) return;
    sheet.hidden = true;
    avatar.setAttribute('aria-expanded', 'false');
    if (returnFocus) avatar.focus({ preventScroll: true });
  }

  /** Shows an answer and has the sheet's figure say it with `clip` + talk. */
  function say(a: Answer | null, clip: 'nod' | 'point' | 'alert' | 'relief', param?: unknown): void {
    show(a);
    if (a) sheetFigure.play([clip, 'talk'], { param, holdMs: talkMs(a.line) });
  }
  /** The when-answer, said with worry for an affected place and relief for an unaffected one. */
  function sayWhen(v: NonNullable<typeof store.state.verdict>, place: NonNullable<typeof store.state.place>): void {
    say(whenAnswer(v, place), v.affected ? 'alert' : 'relief');
  }
  /** Screen direction from the sheet's figure to the storm marker ({x, y}, y up). */
  function towardStorm(): { x: number; y: number } {
    const m = document.querySelector('[data-test="storm-marker"]')?.getBoundingClientRect();
    const f = sheetFigure.el.getBoundingClientRect();
    if (!m || !m.width) return { x: -1, y: 0 };
    return { x: m.left + m.width / 2 - (f.left + f.width / 2), y: f.top + f.height / 2 - (m.top + m.height / 2) };
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
  /**
   * Scroll the sheet just far enough that the whole answer shows, and no further than its top. The chips stay
   * above it; the scroll stops at the top of a row of chips, so no chip is shown cut in half.
   */
  function revealAnswer(): void {
    if (sheet.hidden || answer.hidden) return;
    body.style.paddingBottom = '';
    const top = Math.max(0, answer.offsetTop - 4);
    const need = answer.offsetTop + answer.offsetHeight - body.clientHeight;
    if (need <= 0) {
      body.scrollTop = 0;
      return;
    }
    const rows = [...chips.children].map((c) => (c as HTMLElement).offsetTop).filter((y) => y >= need && y < top);
    const to = rows.length ? Math.min(...rows) : top;
    // The scroll can only reach `need`; a little room under the answer lets it stop at the row's top instead.
    if (to > need) body.style.paddingBottom = `${Math.ceil(to - need)}px`;
    body.scrollTop = to;
  }

  /**
   * "affected", or "when" asked before any verdict: the sheet stays open while the location is found (Usui-chan
   * thinks), and answers once the check gives a verdict.
   */
  let pending: 'affected' | 'when' | null = null;
  /** The sheet was closed so the province picker could be used; it opens again with the answer. */
  let reopenForAnswer = false;

  function onChip(id: ChipId): void {
    logEvent('chip', { id });
    pending = null;
    reopenForAnswer = false;
    const s = store.state;
    switch (id) {
      case 'affected':
        show(null);
        pending = 'affected';
        actions.closeSatellite();
        actions.runCheck();
        break;
      case 'when':
        if (s.verdict && s.place) sayWhen(s.verdict, s.place);
        else {
          show(null);
          pending = 'when';
          actions.closeSatellite();
          actions.runCheck();
        }
        break;
      case 'prepare':
        say(prepareAnswer(), 'nod');
        break;
      case 'windlevel':
        say(cardAnswer('wind'), 'nod');
        break;
      case 'radius':
        say(cardAnswer('radius'), 'nod');
        break;
      case 'where':
        actions.closeSatellite();
        say(whereAnswer(s.timeMs), 'point', towardStorm());
        actions.highlightStorm();
        break;
      case 'source':
        show(sourceAnswer());
        closeSheet(true);
        actions.openSatellite();
        break;
    }
  }

  store.subscribe((s, prev) => {
    // Waiting for the location (SPEC 6.8): Usui-chan thinks.
    if (pending && s.locating && !prev.locating && !sheet.hidden) sheetFigure.play(['think']);
    if (pending && s.picker !== 'hidden' && prev.picker === 'hidden' && !sheet.hidden) {
      // Location failed: the sheet would cover the picker on a phone.
      reopenForAnswer = true;
      closeSheet();
    }
    if (s.verdict === prev.verdict || !s.verdict || !s.place) return;
    if (pending) {
      pending = null;
      const reopen = reopenForAnswer;
      reopenForAnswer = false;
      if (reopen) {
        sheet.hidden = false;
        avatar.setAttribute('aria-expanded', 'true');
      }
      sayWhen(s.verdict, s.place);
    }
  });

  // Esc closes the sheet. Capture phase, so the satellite view's Esc does not also run.
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Escape' || document.querySelector('dialog[open]')) return;
      if (!sheet.hidden) closeSheet(sheet.contains(document.activeElement));
      else return;
      e.preventDefault();
      e.stopPropagation();
    },
    true,
  );

  return { root: h('div', { test: 'assistant', class: 'assistant' }, avatar, sheet), sheet };
}
