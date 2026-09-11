self.addEventListener('push', (event) => {
  let data = {};
  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data = { title: 'Nuevo mensaje', body: event.data.text() };
    }
  }

  const title = data.title || 'Nuevo mensaje';
  const options = {
    body: data.body || 'Tienes un mensaje nuevo.',
    icon: 'https://cdn-icons-png.flaticon.com/512/134/134937.png',
    badge: 'https://cdn-icons-png.flaticon.com/512/134/134937.png',
    vibrate: [100, 50, 100],
    
    // AGRUPACIÓN DE NOTIFICACIONES:
    tag: 'chat-room-notification', // Reemplaza la notificación anterior en lugar de amontonarlas
    renotify: true                 // Hace sonar/vibrar el celular con cada nuevo mensaje
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.openWindow('/')
  );
});
