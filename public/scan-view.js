import * as api from './api.js';
import {
  CONDITIONS, LANGS, VARIANTS, cardImage, el, fill, formatPrice, priceFor, select,
} from './dom.js';
import { resizeImage } from './image.js';

export function renderScanView(root) {
  const input = el('input', {
    type: 'file', accept: 'image/*', capture: 'environment', className: 'visually-hidden', id: 'photo-input',
  });
  const content = el('div');
  root.replaceChildren(input, content);

  const openCamera = () => input.click();
  const show = (...nodes) => fill(content, ...nodes);
  const scanButton = (label) => el('button', { className: 'button button--primary button--large', onclick: openCamera }, label);

  function showIdle() {
    show(el('div', { className: 'scan-start' },
      el('h1', {}, 'Scanner une carte'),
      el('p', { className: 'muted' }, 'Pose la carte à plat, bien éclairée, et cadre-la entière.'),
      scanButton('Prendre la photo')));
  }

  function showError(message) {
    show(
      el('p', { className: 'notice notice--error', role: 'alert' }, message),
      scanButton('Reprendre la photo'),
      manualSearch({ lang: 'fr', scanId: null, onPick: showConfirmation, onAdded: showAdded }),
    );
  }

  function showAdded(row) {
    show(el('div', { className: 'scan-start' },
      el('h1', {}, 'Carte ajoutée'),
      el('p', {}, `${row.card.name}, ${row.condition}`),
      el('p', { className: 'muted' }, `Tu en as ${row.quantity}. ${row.price === null ? 'Prix inconnu.' : `Prix de référence: ${formatPrice(row.price)}.`}`),
      scanButton('Scanner la suivante')));
  }

  function showPending(result) {
    show(
      el('p', { className: 'notice', role: 'status' }, result.message),
      scanButton('Scanner une autre carte'),
    );
  }

  function showResult(result) {
    if (result.status === 'pending') return showPending(result);
    if (result.status === 'failed') return showNotFound(result);
    if (!result.card) return showNotFound(result);
    return showConfirmation(result);
  }

  function showNotFound(result) {
    const { identification, scanId, message } = result;
    show(
      el('p', { className: 'notice notice--error', role: 'alert' }, message),
      result.photoUrl ? el('img', { className: 'card-image card-image--photo', src: result.photoUrl, alt: 'Ta photo' }) : null,
      scanButton('Reprendre la photo'),
      manualSearch({
        name: identification?.name ?? '',
        lang: LANGS.some(([code]) => code === identification?.language) ? identification.language : 'fr',
        scanId,
        photoUrl: result.photoUrl,
        identification,
        onPick: showConfirmation,
        onAdded: showAdded,
      }),
    );
  }

  function showConfirmation(result) {
    const { scanId, identification, alternatives = [], ambiguous, metric = 'trend' } = result;
    let card = result.card;

    const condition = select(CONDITIONS, identification?.condition ?? 'Near Mint', { 'aria-label': 'État' });
    const variant = select(VARIANTS, identification?.variant ?? 'normal', { 'aria-label': 'Variante' });
    const lang = select(LANGS, card.lang, { 'aria-label': 'Langue' });
    const quantity = el('input', {
      type: 'number', min: 1, step: 1, value: 1, inputMode: 'numeric', 'aria-label': 'Quantité',
    });

    const official = el('div');
    const title = el('div');
    const price = el('p', { className: 'price' });
    const message = el('p', { className: 'notice notice--error', role: 'alert', hidden: true });

    function refresh() {
      fill(official, cardImage(card.imageUrl, `Carte officielle ${card.name}`));
      fill(title,
        el('h1', {}, card.name),
        el('p', { className: 'muted' }, [card.setName, card.number && `n° ${card.number}${card.printedTotal ? `/${card.printedTotal}` : ''}`, card.rarity].filter(Boolean).join(' · ')),
      );
      fill(price,
        el('span', { className: 'muted' }, 'Prix de référence '),
        card.prices ? formatPrice(priceFor(card, variant.value, metric)) : 'affiché après l\'ajout',
      );
    }
    variant.addEventListener('change', refresh);

    const add = el('button', {
      className: 'button button--primary button--large',
      onclick: async () => {
        add.disabled = true;
        message.hidden = true;
        try {
          showAdded(await api.addToCollection({
            cardId: card.id,
            lang: lang.value,
            variant: variant.value,
            condition: condition.value,
            quantity: Number(quantity.value),
            scanId,
          }));
        } catch (error) {
          message.textContent = error.message;
          message.hidden = false;
          add.disabled = false;
        }
      },
    }, 'Ajouter à ma collection');

    const others = ambiguous && alternatives.length > 0
      ? el('section', {},
        el('h2', {}, 'Ce n\'est pas la bonne ?'),
        el('div', { className: 'candidates' }, [card, ...alternatives].map((candidate) => el('button', {
          className: 'candidate',
          onclick: () => { card = candidate; refresh(); },
        },
        cardImage(candidate.imageUrl, candidate.name),
        el('span', {}, `${candidate.setName ?? ''} ${candidate.number ?? ''}`.trim() || candidate.name)))))
      : null;

    const defects = identification?.defects?.length
      ? el('p', { className: 'muted' }, `Défauts vus: ${identification.defects.join(', ')}.`)
      : null;

    refresh();
    show(
      ambiguous ? el('p', { className: 'notice', role: 'status' }, 'Vérifie la carte: la lecture n\'est pas certaine.') : null,
      el('div', { className: 'compare' },
        el('figure', {},
          result.photoUrl ? el('img', { className: 'card-image', src: result.photoUrl, alt: 'Ta photo' }) : cardImage(null, ''),
          el('figcaption', {}, 'Ta photo')),
        el('figure', {}, official, el('figcaption', {}, 'Carte officielle'))),
      title,
      price,
      others,
      el('div', { className: 'fields' },
        el('label', {}, 'État estimé', condition),
        el('label', {}, 'Variante', variant),
        el('label', {}, 'Langue', lang),
        el('label', {}, 'Quantité', quantity)),
      defects,
      message,
      add,
      el('button', { className: 'button', onclick: openCamera }, 'Reprendre la photo'),
    );
  }

  input.addEventListener('change', async () => {
    const [file] = input.files;
    input.value = '';
    if (!file) return;
    show(el('div', { className: 'scan-start', role: 'status' },
      el('div', { className: 'spinner' }),
      el('p', {}, 'Lecture de la carte…')));

    let blob;
    try {
      blob = await resizeImage(file);
    } catch {
      showError('Photo illisible, réessaie.');
      return;
    }
    try {
      showResult(await api.scan(blob));
    } catch (error) {
      showError(error.message);
    }
  });

  showIdle();
}

function manualSearch({
  name = '', lang, scanId, photoUrl, identification, onPick, onAdded,
}) {
  const nameInput = el('input', { type: 'search', value: name, placeholder: 'Nom de la carte', 'aria-label': 'Nom de la carte' });
  const langSelect = select(LANGS, lang, { 'aria-label': 'Langue' });
  const results = el('div');

  const pick = (brief) => onPick({
    scanId,
    photoUrl,
    identification,
    ambiguous: false,
    card: {
      id: brief.id, lang: langSelect.value, name: brief.name, number: brief.localId, imageUrl: brief.imageUrl, prices: null,
    },
  });

  const saveWithoutPrice = async () => {
    try {
      onAdded(await api.addToCollection({
        lang: langSelect.value,
        variant: identification?.variant ?? 'normal',
        condition: identification?.condition ?? 'Near Mint',
        scanId,
        manualCard: { name: nameInput.value, setName: identification?.setName, number: identification?.number },
      }));
    } catch (error) {
      fill(results, el('p', { className: 'notice notice--error', role: 'alert' }, error.message));
    }
  };

  const search = async (event) => {
    event.preventDefault();
    fill(results, el('p', { className: 'muted' }, 'Recherche…'));
    try {
      const briefs = await api.searchCards(nameInput.value, langSelect.value);
      fill(results,
        briefs.length === 0 ? el('p', { className: 'muted' }, 'Aucune carte trouvée.') : null,
        el('div', { className: 'candidates' }, briefs.slice(0, 24).map((brief) => el('button', {
          type: 'button', className: 'candidate', onclick: () => pick(brief),
        }, cardImage(brief.imageUrl, brief.name), el('span', {}, `${brief.name} ${brief.localId ?? ''}`.trim())))),
        onAdded ? el('button', { type: 'button', className: 'button', onclick: saveWithoutPrice }, 'Enregistrer sans prix') : null,
      );
    } catch (error) {
      fill(results, el('p', { className: 'notice notice--error', role: 'alert' }, error.message));
    }
  };

  return el('section', {},
    el('h2', {}, 'Saisir le nom'),
    el('form', { className: 'search-form', onsubmit: search },
      nameInput,
      langSelect,
      el('button', { className: 'button' }, 'Chercher')),
    results);
}
