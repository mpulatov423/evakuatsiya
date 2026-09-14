const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const state = { mapUploaded: false, audioUploaded: false, currentView: 'setup' };
let toastTimer;
let mediaRecorder;
let audioChunks = [];
let audioContext;
let analyser;
let microphoneStream;
let monitorAnimation;
let isMonitoring = false;
let uploadedAudioUrl;
let currentAlarmAudio;

const viewTitles = { setup: 'Evakuatsiya', map: 'Xarita', recorder: 'Diktafon', settings: 'Sozlamalar' };

function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 3000);
}

function switchView(viewName) {
  state.currentView = viewName;
  $$('.app-view').forEach((view) => view.classList.toggle('active', view.id === `view-${viewName}`));
  $$('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.view === viewName));
  $('#pageTitle').textContent = viewTitles[viewName] || 'Evakuatsiya';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function updateSetupProgress() {
  const count = Number(state.mapUploaded) + Number(state.audioUploaded);
  $('#bottomNav').classList.toggle('hidden', count !== 2);
  $('#settingsButton').classList.toggle('hidden', count !== 2);
  $('#mapUploadState').textContent = state.mapUploaded ? '✓ Yuklandi' : 'Kutilmoqda';
  $('#audioUploadState').textContent = state.audioUploaded ? '✓ Yuklandi' : 'Kutilmoqda';
  $('#mapInput').closest('.first-upload-card').classList.toggle('uploaded', state.mapUploaded);
  $('#audioInput').closest('.first-upload-card').classList.toggle('uploaded', state.audioUploaded);
  $('#settingsMapStatus').textContent = state.mapUploaded ? 'Yuklangan' : 'Kiritilmagan';
  $('#settingsAudioStatus').textContent = state.audioUploaded ? 'Yuklangan' : 'Kiritilmagan';
}

function updateMonitorButton() {
  const button = $('#monitorButton');
  if (!button) return;
  button.innerHTML = isMonitoring ? '<span>◉</span> Sirenani kuzatish faol' : '◌ Sirenani kuzatishni boshlash';
  button.classList.toggle('monitor-active', isMonitoring);
}

function isConfigured() {
  if (!state.mapUploaded || !state.audioUploaded) {
    showToast('Avval xarita va audio faylni kiriting');
    switchView('setup');
    return false;
  }
  return true;
}

function activateRoute() {
  $('#mapCard').classList.add('route-active');
  $('#distanceValue').textContent = '34 m';
  $('#timeValue').textContent = '~ 1 daq';
}

function openAlarm(reason = 'test') {
  if (!isConfigured()) return;
  switchView('map');
  activateRoute();
  $('#alarmModal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  if (reason === 'detected') showToast('Sirena aniqlandi — chiqish yo‘li ko‘rsatildi');
  playAlarmAudio();
}

function closeAlarm() {
  $('#alarmModal').classList.add('hidden');
  document.body.style.overflow = '';
  if (currentAlarmAudio) {
    currentAlarmAudio.pause();
    currentAlarmAudio.currentTime = 0;
    currentAlarmAudio = null;
  }
}

function playAlarmAudio() {
  if (uploadedAudioUrl) {
    currentAlarmAudio = new Audio(uploadedAudioUrl);
    currentAlarmAudio.volume = 1;
    currentAlarmAudio.play().catch(() => showToast('Signalni eshittirish uchun ekranga teging'));
    return;
  }
  try {
    const context = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'sawtooth';
    oscillator.frequency.setValueAtTime(740, context.currentTime);
    oscillator.frequency.linearRampToValueAtTime(440, context.currentTime + 0.5);
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.16, context.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.72);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.75);
  } catch (error) {
    // Brauzer user gesture talab qilsa, modal baribir ko‘rinadi.
  }
}

async function startMonitoring() {
  if (!isConfigured()) return;
  if (!navigator.mediaDevices?.getUserMedia) {
    showToast('Bu brauzer mikrofonni kuzatishni qo‘llamaydi');
    return;
  }
  try {
    microphoneStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioContext.createMediaStreamSource(microphoneStream);
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    isMonitoring = true;
    updateMonitorButton();
    showToast('Sirenani kuzatish boshlandi');
    watchSoundLevel();
  } catch (error) {
    showToast('Mikrofon ruxsati berilmadi');
  }
}

function watchSoundLevel() {
  if (!isMonitoring || !analyser) return;
  const data = new Uint8Array(analyser.fftSize);
  analyser.getByteTimeDomainData(data);
  let sum = 0;
  for (const value of data) {
    const normalized = (value - 128) / 128;
    sum += normalized * normalized;
  }
  const volume = Math.sqrt(sum / data.length);
  // Hozircha demo: baland ovoz trigger bo‘ladi. Keyin sirena fingerprint qo‘shiladi.
  if (volume > 0.34) {
    stopMonitoring();
    openAlarm('detected');
    return;
  }
  monitorAnimation = requestAnimationFrame(watchSoundLevel);
}

function stopMonitoring() {
  isMonitoring = false;
  cancelAnimationFrame(monitorAnimation);
  microphoneStream?.getTracks().forEach((track) => track.stop());
  microphoneStream = null;
  audioContext?.close();
  audioContext = null;
  updateMonitorButton();
}

function showAudioPreview(fileName, url) {
  state.audioUploaded = true;
  uploadedAudioUrl = url;
  const audio = new Audio(url);
  audio.controls = true;
  $('#audioFileStatus').replaceChildren(document.createTextNode(`${fileName} `), audio);
  $('#audioPreview').classList.remove('hidden');
  $('#recorderTitle').textContent = 'Sirena ovozi tayyor';
  $('#recordingStatus').textContent = `${fileName} · favqulodda signal uchun`; 
  updateSetupProgress();
}

function maybeOpenMapAfterSetup() {
  if (state.mapUploaded && state.audioUploaded) {
    showToast('Xarita va audio tayyor — Xarita bo‘limi ochildi');
    switchView('map');
    // Brauzer ruxsati berilgan bo‘lsa, kuzatuv shu yerda boshlanadi.
    startMonitoring();
  }
}

function handleMapUpload(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    showToast('Xarita PNG, JPG yoki SVG bo‘lishi kerak');
    return;
  }
  const url = URL.createObjectURL(file);
  $('#floorPlan').src = url;
  state.mapUploaded = true;
  updateSetupProgress();
  showToast('Evakuatsiya xaritasi yuklandi');
  maybeOpenMapAfterSetup();
}

function handleAudioUpload(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  if (!file.type.startsWith('audio/')) {
    showToast('Audio fayl tanlang');
    return;
  }
  showAudioPreview(file.name, URL.createObjectURL(file));
  showToast('Sirena audiosi yuklandi');
  if (event.target.id === 'audioInput') maybeOpenMapAfterSetup();
}

async function toggleRecording() {
  const recordButton = $('#recordButton');
  if (mediaRecorder?.state === 'recording') {
    mediaRecorder.stop();
    recordButton.classList.remove('recording');
    $('#recordingStatus').textContent = 'Yozuv saqlandi';
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    showToast('Audio yozish bu brauzerda mavjud emas');
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioChunks = [];
    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.addEventListener('dataavailable', (event) => audioChunks.push(event.data));
    mediaRecorder.addEventListener('stop', () => {
      const blob = new Blob(audioChunks, { type: 'audio/webm' });
      showAudioPreview('sirena-yozuv.webm', URL.createObjectURL(blob));
      stream.getTracks().forEach((track) => track.stop());
    });
    mediaRecorder.start();
    recordButton.classList.add('recording');
    $('#recordingStatus').textContent = 'Yozilmoqda... to‘xtatish uchun yana bosing';
  } catch (error) {
    showToast('Mikrofon ruxsati berilmadi');
  }
}

function requestLocation() {
  if (!navigator.geolocation) {
    showToast('Joylashuv xizmati mavjud emas');
    return;
  }
  navigator.geolocation.getCurrentPosition(
    () => showToast('Joylashuv ruxsati berildi'),
    () => showToast('Joylashuv ruxsati berilmadi'),
    { enableHighAccuracy: true, timeout: 8000 }
  );
}

$$('.nav-item').forEach((item) => item.addEventListener('click', () => switchView(item.dataset.view)));
$('#testAlarmButton').addEventListener('click', () => openAlarm('test'));
$('#monitorButton').addEventListener('click', () => (isMonitoring ? stopMonitoring() : startMonitoring()));
$('#recordButton').addEventListener('click', toggleRecording);
$('#mapInput').addEventListener('change', handleMapUpload);
$('#audioInput').addEventListener('change', handleAudioUpload);
$('#recorderAudioInput').addEventListener('change', handleAudioUpload);
$('#settingsMapInput').addEventListener('change', handleMapUpload);
$('#settingsAudioInput').addEventListener('change', handleAudioUpload);
$('#settingsMapButton').addEventListener('click', () => $('#settingsMapInput').click());
$('#settingsAudioButton').addEventListener('click', () => $('#settingsAudioInput').click());
$('#mapLocationButton').addEventListener('click', requestLocation);
$('#permissionLocation').addEventListener('click', requestLocation);
$('#floorSelect').addEventListener('change', (event) => showToast(`${event.target.value}-qavat tanlandi`));
$('#closeAlarmButton').addEventListener('click', closeAlarm);
$('#openMapButton').addEventListener('click', () => { closeAlarm(); switchView('map'); });
window.addEventListener('beforeunload', stopMonitoring);

updateSetupProgress();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
