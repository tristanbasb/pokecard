import * as api from './api.js';
import { el } from './dom.js';
import { renderCollectionView } from './collection-view.js';
import { renderScanView } from './scan-view.js';
import { renderSettingsView } from './settings-view.js';

const main = document.querySelector('main');
const nav = document.querySelector('nav');

const VIEWS = {
  scan: ['Scanner', renderScanView],
  collection: ['Collection', renderCollectionView],
  settings: ['Réglages', renderSettingsView],
};

let current = 'scan';

function showView(name, options = {}) {
  current = name;
  nav.hidden = false;
  for (const button of nav.querySelectorAll('button')) {
    if (button.dataset.view === name) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
  VIEWS[name][1](main, {
    ...options,
    openScanResult: (initialResult) => showView('scan', { initialResult }),
  });
}

function showLogin() {
  nav.hidden = true;
  const pin = el('input', {
    type: 'password', inputMode: 'numeric', autocomplete: 'current-password', 'aria-label': 'Code PIN',
  });
  const message = el('p', { className: 'notice notice--error', role: 'alert', hidden: true });
  main.replaceChildren(el('form', {
    className: 'scan-start',
    onsubmit: async (event) => {
      event.preventDefault();
      try {
        await api.login(pin.value);
        showView(current);
      } catch (error) {
        message.textContent = error.message;
        message.hidden = false;
      }
    },
  },
  el('h1', {}, 'Code PIN'),
  pin,
  message,
  el('button', { className: 'button button--primary button--large' }, 'Entrer')));
  pin.focus();
}

api.setUnauthorizedHandler(showLogin);

nav.replaceChildren(...Object.entries(VIEWS).map(([name, [label]]) => {
  const button = el('button', { onclick: () => showView(name) }, label);
  button.dataset.view = name;
  return button;
}));

showView('scan');
