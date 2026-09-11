const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
  maxHttpBufferSize: 1e7 // Límite de 10MB para imágenes y audios
});
const path = require('path');
const mongoose = require('mongoose');
const webpush = require('web-push');

// Configuración para recibir JSON en peticiones de suscripción
app.use(express.json());

// Configuración e integración de Web Push con Claves VAPID
const vapidKeys = webpush.generateVAPIDKeys();
webpush.setVapidDetails(
  'mailto:admin@chat.com',
  vapidKeys.publicKey,
  vapidKeys.privateKey
);

// Cadena de conexión a MongoDB Atlas
const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://notscraper_db_user:hfhlekw18@cluster0.mqs5pzm.mongodb.net/chat_db?retryWrites=true&w=majority";

// Conexión a la base de datos en la nube
mongoose.connect(MONGO_URI)
  .then(() => console.log('Conectado exitosamente a MongoDB Atlas'))
  .catch((err) => console.error('Error al conectar con MongoDB:', err));

// Esquema de los mensajes en MongoDB
const messageSchema = new mongoose.Schema({
  room: String,
  user: String,
  text: String,
  file: String,
  fileType: String,
  time: String,
  createdAt: { type: Date, default: Date.now }
});

// Esquema para guardar las suscripciones de los celulares/dispositivos
const subscriptionSchema = new mongoose.Schema({
  endpoint: { type: String, unique: true },
  keys: Object
});

const Message = mongoose.model('Message', messageSchema);
const Subscription = mongoose.model('Subscription', subscriptionSchema);

app.use(express.static(path.join(__dirname, 'public')));

// Ruta para entregar la clave pública VAPID al cliente
app.get('/vapidPublicKey', (req, res) => {
  res.send(vapidKeys.publicKey);
});

// Ruta para guardar la suscripción Push del dispositivo en MongoDB
app.post('/subscribe', async (req, res) => {
  try {
    const subscription = req.body;
    await Subscription.findOneAndUpdate(
      { endpoint: subscription.endpoint },
      subscription,
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

  // Al unirse a una sala, enviar el historial guardado desde MongoDB
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

  // Guardar y retransmitir nuevo mensaje + enviar notificación push
  socket.on('sendMessage', async (data) => {
    if (data.room) {
      const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const userStr = data.user || 'Anónimo';
      const textStr = data.message || '';
      const fileData = data.file || null;
      const fileType = data.fileType || null;

      try {
        const newMsg = new Message({
          room: data.room,
          user: userStr,
          text: textStr,
          file: fileData,
          fileType: fileType,
          time: timeStr
        });

        // Guardado permanente en la nube
        await newMsg.save();

        // Emitir mensaje en tiempo real a los usuarios conectados
        io.to(data.room).emit('newMessage', {
          user: userStr,
          message: textStr,
          file: fileData,
          fileType: fileType,
          time: timeStr
        });

        // Enviar Notificación Push en segundo plano a los dispositivos
        const subscriptions = await Subscription.find();
        let bodyText = textStr;
        if (!bodyText) {
          if (fileType === 'image') bodyText = '📷 Te envió una imagen';
          else if (fileType === 'audio') bodyText = '🎤 Te envió un nota de voz';
          else bodyText = 'Te envió un archivo multimedia';
        }

        const payload = JSON.stringify({
          title: `Nuevo mensaje de ${userStr}`,
          body: bodyText
        });

        subscriptions.forEach(sub => {
          webpush.sendNotification(sub, payload).catch(err => {
            // Si el dispositivo expiró o revocó el permiso, se elimina de la base de datos
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

  // Notificación de "Escribiendo..."
  socket.on('typing', (data) => {
    socket.to(data.room).emit('userTyping', data.user);
  });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
  console.log(`Servidor activo en puerto ${PORT}`);
});
