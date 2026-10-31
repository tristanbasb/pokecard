import * as api from './api.js';
import { el, fill, select } from './dom.js';

const METRICS = [
  ['trend', 'Tendance Cardmarket'],
  ['avg30', 'Moyenne sur 30 jours'],
  ['low', 'Prix le plus bas'],
];

export async function renderSettingsView(root, { openScanResult }) {
  const refreshStatus = el('p', { className: 'muted', role: 'status' });
  const metricStatus = el('p', { className: 'muted', role: 'status' });
  const metricHolder = el('div');
  const pending = el('section');

  const refresh = el('button', {
    className: 'button',
    onclick: async () => {
      refresh.disabled = true;
      refreshStatus.textContent = 'Mise à jour en cours, cela peut prendre un moment…';
      try {
        const { updated, failed } = await api.refreshAllPrices();
        refreshStatus.textContent = `${updated} carte${updated > 1 ? 's' : ''} mise${updated > 1 ? 's' : ''} à jour, ${failed} en échec.`;
      } catch (error) {
        refreshStatus.textContent = error.message;
      }
      refresh.disabled = false;
    },
  }, 'Rafraîchir tous les prix');

  fill(root, el('div', {},
    el('h1', {}, 'Réglages'),
    el('section', {},
      el('h2', {}, 'Repère de prix'),
      metricHolder,
      metricStatus,
      el('p', { className: 'muted' }, 'Le prix est une référence par carte: il ne tient compte ni de l\'état ni de la langue de ton exemplaire.')),
    el('section', {}, el('h2', {}, 'Prix'), refresh, refreshStatus),
    el('section', {},
      el('h2', {}, 'Export'),
      el('a', { className: 'button button--link', href: '/api/export.csv', download: 'pokecard-collection.csv' }, 'Télécharger la collection en CSV')),
    pending));

  try {
    const { priceMetric } = await api.getSettings();
    fill(metricHolder, select(METRICS, priceMetric, {
      'aria-label': 'Repère de prix',
      onchange: async (event) => {
        try {
          await api.saveSettings({ priceMetric: event.target.value });
          metricStatus.textContent = 'Repère enregistré.';
        } catch (error) {
          metricStatus.textContent = error.message;
        }
      },
    }));
  } catch (error) {
    metricStatus.textContent = error.message;
  }

  function scanRow(scan, actionLabel) {
    const status = el('p', { className: 'muted', role: 'status' });
    const row = el('div', { className: 'row row--static' });
    const action = el('button', {
      className: 'button',
      onclick: async () => {
        action.disabled = true;
        status.textContent = 'Un instant…';
        try {
          const result = await api.retryScan(scan.id);
          if (result.status === 'done') openScanResult(result);
          else {
            status.textContent = result.message;
            action.disabled = false;
          }
        } catch (error) {
          status.textContent = error.message;
          action.disabled = false;
        }
      },
    }, actionLabel);
    const dismiss = el('button', {
      className: 'button',
      onclick: async () => {
        try {
          await api.dismissScan(scan.id);
          row.remove();
        } catch (error) {
          status.textContent = error.message;
        }
      },
    }, 'Ignorer');
    fill(
      row,
      scan.photoUrl ? el('img', { className: 'card-image', src: scan.photoUrl, alt: 'Photo du scan' }) : null,
      el('span', { className: 'row__body' },
        el('strong', {}, scan.name ?? 'Carte non lue'),
        el('span', { className: 'muted' }, new Date(scan.createdAt).toLocaleString('fr-FR')),
        action,
        dismiss,
        status),
    );
    return row;
  }

  async function loadScans() {
    try {
      const [waiting, unconfirmed] = await Promise.all([api.listScans('pending'), api.listScans('unconfirmed')]);
      fill(
        pending,
        el('h2', {}, 'Scans en attente'),
        waiting.length === 0 ? el('p', { className: 'muted' }, 'Aucun scan en attente.') : null,
        waiting.map((scan) => scanRow(scan, 'Réessayer')),
        el('h2', {}, 'Scans à confirmer'),
        unconfirmed.length === 0
          ? el('p', { className: 'muted' }, 'Aucun scan à confirmer.')
          : el('p', { className: 'muted' }, 'Ces cartes ont été lues mais pas ajoutées à ta collection.'),
        unconfirmed.map((scan) => scanRow(scan, 'Reprendre')),
      );
    } catch (error) {
      fill(pending, el('p', { className: 'muted' }, error.message));
    }
  }
  loadScans();
}
