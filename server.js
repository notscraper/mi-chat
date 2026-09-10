const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

app.use(express.static(path.join(__dirname, 'public')));

io.on('connection', (socket) => {
  let currentRoom = '';

  socket.on('joinRoom', (roomId) => {
    if (currentRoom) socket.leave(currentRoom);
    currentRoom = roomId;
    socket.join(roomId);
  });

  socket.on('sendMessage', (data) => {
    if (data.room && data.message) {
      io.to(data.room).emit('newMessage', {
        user: data.user || 'Anónimo',
        message: data.message,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      });
    }
  });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
  console.log(`Servidor en puerto ${PORT}`);
});
