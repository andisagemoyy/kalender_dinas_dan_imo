'use strict';

// Nilai bawaan mengikuti template. Nama dan NIPP dapat diganti di formulir.
const PROFILE = Object.freeze({
  name: 'ANDISA JATI APRILIA ABADI', nipp: '76121', position: 'PLR',
  unit: 'STASIUN JAKARTAKOTA',
  address: 'PINANGSIA, KECAMATAN TAMAN SARI, KOTA JAKAR...',
  location: '-6.1376467, 106.81578'
});
const SHIFT_WINDOWS = Object.freeze({ PAGI: [7 * 3600, 8 * 3600], SIANG: [15 * 3600, 7 * 3600], MALAM: [22 * 3600, 2 * 3600] });
const DAYS = ['MINGGU', 'SENIN', 'SELASA', 'RABU', 'KAMIS', 'JUMAT', 'SABTU'];
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MEI', 'JUN', 'JUL', 'AGU', 'SEP', 'OKT', 'NOV', 'DES'];
const $ = id => document.getElementById(id);
const canvas = $('output');
const ctx = canvas.getContext('2d', { alpha: false });
const video = $('video');
const dateInput = $('dutyDate');
const logo = new Image();
let stream = null;
let cameraReady = false;
let openingCamera = false;
let cameraGeneration = 0;
let facingMode = 'user';
let cameraZoom = 100;
let photo = null;
let selectedShift = 'PAGI';
let timeOffset = 0;
let timestamp = null;
let lastFrame = 0;
let currentBlobUrl = null;
let timeMode = 'random';
let officer = { name: PROFILE.name, nipp: PROFILE.nipp };
let savedOfficers = [];
let manualLocation = PROFILE.location;
const OFFICER_STORAGE_KEY = 'imocam.petugas.v1';

function validOfficer(value) {
  return value && typeof value.name === 'string' && typeof value.nipp === 'string' && value.name.trim().length > 0 && value.name.length <= 70 && /^\d{1,20}$/.test(value.nipp);
}
function readOfficerFields() {
  officer = { name: $('officerName').value.trim().toUpperCase(), nipp: $('officerNipp').value.trim() };
  $('savedOfficer').value = savedOfficers.some(p => p.nipp === officer.nipp && p.name === officer.name) ? officer.nipp : '';
  updateButtons();
  render();
}
function rebuildOfficerMenu() {
  const menu = $('savedOfficer');
  menu.replaceChildren();
  const prompt = document.createElement('option');
  prompt.value = ''; prompt.textContent = 'Pilih petugas'; menu.append(prompt);
  savedOfficers.forEach(p => {
    const option = document.createElement('option');
    option.value = p.nipp; option.textContent = `${p.name} · ${p.nipp}`;
    menu.append(option);
  });
  menu.value = savedOfficers.some(p => p.nipp === officer.nipp && p.name === officer.name) ? officer.nipp : '';
}
function loadOfficers() {
  savedOfficers = [{ name: PROFILE.name, nipp: PROFILE.nipp }];
  try {
    const data = JSON.parse(localStorage.getItem(OFFICER_STORAGE_KEY));
    if (data && Array.isArray(data.officers)) {
      const unique = new Map(savedOfficers.map(p => [p.nipp, p]));
      data.officers.filter(validOfficer).slice(0, 100).forEach(p => unique.set(p.nipp, { name: p.name.trim().toUpperCase(), nipp: p.nipp }));
      savedOfficers = [...unique.values()];
      const active = savedOfficers.find(p => p.nipp === data.activeNipp);
      if (active) officer = { ...active };
    }
  } catch { /* Storage may be blocked; the default officer remains available. */ }
  $('officerName').value = officer.name;
  $('officerNipp').value = officer.nipp;
  rebuildOfficerMenu();
}
function persistOfficers() {
  try {
    localStorage.setItem(OFFICER_STORAGE_KEY, JSON.stringify({ officers: savedOfficers, activeNipp: officer.nipp }));
    return true;
  } catch { return false; }
}
function saveOfficer() {
  readOfficerFields();
  if (!validOfficer(officer)) {
    $('officerMessage').textContent = 'Isi nama dan NIPP berupa angka sebelum menyimpan.';
    return;
  }
  const index = savedOfficers.findIndex(p => p.nipp === officer.nipp);
  if (index >= 0) savedOfficers[index] = { ...officer };
  else savedOfficers.push({ ...officer });
  const saved = persistOfficers();
  rebuildOfficerMenu();
  $('officerName').value = officer.name;
  $('officerMessage').textContent = saved ? 'Petugas tersimpan. Pilih kembali melalui menu di atas.' : 'Petugas bisa dipakai saat ini, tetapi penyimpanan browser diblokir.';
}
function selectOfficer() {
  const selected = savedOfficers.find(p => p.nipp === $('savedOfficer').value);
  if (!selected) return;
  officer = { ...selected };
  $('officerName').value = officer.name;
  $('officerNipp').value = officer.nipp;
  const saved = persistOfficers();
  $('officerMessage').textContent = saved ? 'Petugas dipilih.' : 'Petugas dipilih untuk sesi ini. Penyimpanan browser diblokir.';
  updateButtons(); render();
}
function randomizeCoordinates() {
  // Manual display variation only. This is never presented as a GPS fix.
  const parts = PROFILE.location.split(', ');
  let candidate;
  do {
    candidate = parts.map(part => part.slice(0, -1) + randomInt(10)).join(', ');
  } while (candidate === manualLocation);
  manualLocation = candidate;
  $('locationValue').textContent = manualLocation;
  render();
}

function pad(value) { return String(value).padStart(2, '0'); }
function jakartaToday() {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const part = key => p.find(x => x.type === key).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
// UTC is used as neutral calendar arithmetic: the selected date never shifts
// with the user's device timezone or daylight saving time.
function parseDate(value) {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!parts) return null;
  const year = Number(parts[1]), month = Number(parts[2]), day = Number(parts[3]);
  if (year < 1900 || year > 9999) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date : null;
}
// Rejection sampling avoids modulo bias. Each second in the shift is possible.
function randomInt(max) {
  if (globalThis.crypto?.getRandomValues) {
    const limit = Math.floor(4294967296 / max) * max;
    const array = new Uint32Array(1);
    do { crypto.getRandomValues(array); } while (array[0] >= limit);
    return array[0] % max;
  }
  return Math.floor(Math.random() * max);
}
function timestampFor(value, shift, offset) {
  const date = parseDate(value);
  const range = SHIFT_WINDOWS[shift];
  if (!date || !range || !Number.isInteger(offset) || offset < 0 || offset >= range[1]) return null;
  date.setUTCSeconds(range[0] + offset);
  return date;
}
function timeText(date) { return `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`; }
function manualTimestamp(value, time) {
  const date = parseDate(value);
  const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(time);
  if (!date || !match) return null;
  const hour = Number(match[1]), minute = Number(match[2]), second = Number(match[3] || 0);
  if (hour > 23 || minute > 59 || second > 59) return null;
  date.setUTCHours(hour, minute, second);
  return date;
}
function dateText(date) { return `${DAYS[date.getUTCDay()]}, ${pad(date.getUTCDate())} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`; }
function overlayLines(date, shift, identity = officer, location = manualLocation) {
  return [
    `NAMA: ${identity.name} | NIPP: ${identity.nipp}`,
    `JABATAN: ${PROFILE.position} | DINAS: ${shift}`,
    `UPT: ${PROFILE.unit}`,
    `ALAMAT: ${PROFILE.address}`,
    `LOKASI: ${location}`,
    `WAKTU: ${dateText(date)} ${timeText(date)}`
  ];
}
function message(text, error = false) {
  $('message').textContent = text;
  $('message').classList.toggle('error', error);
}
function setStatus(text, active = false) {
  $('cameraStatus').textContent = text;
  $('cameraStatus').classList.toggle('active', active);
}
function updateButtons() {
  const valid = Boolean(timestamp) && validOfficer(officer);
  $('capture').disabled = (!cameraReady && !photo) || !valid || openingCamera;
  $('switchCamera').disabled = !cameraReady || openingCamera;
  $('cameraZoom').disabled = !cameraReady || openingCamera;
  $('resetCameraZoom').disabled = !cameraReady || openingCamera || cameraZoom === 100;
  $('download').disabled = !photo || !valid || !logo.complete || !logo.naturalWidth;
  $('saveOfficer').disabled = !validOfficer(officer);
}
function refreshTimestamp(reroll = true) {
  if (reroll) { timeMode = 'random'; timeOffset = randomInt(SHIFT_WINDOWS[selectedShift][1]); }
  timestamp = timeMode === 'manual' ? manualTimestamp(dateInput.value, $('manualTime').value) : timestampFor(dateInput.value, selectedShift, timeOffset);
  const base = parseDate(dateInput.value);
  $('dayLabel').textContent = base ? dateText(base) : 'Pilih tanggal yang valid.';
  if (timeMode === 'random' && timestamp) $('manualTime').value = timeText(timestamp);
  $('timeMode').textContent = timeMode === 'manual' ? 'Manual' : 'Acak';
  $('effectiveDate').textContent = timestamp ? dateText(timestamp) : '';
  $('nightNote').hidden = selectedShift !== 'MALAM';
  updateButtons();
  render();
}
function drawCover(source, width, height, mirrored = false, context = ctx) {
  const sw = source.videoWidth || source.naturalWidth || source.width;
  const sh = source.videoHeight || source.naturalHeight || source.height;
  if (!sw || !sh) return;
  const scale = Math.max(width / sw, height / sh);
  const dw = sw * scale, dh = sh * scale;
  context.save();
  if (mirrored) { context.translate(width, 0); context.scale(-1, 1); }
  context.drawImage(source, (width - dw) / 2, (height - dh) / 2, dw, dh);
  context.restore();
}
function resizePhotoCanvas(target, source) {
  const sw = source.videoWidth || source.naturalWidth || source.width;
  const sh = source.videoHeight || source.naturalHeight || source.height;
  if (!sw || !sh) return null;
  const width = 1200, height = 1600;
  if (target.width !== width) target.width = width;
  if (target.height !== height) target.height = height;
  if (target.style) target.style.aspectRatio = `${width} / ${height}`;
  return { sw, sh, width, height };
}
function syncCameraStage(target, stage) {
  if (!stage?.style) return;
  stage.style.aspectRatio = `${target.width} / ${target.height}`;
  stage.style.setProperty?.('--camera-ratio', String(target.width / target.height));
}
function cameraZoomPercent(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.max(100, Math.min(200, amount)) : 100;
}
function setCameraZoom(value) {
  cameraZoom = cameraZoomPercent(value);
  $('cameraZoom').value = cameraZoom;
  $('cameraZoom').setAttribute('aria-valuetext', `${cameraZoom} persen`);
  $('cameraZoomValue').textContent = `${cameraZoom}%`;
  updateButtons();
  if (cameraReady && !photo) render();
}
function drawCameraFrame(source, context = ctx, mirrored = false, zoomPercent = 100) {
  const size = resizePhotoCanvas(context.canvas, source);
  if (!size) return;
  const { sw, sh, width, height } = size;
  // Fill the requested 3:4 format with the smallest centred crop. This keeps
  // the image undistorted and border-free; additional zoom is user-controlled.
  const factor = cameraZoomPercent(zoomPercent) / 100;
  const baseWidth = Math.min(sw, sh * 3 / 4);
  const cropWidth = baseWidth / factor, cropHeight = baseWidth * 4 / 3 / factor;
  context.save();
  if (mirrored) { context.translate(width, 0); context.scale(-1, 1); }
  context.drawImage(source, (sw - cropWidth) / 2, (sh - cropHeight) / 2, cropWidth, cropHeight, 0, 0, width, height);
  context.restore();
}
async function openCameraStream(requestedFacing) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('INSECURE');
  const constraints = { facingMode: { ideal: requestedFacing }, width: { ideal: 1280 } };
  // Keep the camera's native aspect ratio instead of requesting a 3:4 crop.
  if (navigator.mediaDevices.getSupportedConstraints?.().resizeMode) constraints.resizeMode = { exact: 'none' };
  let candidate;
  try {
    candidate = await navigator.mediaDevices.getUserMedia({ audio: false, video: constraints });
  } catch (error) {
    if (error.name !== 'OverconstrainedError' || !constraints.resizeMode) throw error;
    delete constraints.resizeMode;
    candidate = await navigator.mediaDevices.getUserMedia({ audio: false, video: constraints });
  }
  // Reset zoom only when the browser already exposes this camera setting.
  // Cameras without zoom controls, or a rejected reset, remain usable.
  try {
    const track = candidate.getVideoTracks?.()[0];
    const zoom = track?.getCapabilities?.().zoom;
    const currentZoom = track?.getSettings?.().zoom;
    if (Number.isFinite(zoom?.min) && zoom.min > 0 && Number.isFinite(currentZoom) && currentZoom > zoom.min && track.applyConstraints) {
      const current = track.getConstraints?.() || constraints;
      await track.applyConstraints({ ...current, advanced: [...(current.advanced || []), { zoom: zoom.min }] });
    }
  } catch { /* Best effort; do not block a camera that cannot reset zoom. */ }
  return candidate;
}
function paintTimestamp(context, date, shift, identity, location, options = {}) {
  if (!date) return;
  const width = context.canvas?.width || 1200, height = context.canvas?.height || 1600;
  const scale = Math.min(width / 1200, height / 1600);
  const panelHeight = 304 * scale, panelTop = height - panelHeight;
  // Retain the reference layout while anchoring its footer to the actual photo.
  if (options.addLogo !== false && logo.complete && logo.naturalWidth) context.drawImage(logo, 58 * scale, 59 * scale, 198 * scale, 88 * scale);
  if (options.oldStamp) {
    const coverHeight = Math.max(19, Math.min(45, Number(options.coverPercent) || 20)) * height / 100;
    context.fillStyle = '#251a18';
    context.fillRect(0, height - coverHeight, width, coverHeight);
  }
  context.fillStyle = 'rgba(32, 19, 9, 0.53)';
  context.fillRect(0, panelTop, width, panelHeight);
  context.save();
  context.font = `bold ${36 * scale}px "Courier New", monospace`;
  context.textBaseline = 'top';
  context.fillStyle = '#fff';
  context.shadowColor = 'rgba(0,0,0,0.75)';
  context.shadowBlur = 3 * scale;
  context.shadowOffsetX = scale;
  context.shadowOffsetY = 2 * scale;
  overlayLines(date, shift, identity, location).forEach((line, i) => context.fillText(line, 35 * scale, panelTop + (14 + i * 46) * scale, width - 70 * scale));
  context.restore();
}
function drawOverlay() {
  paintTimestamp(ctx, timestamp, selectedShift, officer, manualLocation);
}
function render() {
  if (photo) drawCameraFrame(photo, ctx);
  else if (cameraReady) drawCameraFrame(video, ctx, facingMode === 'user', cameraZoom);
  else { ctx.fillStyle = '#101c2a'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
  if (photo || cameraReady) drawOverlay();
  syncCameraStage(canvas, $('cameraViewfinder'));
  $('singleDimensions').textContent = `${canvas.width} × ${canvas.height} px · Timestamp manual`;
}
function frame(now) {
  if (cameraReady && !photo && now - lastFrame >= 80) { render(); lastFrame = now; }
  requestAnimationFrame(frame);
}
function stopCamera() {
  cameraGeneration++;
  openingCamera = false;
  if (stream) stream.getTracks().forEach(track => track.stop());
  stream = null;
  video.srcObject = null;
  cameraReady = false;
  updateButtons();
}
async function startCamera() {
  if (openingCamera) return;
  stopCamera();
  openingCamera = true;
  const generation = cameraGeneration;
  $('startCamera').disabled = true;
  updateButtons();
  setStatus('Membuka kamera…');
  setCameraZoom(100);
  try {
    const candidate = await openCameraStream(facingMode);
    if (generation !== cameraGeneration) { candidate.getTracks().forEach(track => track.stop()); return; }
    stream = candidate;
    const actualFacing = candidate.getVideoTracks?.()[0]?.getSettings?.().facingMode;
    if (actualFacing === 'user' || actualFacing === 'environment') facingMode = actualFacing;
    video.srcObject = stream;
    await video.play();
    if (generation !== cameraGeneration) return;
    if (!video.videoWidth) await new Promise(resolve => video.addEventListener('loadeddata', resolve, { once: true }));
    if (generation !== cameraGeneration) return;
    photo = null;
    cameraReady = true;
    $('capture').textContent = '● Ambil foto';
    $('emptyState').hidden = true;
    setStatus('Kamera aktif', true);
    message('Pratinjau 3:4 mengikuti hasil foto. Atur posisi dan pembesaran, lalu tekan Ambil foto.');
    render();
  } catch (error) {
    if (generation !== cameraGeneration) return;
    stopCamera();
    setStatus(photo ? 'Foto siap' : 'Kamera belum aktif');
    const errors = {
      NotAllowedError: 'Akses kamera ditolak. Izinkan kamera melalui pengaturan situs, lalu coba lagi. Kamu juga bisa memilih foto.',
      NotFoundError: 'Kamera tidak ditemukan. Gunakan tombol Pilih foto.',
      NotReadableError: 'Kamera sedang digunakan aplikasi lain. Tutup aplikasi itu, lalu coba lagi.'
    };
    message(errors[error.name] || 'Kamera memerlukan HTTPS atau localhost. Jalankan sesuai panduan, atau gunakan Pilih foto.', true);
  } finally {
    if (generation === cameraGeneration || !openingCamera) {
      openingCamera = false;
      $('startCamera').disabled = false;
      updateButtons();
    }
  }
}
function capturePhoto() {
  if (!cameraReady || !timestamp || !validOfficer(officer)) return;
  // Save the clean frame separately so editing the date never stacks overlays.
  const raw = document.createElement('canvas');
  const rawCtx = raw.getContext('2d');
  drawCameraFrame(video, rawCtx, facingMode === 'user', cameraZoom);
  photo = raw;
  stopCamera();
  randomizeCoordinates();
  setStatus('Foto siap diunduh', true);
  $('emptyState').hidden = true;
  message('Foto siap. Tanggal dan dinas masih bisa diubah sebelum diunduh.');
  $('capture').textContent = 'Ambil ulang';
  $('capture').disabled = false;
  render();
  if (typeof saveSingleDraft === 'function') saveSingleDraft();
}
async function loadPhoto(file) {
  if (!file) return;
  if (!file.type.startsWith('image/')) { message('Pilih file gambar JPG, PNG, atau WebP.', true); return; }
  if (file.size > 30 * 1024 * 1024) { message('Foto terlalu besar. Gunakan gambar di bawah 30 MB.', true); return; }
  const image = new Image();
  const url = URL.createObjectURL(file);
  try {
    image.src = url;
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('invalid');
    stopCamera();
    photo = image;
    randomizeCoordinates();
    $('emptyState').hidden = true;
    $('capture').textContent = 'Ambil selfie';
    setStatus('Foto siap diunduh', true);
    message('Foto dipaskan ke 3:4 tanpa tepi tambahan. Timestamp sudah terpasang.');
    updateButtons();
    render();
    if (typeof saveSingleDraft === 'function') saveSingleDraft(file);
  } catch {
    message('Gambar tidak dapat dibaca. Coba gunakan JPG atau PNG.', true);
  } finally {
    URL.revokeObjectURL(url);
    $('photoInput').value = '';
  }
}
function downloadPhoto() {
  if (!photo || !timestamp || !validOfficer(officer) || !logo.naturalWidth) return;
  render();
  const stamp = new Date(timestamp);
  const shift = selectedShift;
  const officerFilename = officer.name.replace(/[^A-Z0-9]+/g, '_').slice(0, 80);
  canvas.toBlob(blob => {
    if (!blob) { message('Unduhan gagal. Coba kembali.', true); return; }
    if (currentBlobUrl) URL.revokeObjectURL(currentBlobUrl);
    currentBlobUrl = URL.createObjectURL(blob);
    const date = `${stamp.getUTCFullYear()}-${pad(stamp.getUTCMonth() + 1)}-${pad(stamp.getUTCDate())}`;
    const a = document.createElement('a');
    a.href = currentBlobUrl;
    a.download = `IMO_${officerFilename}_${date}_${shift}_${timeText(stamp).replaceAll(':', '-')}.jpg`;
    document.body.append(a); a.click(); a.remove();
    message('Foto JPG diunduh. Cek folder unduhan atau gunakan Simpan ke Foto di ponsel.');
  }, 'image/jpeg', 0.95);
}
dateInput.min = '1900-01-01';
dateInput.max = '9999-12-31';
dateInput.value = jakartaToday();
const jakartaHour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jakarta', hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
selectedShift = jakartaHour >= 22 || jakartaHour < 7 ? 'MALAM' : jakartaHour >= 15 ? 'SIANG' : 'PAGI';
loadOfficers();
document.querySelector(`input[name="shift"][value="${selectedShift}"]`).checked = true;
dateInput.addEventListener('input', () => refreshTimestamp(timeMode !== 'manual'));
document.querySelectorAll('input[name="shift"]').forEach(input => input.addEventListener('change', () => { selectedShift = input.value; refreshTimestamp(timeMode !== 'manual'); }));
$('manualTime').addEventListener('input', () => { timeMode = 'manual'; refreshTimestamp(false); });
$('officerName').addEventListener('input', readOfficerFields);
$('officerNipp').addEventListener('input', readOfficerFields);
$('saveOfficer').addEventListener('click', saveOfficer);
$('savedOfficer').addEventListener('change', selectOfficer);
$('randomizeLocation').addEventListener('click', randomizeCoordinates);
$('randomize').addEventListener('click', () => refreshTimestamp(true));
$('cameraZoom').addEventListener('input', event => setCameraZoom(event.target.value));
$('resetCameraZoom').addEventListener('click', () => setCameraZoom(100));
$('startCamera').addEventListener('click', startCamera);
$('switchCamera').addEventListener('click', () => { facingMode = facingMode === 'user' ? 'environment' : 'user'; startCamera(); });
$('capture').addEventListener('click', () => { if (cameraReady) capturePhoto(); else startCamera(); });
$('photoInput').addEventListener('change', event => loadPhoto(event.target.files[0]));
$('download').addEventListener('click', downloadPhoto);
window.addEventListener('pagehide', () => { stopCamera(); if (currentBlobUrl) URL.revokeObjectURL(currentBlobUrl); });
logo.onload = () => { updateButtons(); render(); };
logo.onerror = () => message('Logo gagal dimuat. Pastikan semua file paket berada dalam satu folder.', true);
// LOGO_DATA is filled below with the supplied reference logo, so local files
// work without external assets and never taint the download canvas.
logo.src = 'data:image/png;base64,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';
setCameraZoom(100);
refreshTimestamp(true);
requestAnimationFrame(frame);
