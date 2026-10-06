'use strict';

const monthState = { month: '', records: [], cards: new Map(), thumbnailUrls: new Map(), loading: false, importing: false, exporting: false, cancel: false, loadToken: 0, previewToken: 0, previewRecord: null, previewImage: null, downloadUrls: new Set() };
const monthPending = new Map();
let monthSaveTimer = null;
let monthSavePromise = null;
const monthSaveStatus = new Map();
const monthDatabase = openMonthDatabase();

function monthDates(value) {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match || Number(match[1]) < 1900 || Number(match[1]) > 9999 || Number(match[2]) < 1 || Number(match[2]) > 12) return [];
  const count = new Date(Date.UTC(Number(match[1]), Number(match[2]), 0)).getUTCDate();
  return Array.from({ length: count }, (_, i) => `${value}-${pad(i + 1)}`);
}
function monthRandomTime(date, shift) { return shift === 'LIBUR' ? LEAVE_TIME : timeText(timestampFor(date, shift, randomInt(SHIFT_WINDOWS[shift][1]))); }
function variedLocation(previous = PROFILE.location) {
  const original = PROFILE.location.split(', ');
  // Choose a different pair without retry loops.
  const oldPair = Number(previous.split(', ').map(part => part.slice(-1)).join(''));
  const pair = (oldPair + 1 + randomInt(99)) % 100;
  return `${original[0].slice(0, -1)}${Math.floor(pair / 10)}, ${original[1].slice(0, -1)}${pair % 10}`;
}
function emptyMonthRecord(date) {
  const shift = dutyDayPlan(date).main.shift;
  return { date, month: date.slice(0, 7), shift, shiftSource: 'auto', time: monthRandomTime(date, shift), timeMode: shift === 'LIBUR' ? 'fixed' : 'random', location: PROFILE.location, oldStamp: false, coverPercent: 20, addLogo: true, photo: null, thumbnail: null, filename: '' };
}
function recordIncluded(record) { return Boolean(record && (record.shift === 'LIBUR' || record.photo)); }
function recordReady(record) { return Boolean(record && manualTimestamp(record.date, record.time) && (record.shift === 'LIBUR' ? leaveImage.naturalWidth : record.photo && SHIFT_WINDOWS[record.shift])); }
function monthNotice(text, error = false) { $('monthMessage').textContent = text; $('monthMessage').classList.toggle('error', error); }
function openMonthDatabase() {
  return new Promise(resolve => {
    if (!globalThis.indexedDB) { resolve(null); return; }
    try {
      const request = indexedDB.open('imocam.monthly.v1', 2);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos', { keyPath: 'date' }).createIndex('month', 'month');
        if (!db.objectStoreNames.contains('single')) db.createObjectStore('single', { keyPath: 'id' });
      };
      request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
}
async function loadMonthDraft(value) {
  const db = await monthDatabase;
  if (!db) return [];
  return new Promise(resolve => {
    try {
      const tx = db.transaction('photos', 'readonly');
      const request = tx.objectStore('photos').index('month').getAll(value);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve([]);
    } catch { resolve([]); }
  });
}
function scheduleMonthSave(record) {
  monthPending.set(record.date, { ...record });
  monthSaveStatus.set(record.date, 'pending');
  $('draftStatus').textContent = 'Menyimpan draf…';
  clearTimeout(monthSaveTimer);
  monthSaveTimer = setTimeout(flushMonthSaves, 0);
}
async function flushMonthSaves() {
  clearTimeout(monthSaveTimer);
  if (monthSavePromise) { const saved = await monthSavePromise; return saved && monthPending.size ? flushMonthSaves() : saved; }
  if (!monthPending.size) return true;
  const pending = [...monthPending.values()]; monthPending.clear();
  monthSavePromise = (async () => {
    const db = await monthDatabase;
    if (!db) return false;
    return new Promise(resolve => {
    try {
      const tx = db.transaction('photos', 'readwrite');
      pending.forEach(record => tx.objectStore('photos').put(record));
      tx.oncomplete = () => resolve(true);
      tx.onerror = tx.onabort = () => resolve(false);
    } catch { resolve(false); }
    });
  })();
  const saved = await monthSavePromise; monthSavePromise = null;
  pending.forEach(record => {
    if (!saved && !monthPending.has(record.date)) monthPending.set(record.date, record);
    monthSaveStatus.set(record.date, saved ? (monthPending.has(record.date) ? 'pending' : 'saved') : 'failed');
    const current = monthState.records.find(row => row.date === record.date); if (current) updateMonthCard(current);
  });
  $('draftStatus').textContent = saved ? (monthPending.size ? 'Menyimpan draf…' : 'Draf tersimpan di perangkat') : 'Draf gagal disimpan; sesi ini tetap bisa diunduh';
  return saved && monthPending.size ? flushMonthSaves() : saved;
}
function syncMonthOfficer() {
  $('monthlyOfficerName').textContent = officer.name || 'Isi nama petugas';
  $('monthlyOfficerNipp').textContent = `NIPP ${officer.nipp || '—'}`;
  $('cameraOfficerName').textContent = officer.name || 'Isi nama petugas';
  updateMonthSummary();
  if (monthState.previewRecord && monthState.previewImage) renderMonthPreview();
}
function updateMonthSummary() {
  const loaded = monthState.records.filter(recordIncluded);
  const ready = loaded.filter(recordReady);
  const leaves = loaded.filter(record => record.shift === 'LIBUR').length;
  $('monthSummary').textContent = `${loaded.length - leaves} foto · ${leaves} libur · ${ready.length} siap`;
  $('monthEmptySummary').textContent = `${monthState.records.length - loaded.length} tanggal belum diisi`;
  $('monthCompletion').max = monthState.records.length || 31; $('monthCompletion').value = ready.length;
  $('exportMonth').disabled = monthState.loading || monthState.importing || monthState.exporting || !loaded.length || ready.length !== loaded.length || !validOfficer(officer) || !logo.naturalWidth;
  $('exportMonth').textContent = monthState.exporting ? 'Memproses rekap…' : `Unduh ${ready.length || 'semua'} hasil ZIP ↓`;
}
function setMonthImporting(value) {
  monthState.importing = value;
  ['monthPicker', 'bulkPhotos', 'applyDefaultShift'].forEach(id => $(id).disabled = value || monthState.exporting || monthState.loading);
  monthState.cards.forEach((card, date) => {
    const leave = monthState.records.find(record => record.date === date)?.shift === 'LIBUR';
    card.querySelector('input[type=file]').disabled = value || monthState.loading || monthState.exporting || leave;
    card.querySelector('.day-camera').disabled = value || monthState.loading || monthState.exporting || leave;
  });
  updateMonthSummary();
}
function updateMonthRecord(record, patch) {
  const oldShift = record.shift;
  Object.assign(record, patch);
  scheduleMonthSave(record);
  updateMonthCard(record);
  updateMonthSummary();
  if (monthState.previewRecord === record) { syncPreviewControls(); if (oldShift !== record.shift) reloadMonthPreviewSource(record); else renderMonthPreview(); }
}
function monthShiftChange(record, choice) {
  const shift = choice === 'AUTO' ? dutyDayPlan(record.date).main.shift : choice;
  if (!SHIFT_WINDOWS[shift] && shift !== 'LIBUR') return;
  const shiftSource = choice === 'AUTO' ? 'auto' : 'manual';
  if (record.shift === shift) { updateMonthRecord(record, { shiftSource }); return; }
  if (shift === 'LIBUR') {
    updateMonthRecord(record, { shift, shiftSource, ...(record.shift !== 'LIBUR' ? { workTime: record.time, workTimeMode: record.timeMode } : {}), time: LEAVE_TIME, timeMode: 'fixed' });
  } else {
    const mode = record.shift === 'LIBUR' ? record.workTimeMode || 'random' : record.timeMode;
    const time = mode === 'manual' ? (record.shift === 'LIBUR' ? record.workTime : record.time) : monthRandomTime(record.date, shift);
    updateMonthRecord(record, { shift, shiftSource, timeMode: mode, time: manualTimestamp(record.date, time) ? time : monthRandomTime(record.date, shift) });
  }
}
function randomizeMonthRecord(record) { if (record.shift !== 'LIBUR') updateMonthRecord(record, { time: monthRandomTime(record.date, record.shift), timeMode: 'random' }); }
function updateMonthCard(record) {
  const card = monthState.cards.get(record.date); if (!card) return;
  const leave = record.shift === 'LIBUR';
  const plan = dutyDayPlan(record.date), duty = plan.main;
  card.querySelector('.day-shift option[value="AUTO"]').textContent = `OTOMATIS · ${duty.label.toUpperCase()}`;
  card.querySelector('.day-shift').value = record.shiftSource === 'auto' ? 'AUTO' : record.shift;
  card.querySelector('.day-duty-label').textContent = `Jadwal: ${duty.label}`;
  card.querySelector('.day-duty-label').dataset.shift = duty.shift;
  card.querySelector('.day-duty-note').textContent = record.shiftSource === 'auto' ? 'Foto mengikuti jadwal otomatis.' : 'Dinas foto diatur manual. Pilih OTOMATIS untuk mengikuti jadwal.';
  const time = card.querySelector('.day-time'); if (document.activeElement !== time) time.value = record.time;
  card.querySelector('.day-old-stamp').checked = record.oldStamp;
  card.querySelector('.day-filename').textContent = leave ? 'Kartu LIBUR · tanpa foto' : record.filename || 'Belum ada foto';
  card.querySelector('.day-state').textContent = leave ? 'LIBUR' : record.photo ? (recordReady(record) ? 'Siap' : 'Periksa jam') : 'Kosong';
  card.classList.toggle('has-photo', Boolean(record.photo && !leave)); card.classList.toggle('is-leave', leave);
  card.querySelector('.preview-open').disabled = !recordIncluded(record);
  card.querySelector('.delete-photo').disabled = !record.photo || leave;
  card.querySelector('.day-upload-row').hidden = leave;
  card.querySelector('input[type=file]').disabled = leave || monthState.importing || monthState.exporting || monthState.loading;
  card.querySelector('.day-camera').disabled = leave || monthState.importing || monthState.exporting || monthState.loading;
  card.querySelector('.day-time').disabled = leave; card.querySelector('.day-random').disabled = leave;
  card.querySelector('.day-old-stamp').disabled = leave;
  card.querySelector('.day-image').hidden = !recordIncluded(record);
  card.querySelector('.day-placeholder').hidden = recordIncluded(record);
  card.querySelector('.day-save-status').textContent = ({ pending: 'Menyimpan…', saved: 'Tersimpan di perangkat', failed: 'Belum tersimpan; periksa status' })[monthSaveStatus.get(record.date)] || '';
  if (leave) { card.querySelector('.day-image').src = leaveImage.src; return; }
  const current = monthState.thumbnailUrls.get(record.date);
  if (record.thumbnail && current?.blob !== record.thumbnail) {
    if (current) URL.revokeObjectURL(current.url);
    const url = URL.createObjectURL(record.thumbnail); monthState.thumbnailUrls.set(record.date, { blob: record.thumbnail, url });
  } else if (!record.photo && current) { URL.revokeObjectURL(current.url); monthState.thumbnailUrls.delete(record.date); card.querySelector('.day-image').removeAttribute('src'); }
  if (record.photo && monthState.thumbnailUrls.has(record.date)) card.querySelector('.day-image').src = monthState.thumbnailUrls.get(record.date).url;
}
function renderMonthGrid() {
  monthState.thumbnailUrls.forEach(value => URL.revokeObjectURL(value.url)); monthState.thumbnailUrls.clear();
  monthState.cards.clear(); $('dayGrid').replaceChildren();
  monthState.records.forEach(record => {
    const date = parseDate(record.date), card = document.createElement('article');
    card.className = 'day-card';
    card.id = `duty-card-${record.date}`;
    card.tabIndex = -1;
    card.classList.toggle('is-today', record.date === jakartaToday());
    card.innerHTML = '<div class="day-card-heading"><div><strong class="day-number"></strong><span class="day-weekday"></span></div><span class="day-state"></span></div><span class="day-duty-label"></span><p class="day-duty-note"></p><button class="preview-open" type="button"><img class="day-image" alt="Foto asli untuk tanggal ini" hidden><span class="day-placeholder">Belum ada foto<br><small>Pilih foto di bawah</small></span></button><p class="day-filename"></p><div class="day-upload-row"><label class="button secondary day-upload">Pilih / ganti foto<input type="file" accept="image/*" hidden></label><button class="day-camera button camera-mini" type="button">Ambil foto</button><button class="delete-photo text-button" type="button">Hapus</button></div><div class="day-fields"><label>Dinas<select class="day-shift"><option value="AUTO">OTOMATIS SESUAI TANGGAL</option><option value="PAGI">PAGI</option><option value="SIANG">SIANG</option><option value="MALAM">MALAM</option><option value="LIBUR">LIBUR</option></select></label><label>Jam<input class="day-time" type="time" step="1" required></label></div><div class="day-bottom"><label class="check-label"><input class="day-old-stamp" type="checkbox"> Timestamp lama</label><button class="day-random text-button" type="button">Acak jam</button></div><p class="day-save-status"></p>';
    card.querySelector('.day-number').textContent = `${pad(date.getUTCDate())} ${MONTHS[date.getUTCMonth()]}`;
    card.querySelector('.day-weekday').textContent = DAYS[date.getUTCDay()];
    card.querySelector('.preview-open').setAttribute('aria-label', `Pratinjau ${dateText(date)}`);
    card.querySelector('.preview-open').addEventListener('click', () => openMonthPreview(record));
    const fileInput = card.querySelector('input[type=file]');
    fileInput.addEventListener('change', async () => { if (fileInput.files[0]) await importSinglePhoto(record, fileInput.files[0]); fileInput.value = ''; });
    card.querySelector('.day-camera').addEventListener('click', () => openDayCamera(record));
    card.querySelector('.day-shift').addEventListener('change', event => monthShiftChange(record, event.target.value));
    card.querySelector('.day-time').addEventListener('input', event => updateMonthRecord(record, { time: event.target.value, timeMode: 'manual' }));
    card.querySelector('.day-old-stamp').addEventListener('change', event => updateMonthRecord(record, { oldStamp: event.target.checked, addLogo: !event.target.checked }));
    card.querySelector('.day-random').addEventListener('click', () => randomizeMonthRecord(record));
    card.querySelector('.delete-photo').addEventListener('click', () => updateMonthRecord(record, { photo: null, thumbnail: null, filename: '' }));
    monthState.cards.set(record.date, card); $('dayGrid').append(card); updateMonthCard(record);
  });
}
async function chooseMonth(value) {
  const dates = monthDates(value);
  if (!dates.length) { monthNotice('Pilih bulan yang valid.', true); return; }
  const token = ++monthState.loadToken;
  monthState.loading = true; setMonthImporting(false);
  await flushMonthSaves();
  const saved = await loadMonthDraft(value);
  if (token !== monthState.loadToken) return;
  monthState.month = value;
  const savedByDate = new Map(saved.filter(record => dates.includes(record.date)).map(record => [record.date, record]));
  monthPending.forEach(record => { if (dates.includes(record.date)) savedByDate.set(record.date, record); });
  monthState.records = dates.map(date => {
    const empty = emptyMonthRecord(date), data = savedByDate.get(date);
    if (!data) return empty;
    const record = { ...empty, ...data, date, month: value, shiftSource: data.shiftSource === 'auto' ? 'auto' : 'manual' };
    if (record.shiftSource === 'auto') record.shift = dutyDayPlan(date).main.shift;
    if (!SHIFT_WINDOWS[record.shift] && record.shift !== 'LIBUR') record.shift = empty.shift;
    if (record.shift === 'LIBUR') { record.time = LEAVE_TIME; record.timeMode = 'fixed'; }
    if (!manualTimestamp(date, record.time)) record.time = empty.time;
    if (!(record.photo instanceof Blob)) { record.photo = null; record.thumbnail = null; record.filename = ''; }
    if (record.thumbnail && !(record.thumbnail instanceof Blob)) record.thumbnail = null;
    if (!monthPending.has(date)) monthSaveStatus.set(date, 'saved');
    return record;
  });
  renderMonthGrid(); renderDutyCalendar(); updateMonthSummary();
  $('draftStatus').textContent = await monthDatabase ? (monthPending.size ? 'Ada draf yang belum tersimpan' : 'Draf tersimpan di perangkat') : 'Draf hanya untuk sesi ini';
  monthState.loading = false; setMonthImporting(false);
  try { localStorage.setItem('imocam.lastMonth', value); } catch {}
  monthNotice('Unggah banyak foto sekaligus, atau pilih foto pada tanggal tertentu. Klik foto untuk memeriksa hasilnya.');
}
async function decodeMonthImage(blob) {
  if (globalThis.createImageBitmap) {
    try { return await createImageBitmap(blob); } catch { /* Try the image decoder as a fallback. */ }
  }
  const image = new Image(), url = URL.createObjectURL(blob);
  try { image.src = url; await image.decode(); return image; }
  finally { URL.revokeObjectURL(url); }
}
function canvasBlob(target, quality = 0.95) {
  return new Promise((resolve, reject) => target.toBlob(blob => blob ? resolve(blob) : reject(new Error('Gagal membuat foto JPG.')), 'image/jpeg', quality));
}
async function prepareMonthPhoto(file) {
  if (!file.type.startsWith('image/') && !/\.(jpe?g|png|webp|gif|avif|bmp)$/i.test(file.name)) throw new Error('Format gambar tidak didukung.');
  if (file.size > 30 * 1024 * 1024) throw new Error('Maksimal 30 MB per foto.');
  const image = await decodeMonthImage(file);
  try {
    const thumb = document.createElement('canvas'); thumb.width = 240; thumb.height = 320;
    drawCover(image, 240, 320, false, thumb.getContext('2d'));
    return { photo: file, thumbnail: await canvasBlob(thumb, 0.68), filename: file.name };
  } finally { image.close?.(); }
}
async function importSinglePhoto(record, file) {
  if (record.shift === 'LIBUR' || monthState.loading || monthState.importing || monthState.exporting) return;
  setMonthImporting(true);
  try {
    const prepared = await prepareMonthPhoto(file), oldStamp = $('defaultOldStamp').checked;
    updateMonthRecord(record, { ...prepared, oldStamp, addLogo: !oldStamp, location: variedLocation(record.location) });
    await requestLocalPersistence(); await flushMonthSaves();
    monthNotice(`Foto untuk ${dateText(parseDate(record.date))} siap. Klik foto untuk melihat hasil timestamp.`);
  } catch (error) { monthNotice(`${file.name}: ${error.message}`, true); }
  finally { setMonthImporting(false); }
}
async function importManyPhotos(files) {
  if (monthState.loading || monthState.importing || monthState.exporting) return;
  const input = [...files].sort((a, b) => a.name.localeCompare(b.name, 'id', { numeric: true }));
  const choice = $('defaultShift').value;
  const slots = monthState.records.filter(record => !record.photo && record.shift !== 'LIBUR' && (choice !== 'AUTO' || dutyDayPlan(record.date).main.shift !== 'LIBUR'));
  if (!slots.length) { monthNotice('Semua tanggal sudah terisi. Ganti foto pada tanggal tertentu.', true); return; }
  setMonthImporting(true);
  let count = 0, failures = [], skipped = 0;
  const oldStamp = $('defaultOldStamp').checked;
  for (const file of input) {
    if (count >= slots.length) { skipped++; continue; }
    monthNotice(`Menyiapkan ${count + 1}/${Math.min(input.length, slots.length)} foto…`);
    try {
      const prepared = await prepareMonthPhoto(file), record = slots[count];
      const shift = choice === 'AUTO' ? dutyDayPlan(record.date).main.shift : choice;
      updateMonthRecord(record, { ...prepared, shift, shiftSource: choice === 'AUTO' ? 'auto' : 'manual', time: monthRandomTime(record.date, shift), timeMode: 'random', oldStamp, addLogo: !oldStamp, location: variedLocation(record.location) });
      count++;
    } catch (error) { failures.push(`${file.name}: ${error.message}`); }
  }
  await requestLocalPersistence(); await flushMonthSaves();
  setMonthImporting(false);
  monthNotice(`${count} foto dimasukkan. Periksa tanggal dan dinas setiap foto.${skipped ? ` ${skipped} file tidak dimasukkan karena tanggal kosong sudah habis.` : ''}${failures.length ? ` ${failures.length} file gagal: ${failures.slice(0, 3).join('; ')}` : ''}`, Boolean(failures.length || skipped));
}
function closeMonthPreview() { monthState.previewToken++; monthState.previewImage?.close?.(); monthState.previewImage = null; monthState.previewRecord = null; }
async function reloadMonthPreviewSource(record) {
  const token = ++monthState.previewToken;
  monthState.previewImage?.close?.(); monthState.previewImage = null;
  if (record.shift === 'LIBUR') { monthState.previewImage = leaveImage; renderMonthPreview(); return; }
  if (!record.photo) { const target = $('monthPreviewCanvas'); target.getContext('2d').clearRect(0, 0, target.width, target.height); $('previewMessage').textContent = 'Pilih foto pada tanggal ini untuk kembali ke dinas.'; return; }
  try {
    const image = await decodeMonthImage(record.photo);
    if (token !== monthState.previewToken) { image.close?.(); return; }
    monthState.previewImage = image; renderMonthPreview(); $('previewMessage').textContent = '';
  } catch { $('previewMessage').textContent = 'Foto gagal dibaca. Pilih ulang gambar.'; }
}
function syncPreviewControls() {
  const record = monthState.previewRecord; if (!record) return;
  const leave = record.shift === 'LIBUR';
  $('previewDate').textContent = dateText(parseDate(record.date)); $('previewFilename').textContent = leave ? 'Kartu LIBUR · tidak memerlukan foto' : record.filename;
  $('previewMoveDate').value = record.date;
  $('previewShift').querySelector('option[value="AUTO"]').textContent = `OTOMATIS · ${dutyDayPlan(record.date).main.label.toUpperCase()}`;
  $('previewShift').value = record.shiftSource === 'auto' ? 'AUTO' : record.shift;
  if (document.activeElement !== $('previewTime')) $('previewTime').value = record.time;
  $('previewOldStamp').checked = record.oldStamp; $('previewCover').value = record.coverPercent;
  $('previewCover').disabled = leave || !record.oldStamp; $('coverValue').textContent = `${record.coverPercent}%`;
  $('previewTime').disabled = leave; $('previewRandom').disabled = leave; $('previewOldStamp').disabled = leave; $('previewLogo').disabled = leave;
  $('previewLogo').checked = record.addLogo; $('previewLocation').textContent = leave ? 'Kartu LIBUR mengikuti template. Waktu tetap 17:16:39; tanggal mengikuti pilihan.' : `Koordinat manual: ${record.location}`;
  $('previewDownload').disabled = !recordReady(record) || !validOfficer(officer) || !logo.naturalWidth;
}
function renderMonthPreview() {
  const record = monthState.previewRecord, image = monthState.previewImage; if (!record || (!image && record.shift !== 'LIBUR')) return;
  const target = $('monthPreviewCanvas'), context = target.getContext('2d', { alpha: false });
  if (record.shift === 'LIBUR') { if (leaveImage.naturalWidth) paintLeaveCard(context, manualTimestamp(record.date, LEAVE_TIME), officer); }
  else {
  drawCameraFrame(image, context);
  paintTimestamp(context, manualTimestamp(record.date, record.time), record.shift, officer, record.location, record);
  }
  if (target.style) target.style.aspectRatio = `${target.width} / ${target.height}`;
}
async function openMonthPreview(record) {
  if (!recordIncluded(record)) return;
  closeMonthPreview(); monthState.previewRecord = record;
  const token = ++monthState.previewToken;
  $('previewMoveDate').replaceChildren();
  monthState.records.forEach(row => { const option = document.createElement('option'); option.value = row.date; option.textContent = dateText(parseDate(row.date)); $('previewMoveDate').append(option); });
  syncPreviewControls(); $('previewMessage').textContent = 'Memuat pratinjau…';
  $('monthPreviewCanvas').getContext('2d').clearRect(0, 0, $('monthPreviewCanvas').width, $('monthPreviewCanvas').height);
  $('photoDialog').showModal();
  try {
    const image = record.shift === 'LIBUR' ? leaveImage : await decodeMonthImage(record.photo);
    if (token !== monthState.previewToken) { image.close?.(); return; }
    monthState.previewImage = image; renderMonthPreview(); $('previewMessage').textContent = '';
  } catch { $('previewMessage').textContent = 'Foto gagal dibaca. Pilih ulang gambar JPG atau PNG.'; }
}
function moveMonthPhoto(targetDate) {
  const source = monthState.previewRecord, target = monthState.records.find(record => record.date === targetDate);
  if (!source || !target || source === target) return;
  const sourceData = { ...source }, targetData = { ...target };
  Object.assign(target, sourceData, { date: target.date, month: monthState.month });
  Object.assign(source, targetData, { date: sourceData.date, month: monthState.month });
  // Automatic duty belongs to the destination date, rather than to the photo.
  for (const record of [source, target]) {
    if (record.shiftSource === 'auto') monthShiftChange(record, 'AUTO');
  }
  scheduleMonthSave(source); scheduleMonthSave(target); updateMonthCard(source); updateMonthCard(target); updateMonthSummary();
  monthState.previewRecord = target; syncPreviewControls(); reloadMonthPreviewSource(target);
}
function monthPhotoName(record, identity) { return `IMO_${record.date}_${record.shift}_${timeText(manualTimestamp(record.date, record.time)).replaceAll(':', '-')}_${identity.nipp}.jpg`; }
async function renderMonthBlob(record, identity, target) {
  if (!recordReady(record)) throw new Error(`Periksa tanggal/jam ${record.date}.`);
  if (record.shift === 'LIBUR') { await leaveImage.decode(); paintLeaveCard(target.getContext('2d', { alpha: false }), manualTimestamp(record.date, LEAVE_TIME), identity); return canvasBlob(target); }
  const image = await decodeMonthImage(record.photo);
  try {
    const context = target.getContext('2d', { alpha: false }); drawCameraFrame(image, context);
    paintTimestamp(context, manualTimestamp(record.date, record.time), record.shift, identity, record.location, record);
    return await canvasBlob(target);
  } finally { image.close?.(); }
}
function monthDownload(blob, name) {
  const url = URL.createObjectURL(blob); monthState.downloadUrls.add(url);
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => { URL.revokeObjectURL(url); monthState.downloadUrls.delete(url); }, 60000);
}
async function downloadPreviewPhoto() {
  const current = monthState.previewRecord; if (!recordReady(current) || !validOfficer(officer)) return;
  $('previewDownload').disabled = true;
  const record = { ...current }, identity = { ...officer }, target = document.createElement('canvas'); target.width = 1200; target.height = 1600;
  try { monthDownload(await renderMonthBlob(record, identity, target), monthPhotoName(record, identity)); $('previewMessage').textContent = 'Foto JPG diunduh.'; }
  catch (error) { $('previewMessage').textContent = error.message; }
  finally { syncPreviewControls(); }
}
function monthCsv(records, identity) {
  const cell = value => { let text = String(value ?? ''); if (/^[=+\-@]/.test(text)) text = "'" + text; return `"${text.replaceAll('"', '""')}"`; };
  const rows = [['Tanggal', 'Hari', 'Jadwal otomatis', 'Dinas', 'Jam manual', 'Nama', 'NIPP', 'Koordinat manual', 'File asli', 'Hasil JPG']];
  records.forEach(record => rows.push([record.date, DAYS[parseDate(record.date).getUTCDay()], dutyDayPlan(record.date).main.label, record.shift, record.time, identity.name, identity.nipp, record.shift === 'LIBUR' ? '' : record.location, record.shift === 'LIBUR' ? 'Kartu LIBUR' : record.filename, monthPhotoName(record, identity)]));
  return '\ufeff' + rows.map(row => row.map(cell).join(',')).join('\r\n');
}
async function exportMonthPhotos() {
  const records = monthState.records.filter(recordIncluded).map(record => ({ ...record }));
  if (!records.length || !records.every(recordReady) || !validOfficer(officer) || monthState.loading || monthState.exporting || monthState.importing) return;
  const identity = { ...officer }, month = monthState.month, archive = new PhotoZip();
  monthState.exporting = true; monthState.cancel = false; setMonthImporting(false);
  $('exportProgress').hidden = false; $('exportProgressBar').max = records.length; $('exportProgressBar').value = 0;
  const target = document.createElement('canvas'); target.width = 1200; target.height = 1600;
  try {
    for (let i = 0; i < records.length; i++) {
      if (monthState.cancel) throw new Error('EXPORT_CANCELLED');
      $('exportProgressText').textContent = `${i + 1}/${records.length} · ${records[i].date}`;
      const blob = await renderMonthBlob(records[i], identity, target);
      if (monthState.cancel) throw new Error('EXPORT_CANCELLED');
      await archive.add(monthPhotoName(records[i], identity), blob, manualTimestamp(records[i].date, records[i].time));
      $('exportProgressBar').value = i + 1;
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    await archive.add(`REKAP_${month}.csv`, new Blob([monthCsv(records, identity)], { type: 'text/csv;charset=utf-8' }));
    if (monthState.cancel) throw new Error('EXPORT_CANCELLED');
    monthDownload(archive.blob(), `IMO_${month}_${identity.nipp}.zip`);
    monthNotice(`${records.length} foto dan tabel rekap CSV diunduh dalam ZIP.`);
  } catch (error) { monthNotice(error.message === 'EXPORT_CANCELLED' ? 'Unduhan dibatalkan. Foto dan draf tetap ada.' : `Gagal membuat ZIP: ${error.message}`, error.message !== 'EXPORT_CANCELLED'); }
  finally { monthState.exporting = false; setMonthImporting(false); $('exportProgress').hidden = true; }
}
function chooseMode(mode) {
  const monthly = mode === 'monthly';
  try { localStorage.setItem('imocam.lastMode', mode); } catch {}
  $('monthlyWorkspace').hidden = !monthly; $('cameraWorkspace').hidden = monthly;
  $('monthlyTab').classList.toggle('selected', monthly); $('cameraTab').classList.toggle('selected', !monthly);
  $('monthlyTab').setAttribute('aria-pressed', String(monthly)); $('cameraTab').setAttribute('aria-pressed', String(!monthly));
  if (monthly && (cameraReady || openingCamera)) { stopCamera(); setStatus('Kamera belum aktif'); if (!photo) $('emptyState').hidden = false; }
}

function renderDutySearchResult() {
  const value = $('dutySearchDate').value, plan = dutyDayPlan(value);
  $('dutySearchResult').textContent = plan ? `${dateText(parseDate(value))} · ${plan.main.label}${plan.extras.length ? ' · Tambahan: ' + plan.extras.map(extra => `${DUTY_NAMES[extra.shift]}${extra.time ? ' ' + extra.time + ' WIB' : ''}${extra.note ? ' (' + extra.note + ')' : ''}`).join('; ') : ''}${plan.note ? ' · ' + plan.note : ''}` : 'Pilih tanggal yang valid.';
  $('dutySearchResult').dataset.shift = plan?.main.shift || '';
}

function refreshDutyReminders() {
  const today = jakartaToday(), tomorrow = offsetDutyDate(today, 1);
  for (const [id, value] of [['dutyToday', today], ['dutyTomorrow', tomorrow]]) {
    const card = $(id), plan = dutyDayPlan(value);
    card.querySelector('strong').textContent = plan?.main.label || 'Di luar rentang kalender';
    card.querySelector('small').textContent = plan ? `${dateText(parseDate(value))}${plan.extras.length ? ' · Tambahan: ' + plan.extras.map(extra => DUTY_NAMES[extra.shift] + (extra.time ? ' ' + extra.time + ' WIB' : '')).join(', ') : ''}` : '';
    card.dataset.shift = plan?.main.shift || '';
  }
  monthState.cards.forEach((card, value) => card.classList.toggle('is-today', value === today));
}

function renderDutyCalendar() {
  const dates = monthDates(monthState.month), grid = $('dutyCalendarGrid');
  grid.replaceChildren();
  if (!dates.length) return;
  $('dutyMonthTitle').textContent = new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(parseDate(dates[0]));
  const offset = (parseDate(dates[0]).getUTCDay() + 6) % 7;
  for (let i = 0; i < offset; i++) {
    const spacer = document.createElement('span'); spacer.setAttribute('aria-hidden', 'true'); grid.append(spacer);
  }
  const today = jakartaToday(), selected = $('dutySearchDate').value;
  for (const value of dates) {
    const plan = dutyDayPlan(value), duty = plan.base, button = document.createElement('button');
    button.type = 'button'; button.className = 'duty-calendar-day'; button.dataset.shift = plan.main.shift;
    button.classList.toggle('is-today', value === today);
    button.classList.toggle('is-selected', value === selected);
    button.setAttribute('aria-label', `${dateText(parseDate(value))}, ${plan.main.label}${plan.extras.length ? ', tambahan ' + plan.extras.map(extra => DUTY_NAMES[extra.shift]).join(', ') : ''}${value === today ? ', hari ini' : ''}`);
    button.setAttribute('aria-pressed', String(value === selected));
    if (value === today) button.setAttribute('aria-current', 'date');
    const number = document.createElement('strong'); number.textContent = String(parseDate(value).getUTCDate());
    const label = document.createElement('small'); label.textContent = dutyPlans.get(value)?.mainShift ? `${DUTY_NAMES[plan.main.shift]}*` : `${DUTY_NAMES[duty.shift]} ${duty.occurrence}`;
    button.append(number, label);
    if (plan.extras.length) { const extraLabel = document.createElement('span'); extraLabel.className = 'calendar-extra-label'; extraLabel.textContent = `+ ${DUTY_NAMES[plan.extras[0].shift]}${plan.extras.length > 1 ? ' +' + (plan.extras.length - 1) : ''}`; button.append(extraLabel); }
    button.addEventListener('click', () => selectDutyDate(value)); grid.append(button);
  }
  $('dutyPreviousMonth').disabled = monthState.month === '1900-01';
  $('dutyNextMonth').disabled = monthState.month === '9999-12';
}

async function selectDutyDate(value) {
  if (!dutyForDate(value)) { renderDutySearchResult(); return; }
  if (monthState.loading || monthState.importing || monthState.exporting) { monthNotice('Tunggu sampai proses saat ini selesai.', true); return; }
  $('dutySearchDate').value = value; renderDutySearchResult();
  const month = value.slice(0, 7); $('monthPicker').value = month;
  if (monthState.month !== month) await chooseMonth(month);
  renderDutyCalendar();
  openDutyEditor(value);
}

function changeDutyMonth(direction) {
  if (monthState.loading || monthState.importing || monthState.exporting) return;
  const start = parseDate(`${monthState.month}-01`); if (!start) return;
  start.setUTCMonth(start.getUTCMonth() + direction);
  const month = `${start.getUTCFullYear()}-${pad(start.getUTCMonth() + 1)}`;
  if (!monthDates(month).length) return;
  $('monthPicker').value = month; chooseMonth(month);
}

// Keep the original officer editor as a shared dialog for both working modes.
$('officerDialogContent').append(document.querySelector('.identity'));
document.querySelectorAll('.officer-open').forEach(button => button.addEventListener('click', () => $('officerDialog').showModal()));
$('closeOfficer').addEventListener('click', () => $('officerDialog').close());
['officerName', 'officerNipp'].forEach(id => $(id).addEventListener('input', syncMonthOfficer));
$('savedOfficer').addEventListener('change', syncMonthOfficer); $('saveOfficer').addEventListener('click', syncMonthOfficer);
$('monthlyTab').addEventListener('click', () => chooseMode('monthly')); $('cameraTab').addEventListener('click', () => chooseMode('camera'));
$('monthPicker').value = jakartaToday().slice(0, 7); $('monthPicker').min = '1900-01'; $('monthPicker').max = '9999-12';
$('defaultShift').value = 'AUTO';
$('monthPicker').addEventListener('change', () => chooseMonth($('monthPicker').value));
$('bulkPhotos').addEventListener('change', async event => { await importManyPhotos(event.target.files); event.target.value = ''; });
$('applyDefaultShift').addEventListener('click', () => { const choice = $('defaultShift').value; monthState.records.filter(record => record.photo && (choice === 'AUTO' || record.shift !== 'LIBUR')).forEach(record => monthShiftChange(record, choice)); monthNotice(choice === 'AUTO' ? 'Foto yang terisi sekarang mengikuti jadwal otomatis. Foto pada tanggal LIBUR tetap disimpan.' : `Dinas ${choice} diterapkan ke foto yang terisi. Jam manual dan tanggal LIBUR dipertahankan.`); });
$('exportMonth').addEventListener('click', exportMonthPhotos); $('cancelExport').addEventListener('click', () => monthState.cancel = true);
$('closePreview').addEventListener('click', () => $('photoDialog').close()); $('photoDialog').addEventListener('close', closeMonthPreview);
$('previewShift').addEventListener('change', event => { if (monthState.previewRecord) monthShiftChange(monthState.previewRecord, event.target.value); });
$('previewTime').addEventListener('input', event => { if (monthState.previewRecord) updateMonthRecord(monthState.previewRecord, { time: event.target.value, timeMode: 'manual' }); });
$('previewRandom').addEventListener('click', () => { if (monthState.previewRecord) randomizeMonthRecord(monthState.previewRecord); });
$('previewOldStamp').addEventListener('change', event => { if (monthState.previewRecord) updateMonthRecord(monthState.previewRecord, { oldStamp: event.target.checked, addLogo: !event.target.checked }); });
$('previewCover').addEventListener('input', event => { if (monthState.previewRecord) updateMonthRecord(monthState.previewRecord, { coverPercent: Number(event.target.value) }); });
$('previewLogo').addEventListener('change', event => { if (monthState.previewRecord) updateMonthRecord(monthState.previewRecord, { addLogo: event.target.checked }); });
$('previewMoveDate').addEventListener('change', event => moveMonthPhoto(event.target.value));
$('previewDownload').addEventListener('click', downloadPreviewPhoto);
logo.addEventListener('load', updateMonthSummary);
leaveImage.addEventListener('load', () => { updateMonthSummary(); if (monthState.previewRecord?.shift === 'LIBUR') renderMonthPreview(); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushMonthSaves(); });
window.addEventListener('pagehide', () => { flushMonthSaves(); monthState.thumbnailUrls.forEach(value => URL.revokeObjectURL(value.url)); monthState.downloadUrls.forEach(url => URL.revokeObjectURL(url)); });
let startupMode = 'monthly';
try {
  const month = localStorage.getItem('imocam.lastMonth'); if (monthDates(month || '').length) $('monthPicker').value = month;
  if (localStorage.getItem('imocam.lastMode') === 'camera') startupMode = 'camera';
} catch {}
$('dutySearchDate').value = jakartaToday();
$('dutySearchDate').addEventListener('input', renderDutySearchResult);
$('dutySearchForm').addEventListener('submit', event => { event.preventDefault(); selectDutyDate($('dutySearchDate').value); });
$('dutyPreviousMonth').addEventListener('click', () => changeDutyMonth(-1));
$('dutyNextMonth').addEventListener('click', () => changeDutyMonth(1));
$('dutyGoToday').addEventListener('click', () => selectDutyDate(jakartaToday()));
refreshDutyReminders(); renderDutySearchResult();
let dutyReminderDate = jakartaToday();
function checkDutyDayChange() {
  const current = jakartaToday();
  if (current !== dutyReminderDate) { dutyReminderDate = current; refreshDutyReminders(); renderDutyCalendar(); }
}
setInterval(checkDutyDayChange, 30000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkDutyDayChange(); });
syncMonthOfficer(); chooseMode(startupMode); chooseMonth($('monthPicker').value);
