require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');

// ✅ IMPORTACIONES LOCALES
const connectDB = require('./src/config/mongo');

// ✅ RUTAS - USANDO TRY-CATCH PARA EVITAR ERRORES
const getRoute = (routePath, fallbackName) => {
  try {
    return require(routePath);
  } catch (error) {
    console.warn(`⚠️ ${fallbackName} no disponible:`, error.message);
    return null;
  }
};

const authRoutes = getRoute('./src/routes/auth', 'Auth routes');
const dashboardRoutes = getRoute('./src/routes/dashboard', 'Dashboard routes'); 
const userRoutes = getRoute('./src/routes/users', 'User routes');
const movementRoutes = getRoute('./src/routes/movements', 'Movement routes');
const adminRoutes = getRoute('./src/routes/admin', 'Admin routes');

// ✅ TAREAS PROGRAMADAS
let iniciarTareasProgramadas;
try {
  iniciarTareasProgramadas = require('./src/cron/exportarReporteMensual');
} catch (error) {
  console.warn('⚠️ Tareas programadas no disponibles:', error.message);
  iniciarTareasProgramadas = () => console.log('📅 Tareas programadas deshabilitadas');
}

const app = express();
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';

// ✅ CONFIGURACIÓN DE TRUST PROXY (CRÍTICO PARA RENDER)
app.set('trust proxy', 1);

// ✅ CONFIGURACIÓN DE SEGURIDAD PARA PRODUCCIÓN
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https:"],
    },
  },
  crossOriginEmbedderPolicy: false
}));

// ✅ COMPRESIÓN GZIP PARA MEJORAR RENDIMIENTO
app.use(compression({
  level: 6,
  threshold: 1024,
  filter: (req, res) => {
    if (req.headers['x-no-compression']) {
      return false;
    }
    return compression.filter(req, res);
  }
}));

// ✅ LOGGING PARA PRODUCCIÓN
if (NODE_ENV === 'production') {
  app.use(morgan('combined', {
    skip: (req, res) => res.statusCode < 400
  }));
} else {
  app.use(morgan('dev'));
}

// ✅ RATE LIMITING MÁS ESTRICTO PARA PRODUCCIÓN
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW || 15) * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || 100),
  message: {
    success: false,
    message: 'Demasiadas peticiones desde esta IP, intenta más tarde',
    retryAfter: Math.ceil(parseInt(process.env.RATE_LIMIT_WINDOW || 15)),
    code: 'RATE_LIMIT_EXCEEDED'
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    return req.ip || req.connection.remoteAddress;
  },
  skip: (req) => {
    return req.url === '/api/v1/system/health' || 
           req.url === '/health' ||
           req.url === '/';
  },
  onLimitReached: (req, res, options) => {
    console.warn('🚨 Rate limit alcanzado:', {
      ip: req.ip,
      path: req.path,
      method: req.method,
      userAgent: req.get('User-Agent'),
      timestamp: new Date().toISOString()
    });
  }
});

// ✅ APLICAR RATE LIMIT ESPECÍFICO POR RUTAS
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: {
    success: false,
    message: 'Demasiados intentos de autenticación, intenta en 15 minutos',
    code: 'AUTH_RATE_LIMIT_EXCEEDED'
  }
});

app.use('/api/v1/auth/login', authLimiter);
app.use('/api/v1/auth/register', authLimiter);
if (adminRoutes) {
  app.use('/api/v1/admin/login', authLimiter);
}
app.use('/api', limiter);

// ✅ CORS CONFIGURADO DINÁMICAMENTE PARA PRODUCCIÓN
const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    
    const allowedOrigins = process.env.CORS_ORIGINS 
      ? process.env.CORS_ORIGINS.split(',').map(url => url.trim())
      : [
          'http://localhost:3000',
          'http://localhost:3000', 
          'http://localhost:8081',
          'http://localhost:3000',
          'https://back-end-fjnh.onrender.com',
          'https://supervitec-app.netlify.app',
          'https://supervitec-app.vercel.app',
          'exp://localhost:8081'
        ];
    
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.warn('❌ CORS blocked origin:', origin);
      callback(new Error(`CORS: Origin ${origin} not allowed`));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type', 
    'Authorization', 
    'X-Requested-With',
    'Accept',
    'Origin'
  ],
  exposedHeaders: ['X-Total-Count', 'X-Page-Count']
};

app.use(cors(corsOptions));

// ✅ PARSERS CON LÍMITES DE SEGURIDAD
const maxFileSize = process.env.MAX_FILE_SIZE || '10mb';
app.use(express.json({ 
  limit: maxFileSize,
  verify: (req, res, buf, encoding) => {
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({ extended: true, limit: maxFileSize }));

// ✅ MIDDLEWARE DE REQUEST ID PARA TRACKING
app.use((req, res, next) => {
  req.requestId = require('crypto').randomBytes(16).toString('hex');
  res.setHeader('X-Request-ID', req.requestId);
  next();
});

// ✅ MIDDLEWARE DE LOGGING PERSONALIZADO MEJORADO
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  const ip = req.ip || req.connection.remoteAddress;
  const userAgent = req.get('User-Agent') || 'Unknown';
  
  if (NODE_ENV !== 'production' || req.path.includes('/auth/')) {
    console.log(`📡 [${timestamp}] ${req.method} ${req.path} - IP: ${ip} - UA: ${userAgent.substring(0, 50)} - ID: ${req.requestId}`);
  }
  next();
});

// ✅ ENDPOINT RAÍZ INFORMATIVO
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'SupervitecApp API v1.0 - Sistema de Seguridad y Salud en el Trabajo 🚀',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    environment: NODE_ENV,
    documentation: '/api/v1',
    health: '/health',
    endpoints: {
      auth: authRoutes ? '/api/v1/auth' : 'No disponible',
      dashboard: dashboardRoutes ? '/api/v1/dashboard' : 'No disponible',
      users: userRoutes ? '/api/v1/users' : 'No disponible',
      movements: movementRoutes ? '/api/v1/movements' : 'No disponible',
      admin: adminRoutes ? '/api/v1/admin' : 'No disponible'
    }
  });
});

// ✅ RUTAS API CON VERIFICACIÓN DE EXISTENCIA
if (authRoutes) {
  app.use('/api/v1/auth', authRoutes);
  console.log('✅ Rutas auth cargadas');
} else {
  console.warn('⚠️ Rutas auth no disponibles - creando ruta temporal');
  // ✅ RUTA TEMPORAL DE AUTH SI FALLA LA PRINCIPAL
  app.post('/api/v1/auth/login', async (req, res) => {
    try {
      const User = require('./src/models/User');
      const jwt = require('jsonwebtoken');
      const { correo_electronico, contrasena } = req.body;

      if (!correo_electronico || !contrasena) {
        return res.status(400).json({
          success: false,
          message: 'Email y contraseña son requeridos'
        });
      }

      const user = await User.findOne({ correo_electronico }).select('+contrasena');
      if (!user || !user.activo) {
        return res.status(401).json({
          success: false,
          message: 'Credenciales inválidas'
        });
      }

      const isValid = await bcrypt.compare(contrasena, user.contrasena);
      if (!isValid) {
        return res.status(401).json({
          success: false,
          message: 'Credenciales inválidas'
        });
      }

      const token = jwt.sign({ 
        id: user._id, 
        rol: user.rol 
      }, process.env.JWT_SECRET, { expiresIn: '24h' });

      res.json({
        success: true,
        message: 'Login exitoso',
        data: {
          usuario: {
            id: user._id,
            nombre_completo: user.nombre_completo,
            correo_electronico: user.correo_electronico,
            rol: user.rol
          },
          token
        }
      });

    } catch (error) {
      console.error('Error en login temporal:', error);
      res.status(500).json({
        success: false,
        message: 'Error interno del servidor'
      });
    }
  });
}

if (dashboardRoutes) {
  app.use('/api/v1/dashboard', dashboardRoutes);
  console.log('✅ Rutas dashboard cargadas');
}

if (userRoutes) {
  app.use('/api/v1/users', userRoutes);
  console.log('✅ Rutas users cargadas');
}

if (movementRoutes) {
  app.use('/api/v1/movements', movementRoutes);
  console.log('✅ Rutas movements cargadas');
}

if (adminRoutes) {
  app.use('/api/v1/admin', adminRoutes);
  console.log('✅ Rutas admin cargadas');
}

// ✅ ENDPOINTS DE SISTEMA PARA MONITOREO
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    service: 'SupervitecApp Backend',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    uptime: `${Math.floor(process.uptime())}s`,
    environment: NODE_ENV,
    memory: {
      used: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`,
      total: `${Math.round(process.memoryUsage().heapTotal / 1024 / 1024)}MB`,
      external: `${Math.round(process.memoryUsage().external / 1024 / 1024)}MB`
    },
    requestId: req.requestId
  });
});

app.get('/api/v1/system/health', (req, res) => {
  res.json({
    status: 'OK',
    message: 'SupervitecApp Backend funcionando correctamente',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: '1.0.0',
    environment: NODE_ENV,
    routes_loaded: {
      auth: !!authRoutes,
      dashboard: !!dashboardRoutes,
      users: !!userRoutes,
      movements: !!movementRoutes,
      admin: !!adminRoutes
    },
    requestId: req.requestId
  });
});

app.get('/api/v1/system/db-status', async (req, res) => {
  try {
    const mongoose = require('mongoose');
    const dbState = mongoose.connection.readyState;
    const states = {
      0: 'disconnected',
      1: 'connected',
      2: 'connecting',
      3: 'disconnecting'
    };

    res.json({
      status: 'OK',
      database: {
        state: states[dbState],
        name: mongoose.connection.name || 'N/A',
        host: mongoose.connection.host || 'N/A',
        isConnected: dbState === 1
      },
      timestamp: new Date().toISOString(),
      requestId: req.requestId
    });
  } catch (error) {
    console.error('❌ Error verificando DB:', error);
    res.status(500).json({
      status: 'ERROR',
      message: 'Error al verificar estado de la base de datos',
      error: NODE_ENV === 'development' ? error.message : 'Database connection error',
      timestamp: new Date().toISOString(),
      requestId: req.requestId
    });
  }
});

// ✅ FUNCIÓN DE INICIALIZACIÓN MEJORADA
const startServer = async () => {
  try {
    console.log('🚀 ================================');
    console.log('🚀 INICIANDO SUPERVITECAPP BACKEND');
    console.log('🚀 ================================');
    console.log(`🌍 Entorno: ${NODE_ENV}`);
    console.log(`🚪 Puerto: ${PORT}`);
    console.log(`📡 MongoDB URI: ${process.env.MONGO_URI ? 'Configurado ✅' : 'No configurado ❌'}`);

    // ✅ CONECTAR A BASE DE DATOS
    console.log('📡 Conectando a MongoDB...');
    await connectDB();
    console.log('✅ MongoDB conectado exitosamente');

    // ✅ CREAR ÍNDICES AUTOMÁTICAMENTE
    await crearIndicesBasicos();

    // ✅ INICIALIZAR USUARIO ADMINISTRADOR
    console.log('👤 Inicializando usuario administrador...');
    await initializeAdmin();
    console.log('✅ Usuario administrador inicializado');

    // ✅ INICIALIZAR TAREAS PROGRAMADAS
    if (typeof iniciarTareasProgramadas === 'function' && NODE_ENV === 'production') {
      console.log('📅 Inicializando tareas programadas...');
      iniciarTareasProgramadas();
      console.log('✅ Tareas programadas iniciadas');
    } else {
      console.log('📅 Tareas programadas omitidas (desarrollo)');
    }

    // ✅ MIDDLEWARE DE MANEJO DE ERRORES (DEBE IR AL FINAL)
    app.use((err, req, res, next) => {
      console.error('❌ Error global capturado:', {
        error: err.message,
        stack: NODE_ENV === 'development' ? err.stack : undefined,
        path: req.path,
        method: req.method,
        ip: req.ip,
        requestId: req.requestId,
        timestamp: new Date().toISOString()
      });

      res.status(err.status || 500).json({
        success: false,
        message: NODE_ENV === 'development' ? err.message : 'Error interno del servidor',
        code: err.code || 'INTERNAL_ERROR',
        requestId: req.requestId,
        timestamp: new Date().toISOString()
      });
    });

    // ✅ MANEJO DE RUTAS NO ENCONTRADAS
    app.use('*', (req, res) => {
      console.warn('🔍 Ruta no encontrada:', {
        method: req.method,
        path: req.originalUrl,
        ip: req.ip,
        requestId: req.requestId
      });

      res.status(404).json({
        success: false,
        message: `Endpoint ${req.method} ${req.originalUrl} no encontrado`,
        code: 'ENDPOINT_NOT_FOUND',
        availableEndpoints: [
          'GET /',
          'GET /health',
          'GET /api/v1/system/health',
          'GET /api/v1/system/db-status',
          authRoutes ? 'POST /api/v1/auth/login' : null,
          authRoutes ? 'POST /api/v1/auth/register' : null,
          dashboardRoutes ? 'GET /api/v1/dashboard/stats' : null,
          userRoutes ? 'GET /api/v1/users' : null,
          movementRoutes ? 'POST /api/v1/movements' : null,
          adminRoutes ? 'POST /api/v1/admin/login' : null
        ].filter(Boolean),
        requestId: req.requestId,
        timestamp: new Date().toISOString()
      });
    });

    // ✅ INICIAR SERVIDOR
    const server = app.listen(PORT, '0.0.0.0', () => {
      console.log('🚀 ================================');
      console.log('✅ SUPERVITEC BACKEND ONLINE');
      console.log(`🌐 Puerto: ${PORT}`);
      console.log(`🌍 Entorno: ${NODE_ENV}`);
      console.log(`🏥 Health Check: http://localhost:${PORT}/health`);
      console.log(`📊 API Health: http://localhost:${PORT}/api/v1/system/health`);
      console.log(`🗄️  DB Status: http://localhost:${PORT}/api/v1/system/db-status`);
      
      // ✅ MOSTRAR RUTAS CARGADAS
      console.log('📋 Rutas cargadas:');
      console.log(`   Auth: ${authRoutes ? '✅' : '❌'}`);
      console.log(`   Dashboard: ${dashboardRoutes ? '✅' : '❌'}`);
      console.log(`   Users: ${userRoutes ? '✅' : '❌'}`);
      console.log(`   Movements: ${movementRoutes ? '✅' : '❌'}`);
      console.log(`   Admin: ${adminRoutes ? '✅' : '❌'}`);
      
      console.log('🚀 ================================');
    });

    // ✅ CONFIGURAR TIMEOUTS PARA PRODUCCIÓN
    server.timeout = 30000;
    server.keepAliveTimeout = 65000;
    server.headersTimeout = 66000;

    // ✅ MANEJO GRACEFUL DE CIERRE
    const gracefulShutdown = (signal) => {
      console.log(`📴 ${signal} recibido. Cerrando servidor gracefully...`);
      
      server.close(async (err) => {
        if (err) {
          console.error('❌ Error cerrando servidor HTTP:', err);
        } else {
          console.log('✅ Servidor HTTP cerrado');
        }

        try {
          const mongoose = require('mongoose');
          await mongoose.connection.close();
          console.log('✅ Conexión MongoDB cerrada');
        } catch (error) {
          console.error('❌ Error cerrando MongoDB:', error);
        }
        
        console.log('✅ Proceso terminado correctamente');
        process.exit(err ? 1 : 0);
      });

      setTimeout(() => {
        console.error('❌ Cierre forzado por timeout');
        process.exit(1);
      }, 10000);
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

    return server;

  } catch (error) {
    console.error('💥 ERROR CRÍTICO AL INICIAR SERVIDOR:');
    console.error(error);
    process.exit(1);
  }
};

// ✅ FUNCIÓN PARA CREAR ÍNDICES BÁSICOS AUTOMÁTICAMENTE
async function crearIndicesBasicos() {
  try {
    const mongoose = require('mongoose');
    const db = mongoose.connection.db;

    await Promise.all([
      db.collection('users').createIndex({ "correo_electronico": 1 }, { unique: true }),
      db.collection('users').createIndex({ "rol": 1, "activo": 1 }),
      db.collection('movements').createIndex({ "user_id": 1, "fecha": -1 }),
      db.collection('movements').createIndex({ "start_location": "2dsphere" })
    ]);
    
    console.log('✅ Índices básicos verificados/creados');
  } catch (error) {
    console.warn('⚠️ Error creando índices básicos:', error.message);
  }
}

// ✅ FUNCIÓN DE INICIALIZACIÓN DE ADMIN MEJORADA
async function initializeAdmin() {
  try {
    const User = require('./src/models/User');
    const adminEmail = process.env.DEFAULT_ADMIN_EMAIL || 'supervitecingenieriasas@gmail.com';
    const adminPass = process.env.DEFAULT_ADMIN_PASSWORD || '5up3r_v1t3c_4dm1n_2024!';

    let admin = await User.findOne({ correo_electronico: adminEmail });

    if (!admin) {
      console.log('🔐 Creando usuario administrador...');
      const hashedPassword = await bcrypt.hash(adminPass, 12);

      admin = new User({
        nombre_completo: 'Administrador SupervitecApp',
        correo_electronico: adminEmail,
        contrasena: hashedPassword,
        region: 'Nacional',
        transporte: 'auto',
        rol: 'admin',
        activo: true,
        fechaCreacion: new Date()
      });

      await admin.save();
      console.log(`✅ Admin creado: ${admin.correo_electronico}`);
      console.log(`🔑 Contraseña inicial: ${adminPass}`);
    } else {
      console.log(`ℹ️ Admin existente: ${admin.correo_electronico}`);
      
      if (!admin.contrasena || !admin.contrasena.startsWith('$2b$')) {
        console.log('🔄 Actualizando contraseña admin...');
        admin.contrasena = await bcrypt.hash(adminPass, 12);
        await admin.save();
        console.log('✅ Contraseña admin actualizada');
      }

      if (!admin.activo) {
        admin.activo = true;
        await admin.save();
        console.log('✅ Admin reactivado');
      }
    }
    
    return admin;
  } catch (error) {
    console.error('❌ Error inicializando admin:', error);
    throw error;
  }
}

// ✅ MANEJO DE ERRORES GLOBALES MEJORADO
process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
  if (NODE_ENV === 'production') {
    console.error('🔄 Continuando en modo producción...');
  } else {
    console.error('📴 Cerrando proceso en desarrollo...');
    process.exit(1);
  }
});

process.on('uncaughtException', (error) => {
  console.error('💥 Uncaught Exception:', error);
  console.error('📴 Cerrando proceso por seguridad...');
  process.exit(1);
});

process.on('warning', (warning) => {
  if (NODE_ENV === 'development') {
    console.warn('⚠️ Warning:', warning.name, warning.message);
  }
});

// ✅ INICIAR SERVIDOR
if (require.main === module) {
  startServer();
}

module.exports = app;
