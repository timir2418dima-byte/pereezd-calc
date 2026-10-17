// Расчёт примерной стоимости переезда. Чистые функции без DOM: их гоняют тесты.

const DEFAULT_PRESETS = [
  { id: 'few', label: 'Несколько вещей', hours: [1, 2] },
  { id: 'studio', label: 'Студия', hours: [2, 3] },
  { id: 'k1', label: '1-комнатная', hours: [3, 4] },
  { id: 'k2', label: '2-комнатная', hours: [4, 5.5] },
  { id: 'k3', label: '3-комнатная и больше', hours: [5, 7] },
  { id: 'office', label: 'Офис', hours: [4, 8] },
];

export function presetsOf(cfg) {
  return cfg.presets && cfg.presets.length ? cfg.presets : DEFAULT_PRESETS;
}

const roundUp = (v, step) => Math.ceil(v / step) * step;

export function isNight(time, cfg) {
  if (!time || !cfg.loaders?.nightRate) return false;
  const [h] = time.split(':').map(Number);
  const from = cfg.nightFrom ?? 22;
  const to = cfg.nightTo ?? 7;
  return h >= from || h < to;
}

/**
 * order: { presetId, vehicleId, loaders, floorFrom, liftFrom, floorTo, liftTo, outOfCityKm, time, extras: [] }
 * Возвращает вилку цены и разбивку по строкам.
 */
export function estimate(cfg, order) {
  const preset = presetsOf(cfg).find((p) => p.id === order.presetId) || presetsOf(cfg)[0];
  const vehicle = cfg.vehicles.find((v) => v.id === order.vehicleId) || cfg.vehicles[0];
  const loaders = Math.max(0, Math.min(order.loaders ?? 0, cfg.loaders?.max ?? 4));

  // Каждый этаж без лифта добавляет время на погрузку/выгрузку.
  const perFloor = cfg.floorExtraHours ?? 0.15;
  const stairs = (floor, lift) => (lift ? 0 : Math.max(0, (floor || 1) - 1));
  const extraHours = (stairs(order.floorFrom, order.liftFrom) + stairs(order.floorTo, order.liftTo)) * perFloor;

  const minVeh = vehicle.minHours ?? cfg.minHours ?? 2;
  const minLoad = cfg.loaders?.minHours ?? cfg.minHours ?? 2;
  const hours = preset.hours.map((h) => roundUp(h + extraHours, 0.5));

  const lines = [];
  const vehicleCost = hours.map((h) => {
    const cost = Math.max(h, minVeh) * vehicle.rate;
    return Math.max(cost, vehicle.minOrder ?? 0);
  });
  lines.push({ label: `${vehicle.name}, ${fmtHours(hours, minVeh)}`, range: vehicleCost });

  const night = isNight(order.time, cfg);
  const loaderRate = night ? cfg.loaders.nightRate : cfg.loaders?.rate ?? 0;
  if (loaders > 0) {
    const cost = hours.map((h) => Math.max(h, minLoad) * loaderRate * loaders);
    lines.push({ label: `Грузчики: ${loaders} × ${loaderRate} ₽/ч${night ? ' (ночь)' : ''}`, range: cost });
  }

  const km = Math.max(0, order.outOfCityKm || 0);
  if (km > 0 && vehicle.kmRate) {
    const trips = cfg.kmBothWays === false ? 1 : 2;
    const cost = km * vehicle.kmRate * trips;
    lines.push({ label: `За городом: ${km} км × ${vehicle.kmRate} ₽${trips === 2 ? ' туда-обратно' : ''}`, range: [cost, cost] });
  }

  for (const id of order.extras || []) {
    const extra = (cfg.extras || []).find((e) => e.id === id);
    if (!extra) continue;
    const range = Array.isArray(extra.price) ? extra.price : [extra.price, extra.price];
    lines.push({ label: extra.label, range });
  }

  let total = lines.reduce((acc, l) => [acc[0] + l.range[0], acc[1] + l.range[1]], [0, 0]);

  const promo = cfg.promo;
  let promoApplied = false;
  const promoVehicleOk = !promo?.vehicleIds || promo.vehicleIds.includes(vehicle.id);
  if (promo && promoVehicleOk && loaders >= (promo.minLoaders ?? 0) && hours[0] >= (promo.minHours ?? 0)) {
    const k = 1 - promo.percent / 100;
    lines.push({ label: promo.label, range: [-(total[0] * (1 - k)), -(total[1] * (1 - k))] });
    total = [total[0] * k, total[1] * k];
    promoApplied = true;
  }

  const step = cfg.roundTo ?? 100;
  return {
    hours,
    lines: lines.map((l) => ({ label: l.label, range: l.range.map((v) => Math.round(v)) })),
    low: roundUp(total[0], step),
    high: roundUp(total[1], step),
    night,
    promoApplied,
    vehicle,
    preset,
  };
}

function fmtHours([a, b], min) {
  const lo = Math.max(a, min);
  const hi = Math.max(b, min);
  return lo === hi ? `${fmtNum(lo)} ч` : `${fmtNum(lo)}–${fmtNum(hi)} ч`;
}

const fmtNum = (n) => String(n).replace('.', ',');

export function rub(n) {
  return `${Math.round(n).toLocaleString('ru-RU').replace(/ /g, ' ')} ₽`;
}

export function rangeText(low, high) {
  return low === high ? rub(low) : `${rub(low).replace(' ₽', '')} – ${rub(high)}`;
}

const WEEKDAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

/** '2026-10-18' → '18.10.2026 (вс)' */
export function fmtDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!m) return iso || '';
  const day = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay();
  return `${m[3]}.${m[2]}.${m[1]} (${WEEKDAYS[day]})`;
}

/** Текст заявки, который клиент отправит в мессенджер. */
export function orderMessage(cfg, order, est) {
  const floor = (f, lift) => `${f || 1} этаж, ${lift ? 'есть лифт' : 'без лифта'}`;
  const rows = [
    `Заявка с сайта ${cfg.name}`,
    '',
    `Что везём: ${est.preset.label}`,
    `Машина: ${est.vehicle.name}`,
    `Грузчики: ${order.loaders || 'не нужны'}`,
    `Откуда: ${order.from || '—'} (${floor(order.floorFrom, order.liftFrom)})`,
    `Куда: ${order.to || '—'} (${floor(order.floorTo, order.liftTo)})`,
  ];
  if (order.outOfCityKm) rows.push(`За городом: ${order.outOfCityKm} км`);
  rows.push(`Когда: ${fmtDate(order.date) || 'дата не указана'}${order.time ? `, ${order.time}` : ''}`);
  const extras = (order.extras || [])
    .map((id) => (cfg.extras || []).find((e) => e.id === id)?.label)
    .filter(Boolean);
  if (extras.length) rows.push(`Дополнительно: ${extras.join(', ')}`);
  rows.push(`Предварительно: ${rangeText(est.low, est.high)}`);
  if (order.comment) rows.push(`Комментарий: ${order.comment}`);
  if (order.name) rows.push(`Имя: ${order.name}`);
  return rows.join('\n');
}

export function messengerLinks(cfg, text) {
  const enc = encodeURIComponent(text);
  const links = [];
  if (cfg.whatsapp) links.push({ kind: 'whatsapp', label: 'WhatsApp', href: `https://wa.me/${cfg.whatsapp.replace(/\D/g, '')}?text=${enc}` });
  if (cfg.telegram) links.push({ kind: 'telegram', label: 'Telegram', href: `https://t.me/${cfg.telegram.replace(/^@/, '')}?text=${enc}` });
  return links;
}

/**
 * Таблица владельца (CSV из Google Таблиц): id;rate;kmRate;available
 * Позволяет менять цены и отмечать занятые машины без правки кода.
 */
export function applySheet(cfg, csv) {
  const lines = csv.trim().split(/\r?\n/);
  const sep = lines[0].includes(';') ? ';' : ',';
  const head = lines[0].split(sep).map((s) => s.trim().toLowerCase());
  const col = (name) => head.indexOf(name);
  const out = structuredClone(cfg);
  for (const line of lines.slice(1)) {
    const cells = line.split(sep).map((s) => s.trim());
    const id = cells[col('id')];
    const num = (name) => {
      const i = col(name);
      if (i < 0 || cells[i] === '' || cells[i] === undefined) return undefined;
      const v = Number(cells[i].replace(/\s/g, '').replace(',', '.'));
      return Number.isFinite(v) ? v : undefined;
    };
    if (id === 'loaders') {
      const rate = num('rate');
      if (rate !== undefined) out.loaders.rate = rate;
      continue;
    }
    const v = out.vehicles.find((x) => x.id === id);
    if (!v) continue;
    const rate = num('rate');
    const kmRate = num('kmrate');
    if (rate !== undefined) v.rate = rate;
    if (kmRate !== undefined) v.kmRate = kmRate;
    const ai = col('available');
    if (ai >= 0 && cells[ai] !== undefined && cells[ai] !== '') {
      v.available = !/^(0|нет|no|false|занят[аоы]?)$/i.test(cells[ai]);
    }
  }
  return out;
}
