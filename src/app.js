const express = require('express');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const morgan = require('morgan');
const helmet = require('helmet');
const compression = require('compression');
const hpp = require('hpp');
const xss = require('xss-clean');
const mongoSanitize = require('express-mongo-sanitize');

// ✅ IMPORTACIONES LOCALES
const routes = require('./routes');
const { manejoErrores, notFound, generateRequestId } = require('./middlewares/manejoErrores');

// ✅ CREAR APLICACIÓN EXPRESS
const app = express();

// ✅ CONFIGURACIÓN DE CONFIANZA EN PROXIES (PARA RENDER/HEROKU/AWS)
app.set('trust proxy', process.env.TRUST_PROXY === 'true' || 1);

// ✅ LOGGING AVANZADO CON MORGAN
const morganFormat = process.env.NODE_ENV === 'production' 
  ? 'combined' // Formato estándar Apache para producción
  : 'dev';     // Formato colorido para desarrollo

app.use(morgan(morganFormat, {
  // Solo loggear errores en producción para reducir ruido
  skip: (req, res) => process.env.NODE_ENV === 'production' && res.statusCode < 400,
  
  // Función personalizada para logs críticos
  stream: {
    write: (message) => {
      if (process.env.NODE_ENV === 'production') {
        console.log(message.trim());
      } else {
        process.stdout.write(message);
      }
    }
  }
}));

// ✅ MIDDLEWARE DE SEGURIDAD CON HELMET
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"]
    }
  },
  crossOriginEmbedderPolicy: false, // Para compatibilidad con algunos frontends
  hsts: {
    maxAge: 31536000, // 1 año
    includeSubDomains: true,
    preload: true
  }
}));

// ✅ COMPRESIÓN GZIP/DEFLATE PARA MEJOR RENDIMIENTO
app.use(compression({
  level: 6, // Balance entre velocidad y compresión
  threshold: 1024, // Solo comprimir respuestas > 1KB
  filter: (req, res) => {
    // No comprimir si el cliente no lo soporta
    if (req.headers['x-no-compression']) {
      return false;
    }
    return compression.filter(req, res);
  }
}));

// ✅ CORS CONFIGURADO PARA PRODUCCIÓN
const corsOptions = {
  origin: function (origin, callback) {
    // Lista de dominios permitidos
    const allowedOrigins = [
      'http://localhost:3000',      // Desarrollo React
      'http://localhost:5000
      ',      // Desarrollo alternativo
      'http://localhost:8081',     // Expo web
      'https://supervitec-app.netlify.app',   // Frontend en Netlify
      'https://back-end-fjnh.onrender.com/api/v1',    // Frontend en Vercel
      'https://www.supervitecapp.com',        // Dominio personalizado
      'https://back-end-fjnh.onrender.com',            // Dominio sin www
      process.env.FRONTEND_URL,               // URL del frontend desde ENV
    ].filter(Boolean); // Remover valores undefined/null

    // Permitir requests sin origin (apps móviles, Postman, etc)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.warn('🚫 CORS bloqueado para origen:', origin);
      callback(new Error('Origen no permitido por CORS'));
    }
  },
  credentials: true, // Permitir cookies y headers de autenticación
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: [
    'Origin',
    'X-Requested-With', 
    'Content-Type', 
    'Accept',
    'Authorization',
    'x-access-token',
    'X-Request-ID'
  ],
  exposedHeaders: ['X-Request-ID', 'X-RateLimit-Limit', 'X-RateLimit-Remaining'],
  optionsSuccessStatus: 200 // Para compatibilidad con navegadores legacy
};

app.use(cors(corsOptions));

// ✅ MIDDLEWARE PARA GENERAR REQUEST ID
app.use(generateRequestId);

// ✅ PARSEO DE JSON CON LÍMITES DE SEGURIDAD
app.use(express.json({ 
  limit: process.env.JSON_LIMIT || '10mb',
  verify: (req, res, buf, encoding) => {
    // Guardar el buffer raw para verificaciones de webhook si es necesario
    req.rawBody = buf;
  }
}));

app.use(express.urlencoded({ 
  extended: true, 
  limit: process.env.URL_ENCODED_LIMIT || '10mb'
}));

// ✅ SANITIZACIÓN CONTRA ATAQUES NoSQL Y XSS
app.use(mongoSanitize({
  replaceWith: '_', // Reemplazar caracteres peligrosos
  onSanitize: ({ req, key }) => {
    console.warn('🧹 Sanitización aplicada:', { key, path: req.path });
  }
}));

app.use(xss({
  filterTags: {
    script: false, // Remover completamente tags <script>
    iframe: false  // Remover completamente tags <iframe>
  }
}));

// ✅ PROTECCIÓN CONTRA HTTP PARAMETER POLLUTION
app.use(hpp({
  whitelist: ['tags', 'filters', 'sort'] // Parámetros que pueden tener múltiples valores
}));

// ✅ RATE LIMITING INTELIGENTE POR RUTAS
const createRateLimit = (windowMs, max, message, skipIf = null) => {
  return rateLimit({
    windowMs,
    max,
    message: {
      success: false,
      message,
      code: 'RATE_LIMIT_EXCEEDED',
      timestamp: new Date().toISOString()
    },
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => {
      // Saltar rate limiting si se cumple la condición
      if (skipIf && skipIf(req)) return true;
      
      // Saltar para IPs de confianza (opcional)
      const trustedIPs = process.env.TRUSTED_IPS?.split(',') || [];
      return trustedIPs.includes(req.ip);
    },
    keyGenerator: (req) => {
      // Usar combinación de IP y user ID si está disponible
      return req.user?.id ? `${req.ip}:${req.user.id}` : req.ip;
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
};

// ✅ RATE LIMITS ESPECÍFICOS POR TIPO DE OPERACIÓN
const authLimiter = createRateLimit(
  15 * 60 * 1000, // 15 minutos
  5, // 5 intentos de login por IP
  'Demasiados intentos de autenticación, intenta en 15 minutos'
);

const generalLimiter = createRateLimit(
  15 * 60 * 1000, // 15 minutos
  100, // 100 requests generales por IP
  'Demasiadas solicitudes, intenta más tarde'
);

const strictLimiter = createRateLimit(
  15 * 60 * 1000, // 15 minutos
  10, // Solo 10 requests para operaciones críticas
  'Límite de operaciones críticas alcanzado'
);

const uploadLimiter = createRateLimit(
  60 * 60 * 1000, // 1 hora
  20, // 20 uploads por hora
  'Límite de subidas alcanzado, intenta en una hora'
);

// ✅ APLICAR RATE LIMITS POR RUTAS
app.use('/api/v1/auth/login', authLimiter);
app.use('/api/v1/auth/register', authLimiter);
app.use('/api/v1/auth/forgot-password', authLimiter);
app.use('/api/v1/admin/login', authLimiter);

// Rate limit más estricto para operaciones admin
app.use('/api/v1/admin', strictLimiter);

// Rate limit para uploads y exports
app.use('/api/v1/admin/export', uploadLimiter);
app.use('/api/v1/upload', uploadLimiter);

// Rate limit general para todas las demás rutas
app.use('/api', generalLimiter);

// ✅ MIDDLEWARE PARA LOGS DE REQUEST EN PRODUCCIÓN
if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    const start = Date.now();
    
    res.on('finish', () => {
      const duration = Date.now() - start;
      
      // Solo loggear requests lentos o errores
      if (duration > 1000 || res.statusCode >= 400) {
        console.log(`🐌 Slow/Error request: ${req.method} ${req.path} - ${res.statusCode} - ${duration}ms - ${req.ip}`);
      }
    });
    
    next();
  });
}

// ✅ HEALTH CHECK ENDPOINT (ANTES DE LAS RUTAS PRINCIPALES)
app.get('/health', (req, res) => {
  res.json({
    success: true,
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    version: process.env.npm_package_version || '1.0.0',
    environment: process.env.NODE_ENV || 'development'
  });
});

app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'SupervitecApp API is running 🚀',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// ✅ RUTAS PRINCIPALES
app.use('/api/v1', routes);

// ✅ RUTA RAÍZ INFORMATIVA
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'SupervitecApp API v1.0 - Sistema de Seguridad y Salud en el Trabajo 🚀',
    documentation: '/api/v1',
    health: '/health',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    endpoints: {
      auth: '/api/v1/auth',
      movements: '/api/v1/movements',
      admin: '/api/v1/admin',
      users: '/api/v1/users',
      dashboard: '/api/v1/dashboard'
    }
  });
});

// ✅ MIDDLEWARE PARA MANEJAR RUTAS NO ENCONTRADAS
app.use('*', notFound);

// ✅ MIDDLEWARE GLOBAL DE MANEJO DE ERRORES (DEBE IR AL FINAL)
app.use(manejoErrores);

// ✅ MANEJO DE ERRORES NO CAPTURADOS
process.on('unhandledRejection', (err) => {
  console.error('💥 UNHANDLED PROMISE REJECTION:', err);
  if (process.env.NODE_ENV === 'production') {
    // En producción, registrar el error pero no cerrar el proceso inmediatamente
    console.error('🔄 Continuando ejecución en producción...');
  } else {
    // En desarrollo, cerrar el proceso
    process.exit(1);
  }
});

process.on('uncaughtException', (err) => {
  console.error('💥 UNCAUGHT EXCEPTION:', err);
  console.error('📴 Cerrando aplicación...');
  process.exit(1);
});

// ✅ GRACEFUL SHUTDOWN
process.on('SIGTERM', () => {
  console.log('📴 SIGTERM recibido, cerrando servidor graciosamente...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('📴 SIGINT recibido, cerrando servidor graciosamente...');
  process.exit(0);
});

module.exports = app;
