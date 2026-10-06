'use strict';

// One eight-day cycle. Dates identify the start date of each duty,
// so the first night shift starts on 6 October, even if it ends on the 7th.
const DUTY_ANCHOR = '2026-10-06';
const DUTY_CYCLE = Object.freeze(['MALAM', 'MALAM', 'SIANG', 'SIANG', 'PAGI', 'PAGI', 'LIBUR', 'LIBUR']);
const DUTY_NAMES = Object.freeze({ MALAM: 'Malam', SIANG: 'Siang', PAGI: 'Pagi', LIBUR: 'Libur' });

function dutyForDate(value) {
  const date = parseDate(value);
  if (!date) return null;
  const elapsed = Math.round((date.getTime() - parseDate(DUTY_ANCHOR).getTime()) / 86400000);
  // JS remainder is negative before the anchor; normalize it to 0..7.
  const index = ((elapsed % DUTY_CYCLE.length) + DUTY_CYCLE.length) % DUTY_CYCLE.length;
  const shift = DUTY_CYCLE[index], occurrence = index % 2 + 1;
  return { date: value, index, shift, occurrence, label: `${DUTY_NAMES[shift]} ke-${occurrence}` };
}

function offsetDutyDate(value, days) {
  const date = parseDate(value);
  if (!date || !Number.isInteger(days)) return null;
  date.setUTCDate(date.getUTCDate() + days);
  const result = `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
  return parseDate(result) ? result : null;
}
