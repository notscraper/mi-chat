self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || 'Nuevo mensaje';
  
  const options = {
    body: data.body || 'Tienes un nuevo mensaje en el chat.',
    icon: 'https://cdn-icons-png.flaticon.com/512/134/134937.png',
    badge: 'https://cdn-icons-png.flaticon.com/512/134/134937.png',
    vibrate: [100, 50, 100],
    
    // ESTAS DOS LÍNEAS AGRUPAN LAS NOTIFICACIONES:
    tag: 'chat-room-notification', // Agrupa todos los mensajes bajo el mismo ID
    renotify: true                 // Hace sonar/vibrar el teléfono con cada mensaje nuevo
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
