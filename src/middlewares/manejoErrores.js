// ✅ MIDDLEWARE GLOBAL DE MANEJO DE ERRORES
const manejoErrores = (err, req, res, next) => {
  try {
    // ✅ LOGGING COMPLETO DEL ERROR
    const errorInfo = {
      message: err.message,
      stack: err.stack,
      endpoint: `${req.method} ${req.path}`,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      userId: req.user?.id || 'anonymous',
      timestamp: new Date().toISOString(),
      requestId: req.requestId || Math.random().toString(36).substr(2, 9)
    };

    console.error('🚨 ERROR GLOBAL:', errorInfo);

    // ✅ NO CONTINUAR SI YA SE ENVIARON HEADERS
    if (res.headersSent) {
      console.warn('⚠️ Headers ya enviados, delegando al handler por defecto');
      return next(err);
    }

    // ✅ DETERMINAR STATUS CODE
    let statusCode = err.status || err.statusCode || 500;
    let message = err.message || 'Error interno del servidor';
    let code = err.code || 'INTERNAL_ERROR';

    // ✅ MANEJO ESPECÍFICO POR TIPO DE ERROR
    if (err.name === 'ValidationError') {
      // Error de validación de Mongoose
      statusCode = 400;
      message = 'Errores de validación';
      code = 'MONGOOSE_VALIDATION_ERROR';
      
      const validationErrors = Object.values(err.errors).map(e => ({
        field: e.path,
        message: e.message,
        kind: e.kind,
        value: e.value
      }));

      return res.status(statusCode).json({
        success: false,
        message,
        code,
        errors: validationErrors,
        requestId: errorInfo.requestId,
        timestamp: errorInfo.timestamp
      });
    }

    if (err.name === 'CastError') {
      // Error de casting de Mongoose (ej: ID inválido)
      statusCode = 400;
      message = `Formato inválido para el campo ${err.path}`;
      code = 'INVALID_FORMAT';
    }

    if (err.code === 11000) {
      // Error de duplicado de MongoDB
      statusCode = 409;
      message = 'Ya existe un registro con esos datos';
      code = 'DUPLICATE_ENTRY';
      
      // Extraer el campo duplicado
      const field = Object.keys(err.keyValue)[0];
      const value = err.keyValue[field];
      
      return res.status(statusCode).json({
        success: false,
        message: `Ya existe un registro con ${field}: "${value}"`,
        code,
        field,
        value,
        requestId: errorInfo.requestId,
        timestamp: errorInfo.timestamp
      });
    }

    if (err.name === 'MulterError') {
      // Errores de Multer (archivos)
      statusCode = 400;
      code = 'FILE_UPLOAD_ERROR';
      
      switch (err.code) {
        case 'LIMIT_FILE_SIZE':
          message = 'Archivo demasiado grande';
          break;
        case 'LIMIT_FILE_COUNT':
          message = 'Demasiados archivos';
          break;
        case 'LIMIT_UNEXPECTED_FILE':
          message = 'Campo de archivo inesperado';
          break;
        default:
          message = `Error subiendo archivo: ${err.message}`;
      }
    }

    if (err.name === 'MongoNetworkError' || err.name === 'MongooseServerSelectionError') {
      // Errores de conexión a MongoDB
      statusCode = 503;
      message = 'Error de conexión con la base de datos';
      code = 'DATABASE_CONNECTION_ERROR';
    }

    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      // Errores JWT que no se capturaron en el middleware de auth
      statusCode = 401;
      message = 'Token de autenticación inválido';
      code = 'AUTH_TOKEN_ERROR';
    }

    // ✅ RESPUESTA SEGÚN ENTORNO
    const errorResponse = {
      success: false,
      message,
      code,
      requestId: errorInfo.requestId,
      timestamp: errorInfo.timestamp
    };

    // En desarrollo, incluir más información
    if (process.env.NODE_ENV !== 'production') {
      errorResponse.stack = err.stack;
      errorResponse.debug = {
        name: err.name,
        originalMessage: err.message,
        path: req.path,
        method: req.method,
        body: req.body,
        query: req.query,
        params: req.params
      };
    }

    // ✅ LOG ADICIONAL PARA ERRORES 5XX
    if (statusCode >= 500) {
      console.error('💥 ERROR CRÍTICO DEL SERVIDOR:', {
        ...errorInfo,
        env: process.env.NODE_ENV,
        nodeVersion: process.version,
        memory: process.memoryUsage(),
        uptime: process.uptime()
      });

      // En producción, notificar a servicios de monitoreo
      if (process.env.NODE_ENV === 'production') {
        // Aquí podrías integrar con Sentry, LogRocket, etc.
        // notifyErrorService(errorInfo);
      }
    }

    res.status(statusCode).json(errorResponse);

  } catch (handlingError) {
    // ✅ FALLBACK SI FALLA EL MANEJO DE ERRORES
    console.error('💥 ERROR CRÍTICO EN MANEJO DE ERRORES:', handlingError);
    
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: 'Error crítico del sistema',
        code: 'ERROR_HANDLER_FAILURE',
        timestamp: new Date().toISOString()
      });
    }
  }
};

// ✅ MIDDLEWARE PARA RUTAS NO ENCONTRADAS
const notFound = (req, res) => {
  const message = `Endpoint ${req.method} ${req.originalUrl} no encontrado`;
  
  console.warn('🔍 Ruta no encontrada:', {
    method: req.method,
    path: req.originalUrl,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    timestamp: new Date().toISOString()
  });

  res.status(404).json({
    success: false,
    message,
    code: 'ROUTE_NOT_FOUND',
    availableEndpoints: [
      'GET /health',
      'POST /api/v1/auth/login',
      'POST /api/v1/auth/register',
      'GET /api/v1/users',
      'POST /api/v1/movements'
    ],
    timestamp: new Date().toISOString()
  });
};

// ✅ MIDDLEWARE PARA GENERAR REQUEST ID
const generateRequestId = (req, res, next) => {
  req.requestId = Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
  res.setHeader('X-Request-ID', req.requestId);
  next();
};

module.exports = {
  manejoErrores,
  notFound,
  generateRequestId
};

// Exportación por defecto para compatibilidad
module.exports.default = manejoErrores;
