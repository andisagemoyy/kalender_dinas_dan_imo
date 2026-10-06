'use strict';

const dayCamera = { record: null, stream: null, generation: 0, opening: false, ready: false, saving: false, facing: 'user', lastFrame: 0, zoom: 100 };
let persistenceRequested = false;
let singleSaveChain = Promise.resolve(true);
let singleSaveVersion = 0;
let singleSourcePhoto = null;
let singleSourceBlob = null;

async function requestLocalPersistence() {
  if (persistenceRequested) return;
  persistenceRequested = true;
  // Best effort only. The UI always reports the actual IndexedDB write result.
  try { if (navigator.storage?.persist) await navigator.storage.persist(); } catch {}
}
function updateDayCameraButtons() {
  $('captureDayCamera').disabled = !dayCamera.ready || dayCamera.saving || !dayCamera.record || !manualTimestamp(dayCamera.record.date, dayCamera.record.time) || !validOfficer(officer);
  $('switchDayCamera').disabled = !dayCamera.ready || dayCamera.saving;
  $('dayCameraZoom').disabled = !dayCamera.ready || dayCamera.saving;
  $('resetDayCameraZoom').disabled = !dayCamera.ready || dayCamera.saving || dayCamera.zoom === 100;
}
function setDayCameraZoom(value) {
  dayCamera.zoom = cameraZoomPercent(value);
  $('dayCameraZoom').value = dayCamera.zoom;
  $('dayCameraZoom').setAttribute('aria-valuetext', `${dayCamera.zoom} persen`);
  $('dayCameraZoomValue').textContent = `${dayCamera.zoom}%`;
  updateDayCameraButtons(); drawDayCameraFrame();
}
function stopDayCameraTracks() {
  dayCamera.generation++;
  dayCamera.stream?.getTracks().forEach(track => track.stop());
  dayCamera.stream = null; dayCamera.ready = false; dayCamera.opening = false;
  $('dayCameraVideo').srcObject = null; updateDayCameraButtons();
}
function drawDayCameraFrame() {
  if (!dayCamera.ready || !dayCamera.record) return;
  const target = $('dayCameraCanvas'), context = target.getContext('2d', { alpha: false });
  drawCameraFrame($('dayCameraVideo'), context, dayCamera.facing === 'user', dayCamera.zoom);
  syncCameraStage(target, $('dayCameraStage'));
  const record = dayCamera.record;
  paintTimestamp(context, manualTimestamp(record.date, record.time), record.shift, officer, record.location);
}
function dayCameraFrame(now) {
  if (dayCamera.ready && now - dayCamera.lastFrame >= 80) { drawDayCameraFrame(); dayCamera.lastFrame = now; }
  requestAnimationFrame(dayCameraFrame);
}
async function startDayCamera() {
  if (dayCamera.opening || dayCamera.saving || !dayCamera.record) return;
  stopDayCameraTracks(); dayCamera.opening = true;
  setDayCameraZoom(100);
  const generation = dayCamera.generation;
  $('dayCameraEmpty').hidden = false; $('dayCameraEmpty').textContent = 'Membuka kamera…';
  $('retryDayCamera').hidden = true; $('dayCameraMessage').textContent = 'Izinkan akses kamera saat diminta oleh browser.';
  try {
    const candidate = await openCameraStream(dayCamera.facing);
    if (generation !== dayCamera.generation) { candidate.getTracks().forEach(track => track.stop()); return; }
    dayCamera.stream = candidate;
    const settings = candidate.getVideoTracks?.()[0]?.getSettings?.();
    if (settings?.facingMode === 'user' || settings?.facingMode === 'environment') dayCamera.facing = settings.facingMode;
    const video = $('dayCameraVideo'); video.srcObject = candidate; await video.play();
    if (!video.videoWidth) await new Promise(resolve => video.addEventListener('loadeddata', resolve, { once: true }));
    if (generation !== dayCamera.generation) return;
    dayCamera.ready = true; dayCamera.opening = false;
    $('dayCameraEmpty').hidden = true;
    $('dayCameraMessage').textContent = 'Foto akan masuk langsung ke tanggal yang dipilih dan tersimpan otomatis.';
    drawDayCameraFrame(); updateDayCameraButtons();
  } catch (error) {
    if (generation !== dayCamera.generation) return;
    stopDayCameraTracks(); $('dayCameraEmpty').textContent = 'Kamera belum aktif';
    const errors = { NotAllowedError: 'Akses kamera ditolak. Izinkan melalui pengaturan situs, lalu coba lagi.', NotFoundError: 'Kamera tidak ditemukan. Pilih foto dari perangkat pada kartu tanggal.', NotReadableError: 'Kamera sedang digunakan aplikasi lain. Tutup aplikasi itu, lalu coba lagi.' };
    $('dayCameraMessage').textContent = errors[error.name] || 'Kamera memerlukan HTTPS atau localhost. Buka melalui Go Live, lalu coba lagi.';
    $('retryDayCamera').hidden = false;
  }
}
async function openDayCamera(record) {
  if (!record || record.shift === 'LIBUR' || monthState.loading || monthState.importing || monthState.exporting || dayCamera.saving) return;
  if (!manualTimestamp(record.date, record.time) || !validOfficer(officer)) { monthNotice('Isi nama, NIPP, dan jam yang valid sebelum mengambil foto.', true); return; }
  if (cameraReady || openingCamera) { stopCamera(); setStatus('Kamera belum aktif'); if (!photo) $('emptyState').hidden = false; }
  stopDayCameraTracks(); dayCamera.record = record;
  $('dayCameraDate').textContent = `${dateText(parseDate(record.date))} · ${record.shift}`;
  $('dayCameraDialog').showModal();
  await startDayCamera();
}
async function captureDayPhoto() {
  if (!dayCamera.ready || !dayCamera.record || dayCamera.saving || !validOfficer(officer)) return;
  const record = dayCamera.record;
  if (!manualTimestamp(record.date, record.time)) return;
  const raw = document.createElement('canvas');
  drawCameraFrame($('dayCameraVideo'), raw.getContext('2d', { alpha: false }), dayCamera.facing === 'user', dayCamera.zoom);
  dayCamera.saving = true; stopDayCameraTracks(); setMonthImporting(true);
  $('dayCameraMessage').textContent = 'Menyimpan foto ke perangkat…';
  try {
    const blob = await canvasBlob(raw);
    const file = new File([blob], `KAMERA_${record.date}_${record.shift}.jpg`, { type: 'image/jpeg' });
    const prepared = await prepareMonthPhoto(file);
    updateMonthRecord(record, { ...prepared, oldStamp: false, addLogo: true, location: variedLocation(record.location) });
    await requestLocalPersistence(); const saved = await flushMonthSaves();
    monthNotice(saved ? `Foto ${dateText(parseDate(record.date))} tersimpan. Kamu bisa melanjutkan tanggal lain nanti.` : 'Foto masuk ke rekap, tetapi penyimpanan belum berhasil. Unduh hasil sebelum menutup halaman.', !saved);
    if ($('dayCameraDialog').open) $('dayCameraDialog').close();
  } catch (error) { $('dayCameraMessage').textContent = `Foto gagal disimpan: ${error.message}`; $('retryDayCamera').hidden = false; }
  finally { dayCamera.saving = false; setMonthImporting(false); updateDayCameraButtons(); }
}
function saveSingleDraft(sourceFile = null) {
  if (!photo) return singleSaveChain;
  const reference = photo;
  const state = { id: 'current', date: dateInput.value, shift: selectedShift, timeMode, timeOffset, time: $('manualTime').value, location: manualLocation, officer: { ...officer } };
  singleSaveVersion++; $('singleSaveStatus').textContent = 'Menyimpan foto dan pengaturan…';
  singleSaveChain = singleSaveChain.catch(() => false).then(async () => {
    if (singleSourcePhoto !== reference || sourceFile) {
      singleSourceBlob = sourceFile || await canvasBlob(reference);
      singleSourcePhoto = reference;
    }
    const db = await monthDatabase;
    if (!db) { $('singleSaveStatus').textContent = 'Penyimpanan diblokir. Unduh foto sebelum menutup halaman.'; return false; }
    await requestLocalPersistence();
    const saved = await new Promise(resolve => {
      try {
        const tx = db.transaction('single', 'readwrite');
        tx.objectStore('single').put({ ...state, photo: singleSourceBlob });
        tx.oncomplete = () => resolve(true); tx.onerror = tx.onabort = () => resolve(false);
      } catch { resolve(false); }
    });
    $('singleSaveStatus').textContent = saved ? 'Foto dan pengaturan tersimpan di perangkat.' : 'Foto belum tersimpan. Unduh hasil sebelum menutup halaman.';
    return saved;
  }).catch(() => { $('singleSaveStatus').textContent = 'Foto belum tersimpan. Coba kembali atau unduh hasil.'; return false; });
  return singleSaveChain;
}
async function restoreSingleDraft() {
  const db = await monthDatabase; if (!db) return;
  const record = await new Promise(resolve => {
    try {
      const request = db.transaction('single', 'readonly').objectStore('single').get('current');
      request.onsuccess = () => resolve(request.result); request.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
  if (!record || !(record.photo instanceof Blob) || singleSaveVersion) return;
  try {
    const image = await decodeMonthImage(record.photo);
    if (singleSaveVersion || cameraReady || openingCamera) { image.close?.(); return; }
    photo = image; singleSourcePhoto = image; singleSourceBlob = record.photo;
    dateInput.value = parseDate(record.date) ? record.date : jakartaToday(); selectedShift = SHIFT_WINDOWS[record.shift] ? record.shift : 'PAGI';
    timeMode = record.timeMode === 'manual' ? 'manual' : 'random';
    timeOffset = Number.isInteger(record.timeOffset) && record.timeOffset >= 0 && record.timeOffset < SHIFT_WINDOWS[selectedShift][1] ? record.timeOffset : 0;
    $('manualTime').value = manualTimestamp(dateInput.value, record.time) ? record.time : monthRandomTime(dateInput.value, selectedShift);
    if (validOfficer(record.officer)) { officer = { ...record.officer }; $('officerName').value = officer.name; $('officerNipp').value = officer.nipp; rebuildOfficerMenu(); }
    manualLocation = typeof record.location === 'string' ? record.location : PROFILE.location; $('locationValue').textContent = manualLocation;
    document.querySelector(`input[name="shift"][value="${selectedShift}"]`).checked = true;
    $('emptyState').hidden = true; $('capture').textContent = 'Ambil ulang';
    setStatus('Foto tersimpan dimuat', true); refreshTimestamp(false); syncMonthOfficer();
    $('singleSaveStatus').textContent = 'Foto terakhir dimuat dari perangkat.';
  } catch { $('singleSaveStatus').textContent = 'Foto terakhir gagal dibaca. Pilih ulang file gambar.'; }
}
$('captureDayCamera').addEventListener('click', captureDayPhoto);
$('switchDayCamera').addEventListener('click', () => { dayCamera.facing = dayCamera.facing === 'user' ? 'environment' : 'user'; startDayCamera(); });
$('retryDayCamera').addEventListener('click', startDayCamera);
$('dayCameraZoom').addEventListener('input', event => setDayCameraZoom(event.target.value));
$('resetDayCameraZoom').addEventListener('click', () => setDayCameraZoom(100));
$('closeDayCamera').addEventListener('click', () => $('dayCameraDialog').close());
$('dayCameraDialog').addEventListener('close', () => { stopDayCameraTracks(); dayCamera.record = null; });
['dutyDate', 'manualTime', 'officerName', 'officerNipp'].forEach(id => $(id).addEventListener('input', () => saveSingleDraft()));
document.querySelectorAll('input[name="shift"]').forEach(input => input.addEventListener('change', () => saveSingleDraft()));
['randomize', 'randomizeLocation', 'savedOfficer', 'saveOfficer'].forEach(id => $(id).addEventListener(id === 'savedOfficer' ? 'change' : 'click', () => saveSingleDraft()));
window.addEventListener('pagehide', stopDayCameraTracks);
requestAnimationFrame(dayCameraFrame); restoreSingleDraft();
