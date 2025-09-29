const jwt = require('jsonwebtoken');
const User = require('../models/User');

// ✅ CONFIGURACIÓN SEGURA DE JWT
const JWT_CONFIG = {
  secret: process.env.JWT_SECRET,
  refreshSecret: process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET,
  options: {
    issuer: 'supervitec-api',
    audience: 'supervitec-app',
    algorithms: ['HS256']
  }
};

// ✅ VALIDAR CONFIGURACIÓN AL INICIALIZAR
if (!JWT_CONFIG.secret || JWT_CONFIG.secret.length < 32) {
  console.error('❌ CRÍTICO: JWT_SECRET debe tener al menos 32 caracteres');
  if (process.env.NODE_ENV === 'production') {
    process.exit(1);
  }
}

// ✅ MIDDLEWARE PRINCIPAL DE AUTENTICACIÓN
const authMiddleware = async (req, res, next) => {
  try {
    // Obtener token del header
    const authHeader = req.headers.authorization || req.headers['x-access-token'];
    
    if (!authHeader) {
      return res.status(401).json({
        success: false,
        message: 'Token de acceso requerido',
        code: 'NO_TOKEN',
        timestamp: new Date().toISOString()
      });
    }

    // Extraer token (soporta Bearer y token directo)
    let token;
    if (authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    } else {
      token = authHeader;
    }

    if (!token || token.trim().length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Token vacío o inválido',
        code: 'EMPTY_TOKEN',
        timestamp: new Date().toISOString()
      });
    }

    // ✅ VERIFICAR Y DECODIFICAR TOKEN
    let decoded;
    try {
      decoded = jwt.verify(token, JWT_CONFIG.secret, JWT_CONFIG.options);
    } catch (jwtError) {
      console.warn('🔐 Token inválido:', {
        error: jwtError.message,
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        timestamp: new Date().toISOString()
      });

      // Respuestas específicas por tipo de error
      if (jwtError.name === 'TokenExpiredError') {
        return res.status(401).json({
          success: false,
          message: 'Token expirado, inicia sesión nuevamente',
          code: 'TOKEN_EXPIRED',
          expiredAt: jwtError.expiredAt,
          timestamp: new Date().toISOString()
        });
      }

      if (jwtError.name === 'JsonWebTokenError') {
        return res.status(401).json({
          success: false,
          message: 'Token inválido o corrupto',
          code: 'INVALID_TOKEN',
          timestamp: new Date().toISOString()
        });
      }

      if (jwtError.name === 'NotBeforeError') {
        return res.status(401).json({
          success: false,
          message: 'Token aún no es válido',
          code: 'TOKEN_NOT_ACTIVE',
          timestamp: new Date().toISOString()
        });
      }

      return res.status(401).json({
        success: false,
        message: 'Error de autenticación',
        code: 'AUTH_ERROR',
        timestamp: new Date().toISOString()
      });
    }

    // ✅ VALIDAR ESTRUCTURA DEL TOKEN
    if (!decoded.userId) {
      return res.status(401).json({
        success: false,
        message: 'Token inválido - falta información de usuario',
        code: 'INVALID_TOKEN_STRUCTURE',
        timestamp: new Date().toISOString()
      });
    }

    // ✅ VERIFICAR TIPO DE TOKEN
    if (decoded.type && decoded.type !== 'access') {
      return res.status(401).json({
        success: false,
        message: 'Tipo de token incorrecto',
        code: 'WRONG_TOKEN_TYPE',
        timestamp: new Date().toISOString()
      });
    }

    // ✅ AGREGAR INFORMACIÓN DEL USUARIO AL REQUEST
    req.user = {
      id: decoded.userId,
      userId: decoded.userId, // Compatibilidad
      role: decoded.userRole || 'trabajador',
      rol: decoded.userRole || 'trabajador', // Compatibilidad
      iat: decoded.iat,
      exp: decoded.exp,
      tokenType: decoded.type || 'access'
    };

    // ✅ LOG DE ACCESO PARA AUDITORÍA
    console.log('🔐 Acceso autorizado:', {
      userId: req.user.id,
      role: req.user.role,
      endpoint: `${req.method} ${req.path}`,
      ip: req.ip,
      timestamp: new Date().toISOString()
    });

    next();

  } catch (error) {
    console.error('❌ Error crítico en middleware de autenticación:', error);
    return res.status(500).json({
      success: false,
      message: 'Error interno de autenticación',
      code: 'AUTH_INTERNAL_ERROR',
      timestamp: new Date().toISOString()
    });
  }
};

// ✅ MIDDLEWARE PARA VERIFICAR ROLES ESPECÍFICOS
const requireRole = (...allowedRoles) => {
  return (req, res, next) => {
    try {
      // Verificar que el usuario esté autenticado
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: 'Usuario no autenticado',
          code: 'NOT_AUTHENTICATED',
          timestamp: new Date().toISOString()
        });
      }

      const userRole = req.user.role || req.user.rol;
      const rolesArray = allowedRoles.flat(); // Permitir arrays anidados

      // Verificar si el usuario tiene alguno de los roles permitidos
      if (!rolesArray.includes(userRole)) {
        console.warn('🚫 Acceso denegado por rol:', {
          userId: req.user.id,
          userRole,
          requiredRoles: rolesArray,
          endpoint: `${req.method} ${req.path}`,
          ip: req.ip,
          timestamp: new Date().toISOString()
        });

        return res.status(403).json({
          success: false,
          message: 'Permisos insuficientes para acceder a este recurso',
          code: 'INSUFFICIENT_PERMISSIONS',
          required: rolesArray,
          current: userRole,
          timestamp: new Date().toISOString()
        });
      }

      next();
    } catch (error) {
      console.error('❌ Error en verificación de roles:', error);
      return res.status(500).json({
        success: false,
        message: 'Error interno verificando permisos',
        code: 'ROLE_CHECK_ERROR',
        timestamp: new Date().toISOString()
      });
    }
  };
};

// ✅ MIDDLEWARE PARA VERIFICAR QUE EL USUARIO EXISTE Y ESTÁ ACTIVO
const verifyUserExists = async (req, res, next) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        message: 'Token inválido - falta información de usuario',
        code: 'MISSING_USER_INFO',
        timestamp: new Date().toISOString()
      });
    }

    // Buscar usuario en la base de datos
    const user = await User.findById(req.user.id)
      .select('-contrasena -tokenRecuperacion -expiraTokenRecuperacion')
      .lean();

    if (!user) {
      console.warn('👻 Usuario no encontrado en BD:', {
        userId: req.user.id,
        ip: req.ip,
        timestamp: new Date().toISOString()
      });

      return res.status(401).json({
        success: false,
        message: 'Usuario no encontrado',
        code: 'USER_NOT_FOUND',
        timestamp: new Date().toISOString()
      });
    }

    if (!user.activo) {
      console.warn('🚫 Usuario desactivado intentó acceder:', {
        userId: req.user.id,
        email: user.correo_electronico,
        ip: req.ip,
        timestamp: new Date().toISOString()
      });

      return res.status(403).json({
        success: false,
        message: 'Cuenta desactivada. Contacta al administrador.',
        code: 'ACCOUNT_DISABLED',
        timestamp: new Date().toISOString()
      });
    }

    // Agregar datos completos del usuario al request
    req.currentUser = user;
    req.user.email = user.correo_electronico;
    req.user.fullName = user.nombre_completo;
    req.user.isActive = user.activo;

    next();

  } catch (error) {
    console.error('❌ Error verificando existencia de usuario:', error);
    return res.status(500).json({
      success: false,
      message: 'Error interno verificando usuario',
      code: 'USER_VERIFICATION_ERROR',
      timestamp: new Date().toISOString()
    });
  }
};

// ✅ MIDDLEWARE OPCIONAL (NO FALLA SI NO HAY TOKEN)
const optionalAuth = async (req, res, next) => {
  const authHeader = req.headers.authorization || req.headers['x-access-token'];
  
  if (!authHeader) {
    // No hay token, continuar sin autenticación
    return next();
  }

  try {
    // Usar el middleware de autenticación normal
    await authMiddleware(req, res, next);
  } catch (error) {
    // Si hay error, continuar sin autenticación (pero log del error)
    console.warn('⚠️ Token opcional inválido, continuando sin auth:', error.message);
    next();
  }
};

// ✅ COMBINACIONES ÚTILES DE MIDDLEWARES
const requireAdmin = [authMiddleware, requireRole('admin')];
const requireSupervisor = [authMiddleware, requireRole('admin', 'supervisor')];
const requireAuthenticatedUser = [authMiddleware, verifyUserExists];

// ✅ EXPORTACIONES
module.exports = {
  // Middlewares individuales
  authMiddleware,
  requireRole,
  verifyUserExists,
  optionalAuth,
  
  // Combinaciones útiles
  requireAdmin,
  requireSupervisor,
  requireAuthenticatedUser,
  
  // Configuración (para testing)
  JWT_CONFIG
};

// Exportación por defecto para compatibilidad
module.exports.default = authMiddleware;
