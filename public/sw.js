// 건축사업 사업성 검토기 — Service Worker v6.0
const CACHE = "feasibility-v6";
const ASSETS = ["/", "/index.html", "/manifest.json"];

// 설치: 핵심 파일 캐시
self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

// 활성화: 오래된 캐시 삭제
self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// 요청 처리: 네트워크 우선 → 캐시 폴백
self.addEventListener("fetch", e => {
  // 외부 도메인(토지이음 등)은 캐시하지 않음
  if (!e.request.url.startsWith(self.location.origin)) return;

  e.respondWith(
    fetch(e.request)
      .then(res => {
        // 성공 시 캐시 업데이트
        if (res && res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
