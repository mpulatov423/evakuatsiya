# Evakuatsiya yordamchisi

Mobil-first prototip: bino xaritasini ko‘rsatadi, xarita/audio yuklashga, sirena yozib olishga, mikrofon kuzatuviga va favqulodda evakuatsiya ekraniga ega.

Manifest va service worker ham qo‘shilgan, shuning uchun localhost/HTTPS orqali telefonga o‘rnatiladigan PWA sifatida sinash mumkin.

## Ishga tushirish

`index.html` faylini brauzerda ochish mumkin, lekin mikrofon va joylashuv ruxsatlari uchun loyihani `localhost` yoki HTTPS orqali ochgan ma’qul. Node.js mavjud bo‘lsa:

```powershell
npm start
```

`npm run dev` buyrug‘i ham xuddi shu serverni ishga tushiradi. 5500-port band bo‘lsa, server avtomatik 5501, 5502 kabi keyingi bo‘sh portni tanlaydi va terminalda aniq manzilni ko‘rsatadi.

Keyin `http://localhost:5500` manzilini oching.

## Prototip cheklovi

Mikrofon kuzatuvi hozir baland ovoz darajasiga asoslangan demo algoritmdir. Haqiqiy mahsulotda sirena fingerprint/audio-classification modeli, Android foreground service, doimiy notification, battery-optimization sozlamalari va indoor positioning (QR/BLE/Wi-Fi) qo‘shilishi kerak.

## Vercel

`package.json` ichidagi `build` skript frontend fayllarini `public` papkasiga chiqaradi. Vercel’da Framework Preset `Other`, Build Command `npm run build`, Output Directory `public` qilib deploy qiling.

## APK yo‘li

Keyingi bosqichda bu frontend Capacitor yoki native Android shell ichiga joylanadi. So‘ng Android Studio orqali debug/release APK olinadi. Flutter kompyuterda o‘rnatilmaganligi sababli prototip hozir brauzerda ishlaydigan, keyinchalik APK’ga o‘raladigan formatda tayyorlandi.
