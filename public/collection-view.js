import * as api from './api.js';
import {
  CONDITIONS, LANGS, VARIANTS, cardImage, el, fill, formatEuro, formatPrice, select,
} from './dom.js';

const labelOf = (options, value) => options.find(([code]) => code === value)?.[1] ?? value;
const uniqueOptions = (pairs) => [...new Map(pairs.filter(([value]) => value)).entries()]
  .sort((a, b) => a[1].localeCompare(b[1], 'fr'));

export function renderCollectionView(root) {
  const filters = { search: '', set: '', rarity: '', condition: '', sort: 'added' };
  renderList();

  async function renderList() {
    const summary = el('p', { className: 'summary' }, 'Chargement…');
    const list = el('div', { className: 'rows' });
    const controls = el('div', { className: 'filters' });
    fill(root, el('div', {}, el('h1', {}, 'Ma collection'), summary, controls, list));

    let all;
    try {
      all = await api.getCollection({});
    } catch (error) {
      summary.textContent = error.message;
      return;
    }

    const filter = (key, label, options) => el('label', {}, label, select(
      [['', 'Tous'], ...options],
      filters[key],
      { onchange: (event) => { filters[key] = event.target.value; load(); } },
    ));
    let searchTimer;
    fill(
      controls,
      el('input', {
        type: 'search',
        className: 'filters__search',
        placeholder: 'Rechercher un nom',
        'aria-label': 'Rechercher un nom',
        value: filters.search,
        oninput: (event) => {
          filters.search = event.target.value;
          clearTimeout(searchTimer);
          searchTimer = setTimeout(load, 200);
        },
      }),
      filter('set', 'Extension', uniqueOptions(all.rows.map((row) => [row.card.setId, row.card.setName]))),
      filter('rarity', 'Rareté', uniqueOptions(all.rows.map((row) => [row.card.rarity, row.card.rarity]))),
      filter('condition', 'État', CONDITIONS),
      el('label', {}, 'Tri', select(
        [['added', 'Derniers ajouts'], ['price', 'Prix'], ['name', 'Nom']],
        filters.sort,
        { onchange: (event) => { filters.sort = event.target.value; load(); } },
      )),
    );

    let latest = 0;
    async function load() {
      latest += 1;
      const ticket = latest;
      try {
        const params = Object.fromEntries(Object.entries(filters).filter(([, value]) => value));
        const data = await api.getCollection(params);
        if (ticket === latest) show(data);
      } catch (error) {
        summary.textContent = error.message;
      }
    }

    function show({ rows, totalCards, estimatedValue, unknownPriceCount }) {
      summary.textContent = [
        `${totalCards} carte${totalCards > 1 ? 's' : ''}`,
        `valeur estimée ${formatEuro(estimatedValue)}`,
        unknownPriceCount > 0 ? `${unknownPriceCount} sans prix` : null,
      ].filter(Boolean).join(' · ');
      if (rows.length === 0) {
        fill(list, el('p', { className: 'muted' }, all.rows.length ? 'Aucune carte ne correspond.' : 'Ta collection est vide. Scanne ta première carte.'));
        return;
      }
      fill(list, rows.map((row) => el('button', { className: 'row', onclick: () => renderDetail(row) },
        cardImage(row.card.imageUrl ?? (row.photoPath && `/photos/${row.photoPath}`), row.card.name),
        el('span', { className: 'row__body' },
          el('strong', {}, row.card.name),
          el('span', { className: 'muted' }, [row.card.setName, row.card.number].filter(Boolean).join(' · ')),
          el('span', { className: 'muted' }, `${row.condition} · ${labelOf(VARIANTS, row.variant)} · ${row.lang.toUpperCase()}`)),
        el('span', { className: 'row__end' },
          el('strong', {}, formatPrice(row.price)),
          el('span', { className: 'muted' }, `× ${row.quantity}`)))));
    }

    load();
  }

  async function renderDetail(row) {
    const message = el('p', { className: 'notice', role: 'status', hidden: true });
    const say = (text) => { message.textContent = text; message.hidden = false; };
    const condition = select(CONDITIONS, row.condition, { 'aria-label': 'État' });
    const variant = select(VARIANTS, row.variant, { 'aria-label': 'Variante' });
    const quantity = el('input', {
      type: 'number', min: 1, step: 1, value: row.quantity, inputMode: 'numeric', 'aria-label': 'Quantité',
    });
    const note = el('input', { type: 'text', value: row.note ?? '', 'aria-label': 'Note' });
    const prices = el('div');
    const history = el('section');

    function showPrices(card, price) {
      const { low, avg30, updatedAt } = card.prices;
      fill(
        prices,
        el('p', { className: 'price' }, el('span', { className: 'muted' }, 'Prix de référence'), formatPrice(price)),
        el('p', { className: 'muted' }, `Prix bas: ${formatPrice(low)} · Moyenne 30 j: ${formatPrice(avg30)}`),
        updatedAt ? el('p', { className: 'muted' }, `Mis à jour le ${new Date(updatedAt).toLocaleDateString('fr-FR')}`) : null,
      );
    }

    async function loadHistory() {
      try {
        const { history: lines } = await api.getCard(row.cardId, row.lang);
        fill(
          history,
          el('h2', {}, 'Évolution du prix'),
          lines.length === 0
            ? el('p', { className: 'muted' }, 'Pas encore d\'historique.')
            : el('ul', { className: 'history' }, lines.slice(-12).reverse().map((line) => el('li', {},
              el('span', {}, new Date(line.date).toLocaleDateString('fr-FR')),
              el('span', {}, formatPrice(row.variant === 'reverse' ? line.trendHolo ?? line.trend : line.trend))))),
        );
      } catch (error) {
        fill(history, el('p', { className: 'muted' }, error.message));
      }
    }

    fill(root, el('div', {},
      el('button', { className: 'button', onclick: renderList }, '‹ Retour'),
      el('div', { className: 'compare' },
        el('figure', {}, cardImage(row.card.imageUrl, row.card.name), el('figcaption', {}, 'Carte officielle')),
        el('figure', {}, cardImage(row.photoPath && `/photos/${row.photoPath}`, 'Ta photo'), el('figcaption', {}, 'Ta photo'))),
      el('h1', {}, row.card.name),
      el('p', { className: 'muted' }, [row.card.setName, row.card.number, row.card.rarity, labelOf(LANGS, row.lang)].filter(Boolean).join(' · ')),
      prices,
      el('div', { className: 'fields' },
        el('label', {}, 'État', condition),
        el('label', {}, 'Variante', variant),
        el('label', {}, 'Quantité', quantity),
        el('label', {}, 'Note', note)),
      message,
      el('button', {
        className: 'button button--primary',
        onclick: async () => {
          try {
            renderDetail(await api.updateRow(row.id, {
              condition: condition.value,
              variant: variant.value,
              quantity: Number(quantity.value),
              note: note.value || null,
            }));
          } catch (error) {
            say(error.message);
          }
        },
      }, 'Enregistrer'),
      el('button', {
        className: 'button',
        onclick: async () => {
          say('Mise à jour du prix…');
          try {
            await api.refreshCardPrice(row.cardId, row.lang);
            const { rows } = await api.getCollection({});
            renderDetail(rows.find((candidate) => candidate.id === row.id) ?? row);
          } catch (error) {
            say(error.message);
          }
        },
      }, 'Rafraîchir le prix'),
      history,
      el('button', {
        className: 'button button--danger',
        onclick: async () => {
          if (!window.confirm(`Supprimer ${row.card.name} (${row.condition}) de ta collection ?`)) return;
          try {
            await api.deleteRow(row.id);
            renderList();
          } catch (error) {
            say(error.message);
          }
        },
      }, 'Supprimer')));

    showPrices(row.card, row.price);
    loadHistory();
  }
}
