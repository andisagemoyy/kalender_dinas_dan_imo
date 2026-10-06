'use strict';

const DUTY_REMINDER_KEY = 'dinesan.andisa.reminders.v1';
const DUTY_SENT_KEY = 'dinesan.andisa.reminders.sent.v1';
const reminderSettings = { enabled: false, lead: 180, times: { PAGI: '07:00', SIANG: '15:00', MALAM: '22:00' } };
let reminderBusy = false;
try {
  const saved = JSON.parse(localStorage.getItem(DUTY_REMINDER_KEY) || 'null');
  if (saved) {
    reminderSettings.enabled = saved.enabled === true;
    reminderSettings.lead = 180;
    // Standard IJK remains fixed; per-date times belong to the date editor.
  }
} catch {}

let dutyWorker = null;
if (globalThis.isSecureContext && 'serviceWorker' in navigator && location.protocol !== 'file:') {
  dutyWorker = navigator.serviceWorker.register('./sw.js').catch(() => null);
}

function reminderNotice(text) { $('reminderStatus').textContent = text; }
function syncReminderSettings() {
  for (const shift of DUTY_WORK_SHIFTS) $(`reminderTime${DUTY_NAMES[shift]}`).value = reminderSettings.times[shift];
  $('reminderLead').value = String(reminderSettings.lead);
  $('enableDutyNotifications').textContent = reminderSettings.enabled ? 'Matikan notifikasi web' : 'Aktifkan notifikasi web';
  $('testDutyNotification').disabled = !('Notification' in globalThis) || Notification.permission !== 'granted';
}
function saveReminderSettings() {
  const next = { ...reminderSettings, lead: 180, times: {} };
  for (const shift of DUTY_WORK_SHIFTS) next.times[shift] = { PAGI: '07:00', SIANG: '15:00', MALAM: '22:00' }[shift];
  try { localStorage.setItem(DUTY_REMINDER_KEY, JSON.stringify(next)); }
  catch { reminderNotice('Pengaturan belum tersimpan. Periksa penyimpanan browser.'); return false; }
  Object.assign(reminderSettings, next); return true;
}

// Notification time is based on actual duty start times entered by the user,
// not the random times painted onto photographs. All times are WIB (UTC+7).
function dutyEventsForDate(date) {
  const plan = dutyDayPlan(date); if (!plan) return [];
  const events = [];
  if (plan.main.shift !== 'LIBUR') events.push({ id: 'main', date, shift: plan.main.shift, label: plan.main.label, time: plan.main.time || reminderSettings.times[plan.main.shift], note: plan.note, modifiedAt: plan.modifiedAt });
  for (const extra of plan.extras) events.push({ id: extra.id, date, shift: extra.shift, label: `${DUTY_NAMES[extra.shift]} · Dinas tambahan`, time: extra.time || reminderSettings.times[extra.shift], note: extra.note, modifiedAt: plan.modifiedAt });
  return events;
}
function dutyEventStart(event) { return validDutyTime(event.time) ? Date.parse(`${event.date}T${event.time}:00+07:00`) : null; }

async function showDutyNotification(title, body, date, tag) {
  if (!('Notification' in globalThis) || Notification.permission !== 'granted') throw new Error('Izin notifikasi belum diberikan.');
  const registration = dutyWorker ? await dutyWorker : null;
  if (registration) {
    const worker = registration.active || registration.installing || registration.waiting;
    if (worker && worker.state !== 'activated') await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Notifikasi belum siap. Coba kembali.')), 5000);
      worker.addEventListener('statechange', () => { if (worker.state === 'activated') { clearTimeout(timeout); resolve(); } });
    });
    await registration.showNotification(title, { body, tag, icon: './icons/kai-icon-192.png', data: { date } });
    return;
  }
  const notification = new Notification(title, { body, tag, icon: './icons/kai-icon-192.png' });
  notification.onclick = () => { window.focus(); if (date) selectDutyDate(date); notification.close(); };
}

async function checkDutyNotifications() {
  if (!reminderSettings.enabled || reminderBusy || !('Notification' in globalThis) || Notification.permission !== 'granted') return;
  reminderBusy = true;
  try {
    let sent = {};
    try { sent = JSON.parse(localStorage.getItem(DUTY_SENT_KEY) || '{}') || {}; } catch {}
    const now = Date.now(), today = jakartaToday();
    const dates = [offsetDutyDate(today, -1), today, offsetDutyDate(today, 1)];
    for (const date of dates.filter(Boolean)) for (const event of dutyEventsForDate(date)) {
      const start = dutyEventStart(event); if (start === null) continue;
      const due = start - reminderSettings.lead * 60000;
      const key = `${date}:${event.id}:${event.shift}:${event.time}:${reminderSettings.lead}:${event.modifiedAt}`;
      if (now < due || now - due > 5 * 60000 || sent[key]) continue;
      await showDutyNotification('Pengingat Dinesan Andisa', `${event.label} · ${event.date} pukul ${event.time} WIB${event.note ? ' · ' + event.note : ''}`, date, `duty-${date}-${event.id}`);
      sent[key] = now;
    }
    for (const [key, time] of Object.entries(sent)) if (!Number.isFinite(time) || now - time > 10 * 86400000) delete sent[key];
    try { localStorage.setItem(DUTY_SENT_KEY, JSON.stringify(sent)); } catch {}
  } catch (error) { reminderNotice(error.message || 'Notifikasi belum dapat ditampilkan.'); }
  finally { reminderBusy = false; }
}

function icsText(value) { return String(value || '').replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,'); }
function icsUtc(milliseconds) { return new Date(milliseconds).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z'); }
function foldIcsLine(line) {
  let output = '', current = '', bytes = 0;
  for (const char of line) {
    const size = new TextEncoder().encode(char).length;
    if (bytes + size > 75) { output += current + '\r\n'; current = ' '; bytes = 1; }
    current += char; bytes += size;
  }
  return output + current;
}
function createDutyIcs(dates) {
  const now = icsUtc(Date.now()), lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Dinesan Andisa//Kalender Dinas//ID', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Dinesan Andisa'];
  let alarms = 0, withoutTime = 0;
  for (const date of dates) {
    const plan = dutyDayPlan(date), events = dutyEventsForDate(date);
    if (plan.main.shift === 'LIBUR') events.unshift({ id: 'main', date, shift: 'LIBUR', label: plan.main.label, time: '', note: plan.note, modifiedAt: plan.modifiedAt });
    for (const event of events) {
      const start = dutyEventStart(event);
      lines.push('BEGIN:VEVENT', `UID:${date}-${event.id}@dinesan-andisa.local`, `DTSTAMP:${now}`, `SEQUENCE:${Math.floor(event.modifiedAt / 1000)}`);
      lines.push(start === null ? `DTSTART;VALUE=DATE:${date.replaceAll('-', '')}` : `DTSTART:${icsUtc(start)}`);
      lines.push(`SUMMARY:${icsText('Dinas ' + event.label)}`, `DESCRIPTION:${icsText(`Pola asli: ${plan.base.label}. ${event.note || ''}${start === null && event.shift !== 'LIBUR' ? ' Jam mulai belum diisi; belum ada alarm.' : ' Waktu dalam WIB.'}`)}`);
      if (start !== null) {
        lines.push('BEGIN:VALARM', `TRIGGER:-PT${reminderSettings.lead}M`, 'ACTION:DISPLAY', `DESCRIPTION:${icsText('Pengingat dinas ' + event.label)}`, 'END:VALARM'); alarms++;
      } else if (event.shift !== 'LIBUR') withoutTime++;
      lines.push('END:VEVENT');
    }
  }
  lines.push('END:VCALENDAR');
  return { text: lines.map(foldIcsLine).join('\r\n') + '\r\n', alarms, withoutTime };
}

$('saveReminderSettings').addEventListener('click', () => {
  if (saveReminderSettings()) { reminderNotice('Pengingat tersimpan: Pagi 04.00, Siang 12.00, Malam 19.00 WIB.'); checkDutyNotifications(); }
});
$('enableDutyNotifications').addEventListener('click', async () => {
  if (reminderSettings.enabled) {
    const previous = reminderSettings.enabled; reminderSettings.enabled = false;
    if (!saveReminderSettings()) reminderSettings.enabled = previous;
    else reminderNotice('Notifikasi web dimatikan.');
    syncReminderSettings(); return;
  }
  if (!globalThis.isSecureContext || !('Notification' in globalThis)) {
    reminderNotice('Notifikasi tidak tersedia di tampilan ini. Buka melalui HTTPS; di iPhone tambahkan ke Layar Utama dan buka dari sana, atau gunakan Kalender HP (.ics).'); return;
  }
  try {
    // Request immediately in this click handler, preserving the user gesture.
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') { reminderNotice('Izin notifikasi belum diberikan. Kamu tetap dapat memakai pengingat Kalender HP (.ics).'); return; }
    reminderSettings.enabled = true;
    if (!saveReminderSettings()) reminderSettings.enabled = false;
    else { reminderNotice('Notifikasi web aktif untuk dinas yang jamnya sudah diisi, selama halaman aktif.'); checkDutyNotifications(); }
    syncReminderSettings();
  } catch { reminderNotice('Izin notifikasi belum tersedia. Coba dari aplikasi di Layar Utama atau gunakan Kalender HP (.ics).'); }
});
$('testDutyNotification').addEventListener('click', async () => {
  try { await showDutyNotification('Tes pengingat Dinesan Andisa', 'Pengingat berhasil ditampilkan. Jadwal terjadwal memakai jam dinas yang kamu isi.', jakartaToday(), 'duty-test'); reminderNotice('Tes notifikasi dikirim.'); }
  catch (error) { reminderNotice(error.message || 'Tes notifikasi belum berhasil.'); }
});
$('exportDutyCalendar').addEventListener('click', () => {
  if (!saveReminderSettings()) return;
  const result = createDutyIcs(monthDates(monthState.month));
  const url = URL.createObjectURL(new Blob([result.text], { type: 'text/calendar;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = `DINESAN_ANDISA_${monthState.month}.ics`; document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  reminderNotice(`File kalender bulan ${monthState.month} diunduh: ${result.alarms} dinas memiliki alarm.${result.withoutTime ? ` ${result.withoutTime} dinas belum memiliki jam; isi jamnya untuk menambahkan alarm.` : ''} Impor ke Kalender HP dan periksa pengaturan notifikasinya.`);
});
if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', event => {
  if (event.data?.type === 'open-duty-date' && dutyForDate(event.data.date)) selectDutyDate(event.data.date);
});
const linkedDutyDate = new URL(location.href).searchParams.get('tanggal');
if (dutyForDate(linkedDutyDate)) {
  const openLinked = () => { if (monthState.loading) setTimeout(openLinked, 100); else selectDutyDate(linkedDutyDate); };
  openLinked();
}
syncReminderSettings();
reminderNotice(reminderSettings.enabled ? 'Notifikasi web aktif saat halaman aktif. Periksa jam dinas dan izin notifikasi perangkat.' : 'Pengingat 3 jam sebelum IJK: Pagi 04.00, Siang 12.00, Malam 19.00 WIB.');
setInterval(checkDutyNotifications, 30000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkDutyNotifications(); });
checkDutyNotifications();
