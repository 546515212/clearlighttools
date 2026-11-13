// Calculators and converters. Pure arithmetic — no network, no storage.
import {
  fmt,
  el, D, t, pad2, download, note, stat, toast, select, numberInput, textInput,
  checkInput, button, field, copyText, locale, add, fill
} from '../lib.js';

const L = (k, fb) => t(k, fb);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// ten significant digits, without the 0.30000000000000004 noise, in the page's language: a Spanish
// visitor has to read 0,25 — the separator is half of what switching the site language means
function show(n) {
  if (!Number.isFinite(n)) return '—';
  if (n !== 0 && (Math.abs(n) >= 1e12 || Math.abs(n) < 1e-6)) return n.toExponential(4);
  return Number(n.toPrecision(10)).toLocaleString(locale(), { maximumSignificantDigits: 10 });
}
const money = n => Number.isFinite(n) ? n.toLocaleString(locale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';
const int = n => Number.isFinite(n) ? Math.round(n).toLocaleString(locale()) : '—';
// percentages read to two decimals: "83.33333333%" is arithmetic, not an answer
const pc = n => show(Math.round(n * 100) / 100);
// …and so do ratios: a loan that costs 9 % more than it borrows is "1.09× the amount", not
// "1.093559324× the amount" — ten significant digits is right for a converted length, wrong for a
// summary a visitor reads once.
const ratio = n => show(Math.round(n * 100) / 100);

// re-run fn whenever any of these fields is edited
function bind(fn, ...inputs) {
  inputs.filter(Boolean).forEach(i => i.addEventListener('input', fn));
  return fn;
}

// Month and weekday names come from ICU through Intl, the same source the "Next birthday" line
// below already uses — a hand-written list would need 13 locales of it and would drift from the
// browser's own capitalisation and genitive forms.
const MONTHS = Array.from({ length: 12 }, (_, i) =>
  new Intl.DateTimeFormat(locale(), { month: 'long' }).format(new Date(2021, i, 15)));
const DAYS = Array.from({ length: 7 }, (_, i) =>
  new Intl.DateTimeFormat(locale(), { weekday: 'long' }).format(new Date(2021, 7, 15 + i)));

// The unit <select> keeps English values because the arithmetic below compares against them, but a
// sentence must not print that value raw: "{0} {1} later" with the value shipped "30 days 後" on the
// Japanese page — an English word sitting inside a Japanese sentence. Same word, translated form.
const UNIT_LABEL = { days: 'daysUnit', weeks: 'weeksUnit', months: 'monthsUnit', years: 'yearsUnit' };

// toLocale* takes locale(), never `undefined`: `undefined` means "whatever language the visitor's
// browser speaks", so on a Chinese Windows the English page printed "2026年12月7日星期一" — the
// dictionary was translated and the result was not. The browser sweep reads rendered text, which is
// how this got caught when no static check could have.

// YYYY-MM-DD as a local calendar day, never a UTC instant
function parseDate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return dt;
}
const iso = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const daysInMonth = (y, mo) => new Date(y, mo + 1, 0).getDate();

function copyChip(text) {
  const b = el('button', { class: 'btn ghost', text: L('copy2', 'copy') });
  b.addEventListener('click', e => { e.stopPropagation(); copyText(typeof text === 'function' ? text() : text); });
  return b;
}

function numBox(value, { min, max, step = 'any' } = {}) {
  return numberInput(value, null, { min, max, step });
}

export const tools = {

  // ------------------------------------------------------------ percentage-calculator
  'percentage-calculator': async (root) => {
    const a = numBox(25), b = numBox(200), c = numBox(150), d = numBox(180), f = numBox(40), g = numBox(60), af = numBox(120), by = numBox(20);
    const box = el('div', { class: 'out' });
    const render = () => {
      const n = x => Number(x.value);
      const pctOf = Number.isFinite(n(a)) && Number.isFinite(n(b)) ? show(n(a) / 100 * n(b)) : '—';
      const share = n(d) ? pc(n(c) / n(d) * 100) + '%' : '—';
      const ch = n(f) ? (n(g) - n(f)) / n(f) * 100 : null;
      const before = by === -100 ? null : n(af) / (1 + n(by) / 100);
      box.replaceChildren(
        el('div', { class: 'panel' }, el('h3', { text: L('pctWhatIs', 'What is X% of Y?') }),
          el('div', { class: 'controls' }, field(L('percent', 'Percent'), a, ''), field(L('of', 'of'), b, '')),
          stat(L('resultSize', 'Result'), pctOf, `${show(n(a))}% × ${show(n(b))}`)),
        el('div', { class: 'panel' }, el('h3', { text: L('pctIsWhat', 'X is what percent of Y?') }),
          el('div', { class: 'controls' }, field(L('value', 'Value'), c, ''), field(L('of', 'of'), d, '')),
          stat(L('resultSize', 'Result'), share, d.value ? `÷ ${show(n(d))}` : '')),
        el('div', { class: 'panel' }, el('h3', { text: L('pctChange', 'Increase or decrease') }),
          el('div', { class: 'controls' }, field(L('from', 'From'), f, ''), field(L('to', 'To'), g, '')),
          stat(L('change', 'Change'), ch === null ? '—' : `${ch >= 0 ? '+' : '−'}${pc(Math.abs(ch))}%`, ch === null ? '' : fmt(L('ui0Absolute', '{0} absolute'), show(n(g) - n(f))))),
        el('div', { class: 'panel' }, el('h3', { text: L('pctReverse', 'Reverse percentage') }),
          el('div', { class: 'controls' }, field(L('afterChange', 'After the change'), af, ''), field(L('byPercent', 'by (%)'), by, L('useANegativeNumberFor', 'use a negative number for a drop'))),
          stat(L('before', 'Before'), before === null ? '—' : show(before), before === null ? '' : fmt(L('ui0BringsItBackTo', '±{0}% brings it back to {1}'), show(by.value), show(n(af))))));
    };
    root.append(el('p', { class: 'lede', text: L('fourEverydayPercentageQuestionsType', 'Four everyday percentage questions. Type in any box and every result updates.') }), box);
    bind(render, a, b, c, d, f, g, af, by);
    render();
  },

  // ------------------------------------------------------------ bmi-calculator
  'bmi-calculator': async (root) => {
    let unit = 'metric';
    const cm = numBox(170), kg = numBox(68), ft = numBox(5), inch = numBox(7), lb = numBox(150);
    const res = el('div', { class: 'out' });
    const metricRow = el('div', { class: 'controls' }, field(L('cm', 'Height (cm)'), cm, ''), field(L('kg', 'Weight (kg)'), kg, ''));
    const imperialRow = el('div', { class: 'controls', style: 'display:none' },
      field(L('heightFt', 'Height (ft)'), ft, ''), field(L('inchesPlus', '+ inches'), inch, ''), field(L('weightLb', 'Weight (lb)'), lb, ''));
    const render = () => {
      res.replaceChildren();
      let metres, kilos;
      if (unit === 'metric') {
        metres = Number(cm.value) / 100;
        kilos = Number(kg.value);
      } else {
        metres = (Number(ft.value) * 12 + Number(inch.value)) * 0.0254;
        kilos = Number(lb.value) * 0.45359237;
      }
      if (!(metres > 0.5 && metres < 2.6) || !(kilos > 2 && kilos < 500)) {
        return res.append(note(L('enterARealisticHeightAnd', 'Enter a realistic height and weight.'), 'err'));
      }
      const bmi = kilos / (metres * metres);
      const cat = bmi < 18.5 ? [L('bmiUnderweight', 'Underweight'), 'warn'] : bmi < 25 ? [L('bmiHealthy', 'Healthy range'), 'ok'] : bmi < 30 ? [L('bmiOverweight', 'Overweight'), 'warn'] : [L('bmiObese', 'Obesity class I–III'), 'err'];
      const lo = 18.5 * metres * metres, hi = 24.9 * metres * metres;
      const conv = unit === 'metric' ? (v, u) => show(v) + ' ' + u : (v) => show(v / 0.45359237) + ' lb';
      // BMI is quoted to one decimal everywhere (and the bands below are defined that way); show()'s
      // ten significant digits made the headline number "23.52941176"
      const one = n => show(Math.round(n * 10) / 10);
      const kg1 = n => conv(Math.round(n * 10) / 10, 'kg');
      res.append(
        stat(L('yourBmi', 'Your BMI'), one(bmi), cat[0]),
        el('div', { class: 'bar' }, el('i', { style: `width:${clamp((bmi - 12) / (40 - 12) * 100, 0, 100)}%` })),
        el('div', { class: 'badges' }, ...[
          fmt(L('bmiBandUnder', 'Under < {0}'), show(18.5)),
          fmt(L('bmiBandHealthy', 'Healthy {0} – {1}'), show(18.5), show(24.9)),
          fmt(L('bmiBandOver', 'Over {0} – {1}'), show(25), show(29.9)),
          fmt(L('bmiBandObese', 'Obese ≥ {0}'), show(30))].map(band => el('span', { class: 'badge', text: band }))),
        el('div', { class: 'out' },
          stat(L('healthyWeight', 'Healthy weight here'), `${kg1(lo)} – ${kg1(hi)}`,
            bmi < 18.5 ? fmt(L('about0MoreToReach', 'about {0} more to reach 18.5'), kg1(18.5 * metres * metres - kilos))
              : bmi >= 25 ? fmt(L('about0LessToReach', 'about {0} less to reach 24.9'), kg1(kilos - 24.9 * metres * metres))
              : L('youAreInsideTheRange', 'you are inside the range'))),
        note(L('bmiIsAPopulationScreen', 'BMI is a population screen, not a diagnosis. It ignores muscle mass, bone density, age, sex and where fat sits, so athletes and older adults often land in the wrong band.')));
    };
    const unitsSel = select([['metric', L('metricUnits', 'Metric (cm, kg)')], ['imperial', L('imperialUnits', 'Imperial (ft/in, lb)')]], unit, v => {
      unit = v;
      metricRow.style.display = v === 'metric' ? 'flex' : 'none';
      imperialRow.style.display = v === 'imperial' ? 'flex' : 'none';
      render();
    });
    root.append(el('div', { class: 'controls' }, field(L('units', 'Units'), unitsSel, '')), metricRow, imperialRow, res);
    bind(render, cm, kg, ft, inch, lb);
    render();
  },

  // ------------------------------------------------------------ age-calculator
  'age-calculator': async (root) => {
    const birth = el('input', { type: 'date', value: '1995-06-15' });
    const asof = el('input', { type: 'date', value: iso(new Date()) });
    const res = el('div', { class: 'out' });
    const render = () => {
      res.replaceChildren();
      const b = parseDate(birth.value), a = parseDate(asof.value);
      if (!b || !a) return res.append(note(L('pickBothDatesTheDay', 'Pick both dates — the day has to exist in that month.'), 'err'));
      if (b > a) return res.append(note(L('theBirthDateIsAfter', 'The birth date is after the reference date.'), 'err'));
      let years = a.getFullYear() - b.getFullYear();
      let months = a.getMonth() - b.getMonth();
      let days = a.getDate() - b.getDate();
      if (days < 0) { months--; days += new Date(a.getFullYear(), a.getMonth(), 0).getDate(); }
      if (months < 0) { years--; months += 12; }
      const totalDays = Math.round((a - b) / 86400000);
      const next = new Date(a.getFullYear(), b.getMonth(), b.getDate());
      if (next < a) next.setFullYear(a.getFullYear() + 1);
      const until = Math.round((next - a) / 86400000);
      res.append(
        stat(L('age', 'Age'), fmt(L('ui0Years1Months2Days', '{0} years, {1} months, {2} days'), years, months, days),
          fmt(L('born0123', 'born {0}, {1} {2}, {3}'), DAYS[b.getDay()], MONTHS[b.getMonth()], b.getDate(), b.getFullYear())),
        el('div', { class: 'out' },
          stat(L('totalDays', 'Total days'), totalDays.toLocaleString(locale()), fmt(L('ui0Weeks', '{0} weeks'), Math.floor(totalDays / 7).toLocaleString(locale()))),
          stat(L('totalHours', 'Total hours'), (totalDays * 24).toLocaleString(locale()), fmt(L('ui0Minutes', '{0} minutes'), (totalDays * 24 * 60).toLocaleString(locale()))),
          stat(L('nextBirthday', 'Next birthday'), until === 0 ? L('today', 'today') : fmt(L('in0Days', 'in {0} days'), until), next.toLocaleDateString(locale(), { weekday: L('long', 'long'), month: L('long', 'long'), day: L('numeric', 'numeric') })),
          stat(L('birthdaysSoFar', 'Birthdays so far'), String(years), fmt(L('ui0LeapDaysLived', '{0} leap days lived'), Math.floor(totalDays / 365.2425)))),
        note(L('monthLengthsAreBorrowedFrom', 'Month lengths are borrowed from the real calendar, so end-of-month birthdays stay correct through February.')));
    };
    root.append(el('div', { class: 'controls' }, field(L('birthDate', 'Date of birth'), birth, ''), field(L('ageAsOf', 'Age as of'), asof, L('defaultsToToday', 'defaults to today'))), res);
    bind(render, birth, asof);
    render();
  },

  // ------------------------------------------------------------ date-calculator
  'date-calculator': async (root) => {
    const start = el('input', { type: 'date', value: iso(new Date()) });
    const amount = numBox(30, { min: -36500, max: 36500 });
    const end = el('input', { type: 'date', value: iso(new Date()) });
    let unit = 'days', dir = 'add', skip = false;
    const addRes = el('div', { class: 'out' });
    const gapRes = el('div', { class: 'out' });
    const renderAdd = () => {
      addRes.replaceChildren();
      const s = parseDate(start.value), n = Number(amount.value);
      if (!s) return addRes.append(note(L('pickAStartDate', 'Pick a start date.'), 'err'));
      if (!Number.isFinite(n)) return addRes.append(note(L('enterAnAmount', 'Enter an amount.'), 'err'));
      const k = dir === 'sub' ? -Math.abs(n) : Math.abs(n);
      const d = new Date(s);
      if (unit === 'days') d.setDate(d.getDate() + k);
      else if (unit === 'weeks') d.setDate(d.getDate() + k * 7);
      else if (unit === 'months') {
        const day = d.getDate();
        d.setDate(1);
        d.setMonth(d.getMonth() + k);
        d.setDate(Math.min(day, daysInMonth(d.getFullYear(), d.getMonth())));
      } else if (unit === 'years') {
        const day = d.getDate();
        d.setDate(1);
        d.setFullYear(d.getFullYear() + k);
        d.setDate(Math.min(day, daysInMonth(d.getFullYear(), d.getMonth())));
      }
      if (skip && unit === 'days') {
        const step = k >= 0 ? 1 : -1;
        let moved = 0;
        while (moved < Math.abs(k)) {
          d.setDate(d.getDate() + step);
          if (d.getDay() !== 0 && d.getDay() !== 6) moved++;
        }
      }
      const diff = Math.round((d - s) / 86400000);
      addRes.append(
        stat(dir === 'add' ? fmt(L('ui01Later', '{0} {1} later'), Math.abs(k), L(UNIT_LABEL[unit], unit)) : fmt(L('ui01Earlier', '{0} {1} earlier'), Math.abs(k), L(UNIT_LABEL[unit], unit)),
          d.toLocaleDateString(locale(), { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }), iso(d)),
        el('div', { class: 'out' },
          stat(L('calendarDays', 'Calendar days'), String(diff), skip ? L('weekendsSkippedWhileCounting', 'weekends skipped while counting') : L('plainDays', 'plain days')),
          stat(L('weeksAndDaysShort', 'Weeks + days'), fmt(L('ui0W1D', '{0} w {1} d'), Math.trunc(diff / 7), Math.abs(diff % 7)), fmt(L('ui0Hours', '{0} hours'), (diff * 24).toLocaleString(locale()))),
          stat(L('thatMonth', 'That month'), fmt(L('ui0Has1Days', '{0} has {1} days'), MONTHS[d.getMonth()], daysInMonth(d.getFullYear(), d.getMonth())), '')));
    };
    const renderGap = () => {
      gapRes.replaceChildren();
      let s = parseDate(start.value), e = parseDate(end.value);
      if (!s || !e) return gapRes.append(note(L('pickBothDates', 'Pick both dates.'), 'err'));
      const flipped = e < s;
      if (flipped) [s, e] = [e, s];
      const abs = Math.round((e - s) / 86400000);
      let workdays = 0;
      const cursor = new Date(s);
      for (let i = 0; i < abs; i++) {
        cursor.setDate(cursor.getDate() + 1);
        if (cursor.getDay() !== 0 && cursor.getDay() !== 6) workdays++;
      }
      let y = e.getFullYear() - s.getFullYear();
      let mo = e.getMonth() - s.getMonth();
      let dd = e.getDate() - s.getDate();
      if (dd < 0) { mo--; dd += new Date(e.getFullYear(), e.getMonth(), 0).getDate(); }
      if (mo < 0) { y--; mo += 12; }
      gapRes.append(
        stat(L('betweenDates', 'Between the two dates'), fmt(L('ui0Days', '{0} days'), abs.toLocaleString(locale())), flipped ? L('theSecondDateIsEarlier', 'the second date is earlier') : L('inclusiveOfLeapDays', 'inclusive of leap days')),
        el('div', { class: 'out' },
          stat(L('brokenDown', 'Broken down'), fmt(L('ui0Years1Months2Days', '{0} years, {1} months, {2} days'), y, mo, dd), ''),
          stat(L('weeksAndDays', 'Weeks and days'), fmt(L('ui0W1D', '{0} w {1} d'), Math.floor(abs / 7), abs % 7), ''),
          stat(L('workingDays', 'Working days'), workdays.toLocaleString(locale()), L('monFriPublicHolidaysNot', 'Mon–Fri, public holidays not counted')),
          stat(L('weekendDays', 'Weekend days'), (abs - workdays).toLocaleString(locale()), ''),
          stat(L('hours', 'Hours'), (abs * 24).toLocaleString(locale()), fmt(L('ui0Minutes', '{0} minutes'), (abs * 24 * 60).toLocaleString(locale())))));
    };
    const render = () => { renderAdd(); renderGap(); };
    root.append(
      el('h3', { text: L('addTimeTitle', 'Add or subtract time') }),
      el('div', { class: 'controls' },
        field(L('startDate', 'Start date'), start, ''), field(L('amount', 'Amount'), amount, ''),
        field(L('unit', 'Unit'), select([['days', L('daysUnit', 'Days')], ['weeks', L('weeksUnit', 'Weeks')], ['months', L('monthsUnit', 'Months')], ['years', L('yearsUnit', 'Years')]], unit, v => { unit = v; render(); }), ''),
        field(L('direction', 'Direction'), select([['add', L('addDir', 'Add')], ['sub', L('subDir', 'Subtract')]], dir, v => { dir = v; render(); }), ''),
        el('span', {}, checkInput(L('skipWeekends', 'Skip weekends'), false, v => { skip = v; render(); }))), addRes,
      el('h3', { text: L('betweenDatesTitle', 'Days between two dates') }),
      el('div', { class: 'controls' }, field(L('secondDate', 'Second date'), end, L('comparedWithTheStartDate', 'compared with the start date above'))), gapRes);
    bind(render, start, amount, end);
    render();
  },

  // ------------------------------------------------------------ loan-calculator
  'loan-calculator': async (root) => {
    const p = numBox(20000), r = numBox(5.9), y = numBox(3, { min: 0.1, step: 'any' });
    const extra = numBox(0);
    const res = el('div', { class: 'out' });
    const render = () => {
      res.replaceChildren();
      const P = Number(p.value), R = Number(r.value), Y = Number(y.value), EX = Math.max(0, Number(extra.value) || 0);
      if (!(P > 0) || !(Y > 0) || !Number.isFinite(R) || R < 0) return res.append(note(L('enterAPositiveAmountA', 'Enter a positive amount, a term longer than zero and a rate of 0 or more.'), 'err'));
      const i = R / 100 / 12;
      const base = i === 0 ? P / Math.round(Y * 12) : P * i * (1 + i) ** Math.round(Y * 12) / ((1 + i) ** Math.round(Y * 12) - 1);
      const pay = base + EX;
      let bal = P, months = 0, yrInt = 0, yrPaid = 0, totalInt = 0, totalPaid = 0;
      const tb = el('tbody');
      while (bal > 0.005 && months < 1200) {
        const ip = bal * i;
        const pri = Math.min(pay - ip, bal);
        if (pri <= 0) {
          res.append(note(L('thatPaymentDoesNotEven', 'That payment does not even cover the monthly interest, so the balance never reaches zero. Increase the payment or shorten the term.'), 'err'));
          return;
        }
        bal -= pri;
        // two sets of running totals, because the table needs the year's figures and the summary
        // needs the whole loan's: they used to share one pair, the table reset it every December,
        // and the summary then reported "-20,000.00 total interest, 0.000× the amount" on a loan
        // that plainly costs 1,871 in interest over three years.
        yrInt += ip; yrPaid += pri + ip; totalInt += ip; totalPaid += pri + ip;
        months++;
        if (months % 12 === 0 || bal <= 0.005) {
          tb.append(el('tr', {}, ...[Math.ceil(months / 12), yrPaid, yrInt, yrPaid - yrInt, Math.max(0, bal)]
            .map((v, k) => el('td', { text: k === 0 ? String(v) : v.toLocaleString(locale(), { maximumFractionDigits: 0 }), style: 'text-align:right;padding:5px 8px;border-bottom:1px solid var(--line)' }))));
          yrInt = 0; yrPaid = 0;
        }
      }
      const n = Math.round(Y * 12);
      const plainTotal = base * n;
      // ---- equal principal (等额本金): the principal is repaid in n fixed slices, so interest is
      // charged on a balance that falls in a straight line. The payment starts high and decreases;
      // total interest is always lower than equal instalment for the same amount, rate and term.
      const epSlice = P / n;
      let epBal = P, epInt = 0, epFirst = 0, epLast = 0;
      const epPay = [];
      for (let k = 0; k < n; k++) {
        const interest = epBal * i;
        const pmt = epSlice + interest;
        if (k === 0) epFirst = pmt;
        epLast = pmt;
        epInt += interest;
        epPay.push(pmt);
        epBal -= epSlice;
      }
      const eiInt = Math.max(0, plainTotal - P);
      const epSaved = Math.max(0, eiInt - epInt);
      // A canvas chart of the STANDARD monthly payment under each method (no extra payment, so the
      // two are compared on equal terms). Only moveTo/lineTo/stroke/fillRect/fillText are used, all of
      // which the smoke harness stubs; the legend lives in the DOM so it is translated like any label.
      const chart = el('canvas', { width: 620, height: 220, style: 'width:100%;max-width:620px;height:auto;border:1px solid var(--line);border-radius:8px' });
      const cx = chart.getContext('2d');
      const padL = 64, padR = 16, padT = 14, padB = 26;
      const plotW = chart.width - padL - padR, plotH = chart.height - padT - padB;
      const yMax = Math.max(base, epFirst, 1) * 1.08;
      const xAt = k => padL + (n <= 1 ? plotW / 2 : (k / (n - 1)) * plotW);
      const yAt = v => padT + plotH - (v / yMax) * plotH;
      cx.clearRect(0, 0, chart.width, chart.height);
      cx.lineWidth = 1; cx.strokeStyle = 'rgba(128,128,128,.4)';
      cx.beginPath(); cx.moveTo(padL, padT); cx.lineTo(padL, padT + plotH); cx.lineTo(padL + plotW, padT + plotH); cx.stroke();
      const plot = (vals, color) => {
        cx.strokeStyle = color; cx.lineWidth = 2; cx.beginPath();
        vals.forEach((v, k) => { const x = xAt(k), y = yAt(v); if (k === 0) cx.moveTo(x, y); else cx.lineTo(x, y); });
        cx.stroke();
      };
      plot(Array.from({ length: n }, () => base), '#2f6fed');
      plot(epPay, '#e0662a');
      cx.fillStyle = '#888'; cx.font = '11px sans-serif';
      cx.fillText(money(yMax), 4, padT + 4);
      cx.fillText(money(0), 4, padT + plotH);
      const legend = el('div', { style: 'display:flex;gap:18px;flex-wrap:wrap;font-size:13px;margin-top:6px' },
        el('span', { style: 'display:inline-flex;align-items:center;gap:6px' }, el('span', { style: 'width:12px;height:12px;background:#2f6fed;border-radius:2px;display:inline-block' }), L('loanEqualInstallment', 'Equal instalment')),
        el('span', { style: 'display:inline-flex;align-items:center;gap:6px' }, el('span', { style: 'width:12px;height:12px;background:#e0662a;border-radius:2px;display:inline-block' }), L('loanEqualPrincipal', 'Equal principal')));
      const table = el('table', { style: 'width:100%;border-collapse:collapse;font-size:13px' },
        el('thead', {}, el('tr', {}, ...[L('yearCol', 'Year'), L('paidInYear', 'Paid in year'), L('interestInYear', 'Interest in year'), L('principalInYear', 'Principal in year'), L('balanceLeft', 'Balance left')].map(h => el('th', { text: h, style: 'text-align:right;padding:6px 8px;border-bottom:1px solid var(--line)' }))))
        , tb);
      add(res,
        stat(L('monthly', 'Monthly payment'), money(pay), EX ? fmt(L('standard01Extra', 'standard {0} + {1} extra'), money(base), money(EX)) : fmt(L('ui0Payments', '{0} payments'), months)),
        el('div', { class: 'out' },
          stat(L('totalInterest', 'Total interest'), money(totalInt), fmt(L('ui0OfWhatYouBorrowed', '{0}% of what you borrowed'), pc(totalInt / P * 100))),
          stat(L('totalRepaid', 'Total repaid'), money(totalPaid), fmt(L('ui0TheAmount', '{0}× the amount'), ratio(totalPaid / P))),
          stat(L('term', 'Term'), fmt(L('ui0Y1M', '{0} y {1} m'), Math.floor(months / 12), months % 12), EX ? fmt(L('paidOff0MonthsEarlier', 'paid off {0} months earlier than the schedule'), n - months) : L('asAgreed', 'as agreed')),
          stat(L('interestShare', 'Interest share'), `${pc(totalInt / Math.max(1, totalPaid) * 100)}%`, L('ofEveryPaymentAtThe', 'of every payment at the start'))),
        el('h3', { text: L('schedule', 'Schedule') }), table,
        EX ? note(fmt(L('withNoExtraPaymentYou', 'With no extra payment you would pay {0} in total; the {1} a month saves {2}.'), money(plainTotal), money(EX), money(plainTotal - totalPaid))) : null,
        note(L('assumesAFixedRateWith', 'Assumes a fixed rate with monthly compounding and equal payments. Real contracts add fees, insurance or different compounding, and then the numbers move.')),
        el('h3', { text: L('loanCompareTitle', 'Equal instalment vs equal principal') }),
        el('div', { class: 'out' },
          stat(L('loanEqualInstallment', 'Equal instalment'), money(base), L('loanFixedEveryMonth', 'the same payment every month')),
          stat(L('loanEqualPrincipal', 'Equal principal'), money(epFirst), fmt(L('loanFallsTo', 'falls to {0} in the last month'), money(epLast)))),
        el('div', { class: 'out' },
          stat(L('loanInterestInstallment', 'Interest — equal instalment'), money(eiInt), L('loanStandardSchedule', 'standard schedule, no extra payment')),
          stat(L('loanInterestPrincipal', 'Interest — equal principal'), money(epInt), fmt(L('loanSavesYou', 'saves you {0}'), money(epSaved)))),
        chart, legend,
        note(L('loanMethodNote', 'Equal instalment spreads the cost evenly, so the payment never changes. Equal principal repays the borrowed amount faster at the start, so the payment is higher early and lower later, and less interest accrues overall. The chart compares the standard schedules; any extra payment above applies to the equal-instalment plan.')));
    };
    root.append(el('div', { class: 'controls' },
      field(L('amountBorrowed', 'Amount borrowed'), p, ''), field(L('ratePerYear', 'Rate (% per year)'), r, L('apr', 'APR')), field(L('termYears', 'Term (years)'), y, ''),
      field(L('extraEachMonth', 'Extra each month'), extra, L('ui0StandardSchedule', '0 = standard schedule'))), res);
    bind(render, p, r, y, extra);
    render();
  },

  // ------------------------------------------------------------ discount-calculator
  'discount-calculator': async (root) => {
    const price = numBox(120), d1 = numBox(25), d2 = numBox(0), tax = numBox(0);
    const res = el('div', { class: 'out' });
    const render = () => {
      const P = Number(price.value);
      const a = clamp(Number(d1.value) || 0, 0, 100);
      const e = clamp(Number(d2.value) || 0, 0, 100);
      const v = Math.max(0, Number(tax.value) || 0);
      if (!Number.isFinite(P) || P < 0) return res.replaceChildren(note(L('enterAPrice', 'Enter a price.'), 'err'));
      const afterFirst = P * (1 - a / 100);
      const final = afterFirst * (1 - e / 100);
      const withTax = final * (1 + v / 100);
      const single = (1 - (1 - a / 100) * (1 - e / 100)) * 100;
      fill(res,
        stat(L('payAfter', 'You pay'), money(withTax), v ? fmt(L('including0Tax', 'including {0}% tax'), show(v)) : L('beforeAnyTax', 'before any tax')),
        el('div', { class: 'out' },
          stat(L('youSave', 'You save'), money(P - final), a ? fmt(L('ui0OffTheStickerPrice', '{0}% off the sticker price'), show(single)) : L('noDiscountApplied', 'no discount applied')),
          stat(L('afterDiscount', 'After discount'), money(final), e ? fmt(L('ui0Then1', '{0} then −{1}%'), money(afterFirst), show(e)) : money(afterFirst)),
          stat(L('taxAmount', 'Tax amount'), money(withTax - final), L('calculatedOnTheDiscountedPrice', 'calculated on the discounted price'))),
        e > 0 ? note(fmt(L('stacked0And1Are', 'Stacked {0}% and {1}% are one discount of {2}%, not {3}%.'), show(a), show(e), show(single), show(a + e))) : null,
        note(L('taxIsAppliedAfterThe', 'Tax is applied after the discount, which is how most shops and marketplaces do it — check your local rules for digital goods.')));
    };
    root.append(el('div', { class: 'controls' },
      field(L('originalPrice', 'Original price'), price, ''), field(L('discountOne', 'Discount 1 (%)'), d1, ''), field(L('discountTwo', 'Discount 2 (%)'), d2, L('stackedCoupon0IfNone', 'stacked coupon, 0 if none')),
      field(L('taxRate', 'Tax / VAT (%)'), tax, L('ui0IfUnsure', '0 if unsure'))), res);
    bind(render, price, d1, d2, tax);
    render();
  },

  // ------------------------------------------------------------ unit-converter
  'unit-converter': async (root) => {
    const UNITS = {
      length: ['meter', { m: 1, km: 1000, cm: 0.01, mm: 0.001, 'µm': 1e-6, nm: 1e-9, mi: 1609.344, yd: 0.9144, ft: 0.3048, in: 0.0254, nmi: 1852 }],
      mass: ['kilogram', { kg: 1, g: 0.001, mg: 1e-6, t: 1000, lb: 0.45359237, oz: 0.0283495, st: 6.35029318, gr: 6.479891e-5, ct: 0.0002 }],
      volume: ['litre', { l: 1, ml: 0.001, cl: 0.01, 'm³': 1000, 'gal US': 3.785411784, 'gal UK': 4.54609, qt: 0.946352946, pt: 0.473176473, 'cup US': 0.2365882365, 'fl oz': 0.0295735295625, 'tbsp': 0.01478676478125, 'tsp': 0.00492892159375 }],
      area: ['square metre', { 'm²': 1, 'km²': 1e6, 'ha': 1e4, 'cm²': 1e-4, 'mm²': 1e-6, acre: 4046.8564224, 'ft²': 0.09290304, 'yd²': 0.83612736, 'in²': 0.00064516, 'mi²': 2589988.110336 }],
      speed: ['metre/second', { 'm/s': 1, 'km/h': 1 / 3.6, mph: 0.44704, knot: 1852 / 3600, 'ft/s': 0.3048 }],
      time: ['second', { s: 1, ms: 0.001, min: 60, h: 3600, day: 86400, week: 604800, month: 2629800, year: 31557600 }],
      data: ['byte', { B: 1, bit: 0.125, 'kB': 1e3, 'MB': 1e6, 'GB': 1e9, 'TB': 1e12, KiB: 1024, MiB: 1024 ** 2, GiB: 1024 ** 3, TiB: 1024 ** 4 }],
      energy: ['joule', { J: 1, kJ: 1000, MJ: 1e6, cal: 4.184, kcal: 4184, Wh: 3600, kWh: 3.6e6, BTU: 1055.05585, 'ft·lbf': 1.3558179483314004, eV: 1.602176634e-19 }],
      pressure: ['pascal', { Pa: 1, kPa: 1000, bar: 1e5, mbar: 100, atm: 101325, psi: 6894.757293168, mmHg: 133.322368421, inHg: 3386.389, 'kgf/cm²': 98066.5 }],
      angle: ['degree', { deg: 1, rad: 180 / Math.PI, grad: 0.9, turn: 360, arcmin: 1 / 60, arcsec: 1 / 3600 }],
      temperature: ['celsius', { '°C': c => c, '°F': c => c * 9 / 5 + 32, K: c => c + 273.15, '°R': c => (c + 273.15) * 9 / 5 }]
    };
    const CATS = Object.keys(UNITS);
    // the dropdown used to print the internal id with its first letter capitalised, which is how
    // "Length" and "Temperature" ended up on a Japanese page; the ids stay the values, these are labels
    const CAT_LABEL = {
      length: L('unitCatLength', 'Length'), mass: L('unitCatMass', 'Mass'), volume: L('unitCatVolume', 'Volume'),
      area: L('unitCatArea', 'Area'), speed: L('unitCatSpeed', 'Speed'), time: L('unitCatTime', 'Time'),
      data: L('unitCatData', 'Data'), energy: L('unitCatEnergy', 'Energy'), pressure: L('unitCatPressure', 'Pressure'),
      angle: L('unitCatAngle', 'Angle'), temperature: L('unitCatTemperature', 'Temperature')
    };
    // the same for the base unit the note names: "meter" and "joule" are English words, not symbols
    const BASE_LABEL = {
      length: L('unitBaseMeter', 'meter'), mass: L('unitBaseKilogram', 'kilogram'), volume: L('unitBaseLitre', 'litre'),
      area: L('unitBaseSquareMetre', 'square metre'), speed: L('unitBaseMetrePerSecond', 'metre/second'),
      time: L('unitBaseSecond', 'second'), data: L('unitBaseByte', 'byte'), energy: L('unitBaseJoule', 'joule'),
      pressure: L('unitBasePascal', 'pascal'), angle: L('unitBaseDegree', 'degree'), temperature: L('unitBaseCelsius', 'celsius')
    };
    // most unit labels are symbols (m, km, psi, kcal) and ISO 80000 makes a symbol language-neutral,
    // so they stay verbatim. These four are not symbols, they are English words, and a Japanese
    // visitor reads them as untranslated text.
    const WORD_UNITS = { day: L('unitDay', 'day'), week: L('unitWeek', 'week'), month: L('unitMonth', 'month'), year: L('unitYear', 'year') };
    const unitName = n => WORD_UNITS[n] || n;
    let cat = 'length';
    const state = { from: 'm', to: 'ft' };
    const val = numBox(1);
    const fromSel = select([], state.from, v => { state.from = v; render(); });
    const toSel = select([], state.to, v => { state.to = v; render(); });
    const list = el('div', { class: 'out' });
    const names = () => Object.keys(UNITS[cat][1]);
    const convert = (v, a, b) => {
      const tbl = UNITS[cat][1];
      if (cat === 'temperature') {
        // every temperature unit is defined as a function of Celsius
        const celsius = (() => {
          for (const [n, f] of Object.entries(tbl)) {
            if (n === a) {
              // invert f by its two-point slope: exact for these affine maps
              const s = f(1) - f(0);
              return (v - f(0)) / s;
            }
          }
          return v;
        })();
        for (const [n, f] of Object.entries(tbl)) if (n === b) return f(celsius);
        return celsius;
      }
      return v * tbl[a] / tbl[b];
    };
    const pick = (next) => {
      cat = next;
      const ns = names();
      // start on a pair that is actually interesting for that category
      const pairs = { length: ['m', 'ft'], mass: ['kg', 'lb'], volume: ['l', 'gal US'], area: ['m²', 'ft²'], speed: ['km/h', 'mph'], time: ['s', 'min'], data: ['MB', 'MiB'], energy: ['kcal', 'kJ'], pressure: ['bar', 'psi'], angle: ['deg', 'rad'], temperature: ['°C', '°F'] };
      const p = pairs[next] || [ns[0], ns[1]];
      state.from = p[0]; state.to = p[1];
      fillSelectors();
      render();
    };
    const fillSelectors = () => {
      const ns = names();
      fromSel.replaceChildren(...ns.map(n => el('option', { value: n, selected: n === state.from }, unitName(n))));
      toSel.replaceChildren(...ns.map(n => el('option', { value: n, selected: n === state.to }, unitName(n))));
      fromSel.value = state.from; toSel.value = state.to;
    };
    const render = () => {
      const v = Number(val.value);
      list.replaceChildren();
      if (!Number.isFinite(v)) return list.append(note(L('enterANumber', 'Enter a number.'), 'err'));
      const result = convert(v, state.from, state.to);
      list.append(
        el('div', { class: 'panel' },
          el('h3', { text: fmt(L('ui01Equals', '{0} {1} equals'), show(v), unitName(state.from)) }),
          stat(L('resultSize', 'Result'), `${show(result)} ${unitName(state.to)}`, `1 ${unitName(state.from)} = ${show(convert(1, state.from, state.to))} ${unitName(state.to)}`),
          cat === 'temperature' ? note(L('temperatureIsNotARatio', 'Temperature is not a ratio scale, so 20 °C is not “twice as hot” as 10 °C.')) : null),
        el('h3', { text: L('allUnits', 'All units at once') }),
        el('div', { class: 'out' }, ...names().map(n => {
          const x = show(convert(v, state.from, n));
          const row = el('div', { class: 'result-card', style: 'display:flex;gap:12px;align-items:center;flex-wrap:wrap' },
            el('span', { class: 'nm', text: unitName(n), style: 'min-width:88px;font-weight:600' }),
            el('code', { text: x, style: 'flex:1' }),
            n === state.to ? el('span', { class: 'badge', text: L('target2', 'target') }) : null,
            copyChip(x));
          row.addEventListener('click', () => { state.to = n; fillSelectors(); render(); });
          return row;
        })),
        note(fmt(L('baseUnit0EveryLine', 'Base unit: {0}. Every line above is converted through it, so rounding stays consistent.'), BASE_LABEL[cat])));
    };
    root.append(el('div', { class: 'controls' },
      field(L('category', 'Category'), select(CATS.map(c => [c, CAT_LABEL[c]]), cat, v => pick(v)), ''),
      field(L('value', 'Value'), val, ''), field(L('from', 'From'), fromSel, ''), field(L('to', 'To'), toSel, ''),
      el('span', {}, button(L('swap', '⇄ swap'), () => { [state.from, state.to] = [state.to, state.from]; fillSelectors(); render(); }, { kind: 'ghost' }))), list);
    val.addEventListener('input', render);
    fillSelectors();
    render();
  },

  // ------------------------------------------------------------ color-converter
  'color-converter': async (root) => {
    const hexIn = textInput('#3366FF');
    hexIn.setAttribute('spellcheck', 'false');
    const pick = el('input', { type: 'color', value: '#3366ff' });
    const res = el('div', { class: 'out' });
    function hslToRgb(h, s, l) {
      const c = (1 - Math.abs(2 * l / 100 - 1)) * s / 100;
      const x = c * (1 - Math.abs((h / 60) % 2 - 1));
      const m = l / 100 - c / 2;
      const seg = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][Math.floor(((h % 360) + 360) % 360 / 60) % 6];
      return seg.map(v => clamp(Math.round((v + m) * 255), 0, 255));
    }
    function rgbToHsl(r, g, b) {
      const max = Math.max(r, g, b) / 255, min = Math.min(r, g, b) / 255;
      const l = (max + min) / 2, d = max - min;
      let h = 0, s = 0;
      if (d) {
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        if (max === r / 255) h = (g - b) / 255 / d + (g < b ? 6 : 0);
        else if (max === g / 255) h = (b - r) / 255 / d + 2;
        else h = (r - g) / 255 / d + 4;
        h *= 60;
      }
      return [Math.round(h), Math.round(s * 100), Math.round(l * 100)];
    }
    const parse = s => {
      const raw = String(s).trim().toLowerCase().replace(/^#/, '');
      if (/^[0-9a-f]{3}$/.test(raw)) return [parseInt(raw[0] + raw[0], 16), parseInt(raw[1] + raw[1], 16), parseInt(raw[2] + raw[2], 16), 1];
      if (/^[0-9a-f]{6}$/.test(raw)) return [parseInt(raw.slice(0, 2), 16), parseInt(raw.slice(2, 4), 16), parseInt(raw.slice(4, 6), 16), 1];
      if (/^[0-9a-f]{8}$/.test(raw)) return [parseInt(raw.slice(0, 2), 16), parseInt(raw.slice(2, 4), 16), parseInt(raw.slice(4, 6), 16), parseInt(raw.slice(6, 8), 16) / 255];
      const fn = /^rgba?\(([^)]+)\)$/.exec(raw);
      if (fn) {
        const parts = fn[1].split(/[,/\s]+/).filter(Boolean);
        if (parts.length < 3) return null;
        const rgb = parts.slice(0, 3).map(x => x.endsWith('%') ? clamp(parseFloat(x) * 2.55, 0, 255) : clamp(parseFloat(x), 0, 255));
        if (rgb.some(x => !Number.isFinite(x))) return null;
        const al = parts[3];
        const alpha = al === undefined ? 1 : al.endsWith('%') ? clamp(parseFloat(al) / 100, 0, 1) : clamp(parseFloat(al), 0, 1);
        return [...rgb.map(Math.round), alpha];
      }
      const hsl = /^hsla?\(([^)]+)\)$/.exec(raw);
      if (hsl) {
        const parts = hsl[1].split(/[,/\s]+/).filter(Boolean).map(x => parseFloat(x));
        if (parts.length < 3 || parts.some(x => !Number.isFinite(x))) return null;
        return [...hslToRgb(parts[0], clamp(parts[1], 0, 100), clamp(parts[2], 0, 100)), parts[3] === undefined ? 1 : clamp(parts[3], 0, 1)];
      }
      return null;
    };
    const relLum = ([r, g, b]) => [r, g, b].map(v => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    }).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
    const render = () => {
      res.replaceChildren();
      const rgb = parse(hexIn.value);
      if (!rgb) return res.append(note(L('iUnderstandRgbRrggbbRrggbbaa', 'I understand #rgb, #rrggbb, #rrggbbaa, rgb(10,20,30,.5) and hsl(210,60%,50%).'), 'err'));
      const [r, g, b, a] = rgb;
      const hx = '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();
      const [h, s, l] = rgbToHsl(r, g, b);
      const maxc = Math.max(r, g, b) / 255;
      const k = 1 - maxc;
      const cmyk = maxc === 0 ? [0, 0, 0, 100] : [Math.round((1 - r / 255 - k) / (1 - k) * 100), Math.round((1 - g / 255 - k) / (1 - k) * 100), Math.round((1 - b / 255 - k) / (1 - k) * 100), Math.round(k * 100)];
      pick.value = hx.toLowerCase();
      const f = relLum(rgb);
      const ratio = other => (Math.max(f, other) + 0.05) / (Math.min(f, other) + 0.05);
      const rw = ratio(1), rb = ratio(0);
      const grade = x => x >= 7 ? L('aaaText', 'AAA text') : x >= 4.5 ? L('aaText', 'AA text') : x >= 3 ? L('largeTextOnly', 'large text only') : L('failsWcag', 'fails WCAG');
      const kv = el('div', { class: 'kv' });
      const rows = [
        ['HEX', hx],
        ['RGB', `rgb(${r}, ${g}, ${b})`],
        ['RGBA', `rgba(${r}, ${g}, ${b}, ${Math.round(a * 100) / 100})`],
        ['HSL', `hsl(${h}, ${s}%, ${l}%)`],
        ['CMYK', `cmyk(${cmyk[0]}%, ${cmyk[1]}%, ${cmyk[2]}%, ${cmyk[3]}%)`],
        [L('webSafe', 'Web safe'), '#' + [r, g, b].map(v => Math.round(v / 51) * 51).map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase()],
        [L('inverseColor', 'Inverse'), '#' + [255 - r, 255 - g, 255 - b].map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase()],
        [L('grayscale', 'Grayscale'), '#' + [1, 1, 1].map(() => Math.round((0.2126 * r + 0.7152 * g + 0.0722 * b)).toString(16).padStart(2, '0')).join('').toUpperCase()]
      ];
      rows.forEach(([k2, v]) => kv.append(el('span', { class: 'k', text: k2 }), el('span', { class: 'check' }, el('code', { text: v }), copyChip(v))));
      const shade = ll => {
        const [rr, gg, bb] = hslToRgb(h, s, ll);
        return '#' + [rr, gg, bb].map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();
      };
      res.append(
        el('div', { class: 'result-card' }, el('i', { style: `display:block;height:96px;border-radius:8px;border:1px solid var(--line);background:${hx}` }),
          a < 1 ? note(fmt(L('alpha0ShownOverThe', 'Alpha {0}% — shown over the panel background.'), Math.round(a * 100))) : null),
        kv,
        el('h3', { text: L('contrastAgainstText', 'Contrast against text') }),
        el('div', { class: 'out' },
          stat(L('whiteText', 'White text'), `${show(rw)}:1`, grade(rw)),
          stat(L('blackText', 'Black text'), `${show(rb)}:1`, grade(rb)),
          stat(L('luminance', 'Luminance'), show(f), L('wcagRelativeLuminance', 'WCAG relative luminance'))),
        el('div', { style: `padding:12px;border-radius:8px;background:${hx}` }, el('p', { text: L('whiteOnColour', 'White on this colour'), style: 'color:#fff;margin:0' }), el('p', { text: L('blackOnColour', 'Black on this colour'), style: 'color:#000;margin:0' })),
        el('h3', { text: L('shadesAndTints', 'Shades and tints') }),
        el('div', { class: 'swatches' }, ...[10, 20, 30, 40, 50, 60, 70, 80, 90].map(ll => {
          const v = shade(ll);
          return el('button', { class: 'swatch', title: fmt(L('lightness0', 'lightness {0}%'), ll), onClick: () => { hexIn.value = v; render(); } }, el('i', { style: `background:${v}` }), el('span', { text: String(ll) }));
        })),
        el('h3', { text: L('harmonies', 'Harmonies') }),
        el('div', { class: 'swatches' }, ...[
          [L('harmonyComplement', 'complement'), (h + 180) % 360],
          [L('harmonyTriadPlus', 'triad +'), (h + 120) % 360], [L('harmonyTriadMinus', 'triad −'), (h + 240) % 360],
          [L('harmonyAnalogPlus', 'analog +'), (h + 30) % 360], [L('harmonyAnalogMinus', 'analog −'), (h + 330) % 360]
        ].map(([name, hh]) => {
          const v = '#' + hslToRgb(hh, s, l).map(x => x.toString(16).padStart(2, '0')).join('').toUpperCase();
          return el('button', { class: 'swatch', title: `${name} · ${v}`, onClick: () => { hexIn.value = v; render(); } }, el('i', { style: `background:${v}` }), el('span', { text: name }));
        })),
        note(L('pasteAnyOfTheseValues', 'Paste any of these values straight into CSS. Print colours (CMYK) never match screen colours exactly.')));
    };
    pick.addEventListener('input', () => { hexIn.value = pick.value.toUpperCase(); render(); });
    root.append(el('div', { class: 'controls' },
      field(L('color', 'Colour'), el('span', { class: 'check' }, pick, hexIn), L('hexRgbOrHsl', 'hex, rgb() or hsl()')),
      el('span', {}, button(L('random', 'Random'), () => {
        hexIn.value = '#' + [...crypto.getRandomValues(new Uint8Array(3))].map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();
        render();
      }, { kind: 'ghost' }))), res);
    hexIn.addEventListener('input', render);
    render();
  },

  // ------------------------------------------------------------ calorie-calculator
  'calorie-calculator': async (root) => {
    let sex = 'female', goal = 'maintain', activity = 1.375;
    const age = numBox(30, { min: 10, max: 100, step: 1 });
    const h = numBox(168), w = numBox(62);
    const res = el('div', { class: 'out' });
    const render = () => {
      res.replaceChildren();
      const A = Number(age.value), H = Number(h.value), W = Number(w.value);
      if (!(A >= 10 && A <= 100) || !(H >= 100 && H <= 230) || !(W >= 25 && W <= 350)) {
        return res.append(note(L('useAnAgeBetween10', 'Use an age between 10 and 100, height in cm (100–230) and weight in kg (25–350).'), 'err'));
      }
      // Mifflin–St Jeor
      const bmr = 10 * W + 6.25 * H - 5 * A + (sex === 'male' ? 5 : -161);
      const tdee = bmr * activity;
      const shift = goal === 'lose' ? -0.2 : goal === 'gain' ? 0.12 : 0;
      const target = tdee * (1 + shift);
      const protein = goal === 'gain' ? 1.8 : goal === 'lose' ? 2 : 1.6;
      const fat = 0.9;
      const pK = protein * W, fK = fat * W * 9;
      const carbs = Math.max(0, (target - pK - fK) / 4);
      res.append(
        stat(L('maintenance', 'Maintenance'), `${int(tdee)} kcal`, fmt(L('bmr0Kcal1Activity', 'BMR {0} kcal × {1} activity'), int(bmr), activity)),
        el('div', { class: 'out' },
          stat(goal === 'lose' ? L('fatLossTarget', 'Fat-loss target') : goal === 'gain' ? L('muscleGainTarget', 'Muscle-gain target') : L('dailyTarget', 'Daily target'), `${int(target)} kcal`,
            shift ? fmt(L('ui01VersusMaintenance2', '{0}{1}% versus maintenance ({2} kcal/day)'), shift > 0 ? '+' : '−', Math.round(Math.abs(shift) * 100), int(Math.abs(tdee - target))) : L('weightStaysWhereItIs', 'weight stays where it is')),
          stat(L('protein', 'Protein'), `${int(pK)} kcal`, `${protein.toFixed(1)} g/kg → ${int(protein * W)} g`),
          stat(L('fatLabel', 'Fat'), `${int(fK)} kcal`, `${fat} g/kg → ${int(fat * W)} g`),
          stat(L('carbohydrate', 'Carbohydrate'), `${int(carbs * 4)} kcal`, `${int(carbs)} g`),
          stat(L('weeklyDrift', 'Weekly drift if you follow it'), `${show((tdee - target) * 7 / 7700)} kg`, L('ui7700Kcal1KgOf', '7700 kcal ≈ 1 kg of body fat'))),
        note(L('theseArePopulationEquationsSo', 'These are population equations, so they are a starting point, not a prescription. Weigh in weekly and adjust by 150–200 kcal if the scale refuses to move. Pregnancy, breastfeeding, kidney disease and eating disorders need a professional instead of a calculator.')));
    };
    root.append(el('div', { class: 'controls' },
      field(L('sex', 'Sex'), select([['female', L('female', 'Female')], ['male', L('male', 'Male')]], sex, v => { sex = v; render(); }), L('theEquationUsesIt', 'the equation uses it')),
      field(L('age', 'Age'), age, L('years', 'years')), field(L('height', 'Height'), h, 'cm'), field(L('weight', 'Weight'), w, 'kg'),
      field(L('activity', 'Activity'), select([[1.2, L('sedentaryDeskWorkNoExercise', 'Sedentary — desk work, no exercise')], [1.375, L('light13SessionsA', 'Light — 1–3 sessions a week')], [1.55, L('moderate35Sessions', 'Moderate — 3–5 sessions')], [1.725, L('veryActive67Sessions', 'Very active — 6–7 sessions')], [1.9, L('athleteOrHeavyManualWork', 'Athlete or heavy manual work')]], activity, v => { activity = Number(v); render(); }), ''),
      field(L('goal', 'Goal'), select([['maintain', L('keepWeight', 'Keep my weight')], ['lose', L('loseFat', 'Lose fat')], ['gain', L('buildMuscle', 'Build muscle')]], goal, v => { goal = v; render(); }), '')), res);
    bind(render, age, h, w);
    render();
  },

  // ------------------------------------------------------------ timestamp-converter
  'timestamp-converter': async (root) => {
    const inA = textInput(String(Math.floor(Date.now() / 1000)));
    inA.setAttribute('spellcheck', 'false');
    let unit = 'auto';
    const res = el('div', { class: 'out' });
    const render = () => {
      res.replaceChildren();
      const raw = inA.value.trim();
      if (!raw) return res.append(note(L('pasteAnEpochNumberOr', 'Paste an epoch number or a date.'), 'err'));
      let date, how;
      if (/^-?\d+(\.\d+)?$/.test(raw)) {
        const n = Number(raw);
        const ms = unit === 'ms' ? n : unit === 's' ? n * 1000 : (Math.abs(n) >= 1e11 ? n : n * 1000);
        date = new Date(ms);
        how = unit === 'auto' ? (Math.abs(n) >= 1e11 ? L('readAsMilliseconds13Digits', 'read as milliseconds (13 digits)') : L('readAsSeconds10Digits', 'read as seconds (10 digits)')) : fmt(L('forced0', 'forced {0}'), unit === 'ms' ? L('milliseconds', 'milliseconds') : L('seconds', 'seconds'));
      } else {
        date = new Date(raw);
        how = L('parsedAsADateString', 'parsed as a date string');
      }
      if (!Number.isFinite(date.getTime())) return res.append(note(L('thatIsNeitherATimestamp', 'That is neither a timestamp I recognise nor a valid date.'), 'err'));
      const ms = date.getTime();
      const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown';
      const offsetMin = -date.getTimezoneOffset();
      const kv = el('div', { class: 'kv' });
      const add = (k, v) => kv.append(el('span', { class: 'k', text: k }), el('span', { class: 'check' }, el('code', { text: String(v) }), copyChip(String(v))));
      add(L('localCol', 'Local'), date.toLocaleString(locale(), { dateStyle: 'full', timeStyle: 'long' }));
      add(L('iso', 'ISO 8601'), date.toISOString());
      add(L('utc', 'UTC'), date.toUTCString());
      add(L('unixSeconds', 'Unix seconds'), Math.floor(ms / 1000));
      add(L('unixMilliseconds', 'Unix milliseconds'), ms);
      add(L('yourTimezone', 'Your timezone'), `${zone} (UTC${offsetMin >= 0 ? '+' : '−'}${pad2(Math.floor(Math.abs(offsetMin) / 60))}:${pad2(Math.abs(offsetMin) % 60)})`);
      add(L('weekDayCol', 'Week / day'), fmt(L('week01', 'week {0}, {1}'), Math.ceil(((date - new Date(date.getFullYear(), 0, 1)) / 86400000 + new Date(date.getFullYear(), 0, 1).getDay() + 1) / 7), DAYS[date.getDay()]));
      const delta = ms - Date.now();
      const abs = Math.abs(delta);
      const human = abs < 60000 ? fmt(L('ui0Seconds', '{0} seconds'), Math.round(abs / 1000)) : abs < 3600000 ? fmt(L('ui0MinutesShort', '{0} min'), Math.round(abs / 60000))
        : abs < 86400000 ? fmt(L('ui0HoursShort', '{0} h'), (abs / 3600000).toFixed(1)) : abs < 2592000000 ? fmt(L('ui0Days', '{0} days'), Math.round(abs / 86400000))
          : fmt(L('ui0Years', '{0} years'), (abs / 31557600000).toFixed(2));
      res.append(
        stat(L('thatMomentIs', 'That moment is'), date.toLocaleDateString(locale(), { year: 'numeric', month: 'long', day: 'numeric' }), `${how}`),
        kv,
        el('div', { class: 'out' },
          stat(delta === 0 ? L('exactlyNow', 'Exactly now') : delta > 0 ? L('inTheFutureBy', 'In the future by') : L('inThePastBy', 'In the past by'), human,
            date.getFullYear() > 2100 ? L('thisFarAheadUsuallyMeans', 'this far ahead usually means the unit is wrong') : '')),
        el('div', { class: 'btn-row' },
          button(L('nowSeconds', 'Now (seconds)'), () => { inA.value = String(Math.floor(Date.now() / 1000)); render(); }, { kind: 'ghost' }),
          button(L('nowMillis', 'Now (milliseconds)'), () => { inA.value = String(Date.now()); render(); }, { kind: 'ghost' }),
          button(L('oneYearFromNow', 'One year from now'), () => { inA.value = String(Math.floor((Date.now() + 365 * 86400000) / 1000)); render(); }, { kind: 'ghost' })),
        note(L('a10DigitNumberIs', 'A 10-digit number is seconds, a 13-digit one is milliseconds. Force the unit above if your value is unusual, such as 0 or a negative date.')));
    };
    const unitSel = select([['auto', L('detectByLength', 'Detect by length')], ['s', L('treatAsSeconds', 'Treat as seconds')], ['ms', L('treatAsMillis', 'Treat as milliseconds')]], unit, v => { unit = v; render(); });
    root.append(el('div', { class: 'controls' },
      field(L('timestampOrDate', 'Timestamp or date'), inA, L('epochIsoStringOr2026', 'epoch, ISO string, or 2026-06-01 14:30')), field(L('unit', 'Unit'), unitSel, '')), res);
    inA.addEventListener('input', render);
    render();
  },

  // ------------------------------------------------------------ random-number-generator
  'random-number-generator': async (root) => {
    const minIn = numBox(1), maxIn = numBox(100), countIn = numberInput(10, null, { min: 1, max: 10000, step: 1 });
    const decIn = numberInput(0, null, { min: 0, max: 6, step: 1 });
    const skipIn = textInput('');
    skipIn.setAttribute('placeholder', L('ui413NeverOutputThese', '4, 13 — never output these'));
    let unique = false, sorted = false, allowNeg = true;
    const out = el('textarea', { spellcheck: 'false', readonly: true, style: 'min-height:230px' });
    const res = el('div', { class: 'out' });
    const draw = () => {
      const b = new Uint32Array(1);
      crypto.getRandomValues(b);
      return b[0];
    };
    const render = () => {
      res.replaceChildren();
      const mi = Number(minIn.value), ma = Number(maxIn.value);
      if (!Number.isFinite(mi) || !Number.isFinite(ma)) return res.append(note(L('enterTwoNumbers', 'Enter two numbers.'), 'err'));
      let lo = Math.min(mi, ma), hi = Math.max(mi, ma);
      if (!allowNeg && lo < 0) lo = 0;
      const dp = clamp(Math.round(Number(decIn.value) || 0), 0, 6);
      const n = clamp(Math.round(Number(countIn.value) || 1), 1, 10000);
      const skip = new Set(skipIn.value.split(/[,\s]+/).filter(Boolean));
      const span = Math.round((hi - lo) * 10 ** dp) + 1;
      if (unique && n > span - skip.size) return res.append(note(fmt(L('youCannotDraw0Unique', 'You cannot draw {0} unique values from {1} possibilities between {2} and {3}.'), n, span, lo, hi), 'err'));
      const seen = new Set(), list = [];
      let guard = 0;
      while (list.length < n && guard++ < n * 400 + 4000) {
        const v = Number((lo + Math.floor(draw() / 4294967296 * span) / 10 ** dp).toFixed(dp));
        const key = String(v);
        if (skip.has(key) || (unique && seen.has(key))) continue;
        if (unique) seen.add(key);
        list.push(v);
      }
      if (sorted) list.sort((x, y) => x - y);
      out.value = list.join('\n');
      const sum = list.reduce((acc, v) => acc + v, 0);
      res.append(
        stat(L('drawn', 'Drawn'), String(list.length), unique ? L('withoutRepeats', 'without repeats') : L('repeatsAllowed', 'repeats allowed')),
        el('div', { class: 'out' },
          // two keys rather than +'s': English builds a plural out of one letter, most languages do not
          stat(L('range', 'Range'), list.length === 1 ? String(list[0]) : `${lo} – ${hi}`,
            fmt(dp === 1 ? L('oneDecimalPlace', '{0} decimal place') : L('nDecimalPlaces', '{0} decimal places'), dp)),
          stat(L('sum', 'Sum'), show(sum), ''),
          stat(L('average', 'Average'), list.length ? show(sum / list.length) : '—', fmt(L('expectedAround0', 'expected around {0}'), show((lo + hi) / 2))),
          stat(L('lowestHighest', 'Lowest / highest'), list.length ? `${Math.min(...list)} / ${Math.max(...list)}` : '—', '')),
        el('div', { class: 'field' }, el('span', { text: L('numbers', 'Numbers') }), out),
        el('div', { class: 'btn-row' },
          button(L('drawAgain', 'Draw again'), render, { kind: 'ghost' }),
          copyChip(() => out.value),
          button('.txt', () => download(new Blob([out.value], { type: 'text/plain' }), 'random-numbers.txt'), { kind: 'ghost' })),
        note(L('usesCryptoGetrandomvaluesSoIt', 'Uses crypto.getRandomValues(), so it is fair enough for raffles, sample data and test ids. It is not a source of secrets, and it is not reproducible — for a repeatable study use a seeded generator.')));
    };
    const PRESETS = { 1: [1, 1, 1, 0, false], 6: [1, 6, 1, 0, false], 3: [1, 6, 3, 0, false], 49: [1, 49, 6, 0, true], 1000: [0, 999, 1, 0, true], coin: [0, 1, 1, 0, false] };
    root.append(el('div', { class: 'controls' },
      field(L('min', 'Minimum'), minIn, ''), field(L('max', 'Maximum'), maxIn, ''), field(L('quantity', 'How many'), countIn, L('upTo10000', 'up to 10000')),
      field(L('decimals', 'Decimals'), decIn, L('ui0WholeNumbers', '0 = whole numbers')), field(L('skipStep', 'Skip'), skipIn, '')),
      el('div', { class: 'controls' },
        el('span', {}, checkInput(L('unique', 'No repeats'), false, v => { unique = v; render(); })),
        el('span', {}, checkInput(L('sortAscending', 'Sort ascending'), false, v => { sorted = v; render(); })),
        el('span', {}, checkInput(L('allowNegatives', 'Allow negatives'), true, v => { allowNeg = v; render(); })),
        field(L('presets', 'Presets'), select([['', L('diceLotteryCoin', 'dice, lottery, coin…')], ['6', L('presetOneDie', 'One die (1–6)')], ['3', L('presetThreeDice', 'Three dice')], ['49', L('presetLotto', 'Lotto 6 of 49')], ['1000', L('presetCode', '4-digit code (0–999)')], ['coin', L('presetCoin', 'Coin flip (0 or 1)')], ['1', L('presetSingle', 'Single number')]], '', v => {
          const p = PRESETS[v];
          if (!p) return;
          minIn.value = p[0]; maxIn.value = p[1]; countIn.value = p[2]; decIn.value = p[3]; unique = p[4];
          render();
        }), '')), res);
    bind(render, minIn, maxIn, countIn, decIn, skipIn);
    render();
  },

  // ------------------------------------------------------------ shoe-size-converter
  'shoe-size-converter': async (root) => {
    // Foot length in centimetres is the canonical base; every system is an affine map of it. These
    // are the standard retail approximations (brands differ by half a size), stated as such below.
    let gender = 'men', system = 'cm';
    const val = numBox(25);
    const res = el('div', { class: 'out' });
    const genderSel = select([['men', L('shoeMen', 'Men')], ['women', L('shoeWomen', 'Women')]], gender, v => { gender = v; render(); });
    const sysOptions = [['cm', L('shoeSysCm', 'Foot length (cm)')], ['us', 'US'], ['eu', 'EU'], ['uk', 'UK'], ['cn', 'CN']];
    const sysSel = select(sysOptions, system, v => { system = v; render(); });
    const toCm = (v, sys, g) => {
      switch (sys) {
        case 'eu': return v / 1.5 - 1.5;
        case 'us': return ((v + (g === 'women' ? 21 : 22)) / 3) * 2.54;
        case 'uk': return ((v + 23) / 3) * 2.54;
        case 'cn': return (v + 10) / 2;
        default: return v;
      }
    };
    const render = () => {
      res.replaceChildren();
      const v = Number(val.value);
      if (!Number.isFinite(v) || v <= 0) return res.append(note(L('shoeEnterSize', 'Enter a size or foot length greater than zero.'), 'err'));
      const cm = toCm(v, system, gender);
      if (!(cm > 0) || cm > 40) return res.append(note(L('shoeOutOfRange', 'That converts to an unusual foot length — check the size system and the value.'), 'err'));
      const inch = cm / 2.54;
      const half = x => Math.round(x * 2) / 2;
      const rows = [
        ['US', half(3 * inch - (gender === 'women' ? 21 : 22))],
        ['EU', Math.round(1.5 * (cm + 1.5))],
        ['UK', half(3 * inch - 23)],
        ['CN', Math.round(cm * 2 - 10)],
        ['cm', show(Math.round(cm * 10) / 10)],
        ['in', show(Math.round(inch * 100) / 100)]
      ];
      const table = el('table', { style: 'width:100%;border-collapse:collapse;font-size:14px' },
        el('thead', {}, el('tr', {},
          el('th', { text: L('shoeColSystem', 'System'), style: 'text-align:left;padding:6px 8px;border-bottom:1px solid var(--line)' }),
          el('th', { text: L('shoeColSize', 'Size'), style: 'text-align:right;padding:6px 8px;border-bottom:1px solid var(--line)' }))),
        el('tbody', {}, ...rows.map(([name, size]) => el('tr', {},
          el('td', { text: name, style: 'padding:6px 8px;border-bottom:1px solid var(--line);font-weight:600' }),
          el('td', { text: String(size), style: 'text-align:right;padding:6px 8px;border-bottom:1px solid var(--line)' })))));
      add(res,
        stat(L('shoeFootLength', 'Foot length'), `${show(Math.round(cm * 10) / 10)} cm`, fmt(L('shoeInches', '{0} in'), show(Math.round(inch * 100) / 100))),
        el('h3', { text: L('shoeEverySystem', 'The same foot in every system') }), table,
        note(L('shoeApproxNote', 'Sizes are approximate retail conversions and differ by brand and last. Measure your foot in the evening from heel to longest toe, and choose the larger size when you fall between two.')));
    };
    root.append(el('div', { class: 'controls' },
      field(L('shoeGender', 'Fit'), genderSel, ''),
      field(L('shoeSystem', 'Size system'), sysSel, ''),
      field(L('shoeValue', 'Size'), val, L('shoeValueHint', 'in the system chosen above'))), res);
    bind(render, val);
    render();
  },

  // ------------------------------------------------------------ rmb-uppercase
  'rmb-uppercase': async (root) => {
    // The PRC financial uppercase form. Integer cents avoid the binary-rounding trap (0.29 * 100 is
    // 28.999… in floating point), so 角 and 分 are always exact. The classic group-and-collapse rules
    // turn 100 into 壹佰元整 and 1000000 into 壹佰万元整 rather than a string of 零.
    const DIGIT = ['零', '壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖'];
    const IU = ['', '拾', '佰', '仟'];
    const GU = ['元', '万', '亿', '兆'];
    const upper = amount => {
      const neg = amount < 0;
      const cents = Math.round(Math.abs(amount) * 100);
      const fen = cents % 10, jiao = Math.floor(cents / 10) % 10;
      let yuan = Math.floor(cents / 100);
      let s = '';
      if (jiao) s += DIGIT[jiao] + '角';
      if (fen) s += DIGIT[fen] + '分';
      s = s || '整';
      if (jiao && !fen) s += '整';
      for (let g = 0; g < GU.length && yuan > 0; g++) {
        let p = '';
        for (let j = 0; j < 4 && yuan > 0; j++) { p = DIGIT[yuan % 10] + IU[j] + p; yuan = Math.floor(yuan / 10); }
        s = p.replace(/(零.)*零$/, '').replace(/^$/, '零') + GU[g] + s;
      }
      // PBOC rule: when the jiao place is 0 but fen is not (and there is a yuan part), a 零 follows 元 —
      // ￥164.09 is 壹佰陆拾肆元零玖分, not …元玖分. Applied after the zero-collapse so it is not eaten by it;
      // 元+digit+分 only occurs when jiao is 0, so this cannot touch the 元X角Y分 form.
      return (neg ? '负' : '') + s.replace(/(零.)*零元/, '元').replace(/(零.)+/g, '零').replace(/元([壹贰叁肆伍陆柒捌玖])分/, '元零$1分').replace(/^整$/, '零元整');
    };
    const input = textInput('1234.56');
    input.setAttribute('inputmode', 'decimal');
    const out = el('textarea', { readonly: true, spellcheck: 'false', style: 'min-height:84px;font-size:18px' });
    const res = el('div', { class: 'out' });
    const render = () => {
      res.replaceChildren();
      // Strip ASCII or fullwidth (IME) commas and yen signs. The fullwidth characters are written as
      // \u escapes on purpose: they are input being matched, not UI punctuation, and keeping them out
      // of the source literally is what check-fullwidth.mjs asks for.
      const raw = input.value.replace(/[,\uFF0C\s\u00A5\uFFE5]/g, '');
      const n = Number(raw);
      if (raw === '' || !Number.isFinite(n)) return res.append(note(L('rmbEnterAmount', 'Enter an amount, for example 1234.56.'), 'err'));
      if (Math.abs(n) >= 1e12) return res.append(note(L('rmbTooLarge', 'That amount is too large — this converter handles values below one trillion.'), 'err'));
      out.value = upper(n);
      add(res,
        stat(L('rmbAmount', 'Amount'), n.toLocaleString(locale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 }), L('rmbCny', 'Chinese yuan (CNY)')),
        el('div', { class: 'field' }, el('span', { text: L('rmbUppercase', 'Amount in Chinese uppercase') }), out),
        el('div', { class: 'btn-row' }, copyChip(() => out.value)),
        note(L('rmbNote', 'This is the financial uppercase form used on cheques, invoices and contracts to prevent tampering. The two decimal places are jiao and fen; the trailing character marks an exact amount with no cents.')));
    };
    root.append(el('div', { class: 'controls' }, field(L('rmbAmountField', 'Amount'), input, L('rmbAmountHint', 'digits, optional decimals'))), res);
    bind(render, input);
    render();
  },

  // ------------------------------------------------------------ world-clock
  'world-clock': async (root) => {
    // City names go through L() so every locale supplies its own form (洛杉矶, Londres, ロンドン…);
    // the IANA zone ids stay verbatim because Intl validates them. All Intl options are plain literals,
    // never dictionary keys, so a translation can never turn '2-digit' into an out-of-range enum.
    const CITIES = [
      ['America/Los_Angeles', L('cityLosAngeles', 'Los Angeles')],
      ['America/New_York', L('cityNewYork', 'New York')],
      ['Europe/London', L('cityLondon', 'London')],
      ['Europe/Paris', L('cityParis', 'Paris')],
      ['Europe/Moscow', L('cityMoscow', 'Moscow')],
      ['Asia/Dubai', L('cityDubai', 'Dubai')],
      ['Asia/Kolkata', L('cityMumbai', 'Mumbai')],
      ['Asia/Shanghai', L('cityShanghai', 'Shanghai')],
      ['Asia/Tokyo', L('cityTokyo', 'Tokyo')],
      ['Australia/Sydney', L('citySydney', 'Sydney')],
      ['Pacific/Auckland', L('cityAuckland', 'Auckland')],
      ['America/Sao_Paulo', L('citySaoPaulo', 'São Paulo')]
    ];
    const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    const start = new Date();
    let minutes = start.getHours() * 60 + start.getMinutes();
    let live = true, timer = null;
    const hhmm = m => `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
    const cards = el('div', { class: 'out', style: 'display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:10px' });
    const liveInput = el('input', { type: 'checkbox', checked: true });
    const sliderInput = el('input', { type: 'range', min: 0, max: 1439, step: 15, value: minutes });
    const sliderOut = el('span', { text: hhmm(minutes) });
    const instant = () => {
      if (live) return new Date();
      const d = new Date();
      return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, minutes, 0, 0);
    };
    const timeIn = (date, zone) => new Intl.DateTimeFormat(locale(), { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
    const dateIn = (date, zone) => new Intl.DateTimeFormat(locale(), { timeZone: zone, weekday: 'short', day: 'numeric', month: 'short' }).format(date);
    const hourIn = (date, zone) => Number(new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: '2-digit', hourCycle: 'h23' }).format(date));
    const dayDiff = (date, zone) => {
      const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
      const [y, m, d] = ymd.split('-').map(Number);
      return Math.round((new Date(y, m - 1, d) - new Date(date.getFullYear(), date.getMonth(), date.getDate())) / 86400000);
    };
    const render = () => {
      if (!cards.isConnected) { stop(); return; }
      const date = instant();
      cards.replaceChildren();
      for (const [zone, name] of CITIES) {
        const h = hourIn(date, zone);
        const diff = dayDiff(date, zone);
        const working = h >= 9 && h < 18;
        const badge = diff === 0 ? '' : (diff > 0 ? fmt(L('clockPlusDay', '+{0} day'), diff) : fmt(L('clockMinusDay', '−{0} day'), -diff));
        cards.append(el('div', { class: 'result-card', style: 'padding:10px 12px' },
          el('div', { style: 'display:flex;justify-content:space-between;align-items:center;gap:8px' },
            el('b', { text: name }),
            el('span', { title: working ? L('clockBusiness', 'Business hours') : L('clockOffHours', 'Outside business hours'), style: `width:10px;height:10px;border-radius:50%;background:${working ? '#2ea44f' : '#c9ccd1'};display:inline-block;flex:none` })),
          el('div', { style: 'font-size:26px;font-weight:700;font-variant-numeric:tabular-nums', text: timeIn(date, zone) }),
          el('div', { class: 'note', style: 'margin:0' }, dateIn(date, zone), badge ? el('span', { class: 'badge', style: 'margin-left:6px', text: badge }) : null)));
      }
    };
    const stop = () => { if (timer) { clearInterval(timer); timer = null; } };
    const startLive = () => { stop(); render(); timer = setInterval(render, 1000); };
    liveInput.addEventListener('change', () => { live = liveInput.checked; if (live) startLive(); else { stop(); render(); } });
    sliderInput.addEventListener('input', () => {
      minutes = Number(sliderInput.value); sliderOut.textContent = hhmm(minutes);
      live = false; liveInput.checked = false; stop(); render();
    });
    root.append(
      el('div', { class: 'controls' },
        el('label', { class: 'check' }, liveInput, L('clockLive', 'Live — update every second')),
        field(L('clockPlan', 'Planned time (your local time)'), el('span', { class: 'check' }, sliderInput, sliderOut), L('clockPlanHint', 'drag to line up a meeting'))),
      el('div', { class: 'btn-row' }, button(L('clockNow', 'Back to now'), () => { live = true; liveInput.checked = true; startLive(); }, { kind: 'ghost' })),
      cards,
      note(fmt(L('clockBaseNote', 'Times are shown against your own time zone ({0}). A green dot marks 09:00–18:00 local business hours; the badge shows when a city is on a different calendar day.'), localZone)));
    startLive();
  },

  // ------------------------------------------------------------ pomodoro-timer
  'pomodoro-timer': async (root) => {
    let workMin = 25, shortMin = 5, longMin = 15, cycles = 4;
    let phase = 'work', remaining = workMin * 60, running = false, endAt = 0, timer = null, done = 0, sound = true, audio = null;
    const phaseLabel = el('div', { style: 'text-align:center;font-size:18px;font-weight:600;margin-bottom:6px' });
    const display = el('div', { style: 'font-size:60px;font-weight:800;font-variant-numeric:tabular-nums;text-align:center;line-height:1.1' });
    const barFill = el('div', { style: 'height:100%;width:0;background:#2f6fed' });
    const countLabel = el('div', { class: 'note', style: 'text-align:center;margin:8px 0 0' });
    const stage = el('div', { class: 'result-card', style: 'padding:24px' },
      phaseLabel, display, el('div', { style: 'height:8px;background:var(--line);border-radius:4px;overflow:hidden;margin:12px 0' }, barFill), countLabel);
    const startBtn = button(L('pomoStart', 'Start'), () => toggle());
    const phaseSeconds = () => (phase === 'work' ? workMin : phase === 'short' ? shortMin : longMin) * 60;
    const phaseName = () => phase === 'work' ? L('pomoFocus', 'Focus') : phase === 'short' ? L('pomoShortBreak', 'Short break') : L('pomoLongBreak', 'Long break');
    const paint = () => {
      const rem = Math.max(0, remaining), total = phaseSeconds();
      display.textContent = `${pad2(Math.floor(rem / 60))}:${pad2(Math.floor(rem % 60))}`;
      phaseLabel.textContent = phaseName();
      barFill.style.width = `${total ? (1 - rem / total) * 100 : 0}%`;
      countLabel.textContent = fmt(L('pomoCount', 'Completed focus sessions: {0}'), done);
    };
    const ensureAudio = () => { try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); if (audio.state === 'suspended') audio.resume(); } catch { /* no audio — the visual change still happens */ } };
    const chime = () => {
      if (!sound || !audio) return;
      try {
        const o = audio.createOscillator(), g = audio.createGain();
        o.connect(g); g.connect(audio.destination);
        o.type = 'sine'; o.frequency.value = 880;
        g.gain.setValueAtTime(0.0001, audio.currentTime);
        g.gain.exponentialRampToValueAtTime(0.3, audio.currentTime + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.6);
        o.start(); o.stop(audio.currentTime + 0.62);
      } catch { /* ignore */ }
    };
    const stop = () => { if (timer) { clearInterval(timer); timer = null; } };
    const advance = () => {
      chime();
      if (phase === 'work') { done++; phase = (done % cycles === 0) ? 'long' : 'short'; }
      else phase = 'work';
      remaining = phaseSeconds();
      endAt = Date.now() + remaining * 1000;
    };
    const tick = () => {
      if (!stage.isConnected) { stop(); return; }
      remaining = Math.round((endAt - Date.now()) / 1000);
      if (remaining <= 0) advance();
      paint();
    };
    const start = () => { ensureAudio(); running = true; endAt = Date.now() + remaining * 1000; stop(); timer = setInterval(tick, 250); startBtn.textContent = L('pomoPause', 'Pause'); };
    const pause = () => { running = false; stop(); remaining = Math.max(0, Math.round((endAt - Date.now()) / 1000)); startBtn.textContent = L('pomoResume', 'Resume'); };
    const toggle = () => { if (running) pause(); else start(); };
    const reset = () => { stop(); running = false; phase = 'work'; done = 0; remaining = workMin * 60; startBtn.textContent = L('pomoStart', 'Start'); paint(); };
    const setting = (value, set) => numberInput(value, v => { set(clamp(Math.round(Number(v)) || 1, 1, 180)); if (!running) { remaining = phaseSeconds(); paint(); } }, { min: 1, max: 180, step: 1 });
    const workIn = setting(25, v => { workMin = v; });
    const shortIn = setting(5, v => { shortMin = v; });
    const longIn = setting(15, v => { longMin = v; });
    const cyclesIn = numberInput(4, v => { cycles = clamp(Math.round(Number(v)) || 1, 1, 12); }, { min: 1, max: 12, step: 1 });
    const soundInput = el('input', { type: 'checkbox', checked: true });
    soundInput.addEventListener('change', () => { sound = soundInput.checked; });
    const fsBtn = button(L('pomoFullscreen', 'Fullscreen'), () => {
      if (stage.requestFullscreen) stage.requestFullscreen().catch(() => toast(L('pomoNoFullscreen', 'Fullscreen is not available in this browser.')));
      else toast(L('pomoNoFullscreen', 'Fullscreen is not available in this browser.'));
    }, { kind: 'ghost' });
    root.append(
      el('div', { class: 'controls' },
        field(L('pomoWorkMin', 'Focus (minutes)'), workIn, ''),
        field(L('pomoShortMin', 'Short break (minutes)'), shortIn, ''),
        field(L('pomoLongMin', 'Long break (minutes)'), longIn, ''),
        field(L('pomoCycles', 'Focus sessions before a long break'), cyclesIn, ''),
        el('label', { class: 'check' }, soundInput, L('pomoSound', 'Chime when a phase ends'))),
      stage,
      el('div', { class: 'btn-row' }, startBtn, button(L('pomoReset', 'Reset'), reset, { kind: 'ghost' }), fsBtn),
      note(L('pomoNote', 'The Pomodoro technique alternates a stretch of focused work with a short break, and a longer break after a few rounds. Adjust the lengths to suit you; the timer keeps counting while this tab is open.')));
    paint();
  },

  // ------------------------------------------------------------ random-picker
  'random-picker': async (root) => {
    const DEFAULTS = () => L('pickerDefaultNames', 'Alice\nBob\nCarlos\nDiana\nEmil\nFatima');
    const input = el('textarea', { spellcheck: 'false', style: 'min-height:130px' });
    input.setAttribute('placeholder', L('pickerPlaceholder', 'One name per line'));
    input.value = DEFAULTS();
    const canvas = el('canvas', { width: 360, height: 360, style: 'width:100%;max-width:360px;height:auto;display:block;margin:0 auto' });
    const ctx = canvas.getContext('2d');
    const winnerBox = el('div', { class: 'out' });
    const COLORS = ['#2f6fed', '#e0662a', '#2ea44f', '#b056d6', '#e0b62a', '#1aa3b0', '#d6455f', '#6b7280'];
    let angle = 0, spinning = false;
    const parseNames = () => input.value.split('\n').map(s => s.trim()).filter(Boolean);
    const randIndex = n => { const b = new Uint32Array(1); crypto.getRandomValues(b); return b[0] % n; };
    const drawWheel = names => {
      const c = canvas.width / 2, r = c - 10, n = names.length;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (!n) return;
      const seg = Math.PI * 2 / n;
      for (let k = 0; k < n; k++) {
        const a0 = angle + k * seg;
        ctx.beginPath(); ctx.moveTo(c, c); ctx.arc(c, c, r, a0, a0 + seg); ctx.closePath();
        ctx.fillStyle = COLORS[k % COLORS.length]; ctx.fill();
        ctx.save(); ctx.translate(c, c); ctx.rotate(a0 + seg / 2);
        ctx.fillStyle = '#fff'; ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
        ctx.fillText(names[k].length > 14 ? names[k].slice(0, 13) + '…' : names[k], r - 12, 0);
        ctx.restore();
      }
      ctx.beginPath(); ctx.arc(c, c, 16, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
      ctx.beginPath(); ctx.moveTo(c, 4); ctx.lineTo(c - 11, 26); ctx.lineTo(c + 11, 26); ctx.closePath(); ctx.fillStyle = '#111'; ctx.fill();
    };
    const redraw = () => drawWheel(parseNames());
    const showWinner = name => {
      fill(winnerBox,
        stat(L('pickerWinner', 'Winner'), name, ''),
        el('div', { class: 'btn-row' },
          button(L('pickerRemove', 'Remove winner'), () => {
            const names = parseNames();
            const at = names.indexOf(name);
            if (at >= 0) names.splice(at, 1);
            input.value = names.join('\n');
            redraw();
            fill(winnerBox, note(fmt(L('pickerRemaining', '{0} names left in the wheel.'), names.length)));
          }, { kind: 'ghost' }),
          button(L('pickerAgain', 'Spin again'), () => spin(), { kind: 'ghost' })));
    };
    const spin = () => {
      const names = parseNames();
      if (names.length < 2) { toast(L('pickerNeedTwo', 'Add at least two names to spin the wheel.')); return; }
      if (spinning) return;
      spinning = true;
      const w = randIndex(names.length);
      const seg = Math.PI * 2 / names.length;
      const base = angle;
      const desired = -Math.PI / 2 - (w * seg + seg / 2);
      const delta = (((desired - base) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) + Math.PI * 2 * 5;
      const dur = 3200;
      let t0 = null;
      const ease = x => 1 - Math.pow(1 - x, 3);
      const frame = now => {
        if (!canvas.isConnected) { spinning = false; return; }
        if (t0 === null) t0 = now;
        const p = Math.min(1, (now - t0) / dur);
        angle = base + delta * ease(p);
        drawWheel(names);
        if (p < 1) requestAnimationFrame(frame);
        else { spinning = false; angle = (base + delta) % (Math.PI * 2); drawWheel(names); showWinner(names[w]); }
      };
      requestAnimationFrame(frame);
    };
    const quickDraw = () => {
      const names = parseNames();
      if (!names.length) { toast(L('pickerNeedOne', 'Add at least one name.')); return; }
      showWinner(names[randIndex(names.length)]);
    };
    input.addEventListener('input', redraw);
    root.append(
      el('div', { class: 'controls' }, field(L('pickerNames', 'Names'), input, L('pickerNamesHint', 'one per line'))),
      canvas,
      el('div', { class: 'btn-row' },
        button(L('pickerSpin', 'Spin the wheel'), () => spin()),
        button(L('pickerDraw', 'Quick draw'), quickDraw, { kind: 'ghost' }),
        button(L('pickerReset', 'Reset names'), () => { input.value = DEFAULTS(); redraw(); fill(winnerBox); }, { kind: 'ghost' })),
      winnerBox,
      note(L('pickerNote', 'Picks use crypto.getRandomValues(), so every name has an equal chance. Remove the winner after each draw to pick a whole team in order, or reset to start again.')));
    redraw();
  }
};
