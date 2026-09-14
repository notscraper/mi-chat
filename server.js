const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
  maxHttpBufferSize: 1e7 // Límite de 10MB
});
const path = require('path');
const mongoose = require('mongoose');
const webpush = require('web-push');

app.use(express.json());

// Claves VAPID para Web Push
const vapidKeys = webpush.generateVAPIDKeys();
webpush.setVapidDetails(
  'mailto:admin@chat.com',
  vapidKeys.publicKey,
  vapidKeys.privateKey
);

// Cadena de conexión a MongoDB Atlas
const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://notscraper_db_user:hfhlekw18@cluster0.mqs5pzm.mongodb.net/chat_db?retryWrites=true&w=majority";

mongoose.connect(MONGO_URI)
  .then(() => console.log('Conectado a MongoDB Atlas'))
  .catch((err) => console.error('Error al conectar con MongoDB:', err));

// Esquema de Mensajes por Sala
const messageSchema = new mongoose.Schema({
  room: String,
  user: String,
  text: String,
  file: String,
  fileType: String,
  time: String,
  createdAt: { type: Date, default: Date.now }
});

// Esquema de Suscripciones Push asociado al Socket y a la Sala
const subscriptionSchema = new mongoose.Schema({
  endpoint: { type: String, unique: true },
  socketId: String,
  room: String,
  keys: Object
});

const Message = mongoose.model('Message', messageSchema);
const Subscription = mongoose.model('Subscription', subscriptionSchema);

app.use(express.static(path.join(__dirname, 'public')));

app.get('/vapidPublicKey', (req, res) => {
  res.send(vapidKeys.publicKey);
});

// Guardar suscripción Push asociada al socket actual y a la sala
app.post('/subscribe', async (req, res) => {
  try {
    const { subscription, socketId, room } = req.body;
    await Subscription.findOneAndUpdate(
      { endpoint: subscription.endpoint },
      { ...subscription, socketId: socketId, room: room },
      { upsert: true, new: true }
    );
    res.status(201).json({ success: true });
  } catch (error) {
    console.error('Error al guardar suscripción Push:', error);
    res.status(500).json({ error: error.message });
  }
});

io.on('connection', (socket) => {
  let currentRoom = '';

  socket.on('joinRoom', async (roomId) => {
    if (currentRoom) socket.leave(currentRoom);
    currentRoom = roomId;
    socket.join(roomId);

    try {
      const history = await Message.find({ room: roomId }).sort({ createdAt: 1 }).exec();
      socket.emit('loadHistory', history);
    } catch (err) {
      console.error('Error al cargar historial:', err);
    }
  });

  socket.on('sendMessage', async (data) => {
    if (data.room) {
      const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const userStr = data.user || 'Anónimo';
      const textStr = data.message || '';
      const fileData = data.file || null;
      const fileKind = data.fileType || null;

      try {
        const newMsg = new Message({
          room: data.room,
          user: userStr,
          text: textStr,
          file: fileData,
          fileType: fileKind,
          time: timeStr
        });

        await newMsg.save();

        io.to(data.room).emit('newMessage', {
          user: userStr,
          message: textStr,
          file: fileData,
          fileType: fileKind,
          time: timeStr
        });

        // Buscar suscripciones en esta sala excluyendo el socket actual del emisor
        const subscriptions = await Subscription.find({ 
          room: data.room, 
          socketId: { $ne: socket.id } 
        });
        
        let bodyText = textStr;
        if (!bodyText) {
          if (fileKind === 'image') bodyText = '📷 Te envió una imagen';
          else if (fileKind === 'audio') bodyText = '🎤 Te envió una nota de voz';
          else bodyText = 'Te envió un archivo multimedia';
        }

        const payload = JSON.stringify({
          title: `Nuevo mensaje de ${userStr}`,
          body: bodyText
        });

        subscriptions.forEach(sub => {
          webpush.sendNotification(sub, payload).catch(err => {
            if (err.statusCode === 410 || err.statusCode === 404) {
              Subscription.deleteOne({ endpoint: sub.endpoint }).exec();
            }
          });
        });

      } catch (err) {
        console.error('Error al procesar mensaje:', err);
      }
    }
  });

  socket.on('typing', (data) => {
    if (data.room) {
      socket.to(data.room).emit('userTyping', data.user || 'Alguien');
    }
  });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
  console.log(`Servidor activo en puerto ${PORT}`);
});
