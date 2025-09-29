const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    console.log('📡 Intentando conectar a MongoDB...');
    console.log('📡 URI:', process.env.MONGO_URI?.replace(/\/\/([^:]+):([^@]+)@/, '//$1:***@'));
    
    // ✅ CONFIGURACIÓN CORRECTA PARA MONGODB 7.x
    const conn = await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 10000, // 10 segundos
      socketTimeoutMS: 45000, // 45 segundos
      family: 4 // IPv4
    });

    console.log(`✅ MongoDB conectado: ${conn.connection.host}`);
    console.log(`📂 Base de datos: ${conn.connection.name}`);
    
    return conn;
    
  } catch (error) {
    console.error('🚨 ERROR CRÍTICO - No se pudo conectar a MongoDB:');
    console.error('❌ Error:', error.message);
    console.error('🔧 Verifica:');
    console.error('   - URL de MongoDB en MONGO_URI');
    console.error('   - Credenciales de acceso');
    console.error('   - Conexión a internet');
    console.error('   - Whitelist de IP en MongoDB Atlas');
    
    // En desarrollo, reintentar; en producción, fallar
    if (process.env.NODE_ENV !== 'production') {
      console.error('🔄 Reintentando conexión en 5 segundos...');
      setTimeout(() => connectDB(), 5000);
    } else {
      process.exit(1);
    }
  }
};

// ✅ MANEJAR EVENTOS DE CONEXIÓN
mongoose.connection.on('connected', () => {
  console.log('🔗 Mongoose conectado a MongoDB');
});

mongoose.connection.on('error', (error) => {
  console.error('❌ Error de conexión MongoDB:', error.message);
});

mongoose.connection.on('disconnected', () => {
  console.log('📴 Mongoose desconectado de MongoDB');
});

module.exports = connectDB;
