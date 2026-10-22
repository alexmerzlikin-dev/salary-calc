// ---------- данные ----------
// Нерабочие праздничные дни (ТК РФ, ст. 112) — одинаковые каждый год
const HOLIDAYS = {
  '01-01': 'Новогодние каникулы', '01-02': 'Новогодние каникулы', '01-03': 'Новогодние каникулы',
  '01-04': 'Новогодние каникулы', '01-05': 'Новогодние каникулы', '01-06': 'Новогодние каникулы',
  '01-07': 'Рождество Христово', '01-08': 'Новогодние каникулы',
  '02-23': 'День защитника Отечества', '03-08': 'Международный женский день',
  '05-01': 'Праздник Весны и Труда', '05-09': 'День Победы',
  '06-12': 'День России', '11-04': 'День народного единства',
};

const DEFAULTS = {
  // доплаты — в % от (ставка + премия): так их считают кадры, и они сами пересчитываются при смене ставок
  rate: 156.2, premium: 35, nightPct: 20, holidayPct: 100, coef: 1.7, ndfl: 13,
  shiftHours: 8, nightPerShift: 2, workDays: [1, 2, 3, 4, 5], workHolidays: true,
};
const MANUAL_DEFAULTS = { h: 165, n: 23, p: 6, d: 2, h15: 88, n15: 11, p15: 0 };

const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* приватный режим */ } },
};

let settings = { ...DEFAULTS, ...store.get('salary.settings', {}) };
// переход со старой версии: доплаты были фиксированными суммами, ставки — 147,7 и 20
if ('nightExtra' in settings) {
  if (settings.rate === 147.7 && settings.premium === 20) { settings.rate = DEFAULTS.rate; settings.premium = DEFAULTS.premium; }
  delete settings.nightExtra; delete settings.holidayExtra;
}
const nightRate = (s) => (s.rate + s.premium) * s.nightPct / 100;
const holidayRate = (s) => (s.rate + s.premium) * s.holidayPct / 100;
let overrides = store.get('salary.overrides', {});          // 'YYYY-MM-DD' -> { s, h, n }
let manual = { ...MANUAL_DEFAULTS, ...store.get('salary.manual', {}) };
let mode = store.get('salary.mode', 'calendar');
const now = new Date();
let year = now.getFullYear(), month = now.getMonth();

const save = () => {
  store.set('salary.settings', settings);
  store.set('salary.overrides', overrides);
  store.set('salary.manual', manual);
  store.set('salary.mode', mode);
};

// ---------- утилиты ----------
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const pad = (n) => String(n).padStart(2, '0');
const num = (v) => { const x = parseFloat(String(v).replace(',', '.')); return Number.isFinite(x) && x >= 0 ? x : 0; };
const r2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;
const rub = (x) => new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(r2(x));
const n = (x) => String(r2(x)).replace('.', ',');
const hrs = (x) => `${n(x)} ч`;

// ---------- график ----------
function dayInfo(y, m, d) {
  const key = `${y}-${pad(m + 1)}-${pad(d)}`;
  const holidayName = HOLIDAYS[`${pad(m + 1)}-${pad(d)}`] || null;
  const wd = ((new Date(y, m, d).getDay() + 6) % 7) + 1;   // 1 = Пн … 7 = Вс
  const tpl = {
    s: settings.workDays.includes(wd) && (!holidayName || settings.workHolidays) ? 'work' : 'off',
    h: settings.shiftHours,
    n: settings.nightPerShift,
  };
  const o = overrides[key];
  return { key, d, wd, holidayName, tpl, custom: !!o, ...(o || tpl) };
}

function monthDays(y, m) {
  const count = new Date(y, m + 1, 0).getDate();
  return Array.from({ length: count }, (_, i) => dayInfo(y, m, i + 1));
}

// часы за месяц и за 1–15 число
function hoursFromCalendar() {
  const all = { h: 0, n: 0, p: 0, d: 0, shifts: 0 };
  const half = { h: 0, n: 0, p: 0, d: 0 };
  for (const day of monthDays(year, month)) {
    if (day.s === 'off' || !(day.h > 0)) continue;
    const nightH = Math.min(day.n, day.h);
    for (const t of day.d <= 15 ? [all, half] : [all]) {
      t.h += day.h;
      t.n += nightH;
      if (day.holidayName) t.p += day.h;
      else if (day.s === 'extra') t.d += day.h;
    }
    all.shifts++;
  }
  return { all, half };
}

function hoursFromManual() {
  return {
    all: { h: num(manual.h), n: num(manual.n), p: num(manual.p), d: num(manual.d) },
    half: { h: num(manual.h15), n: num(manual.n15), p: num(manual.p15), d: 0 },
  };
}

// ---------- расчёт ----------
function calc(t, withPremium) {
  const s = settings;
  const base = t.h * s.rate;
  const premium = withPremium ? t.h * s.premium : 0;
  const night = t.n * nightRate(s);
  const holiday = (t.p + t.d) * holidayRate(s);
  const sum = base + premium + night + holiday;
  const gross = sum * s.coef;
  const tax = gross * s.ndfl / 100;
  return { base, premium, night, holiday, sum, gross, tax, net: gross - tax };
}

// ---------- отрисовка ----------
function render() {
  $('#monthLabel').textContent = new Date(year, month, 1).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
  $$('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
  $('#mode-calendar').hidden = mode !== 'calendar';
  $('#mode-manual').hidden = mode !== 'manual';
  $('#prevMonth').disabled = $('#nextMonth').disabled = mode === 'manual';

  if (mode === 'calendar') renderCalendar();
  const { all, half } = mode === 'calendar' ? hoursFromCalendar() : hoursFromManual();
  renderResult(all, half);
}

function renderCalendar() {
  $('#tShift').value = settings.shiftHours;
  $('#tNight').value = settings.nightPerShift;
  $('#tHolidays').checked = settings.workHolidays;
  $$('#tWeekdays button').forEach((b) => b.classList.toggle('on', settings.workDays.includes(Number(b.dataset.wd))));

  const days = monthDays(year, month);
  const todayKey = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const blanks = '<div class="blank"></div>'.repeat(days[0].wd - 1);
  $('#cal').innerHTML = blanks + days.map((day) => {
    const worked = day.s !== 'off' && day.h > 0;
    const cls = ['day', worked ? day.s : 'off', day.holidayName && 'hol', day.custom && 'custom', day.key === todayKey && 'today']
      .filter(Boolean).join(' ');
    const label = worked ? `${n(day.h)} ч${day.n > 0 ? ` · ${n(Math.min(day.n, day.h))} ноч` : ''}` : (day.holidayName ? 'праздник' : '');
    return `<button type="button" class="${cls}" data-key="${day.key}" title="${day.holidayName || ''}">
      <span class="num">${day.d}</span><span class="hrs">${label}</span></button>`;
  }).join('');

  const { all } = hoursFromCalendar();
  $('#calSummary').textContent = `Смен: ${all.shifts} · часов: ${n(all.h)} · ночных: ${n(all.n)} · праздничных: ${n(all.p)} · в выходной: ${n(all.d)}`;
  const monthPrefix = `${year}-${pad(month + 1)}-`;
  $('#resetMonth').hidden = !Object.keys(overrides).some((k) => k.startsWith(monthPrefix));
}

function renderResult(all, half) {
  const s = settings;
  const full = calc(all, true);
  const adv = calc(half, false);
  const rest = full.net - adv.net;

  $('#rNet').textContent = rub(full.net);
  $('#rGross').textContent = `начислено ${rub(full.gross)}, НДФЛ ${rub(full.tax)}`;
  $('#rAdv').textContent = rub(adv.net);
  $('#rAdvSub').textContent = `за 1–15 число, ${hrs(half.h)}, без премии`;
  $('#rRest').textContent = rub(rest);
  $('#rRest').style.color = rest < 0 ? 'var(--hol)' : '';

  const row = (title, calcText, value, cls = '') =>
    `<tr class="${cls}"><td>${title}${calcText ? `<span class="calc">${calcText}</span>` : ''}</td><td>${value}</td></tr>`;
  $('#breakdown').innerHTML = [
    row('Оплата по ставке', `${hrs(all.h)} × ${n(s.rate)} ₽`, rub(full.base)),
    row('Премия', `${hrs(all.h)} × ${n(s.premium)} ₽`, rub(full.premium)),
    row('Доплата за ночные', `${hrs(all.n)} × ${n(nightRate(s))} ₽ (${n(s.nightPct)} % от ${n(s.rate + s.premium)})`, rub(full.night)),
    row('Доплата за праздничные и выходные', `(${n(all.p)} + ${n(all.d)}) ч × ${n(holidayRate(s))} ₽`, rub(full.holiday)),
    row('Итого до коэффициента', '', rub(full.sum)),
    row(`С коэффициентом × ${n(s.coef)}`, '', rub(full.gross), 'total'),
    row(`НДФЛ ${n(s.ndfl)} %`, '', '−' + rub(full.tax), 'minus'),
    row('На руки', '', rub(full.net), 'total'),
  ].join('');

  $('#formula').textContent =
    `(${n(all.h)} × (${n(s.rate)} + ${n(s.premium)}) + ${n(all.n)} × ${n(nightRate(s))} + (${n(all.p)} + ${n(all.d)}) × ${n(holidayRate(s))}) × ${n(s.coef)} = ${n(full.gross)}`;
  $('#formulaAdv').textContent =
    `Аванс: (${n(half.h)} × ${n(s.rate)} + ${n(half.n)} × ${n(nightRate(s))} + ${n(half.p + half.d)} × ${n(holidayRate(s))}) × ${n(s.coef)} = ${n(adv.gross)} → на руки ${n(adv.net)}`;
}

// ---------- события ----------
$$('.tabs button').forEach((b) => b.addEventListener('click', () => { mode = b.dataset.mode; save(); render(); }));
$('#prevMonth').addEventListener('click', () => { month--; if (month < 0) { month = 11; year--; } render(); });
$('#nextMonth').addEventListener('click', () => { month++; if (month > 11) { month = 0; year++; } render(); });

// шаблон графика
$('#tWeekdays').innerHTML = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
  .map((t, i) => `<button type="button" data-wd="${i + 1}" title="Рабочий день">${t}</button>`).join('');
$$('#tWeekdays button').forEach((b) => b.addEventListener('click', () => {
  const wd = Number(b.dataset.wd);
  settings.workDays = settings.workDays.includes(wd) ? settings.workDays.filter((x) => x !== wd) : [...settings.workDays, wd];
  save(); render();
}));
$('#tShift').addEventListener('input', (e) => { settings.shiftHours = num(e.target.value); save(); render(); });
$('#tNight').addEventListener('input', (e) => { settings.nightPerShift = num(e.target.value); save(); render(); });
$('#tHolidays').addEventListener('change', (e) => { settings.workHolidays = e.target.checked; save(); render(); });
$('#resetMonth').addEventListener('click', () => {
  if (!confirm('Сбросить все ручные правки дней в этом месяце?')) return;
  const prefix = `${year}-${pad(month + 1)}-`;
  for (const k of Object.keys(overrides)) if (k.startsWith(prefix)) delete overrides[k];
  save(); render();
});

// редактирование дня
const dayForm = $('#dayForm');
let editing = null;
$('#cal').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-key]');
  if (!btn) return;
  const [y, m, d] = btn.dataset.key.split('-').map(Number);
  editing = dayInfo(y, m - 1, d);
  $('#dayTitle').textContent = new Date(y, m - 1, d).toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
  $('#dayHoliday').textContent = editing.holidayName ? `🎉 ${editing.holidayName} — двойная оплата` : '';
  dayForm.s.value = editing.s;
  dayForm.h.value = editing.h;
  dayForm.n.value = editing.n;
  syncDayForm();
  $('#dayReset').hidden = !editing.custom;
  $('#dayDialog').showModal();
});
$$('input[name=s]', dayForm).forEach((r) => r.addEventListener('change', () => {
  if (dayForm.s.value !== 'off' && !(num(dayForm.h.value) > 0)) dayForm.h.value = settings.shiftHours;
  syncDayForm();
}));
function syncDayForm() {
  const off = dayForm.s.value === 'off';
  dayForm.h.disabled = dayForm.n.disabled = off;
}
dayForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const v = { s: dayForm.s.value, h: num(dayForm.h.value), n: num(dayForm.n.value) };
  const t = editing.tpl;
  const same = v.s === t.s && (v.s === 'off' || (v.h === t.h && v.n === t.n));
  if (same) delete overrides[editing.key]; else overrides[editing.key] = v;
  save(); $('#dayDialog').close(); render();
});
$('#dayReset').addEventListener('click', () => { delete overrides[editing.key]; save(); $('#dayDialog').close(); render(); });
$$('[data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));

// ручной ввод
$$('[data-m]').forEach((inp) => {
  inp.value = manual[inp.dataset.m];
  inp.addEventListener('input', () => { manual[inp.dataset.m] = inp.value; save(); render(); });
});

// ставки
function fillSettings() { $$('[data-s]').forEach((inp) => { inp.value = settings[inp.dataset.s]; }); fillHints(); }
function fillHints() {
  $('#nightHint').textContent = `= ${n(nightRate(settings))} ₽ за час`;
  $('#holidayHint').textContent = `= ${n(holidayRate(settings))} ₽ за час`;
}
$$('[data-s]').forEach((inp) => inp.addEventListener('input', () => { settings[inp.dataset.s] = num(inp.value); fillHints(); save(); render(); }));
$('#resetSettings').addEventListener('click', () => {
  for (const k of ['rate', 'premium', 'nightPct', 'holidayPct', 'coef', 'ndfl']) settings[k] = DEFAULTS[k];
  fillSettings(); save(); render();
});

fillSettings();
render();
