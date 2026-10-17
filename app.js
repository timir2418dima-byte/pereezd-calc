import { estimate, presetsOf, rangeText, rub, orderMessage, messengerLinks, applySheet } from './calc.js?v=2';

const app = document.getElementById('app');

const ICONS = {
  phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/></svg>',
  whatsapp: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2c-1.5 0-3-.4-4.3-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2c0 1.3.9 2.5 1.1 2.7.1.2 1.8 2.8 4.4 3.9 1.6.7 2.3.8 3.1.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.5-.3z"/></svg>',
  telegram: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M21.9 4.3 18.7 19.5c-.2 1.1-.9 1.3-1.8.8l-4.9-3.6-2.4 2.3c-.3.3-.5.5-1 .5l.4-5 9.1-8.2c.4-.4-.1-.6-.6-.2L6.3 13.2l-4.8-1.5c-1-.3-1.1-1 .2-1.5L20.5 3c.9-.3 1.6.2 1.4 1.3z"/></svg>',
};

// Силуэт кузова: длина растёт с размером машины.
function truck(size = 1) {
  const body = 22 + size * 7;
  const w = body + 22;
  return `<svg viewBox="0 0 ${w} 30" aria-hidden="true" preserveAspectRatio="xMinYMid meet">
    <rect x="1" y="3" width="${body}" height="18" rx="2" fill="currentColor" opacity=".85"/>
    <path d="M${body + 3} 9h9l6 6v6H${body + 3}z" fill="currentColor"/>
    <rect x="${body + 6}" y="11" width="6" height="4" rx="1" fill="#fff" opacity=".8"/>
    <circle cx="9" cy="24" r="4" fill="currentColor"/><circle cx="9" cy="24" r="1.6" fill="#fff"/>
    <circle cx="${body + 11}" cy="24" r="4" fill="currentColor"/><circle cx="${body + 11}" cy="24" r="1.6" fill="#fff"/>
  </svg>`;
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function initials(name) {
  const words = name.replace(/[«»"!]/g, '').split(/[\s-]+/).filter(Boolean);
  return (words.length > 1 ? words[0][0] + words[1][0] : words[0][0]).toUpperCase();
}

function tomorrow() {
  const d = new Date(Date.now() + 864e5);
  return d.toISOString().slice(0, 10);
}

async function loadConfig() {
  const slug = new URLSearchParams(location.search).get('c')
    || document.querySelector('meta[name="company"]')?.content || 'demo';
  if (!/^[a-z0-9-]+$/.test(slug)) throw new Error('bad company');
  const res = await fetch(`companies/${slug}.json`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`no company ${slug}`);
  let cfg = await res.json();
  if (cfg.sheetCsv) {
    try {
      const csv = await fetch(cfg.sheetCsv, { cache: 'no-cache' }).then((r) => (r.ok ? r.text() : Promise.reject()));
      cfg = applySheet(cfg, csv);
    } catch {
      // Таблица недоступна — работаем на ценах из конфига.
    }
  }
  return cfg;
}

function render(cfg) {
  document.title = `${cfg.name} — расчёт переезда`;
  document.documentElement.style.setProperty('--accent', cfg.accent || '#1f7a5a');

  const firstFree = cfg.vehicles.find((v) => v.available !== false) || cfg.vehicles[0];
  const state = {
    presetId: presetsOf(cfg)[2]?.id ?? presetsOf(cfg)[0].id,
    vehicleId: firstFree.id,
    loaders: 2,
    from: '', floorFrom: 1, liftFrom: false,
    to: '', floorTo: 1, liftTo: false,
    outOfCity: false, outOfCityKm: 0,
    date: tomorrow(), time: '10:00',
    extras: [], comment: '', name: '',
    showBreakdown: false,
  };

  const logo = cfg.logo ? `<img src="${esc(cfg.logo)}" alt="">` : esc(initials(cfg.name));
  const tel = cfg.phone ? `tel:${cfg.phone.replace(/[^\d+]/g, '')}` : '';

  app.innerHTML = `
    <header class="top">
      <div class="logo">${logo}</div>
      <div class="brand"><b>${esc(cfg.name)}</b><span>${esc(cfg.tagline || cfg.city || '')}</span></div>
      ${tel ? `<a class="call" href="${tel}">${ICONS.phone}<span>Позвонить</span></a>` : ''}
    </header>
    ${cfg.demo ? `<p class="demo">${esc(cfg.demo.note)}</p>` : ''}
    <h1>Сколько стоит переезд — за минуту</h1>
    <p class="lead">Выберите машину и грузчиков, укажите адреса. Примерная цена посчитается сразу, а готовая заявка уйдёт нам в мессенджер.</p>

    <section class="step"><h2><i>1</i>Что перевозим</h2>
      <div class="chips" data-group="preset">
        ${presetsOf(cfg).map((p) => `<button type="button" class="chip" data-id="${esc(p.id)}">${esc(p.label)}</button>`).join('')}
      </div>
    </section>

    <section class="step"><h2><i>2</i>Машина</h2>
      <div class="vehicles" data-group="vehicle">
        ${cfg.vehicles.map((v) => `
          <button type="button" class="veh" data-id="${esc(v.id)}" ${v.available === false ? 'disabled' : ''}>
            ${truck(v.size)}
            <span><b>${esc(v.name)}</b><small>${esc(v.spec || '')}</small></span>
            <span class="price">${v.available === false ? '<span class="busy">занята</span>' : `${rub(v.rate)}/ч`}</span>
          </button>`).join('')}
      </div>
    </section>

    <section class="step"><h2><i>3</i>Грузчики</h2>
      <div class="stepper">
        <button type="button" data-loaders="-1" aria-label="Меньше грузчиков">−</button>
        <output id="loaders">2</output>
        <button type="button" data-loaders="1" aria-label="Больше грузчиков">+</button>
        <span class="hint">по ${rub(cfg.loaders.rate)}/ч за человека</span>
      </div>
    </section>

    <section class="step"><h2><i>4</i>Адреса</h2>
      <div class="addr">
        <span class="lbl">Откуда</span>
        <input class="field" name="from" placeholder="Улица, дом" autocomplete="off">
        <div class="row">
          <input class="field floor" name="floorFrom" type="number" min="1" max="40" value="1" inputmode="numeric" aria-label="Этаж погрузки">
          <span>этаж</span>
          <label class="check"><input type="checkbox" name="liftFrom"> есть грузовой лифт</label>
        </div>
      </div>
      <div class="addr">
        <span class="lbl">Куда</span>
        <input class="field" name="to" placeholder="Улица, дом" autocomplete="off">
        <div class="row">
          <input class="field floor" name="floorTo" type="number" min="1" max="40" value="1" inputmode="numeric" aria-label="Этаж выгрузки">
          <span>этаж</span>
          <label class="check"><input type="checkbox" name="liftTo"> есть грузовой лифт</label>
        </div>
      </div>
      <div class="addr">
        <label class="check"><input type="checkbox" name="outOfCity"> Поездка за город</label>
        <div class="row" id="kmRow" hidden>
          <input class="field floor" name="outOfCityKm" type="number" min="0" max="3000" value="20" inputmode="numeric" aria-label="Километров за городом">
          <span>км за чертой города</span>
        </div>
      </div>
    </section>

    <section class="step"><h2><i>5</i>Когда и детали</h2>
      <div class="two">
        <input class="field" name="date" type="date" value="${state.date}" aria-label="Дата">
        <input class="field" name="time" type="time" value="${state.time}" step="1800" aria-label="Время">
      </div>
      ${(cfg.extras || []).length ? `<div class="chips" data-group="extras" style="margin-top:12px">
        ${cfg.extras.map((e) => `<button type="button" class="chip" data-id="${esc(e.id)}">${esc(e.label)}</button>`).join('')}
      </div>` : ''}
      <textarea class="field" name="comment" placeholder="Что важно знать: холодильник, шкаф не разбирается, узкий подъезд…" style="margin-top:12px"></textarea>
      <input class="field" name="name" placeholder="Как к вам обращаться" autocomplete="given-name" style="margin-top:10px">
    </section>

    <div class="bar"><div class="bar-in">
      <div class="sum">
        <div><small>Примерно</small><br><strong id="total"></strong></div>
        <button type="button" id="toggle">Из чего цена</button>
      </div>
      <div id="details" hidden></div>
      <div class="send" id="send"></div>
      <p class="legal">Цена предварительная: точную назовёт диспетчер после уточнения деталей. Заявка уходит напрямую компании в мессенджер, сайт её не хранит.</p>
    </div></div>`;

  const $ = (sel) => app.querySelector(sel);

  function update() {
    const order = { ...state, outOfCityKm: state.outOfCity ? state.outOfCityKm : 0 };
    const est = estimate(cfg, order);

    app.querySelectorAll('[data-group="preset"] .chip').forEach((b) => b.setAttribute('aria-pressed', b.dataset.id === state.presetId));
    app.querySelectorAll('[data-group="vehicle"] .veh').forEach((b) => b.setAttribute('aria-pressed', b.dataset.id === state.vehicleId));
    app.querySelectorAll('[data-group="extras"] .chip').forEach((b) => b.setAttribute('aria-pressed', state.extras.includes(b.dataset.id)));
    $('#loaders').textContent = state.loaders;
    $('#kmRow').hidden = !state.outOfCity;

    $('#total').textContent = rangeText(est.low, est.high);
    const details = $('#details');
    details.hidden = !state.showBreakdown;
    $('#toggle').textContent = state.showBreakdown ? 'Скрыть' : 'Из чего цена';
    details.innerHTML = `<ul class="breakdown">${est.lines.map((l) => `
      <li class="${l.range[0] < 0 ? 'promo' : ''}"><span>${esc(l.label)}</span><span>${l.range[0] < 0 ? '−' : ''}${rangeText(Math.abs(l.range[0]), Math.abs(l.range[1]))}</span></li>`).join('')}
    </ul><p class="note">Время работы: ${est.hours[0] === est.hours[1] ? est.hours[0] : `${est.hours[0]}–${est.hours[1]}`} ч с учётом этажей. Минимальный заказ — ${cfg.minHours ?? 2} ч.</p>`;

    const text = orderMessage(cfg, order, est);
    const links = messengerLinks(cfg, text);
    $('#send').innerHTML = links.map((l, i) =>
      `<a class="${i ? 'alt' : ''}" href="${esc(l.href)}" target="_blank" rel="noopener">${ICONS[l.kind]}<span>${links.length > 1 ? `Заявка в ${l.label}` : `Отправить заявку в ${l.label}`}</span></a>`).join('');
  }

  app.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const group = btn.closest('[data-group]')?.dataset.group;
    if (group === 'preset') state.presetId = btn.dataset.id;
    else if (group === 'vehicle') state.vehicleId = btn.dataset.id;
    else if (group === 'extras') {
      const id = btn.dataset.id;
      state.extras = state.extras.includes(id) ? state.extras.filter((x) => x !== id) : [...state.extras, id];
    } else if (btn.dataset.loaders) {
      state.loaders = Math.max(0, Math.min(cfg.loaders.max ?? 4, state.loaders + Number(btn.dataset.loaders)));
    } else if (btn.id === 'toggle') state.showBreakdown = !state.showBreakdown;
    else return;
    update();
  });

  app.addEventListener('input', (e) => {
    const el = e.target;
    if (!el.name || !(el.name in state)) return;
    if (el.type === 'checkbox') state[el.name] = el.checked;
    else if (el.type === 'number') state[el.name] = Math.max(0, Number(el.value) || 0);
    else state[el.name] = el.value;
    update();
  });

  update();
  app.removeAttribute('aria-busy');
}

loadConfig().then(render).catch(() => {
  app.innerHTML = '<p class="loading">Не удалось загрузить цены. Позвоните нам — посчитаем по телефону.</p>';
});
