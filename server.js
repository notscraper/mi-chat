const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
  maxHttpBufferSize: 1e7 // Límite de 10MB para multimedia
});
const path = require('path');
const mongoose = require('mongoose');
const webpush = require('web-push');

app.use(express.json());

// Configuración de claves VAPID para Web Push
const vapidKeys = webpush.generateVAPIDKeys();
webpush.setVapidDetails(
  'mailto:admin@chat.com',
  vapidKeys.publicKey,
  vapidKeys.privateKey
);

// Cadena de conexión a MongoDB Atlas
const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://notscraper_db_user:hfhlekw18@cluster0.mqs5pzm.mongodb.net/chat_db?retryWrites=true&w=majority";

mongoose.connect(MONGO_URI)
  .then(() => console.log('Conectado exitosamente a MongoDB Atlas'))
  .catch((err) => console.error('Error al conectar con MongoDB:', err));

// Esquema de Mensajes con remitente y destinatario
const messageSchema = new mongoose.Schema({
  room: String,
  sender: String,
  receiver: String,
  text: String,
  file: String,
  fileType: String,
  time: String,
  createdAt: { type: Date, default: Date.now }
});

// Esquema de Suscripciones ligado a cada usuario
const subscriptionSchema = new mongoose.Schema({
  endpoint: { type: String, unique: true },
  user: String,
  keys: Object
});

const Message = mongoose.model('Message', messageSchema);
const Subscription = mongoose.model('Subscription', subscriptionSchema);

app.use(express.static(path.join(__dirname, 'public')));

app.get('/vapidPublicKey', (req, res) => {
  res.send(vapidKeys.publicKey);
});

// Registrar o actualizar suscripción Web Push por usuario
app.post('/subscribe', async (req, res) => {
  try {
    const { subscription, user } = req.body;
    if (!user) return res.status(400).json({ error: 'Usuario requerido' });

    await Subscription.findOneAndUpdate(
      { user: user },
      { endpoint: subscription.endpoint, keys: subscription.keys, user: user },
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

  // Unirse a la sala 1 a 1 (ej. "Alex_Sofía")
  socket.on('joinRoom', async ({ sender, receiver }) => {
    if (!sender || !receiver) return;

    // Generar un ID de sala único alfabético para ambos participantes
    const roomId = [sender, receiver].sort().join('_');

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

  // Enviar mensaje privado
  socket.on('sendMessage', async (data) => {
    const { sender, receiver, message, file, fileType } = data;
    if (!sender || !receiver) return;

    const roomId = [sender, receiver].sort().join('_');
    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const textStr = message || '';
    const fileData = file || null;
    const fileKind = fileType || null;

    try {
      const newMsg = new Message({
        room: roomId,
        sender: sender,
        receiver: receiver,
        text: textStr,
        file: fileData,
        fileType: fileKind,
        time: timeStr
      });

      await newMsg.save();

      // Transmitir solo a los integrantes de esta sala
      io.to(roomId).emit('newMessage', {
        sender: sender,
        receiver: receiver,
        text: textStr,
        file: fileData,
        fileType: fileKind,
        time: timeStr
      });

      // Enviar Notificación Push EXCLUSIVAMENTE al destinatario
      const destSubscription = await Subscription.findOne({ user: receiver });

      if (destSubscription) {
        let bodyText = textStr;
        if (!bodyText) {
          if (fileKind === 'image') bodyText = '📷 Te envió una imagen';
          else if (fileKind === 'audio') bodyText = '🎤 Te envió un nota de voz';
          else bodyText = 'Te envió un archivo multimedia';
        }

        const payload = JSON.stringify({
          title: `${sender}`,
          body: bodyText
        });

        webpush.sendNotification(destSubscription, payload).catch(err => {
          if (err.statusCode === 410 || err.statusCode === 404) {
            Subscription.deleteOne({ endpoint: destSubscription.endpoint }).exec();
          }
        });
      }

    } catch (err) {
      console.error('Error al procesar mensaje:', err);
    }
  });

  socket.on('typing', (data) => {
    if (data.sender && data.receiver) {
      const roomId = [data.sender, data.receiver].sort().join('_');
      socket.to(roomId).emit('userTyping', data.sender);
    }
  });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
  console.log(`Servidor activo en puerto ${PORT}`);
});
