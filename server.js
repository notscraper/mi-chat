const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');

const app = express();
const server = http.createServer(app);

// Aumentamos el límite para permitir el envío de audio, fotos y videonotas
const io = new Server(server, { 
  maxHttpBufferSize: 1e7 // 10MB
});

app.use(express.static('public'));

// Configuración de la conexión a MongoDB Atlas
// Busca la variable de entorno en Render (MONGO_URI o MONGODB_URI)
const mongoURI = process.env.MONGO_URI || process.env.MONGODB_URI;

if (!mongoURI) {
  console.error('❌ ATENCIÓN: No se encontró la variable de entorno MONGO_URI en Render.');
} else {
  mongoose.connect(mongoURI)
    .then(() => console.log('✅ Conectado exitosamente a MongoDB Atlas'))
    .catch(err => console.error('❌ Error de conexión a Mongo:', err.message));
}

// Esquema del Mensaje
const MessageSchema = new mongoose.Schema({
  room: String,
  user: String,
  message: String,
  file: String,
  fileType: String,
  replyTo: Object,
  time: String,
  isEdited: { type: Boolean, default: false },
  readBy: { type: [String], default: [] },
  reactions: { type: Map, of: String, default: {} }
});

const Message = mongoose.model('Message', MessageSchema);

// Rastreo de Presencia En Línea
const onlineUsers = {}; // { socketId: { room, user } }

io.on('connection', (socket) => {
  
  socket.on('joinRoom', async ({ room, user }) => {
    socket.join(room);
    onlineUsers[socket.id] = { room, user };

    // Emitir lista de usuarios en línea en esta sala
    const usersInRoom = Object.values(onlineUsers)
      .filter(u => u.room === room)
      .map(u => u.user);
    io.to(room).emit('onlineStatus', usersInRoom);

    // Cargar historial de la sala
    try {
      const history = await Message.find({ room }).sort({ _id: 1 });
      socket.emit('loadHistory', history);
    } catch (err) {
      console.error('Error al cargar historial:', err.message);
    }
  });

  socket.on('sendMessage', async (data) => {
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const newMsg = new Message({
      room: data.room,
      user: data.user,
      message: data.message || '',
      file: data.file || '',
      fileType: data.fileType || '',
      replyTo: data.replyTo || null,
      time,
      readBy: [data.user]
    });

    try {
      await newMsg.save();
    } catch (err) {
      console.error('Error al guardar mensaje en Mongo:', err.message);
    }

    io.to(data.room).emit('newMessage', newMsg);
  });

  // Marcar Mensajes como Leídos (Doble Check Azul)
  socket.on('markAsRead', async ({ room, user }) => {
    try {
      await Message.updateMany(
        { room, readBy: { $ne: user } },
        { $addToSet: { readBy: user } }
      );
      io.to(room).emit('messagesRead', { user });
    } catch (err) {
      console.error('Error al marcar leídos:', err.message);
    }
  });

  // Reacciones Rápidas (Emoji)
  socket.on('toggleReaction', async ({ messageId, room, user, emoji }) => {
    try {
      const msg = await Message.findById(messageId);
      if (msg) {
        if (!msg.reactions) msg.reactions = new Map();
        
        if (msg.reactions.get(user) === emoji) {
          msg.reactions.delete(user); // Quita la reacción si toca el mismo emoji
        } else {
          msg.reactions.set(user, emoji); // Agrega o cambia la reacción
        }
        
        await msg.save();
        io.to(room).emit('reactionUpdated', { messageId, reactions: Object.fromEntries(msg.reactions) });
      }
    } catch (err) {
      console.error('Error en reacción:', err.message);
    }
  });

  // Editar Mensaje
  socket.on('editMessage', async ({ messageId, room, newText }) => {
    try {
      await Message.findByIdAndUpdate(messageId, { message: newText, isEdited: true });
      io.to(room).emit('messageEdited', { messageId, newText });
    } catch (err) {
      console.error('Error al editar:', err.message);
    }
  });

  // Eliminar Mensaje
  socket.on('deleteMessage', async ({ messageId, room }) => {
    try {
      await Message.findByIdAndDelete(messageId);
      io.to(room).emit('messageDeleted', { messageId });
    } catch (err) {
      console.error('Error al borrar:', err.message);
    }
  });

  // Escribiendo...
  socket.on('typing', ({ room, user }) => {
    socket.to(room).emit('userTyping', user);
  });

  // Desconexión
  socket.on('disconnect', () => {
    const userInfo = onlineUsers[socket.id];
    if (userInfo) {
      delete onlineUsers[socket.id];
      const usersInRoom = Object.values(onlineUsers)
        .filter(u => u.room === userInfo.room)
        .map(u => u.user);
      io.to(userInfo.room).emit('onlineStatus', usersInRoom);
    }
  });
});

// El puerto asignado dinámicamente por Render o el 3000 por defecto
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Servidor ejecutándose en el puerto ${PORT}`));
