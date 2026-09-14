const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e7 }); // Soporta adjuntos grandes

app.use(express.static('public'));

// Conexión MongoDB (Asegúrate de colocar tu URI correcta)
const mongoURI = process.env.MONGO_URI || 'mongodb://localhost:27017/chatapp';
mongoose.connect(mongoURI)
  .then(() => console.log('MongoDB Conectado'))
  .catch(err => console.error('Error Mongo:', err));

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
  reactions: { type: Map, of: String, default: {} } // { "nombreUsuario": "👍" }
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

    // Cargar historial
    const history = await Message.find({ room }).sort({ _id: 1 });
    socket.emit('loadHistory', history);
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

    await newMsg.save();
    io.to(data.room).emit('newMessage', newMsg);
  });

  // Marcar Mensajes como Leídos (Doble Check Azul)
  socket.on('markAsRead', async ({ room, user }) => {
    await Message.updateMany(
      { room, readBy: { $ne: user } },
      { $addToSet: { readBy: user } }
    );
    io.to(room).emit('messagesRead', { user });
  });

  // Reacciones Rápidas
  socket.on('toggleReaction', async ({ messageId, room, user, emoji }) => {
    const msg = await Message.findById(messageId);
    if (msg) {
      if (!msg.reactions) msg.reactions = new Map();
      
      if (msg.reactions.get(user) === emoji) {
        msg.reactions.delete(user); // Quitar si presiona el mismo
      } else {
        msg.reactions.set(user, emoji); // Agregar o actualizar
      }
      
      await msg.save();
      io.to(room).emit('reactionUpdated', { messageId, reactions: Object.fromEntries(msg.reactions) });
    }
  });

  // Editar Mensaje
  socket.on('editMessage', async ({ messageId, room, newText }) => {
    await Message.findByIdAndUpdate(messageId, { message: newText, isEdited: true });
    io.to(room).emit('messageEdited', { messageId, newText });
  });

  // Eliminar Mensaje
  socket.on('deleteMessage', async ({ messageId, room }) => {
    await Message.findByIdAndDelete(messageId);
    io.to(room).emit('messageDeleted', { messageId });
  });

  socket.on('typing', ({ room, user }) => {
    socket.to(room).emit('userTyping', user);
  });

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

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Servidor activo en puerto ${PORT}`));
