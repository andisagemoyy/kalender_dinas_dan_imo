'use strict';

const DUTY_PLAN_KEY = 'dinesan.andisa.dates.v1';
const DUTY_SHIFTS = ['PAGI', 'SIANG', 'MALAM', 'LIBUR'];
const DUTY_WORK_SHIFTS = DUTY_SHIFTS.filter(shift => shift !== 'LIBUR');
const validDutyTime = value => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
const cleanDutyNote = value => typeof value === 'string' ? value.slice(0, 200) : '';
const dutyPlans = new Map();
let dutyEditorDate = '';

try {
  const saved = JSON.parse(localStorage.getItem(DUTY_PLAN_KEY) || '{}');
  if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
    for (const [date, value] of Object.entries(saved)) {
      if (!parseDate(date) || !value || typeof value !== 'object') continue;
      dutyPlans.set(date, {
        mainShift: DUTY_SHIFTS.includes(value.mainShift) ? value.mainShift : '',
        mainTime: validDutyTime(value.mainTime) ? value.mainTime : '',
        note: cleanDutyNote(value.note),
        modifiedAt: Number.isFinite(value.modifiedAt) ? value.modifiedAt : 0,
        extras: Array.isArray(value.extras) ? value.extras.filter(extra => extra && DUTY_WORK_SHIFTS.includes(extra.shift)).map((extra, index) => ({
          id: typeof extra.id === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(extra.id) ? extra.id : `restored-${index}`,
          shift: extra.shift, time: validDutyTime(extra.time) ? extra.time : '', note: cleanDutyNote(extra.note)
        })) : []
      });
    }
  }
} catch { /* Existing browser data stays untouched if reading is unavailable. */ }

function dutyDayPlan(date) {
  const base = dutyForDate(date); if (!base) return null;
  const saved = dutyPlans.get(date), shift = saved?.mainShift || base.shift;
  return {
    date, base,
    main: { shift, label: saved?.mainShift ? `${DUTY_NAMES[shift]} (diubah)` : base.label, time: saved?.mainTime || '' },
    note: saved?.note || '', extras: saved?.extras || [], modifiedAt: saved?.modifiedAt || 0
  };
}

function renderExtraDutyRows(extras) {
  const container = $('dutyEditorExtras'); container.replaceChildren();
  for (const extra of extras) addExtraDutyRow(extra);
}

function addExtraDutyRow(extra = {}) {
  const row = document.createElement('div'); row.className = 'duty-extra-row';
  row.dataset.id = extra.id || globalThis.crypto?.randomUUID?.() || `extra-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  row.innerHTML = '<label>Dinas tambahan<select class="extra-shift"><option value="PAGI">PAGI</option><option value="SIANG">SIANG</option><option value="MALAM">MALAM</option></select></label><label>IJK (WIB)<input class="extra-time" type="time"></label><label class="extra-note-label">Catatan / rekan yang ditutupi<input class="extra-note" type="text" maxlength="200" placeholder="Contoh: menutupi Pak ..."></label><button class="extra-delete text-button" type="button">Hapus tambahan</button>';
  row.querySelector('.extra-shift').value = DUTY_WORK_SHIFTS.includes(extra.shift) ? extra.shift : 'PAGI';
  row.querySelector('.extra-time').value = extra.time || '';
  row.querySelector('.extra-note').value = extra.note || '';
  row.querySelector('.extra-delete').addEventListener('click', () => row.remove());
  container.append(row);
}

function syncDutyEditorTime() {
  const choice = $('dutyEditorMainShift').value;
  $('dutyEditorMainTime').disabled = (choice === 'AUTO' ? dutyForDate(dutyEditorDate)?.shift : choice) === 'LIBUR';
}

function openDutyEditor(date) {
  const plan = dutyDayPlan(date); if (!plan) return;
  dutyEditorDate = date;
  const saved = dutyPlans.get(date);
  $('dutyEditorTitle').textContent = dateText(parseDate(date));
  $('dutyEditorBase').textContent = `Jadwal pola 8 hari: ${plan.base.label}`;
  $('dutyEditorMainShift').value = saved?.mainShift || 'AUTO';
  $('dutyEditorMainTime').value = saved?.mainTime || '';
  $('dutyEditorNote').value = saved?.note || '';
  $('dutyEditorMessage').textContent = '';
  renderExtraDutyRows(saved?.extras || []); syncDutyEditorTime();
  $('dutyEditorDialog').showModal();
}

function refreshDutyPlanner() {
  refreshDutyReminders(); renderDutySearchResult(); renderDutyCalendar();
  const record = monthState.records.find(row => row.date === dutyEditorDate);
  if (record) {
    if (record.shiftSource === 'auto' && record.shift !== dutyDayPlan(record.date).main.shift) monthShiftChange(record, 'AUTO');
    else updateMonthCard(record);
  }
}

$('addExtraDuty').addEventListener('click', () => addExtraDutyRow());
$('closeDutyEditor').addEventListener('click', () => $('dutyEditorDialog').close());
$('dutyEditorMainShift').addEventListener('change', syncDutyEditorTime);
$('resetDutyDate').addEventListener('click', () => {
  $('dutyEditorMainShift').value = 'AUTO'; $('dutyEditorMainTime').value = ''; $('dutyEditorNote').value = '';
  renderExtraDutyRows([]); syncDutyEditorTime();
  $('dutyEditorMessage').textContent = 'Tekan Simpan dinas untuk mengembalikan tanggal ini ke pola dan menghapus dinas tambahannya.';
});
$('openDutyPhoto').addEventListener('click', () => {
  $('dutyEditorDialog').close(); $('dutyPhotoSection').open = true;
  const card = monthState.cards.get(dutyEditorDate);
  if (card) { card.scrollIntoView({ behavior: 'smooth', block: 'start' }); card.focus({ preventScroll: true }); }
});
$('dutyEditorForm').addEventListener('submit', event => {
  event.preventDefault();
  if (!dutyForDate(dutyEditorDate) || monthState.importing || monthState.exporting) return;
  const choice = $('dutyEditorMainShift').value;
  const record = {
    mainShift: choice === 'AUTO' ? '' : choice,
    mainTime: $('dutyEditorMainTime').disabled ? '' : $('dutyEditorMainTime').value,
    note: $('dutyEditorNote').value.trim().slice(0, 200), modifiedAt: Date.now(),
    extras: [...$('dutyEditorExtras').querySelectorAll('.duty-extra-row')].map(row => ({
      id: row.dataset.id, shift: row.querySelector('.extra-shift').value,
      time: row.querySelector('.extra-time').value, note: row.querySelector('.extra-note').value.trim().slice(0, 200)
    }))
  };
  const updated = new Map(dutyPlans);
  if (record.mainShift || record.mainTime || record.note || record.extras.length) updated.set(dutyEditorDate, record);
  else updated.delete(dutyEditorDate);
  try { localStorage.setItem(DUTY_PLAN_KEY, JSON.stringify(Object.fromEntries(updated))); }
  catch {
    $('dutyEditorMessage').textContent = 'Belum tersimpan. Penyimpanan perangkat tidak tersedia atau penuh; biarkan formulir ini terbuka dan coba lagi.';
    return;
  }
  dutyPlans.clear(); updated.forEach((value, key) => dutyPlans.set(key, value));
  refreshDutyPlanner();
  monthNotice('Dinas tersimpan. Pola tanggal lain tetap mengikuti siklus 8 hari.');
  $('dutyEditorDialog').close();
  if (typeof checkDutyNotifications === 'function') checkDutyNotifications();
});
