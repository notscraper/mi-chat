const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
  maxHttpBufferSize: 1e7 // Límite de 10MB para poder enviar imágenes y audios
});
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

// Configuración de la Base de Datos SQLite
const db = new sqlite3.Database('./chat_history.db', (err) => {
  if (err) console.error('Error al abrir la base de datos:', err);
  else console.log('Base de datos conectada.');
});

// Crear tabla para mensajes si no existe
db.run(`CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room TEXT,
  user TEXT,
  text TEXT,
  file TEXT,
  fileType TEXT,
  time TEXT,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
)`);

app.use(express.static(path.join(__dirname, 'public')));

io.on('connection', (socket) => {
  let currentRoom = '';

  // Al unirse a una sala, enviar el historial guardado
  socket.on('joinRoom', (roomId) => {
    if (currentRoom) socket.leave(currentRoom);
    currentRoom = roomId;
    socket.join(roomId);

    // Cargar mensajes pasados de esta sala
    db.all(`SELECT user, text, file, fileType, time FROM messages WHERE room = ? ORDER BY id ASC`, [roomId], (err, rows) => {
      if (!err && rows) {
        socket.emit('loadHistory', rows);
      }
    });
  });

  // Guardar y retransmitir nuevo mensaje
  socket.on('sendMessage', (data) => {
    if (data.room) {
      const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const userStr = data.user || 'Anónimo';
      const textStr = data.message || '';
      const fileData = data.file || null;
      const fileType = data.fileType || null;

      // Insertar mensaje en la base de datos
      db.run(
        `INSERT INTO messages (room, user, text, file, fileType, time) VALUES (?, ?, ?, ?, ?, ?)`,
        [data.room, userStr, textStr, fileData, fileType, timeStr],
        function (err) {
          if (!err) {
            io.to(data.room).emit('newMessage', {
              user: userStr,
              message: textStr,
              file: fileData,
              fileType: fileType,
              time: timeStr
            });
          }
        }
      );
    }
  });

  // Notificación de "Escribiendo..."
  socket.on('typing', (data) => {
    socket.to(data.room).emit('userTyping', data.user);
  });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
  console.log(`Servidor activo en puerto ${PORT}`);
});
