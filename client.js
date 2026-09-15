// Browser-only client entry. Indoor route points are configured on the uploaded floor plan.
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const state = {
  mapUrl: '',
  audioUrl: '',
  audioName: '',
  location: null,
  mode: 'start',
  start: null,
  exit: null,
  path: [],
  configured: false,
  monitoring: false,
  alarmActive: false,
  alarmHits: 0,
  noiseFloor: 0,
  demoMode: false,
  gpsAnchor: null,
  lastStableGps: null
};

let recorder;
let recorderChunks = [];
let microphoneStream;
let audioContext;
let analyser;
let monitorFrame;
let alarmAudio;
let toastTimer;
let locationWatch;
let frequencyData;
let referenceProfile;
let referenceSequence = [];
let liveSequence = [];
let monitorTicks = 0;

const signatureFrequencies = [250, 350, 500, 700, 900, 1100, 1400, 1700, 2100, 2600, 3200, 4000];

function normalizeProfile(values) {
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  const centered = values.map((value) => value - average);
  const length = Math.sqrt(centered.reduce((sum, value) => sum + (value * value), 0)) || 1;
  return centered.map((value) => value / length);
}

function goertzel(samples, sampleRate, frequency) {
  const size = samples.length;
  const bin = Math.max(1, Math.round((size * frequency) / sampleRate));
  const omega = (2 * Math.PI * bin) / size;
  const coefficient = 2 * Math.cos(omega);
  let previous = 0;
  let previousPrevious = 0;
  for (const sample of samples) {
    const current = (coefficient * previous) - previousPrevious + sample;
    previousPrevious = previous;
    previous = current;
  }
  return Math.max(0, (previous * previous) + (previousPrevious * previousPrevious) - (coefficient * previous * previousPrevious));
}

async function prepareReferenceProfile() {
  referenceProfile = null;
  referenceSequence = [];
  liveSequence = [];
  if (!state.audioUrl || !audioContext) return;
  try {
    const response = await fetch(state.audioUrl);
    const buffer = await response.arrayBuffer();
    const decoded = await audioContext.decodeAudioData(buffer);
    const samples = decoded.getChannelData(0);
    const windowSize = 2048;
    const step = 4096;
    const profile = new Array(signatureFrequencies.length).fill(0);
    let windows = 0;
    for (let offset = 0; offset + windowSize <= samples.length && windows < 40; offset += step) {
      const chunk = samples.subarray(offset, offset + windowSize);
      const power = chunk.reduce((sum, sample) => sum + (sample * sample), 0) / chunk.length;
      if (power < 0.00001) continue;
      const frameProfile = signatureFrequencies.map((frequency) => goertzel(chunk, decoded.sampleRate, frequency));
      signatureFrequencies.forEach((frequency, index) => { profile[index] += frameProfile[index]; });
      referenceSequence.push(normalizeProfile(frameProfile));
      windows += 1;
    }
    if (windows) referenceProfile = normalizeProfile(profile.map((value) => value / windows));
  } catch (error) {
    referenceProfile = null;
  }
}

function liveSpectrumProfile() {
  if (!frequencyData || !audioContext) return null;
  analyser.getByteFrequencyData(frequencyData);
  return normalizeProfile(signatureFrequencies.map((frequency) => {
    const center = Math.round((frequency * analyser.fftSize) / audioContext.sampleRate);
    const radius = Math.max(1, Math.round((120 * analyser.fftSize) / audioContext.sampleRate));
    let energy = 0;
    for (let index = Math.max(0, center - radius); index <= Math.min(frequencyData.length - 1, center + radius); index += 1) energy += frequencyData[index] * frequencyData[index];
    return energy;
  }));
}

function profileMatch(current, reference) {
  if (!current || !reference) return 0;
  return current.reduce((sum, value, index) => sum + (value * reference[index]), 0);
}

function liveSequenceMatch() {
  if (referenceSequence.length < 8 || liveSequence.length < 8) return 0;
  const windowSize = Math.min(20, liveSequence.length, referenceSequence.length);
  const current = liveSequence.slice(-windowSize);
  let best = 0;
  for (let offset = 0; offset <= referenceSequence.length - windowSize; offset += 1) {
    let score = 0;
    for (let index = 0; index < windowSize; index += 1) score += profileMatch(current[index], referenceSequence[offset + index]);
    best = Math.max(best, score / windowSize);
  }
  return best;
}

function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 3200);
}

function switchScreen(screen) {
  $$('.screen').forEach((item) => item.classList.toggle('active', item.id === `${screen}Screen`));
  $('#headerStatus').innerHTML = screen === 'setup' ? '<i></i> Sozlanmagan' : '<i class="ready"></i> Tayyor';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function updateUploadState() {
  const count = Number(Boolean(state.mapUrl)) + Number(Boolean(state.audioUrl));
  $('#uploadCount').textContent = `${count} / 2 tayyor`;
  $('#mapUploadState').textContent = state.mapUrl ? '✓ Tayyor' : 'Yuklash';
  $('#audioUploadState').textContent = state.audioUrl ? '✓ Tayyor' : 'Yuklash';
  $('#mapUploadCard').classList.toggle('uploaded', Boolean(state.mapUrl));
  $('#audioUploadCard').classList.toggle('uploaded', Boolean(state.audioUrl));
  if (state.mapUrl && state.audioUrl) {
    prepareCalibration();
    switchScreen('calibration');
  }
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function handleMapUpload(event) {
  const file = event.target.files?.[0];
  if (!file || !file.type.startsWith('image/')) return showToast('PNG, JPG yoki SVG xarita tanlang');
  state.mapUrl = await readAsDataUrl(file);
  $('#floorPlan').src = state.mapUrl;
  $('#livePlan').src = state.mapUrl;
  $('#editorEmpty').classList.add('hidden');
  showToast('Xarita yuklandi');
  updateUploadState();
}

async function handleAudioUpload(event) {
  const file = event.target.files?.[0];
  if (!file || !file.type.startsWith('audio/')) return showToast('Audio fayl tanlang');
  state.audioUrl = URL.createObjectURL(file);
  state.audioName = file.name;
  showToast('Sirena ovozi yuklandi');
  updateUploadState();
}

function prepareCalibration() {
  $('#floorPlan').src = state.mapUrl;
  $('#livePlan').src = state.mapUrl;
  $('#editorEmpty').classList.add('hidden');
  updateMarkers();
}

function setMode(mode) {
  state.mode = mode;
  $$('.mode-tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.mode === mode));
  const labels = { start: 'Rasmda hozir turgan joyingizni bosing', exit: 'Rasmda favqulodda chiqish joyini bosing', path: 'Chiqishgacha bo‘lgan yo‘l nuqtalarini bosing' };
  showToast(labels[mode]);
}

function pointFromClick(event, element) {
  const rect = element.getBoundingClientRect();
  return { x: Math.max(0, Math.min(100, ((event.clientX - rect.left) / rect.width) * 100)), y: Math.max(0, Math.min(100, ((event.clientY - rect.top) / rect.height) * 100)) };
}

function pointString(point) {
  return `${point.x.toFixed(2)},${point.y.toFixed(2)}`;
}

function updateMarkers() {
  const start = state.start || { x: 0, y: 0 };
  const exit = state.exit || { x: 0, y: 0 };
  const points = state.start && state.exit ? [state.start, ...state.path, state.exit].map(pointString).join(' ') : '';
  $('#routePolyline').setAttribute('points', points);
  $('#startMarker').setAttribute('cx', start.x); $('#startMarker').setAttribute('cy', start.y);
  $('#exitMarker').setAttribute('cx', exit.x); $('#exitMarker').setAttribute('cy', exit.y);
  $('#startLabel').style.left = `${start.x}%`; $('#startLabel').style.top = `${start.y}%`;
  $('#exitLabel').style.left = `${exit.x}%`; $('#exitLabel').style.top = `${exit.y}%`;
  $('#startLabel').classList.toggle('hidden', !state.start);
  $('#exitLabel').classList.toggle('hidden', !state.exit);
  $('#startMarker').style.opacity = state.start ? '1' : '0';
  $('#exitMarker').style.opacity = state.exit ? '1' : '0';
  $('#startStatus').textContent = state.start ? 'Siz turgan joy belgilandi' : 'Siz turgan joy belgilanmagan';
  $('#exitStatus').textContent = state.exit ? 'Chiqish belgilangandi' : 'Chiqish belgilanmagan';
}

function handleFloorClick(event) {
  const point = pointFromClick(event, $('#floorEditor'));
  if (state.mode === 'start') state.start = point;
  if (state.mode === 'exit') state.exit = point;
  if (state.mode === 'path' && state.start && state.exit) state.path.push(point);
  updateMarkers();
}

function updateGoogleLocation() {
  if (!state.location) return;
  const { latitude, longitude } = state.location;
  const query = `${latitude},${longitude}`;
  const link = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
  $('#googleFrame').src = `https://www.google.com/maps?q=${encodeURIComponent(query)}&z=19&output=embed`;
  $('#googleLink').href = link;
  $('#liveGoogleLink').href = link;
  $('#googlePreview').classList.remove('hidden');
  $('#locationStatus').textContent = `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
  $('#liveLocationStatus').textContent = `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
  $('#locationValue').textContent = 'OK';
}

function getLocation() {
  if (!navigator.geolocation) return showToast('Bu qurilmada lokatsiya mavjud emas');
  navigator.geolocation.getCurrentPosition((position) => {
    state.location = position.coords;
    updateGoogleLocation();
    showToast('Google Maps lokatsiyasi olindi');
  }, () => showToast('Lokatsiya ruxsati berilmadi'), { enableHighAccuracy: true, timeout: 10000 });
}

function startLocationWatch() {
  if (!navigator.geolocation) return showToast('Bu qurilmada Google Maps lokatsiyasi mavjud emas');
  if (locationWatch !== undefined) navigator.geolocation.clearWatch(locationWatch);
  $('#liveLocationStatus').textContent = 'Google Maps lokatsiyasi olinmoqda...';
  locationWatch = navigator.geolocation.watchPosition((position) => {
    state.location = position.coords;
    if (!state.gpsAnchor && state.start) state.gpsAnchor = { latitude: position.coords.latitude, longitude: position.coords.longitude, x: state.start.x, y: state.start.y };
    updateGoogleLocation();
    updatePlanPositionFromGps(position.coords);
    $('#locationValue').textContent = 'LIVE';
    $('#liveLocationStatus').textContent = `Jonli GPS: ${position.coords.latitude.toFixed(5)}, ${position.coords.longitude.toFixed(5)}`;
  }, () => {
    $('#liveLocationStatus').textContent = 'Lokatsiya ruxsati kerak';
    showToast('Google Maps uchun lokatsiyaga Allow bering');
  }, { enableHighAccuracy: true, maximumAge: 1000, timeout: 10000 });
}

function stopLocationWatch() {
  if (locationWatch !== undefined && navigator.geolocation) navigator.geolocation.clearWatch(locationWatch);
  locationWatch = undefined;
}

function updatePlanPositionFromGps(coords) {
  if (!state.start || !state.exit || !state.gpsAnchor) return;
  if (coords.accuracy && coords.accuracy > 35) return;
  if (state.lastStableGps) {
    const latMeters = (coords.latitude - state.lastStableGps.latitude) * 111320;
    const lonMeters = (coords.longitude - state.lastStableGps.longitude) * 111320 * Math.cos((state.lastStableGps.latitude * Math.PI) / 180);
    if (Math.sqrt((latMeters * latMeters) + (lonMeters * lonMeters)) < 5) return;
  }
  state.lastStableGps = { latitude: coords.latitude, longitude: coords.longitude };
  const latitudeMeters = (coords.latitude - state.gpsAnchor.latitude) * 111320;
  const longitudeMeters = (coords.longitude - state.gpsAnchor.longitude) * 111320 * Math.cos((state.gpsAnchor.latitude * Math.PI) / 180);
  const current = {
    x: Math.max(0, Math.min(100, state.gpsAnchor.x + (longitudeMeters / 40) * 100)),
    y: Math.max(0, Math.min(100, state.gpsAnchor.y - (latitudeMeters / 28) * 100))
  };
  $('#liveStartMarker').setAttribute('cx', current.x);
  $('#liveStartMarker').setAttribute('cy', current.y);
  $('#liveStartLabel').style.left = `${current.x}%`;
  $('#liveStartLabel').style.top = `${current.y}%`;
  $('#livePolyline').setAttribute('points', [current, ...state.path, state.exit].map(pointString).join(' '));
}

function findMe() {
  if (!state.configured) return showToast('Avval xarita sozlamasini saqlang');
  if (!navigator.geolocation) return showToast('Telefon GPS lokatsiyasini qo‘llamaydi');
  showToast('Google GPS lokatsiyangiz olinmoqda...');
  navigator.geolocation.getCurrentPosition((position) => {
    state.location = position.coords;
    state.gpsAnchor = { latitude: position.coords.latitude, longitude: position.coords.longitude, x: state.start.x, y: state.start.y };
    state.lastStableGps = { latitude: position.coords.latitude, longitude: position.coords.longitude };
    updateGoogleLocation();
    $('#liveLocationStatus').textContent = `Siz shu yerdasiz: ${position.coords.latitude.toFixed(5)}, ${position.coords.longitude.toFixed(5)}`;
    $('#locationValue').textContent = 'LIVE';
    $('#liveStartMarker').setAttribute('cx', state.start.x);
    $('#liveStartMarker').setAttribute('cy', state.start.y);
    $('#liveStartLabel').style.left = `${state.start.x}%`;
    $('#liveStartLabel').style.top = `${state.start.y}%`;
    $('#liveStartLabel').classList.remove('hidden');
    $('#liveMap').classList.add('route-active');
    showToast('GPS olindi. Rasm bilan tezkor kalibratsiya qilindi.');
    startLocationWatch();
  }, () => showToast('GPS ruxsatini bering va qayta urinib ko‘ring'), { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 });
}

function saveRoute() {
  if (!state.start || !state.exit) return showToast('Avval “Siz” va “Chiqish” nuqtalarini belgilang');
  state.configured = true;
  $('#livePolyline').setAttribute('points', [state.start, ...state.path, state.exit].map(pointString).join(' '));
  $('#liveStartMarker').setAttribute('cx', state.start.x); $('#liveStartMarker').setAttribute('cy', state.start.y);
  $('#liveExitMarker').setAttribute('cx', state.exit.x); $('#liveExitMarker').setAttribute('cy', state.exit.y);
  $('#liveStartLabel').style.left = `${state.start.x}%`; $('#liveStartLabel').style.top = `${state.start.y}%`;
  $('#liveExitLabel').style.left = `${state.exit.x}%`; $('#liveExitLabel').style.top = `${state.exit.y}%`;
  $('#liveStartLabel').classList.remove('hidden'); $('#liveExitLabel').classList.remove('hidden');
  state.gpsAnchor = null;
  state.lastStableGps = null;
  startLocationWatch();
  switchScreen('live');
  showToast('Xarita moslandi. Sirena kuzatuvi tayyor.');
  startMonitoring();
}

function showRoute() {
  state.alarmActive = true;
  $('#liveMap').classList.add('route-active');
  $('#waitingCard').classList.add('hidden');
  $('#alertBanner').classList.remove('hidden');
  $('#liveStatus').textContent = 'Sirena aniqlandi';
  $('#distanceValue').textContent = 'Moslangan yo‘l';
  $('#timeValue').textContent = 'Chiqishgacha';
  $('#alarmModal').classList.add('hidden');
}

function playAlarm() {
  if (!state.audioUrl) return;
  if (!alarmAudio) primeAlarmAudio();
  alarmAudio.muted = false;
  alarmAudio.currentTime = 0;
  alarmAudio.play().catch(() => showToast('Telefon media ovozini yoqing'));
  navigator.vibrate?.([500, 250, 500, 250, 700]);
}

function primeAlarmAudio() {
  if (!state.audioUrl) return;
  alarmAudio?.pause();
  alarmAudio = new Audio(state.audioUrl);
  alarmAudio.preload = 'auto';
  alarmAudio.muted = true;
  const unlock = alarmAudio.play();
  unlock?.then(() => {
    alarmAudio.pause();
    alarmAudio.currentTime = 0;
    alarmAudio.muted = false;
  }).catch(() => {});
}

function triggerAlarm() {
  if (!state.configured) return showToast('Avval xaritada chiqish joyini belgilang');
  if (state.alarmActive) return;
  stopMonitoring();
  switchScreen('live');
  playAlarm();
  showRoute();
  showToast('Sirena aniqlandi — moslangan chiqish yo‘li ko‘rsatildi');
}

async function startMonitoring() {
  if (state.monitoring) return;
  if (!navigator.mediaDevices?.getUserMedia) return showToast('Mikrofon kuzatuvi bu brauzerda mavjud emas');
  primeAlarmAudio();
  try {
    try {
      microphoneStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 } });
    } catch (error) {
      microphoneStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    }
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    await audioContext.resume();
    analyser = audioContext.createAnalyser(); analyser.fftSize = 2048; analyser.smoothingTimeConstant = 0.2;
    frequencyData = new Uint8Array(analyser.frequencyBinCount);
    audioContext.createMediaStreamSource(microphoneStream).connect(analyser);
    state.monitoring = true;
    state.alarmActive = false;
    state.alarmHits = 0;
    state.noiseFloor = 0;
    $('#monitorButton').disabled = true;
    $('#monitorButton').textContent = 'Auto tinglash faol';
    monitorTicks = 0;
    await prepareReferenceProfile();
    showToast(referenceProfile ? 'Mikrofon faol. Faqat yuklangan sirena taniladi.' : 'Sirena audiosi analiz qilinmadi. Audio faylni qayta yuklang.');
    $('#monitorButton').textContent = '◉ Kuzatuv faol';
    $('#liveStatus').textContent = 'Sirena kuzatilmoqda';
    monitorSound();
  } catch (error) { showToast('Mikrofon ruxsati berilmadi'); }
}

function stopMonitoring() {
  state.monitoring = false;
  state.alarmHits = 0;
  $('#monitorButton').disabled = true;
  $('#monitorButton').textContent = 'Auto tinglash yoqilgan';
  cancelAnimationFrame(monitorFrame);
  microphoneStream?.getTracks().forEach((track) => track.stop());
  microphoneStream = null;
  audioContext?.close(); audioContext = null;
  analyser = null;
  frequencyData = null;
  referenceProfile = null;
  referenceSequence = [];
  liveSequence = [];
  $('#monitorButton').textContent = '◉ Sirenani kuzatishni boshlash';
}

function monitorSound() {
  if (!state.monitoring || !analyser) return;
  const data = new Uint8Array(analyser.fftSize); analyser.getByteTimeDomainData(data);
  let power = 0; for (const value of data) { const normalized = (value - 128) / 128; power += normalized * normalized; }
  const rms = Math.sqrt(power / data.length);
  const baselineThreshold = Math.max(0.012, state.noiseFloor * 1.35);
  if (!state.noiseFloor || rms < baselineThreshold) state.noiseFloor = state.noiseFloor ? (state.noiseFloor * 0.97) + (rms * 0.03) : rms;
  const threshold = Math.max(0.015, state.noiseFloor * 1.5);
  monitorTicks += 1;
  if (monitorTicks % 6 === 0) {
    const currentProfile = liveSpectrumProfile();
    if (currentProfile) {
      liveSequence.push(currentProfile);
      if (liveSequence.length > 40) liveSequence.shift();
      const signatureMatch = profileMatch(currentProfile, referenceProfile);
      const sequenceMatch = liveSequenceMatch();
      const sirenLike = referenceSequence.length >= 8 && sequenceMatch > 0.78 && signatureMatch > 0.38;
      if (rms > threshold && rms > 0.012 && sirenLike) state.alarmHits += 1;
      else state.alarmHits = Math.max(0, state.alarmHits - 1);
    }
  }
  if (monitorTicks % 8 === 0) $('#liveStatus').textContent = `Mikrofon tinglanmoqda (${Math.round(rms * 100)}%)`;
  if (state.alarmHits >= 5) return triggerAlarm();
  monitorFrame = requestAnimationFrame(monitorSound);
}

function startRecording() {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return showToast('Diktafon bu brauzerda mavjud emas');
  navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
    recorderChunks = []; recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (event) => recorderChunks.push(event.data);
    recorder.onstop = () => { state.audioUrl = URL.createObjectURL(new Blob(recorderChunks, { type: 'audio/webm' })); state.audioName = 'sirena-yozuv.webm'; updateUploadState(); stream.getTracks().forEach((track) => track.stop()); };
    recorder.start(); showToast('Sirena yozilmoqda... to‘xtatish uchun yana audio tanlang');
  }).catch(() => showToast('Mikrofon ruxsati berilmadi'));
}

function loadDemoAssets() {
  if (new URLSearchParams(window.location.search).get('demo') !== '1') return;
  state.demoMode = true;
  state.mapUrl = 'assets/evakuatsiya-xaritasi.jpg';
  state.audioUrl = 'assets/sirena.mp3';
  state.audioName = '11111.mp3';
  updateUploadState();
  state.start = { x: 50, y: 45 };
  state.exit = { x: 42, y: 21 };
  state.path = [{ x: 42, y: 42 }];
  updateMarkers();
  $('#saveRouteButton').textContent = 'Avtomatik tinglashni yoqish →';
  showToast('Chiqish joyi avtomatik belgilandi. Endi tugmani bosing.');
}

function installRouteButton() {
  return;
  const actions = $('.live-actions');
  if (!actions || $('#routeNowButton')) return;
  const button = document.createElement('button');
  button.className = 'primary-button route-now-button';
  button.id = 'routeNowButton';
  button.type = 'button';
  button.textContent = 'Chiqishga yo‘l ko‘rsat';
  button.addEventListener('click', () => {
    if (!state.navigation) return showToast('Avval xarita yo‘lini saqlang');
    showRoute();
  });
  actions.prepend(button);
}

$$('.mode-tab').forEach((tab) => tab.addEventListener('click', () => setMode(tab.dataset.mode)));
$('#floorEditor').addEventListener('click', handleFloorClick);
$('#mapInput').addEventListener('change', handleMapUpload);
$('#audioInput').addEventListener('change', handleAudioUpload);
$('#getLocationButton').addEventListener('click', getLocation);
$('#findMeButton').addEventListener('click', findMe);
$('#saveRouteButton').addEventListener('click', saveRoute);
$('#testAlarmButton').addEventListener('click', triggerAlarm);
$('#showRouteButton').addEventListener('click', showRoute);
$('#monitorButton').addEventListener('click', () => (state.monitoring ? stopMonitoring() : startMonitoring()));
$('#editRouteButton').addEventListener('click', () => { switchScreen('calibration'); updateMarkers(); });
$('#backToSetup').addEventListener('click', () => switchScreen('setup'));
window.addEventListener('beforeunload', stopMonitoring);
window.addEventListener('beforeunload', stopLocationWatch);
$('#monitorButton').disabled = true;
$('#monitorButton').textContent = 'Auto tinglash yoqilgan';
loadDemoAssets();
