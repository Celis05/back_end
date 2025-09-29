const jwt = require('jsonwebtoken');
const crypto = require('crypto');

// ✅ CONFIGURACIÓN SEGURA Y FLEXIBLE
const JWT_SECRET = process.env.JWT_SECRET;
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET;

// ✅ VALIDAR CONFIGURACIÓN CRÍTICA
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  console.error('❌ CRÍTICO: JWT_SECRET debe tener al menos 32 caracteres');
  if (process.env.NODE_ENV === 'production') {
    process.exit(1);
  }
}

if (!REFRESH_SECRET || REFRESH_SECRET.length < 32) {
  console.error('❌ CRÍTICO: JWT_REFRESH_SECRET debe tener al menos 32 caracteres');
  if (process.env.NODE_ENV === 'production') {
    process.exit(1);
  }
}

// ✅ CONFIGURACIÓN ADAPTATIVA POR ENTORNO
const TOKEN_CONFIG = {
  // Tiempos de expiración
  ACCESS_TOKEN_EXPIRY: process.env.JWT_EXPIRE || '24h', // Cambiado de 15m a 24h para mejor UX
  REFRESH_TOKEN_EXPIRY: process.env.JWT_REFRESH_EXPIRE || '7d',
  
  // Timeouts de actividad
  INACTIVITY_TIMEOUT: parseInt(process.env.INACTIVITY_TIMEOUT) || 30 * 60 * 1000, // 30 min
  MAX_SESSION_TIME: parseInt(process.env.MAX_SESSION_TIME) || 24 * 60 * 60 * 1000, // 24h
  
  // Configuración JWT
  issuer: 'supervitec-api',
  audience: 'supervitec-app',
  algorithm: 'HS256',
  
  // Límites de seguridad
  MAX_REFRESH_TOKENS_PER_USER: parseInt(process.env.MAX_REFRESH_TOKENS) || 5,
  TOKEN_CLEANUP_DAYS: parseInt(process.env.TOKEN_CLEANUP_DAYS) || 7
};

// ✅ GENERAR ACCESS TOKEN SEGURO
const generateAccessToken = (user, options = {}) => {
  try {
    if (!user || !user._id) {
      throw new Error('Usuario requerido para generar token');
    }

    const tokenId = crypto.randomBytes(16).toString('hex');
    const issuedAt = Math.floor(Date.now() / 1000);
    
    const payload = {
      // Información del usuario
      userId: user._id.toString(),
      id: user._id.toString(), // Compatibilidad
      correo_electronico: user.correo_electronico,
      userRole: user.rol,
      rol: user.rol, // Compatibilidad
      nombre_completo: user.nombre_completo,
      
      // Metadatos del token
      tokenId: tokenId,
      type: 'access',
      iat: issuedAt,
      
      // Información de sesión
      sessionInfo: {
        ip: options.ip,
        userAgent: options.userAgent,
        platform: options.platform || 'unknown'
      }
    };

    const token = jwt.sign(payload, JWT_SECRET, {
      expiresIn: TOKEN_CONFIG.ACCESS_TOKEN_EXPIRY,
      issuer: TOKEN_CONFIG.issuer,
      audience: TOKEN_CONFIG.audience,
      algorithm: TOKEN_CONFIG.algorithm
    });

    return {
      token,
      tokenId,
      expiresIn: TOKEN_CONFIG.ACCESS_TOKEN_EXPIRY,
      issuedAt: new Date(issuedAt * 1000),
      type: 'access'
    };

  } catch (error) {
    console.error('❌ Error generando access token:', error);
    throw new Error('Error generando token de acceso');
  }
};

// ✅ GENERAR REFRESH TOKEN SEGURO
const generateRefreshToken = (user, tokenId, options = {}) => {
  try {
    if (!user || !user._id || !tokenId) {
      throw new Error('Usuario y tokenId requeridos para refresh token');
    }

    const issuedAt = Math.floor(Date.now() / 1000);
    
    const payload = {
      userId: user._id.toString(),
      id: user._id.toString(), // Compatibilidad
      userRole: user.rol,
      tokenId: tokenId,
      type: 'refresh',
      iat: issuedAt,
      
      // Información de sesión para tracking
      sessionInfo: {
        ip: options.ip,
        userAgent: options.userAgent,
        createdAt: new Date().toISOString()
      }
    };

    const token = jwt.sign(payload, REFRESH_SECRET, {
      expiresIn: TOKEN_CONFIG.REFRESH_TOKEN_EXPIRY,
      issuer: TOKEN_CONFIG.issuer,
      audience: TOKEN_CONFIG.audience,
      algorithm: TOKEN_CONFIG.algorithm
    });

    return {
      token,
      tokenId,
      expiresIn: TOKEN_CONFIG.REFRESH_TOKEN_EXPIRY,
      issuedAt: new Date(issuedAt * 1000),
      type: 'refresh'
    };

  } catch (error) {
    console.error('❌ Error generando refresh token:', error);
    throw new Error('Error generando refresh token');
  }
};

// ✅ GENERAR PAR DE TOKENS (FUNCIÓN PRINCIPAL)
const generateTokenPair = (user, options = {}) => {
  try {
    const accessTokenData = generateAccessToken(user, options);
    const refreshTokenData = generateRefreshToken(user, accessTokenData.tokenId, options);

    return {
      accessToken: accessTokenData.token,
      refreshToken: refreshTokenData.token,
      tokenId: accessTokenData.tokenId,
      accessTokenExpiry: accessTokenData.expiresIn,
      refreshTokenExpiry: refreshTokenData.expiresIn,
      issuedAt: accessTokenData.issuedAt,
      sessionInfo: {
        ip: options.ip,
        userAgent: options.userAgent,
        platform: options.platform,
        createdAt: new Date()
      }
    };

  } catch (error) {
    console.error('❌ Error generando par de tokens:', error);
    throw new Error('Error generando tokens');
  }
};

// ✅ VERIFICAR ACCESS TOKEN CON VALIDACIONES AVANZADAS
const verifyAccessToken = (token, options = {}) => {
  try {
    if (!token || typeof token !== 'string' || token.trim().length === 0) {
      throw new Error('Token inválido o vacío');
    }

    const decoded = jwt.verify(token, JWT_SECRET, {
      issuer: TOKEN_CONFIG.issuer,
      audience: TOKEN_CONFIG.audience,
      algorithms: [TOKEN_CONFIG.algorithm]
    });

    // ✅ VALIDAR ESTRUCTURA DEL TOKEN
    if (!decoded.userId && !decoded.id) {
      throw new Error('Token inválido - falta información de usuario');
    }

    // ✅ VALIDAR TIPO DE TOKEN
    if (decoded.type && decoded.type !== 'access') {
      throw new Error('Tipo de token incorrecto');
    }

    // ✅ VERIFICAR EXPIRACIÓN MANUAL (REDUNDANCIA)
    if (decoded.exp && decoded.exp < Math.floor(Date.now() / 1000)) {
      throw new Error('Token expirado');
    }

    // ✅ NORMALIZAR DATOS PARA COMPATIBILIDAD
    const normalizedDecoded = {
      ...decoded,
      userId: decoded.userId || decoded.id,
      id: decoded.userId || decoded.id,
      userRole: decoded.userRole || decoded.rol,
      rol: decoded.userRole || decoded.rol
    };

    return {
      valid: true,
      decoded: normalizedDecoded,
      tokenId: decoded.tokenId,
      issuedAt: decoded.iat ? new Date(decoded.iat * 1000) : null,
      expiresAt: decoded.exp ? new Date(decoded.exp * 1000) : null
    };

  } catch (error) {
    console.warn('🔐 Token verification failed:', {
      error: error.message,
      name: error.name,
      timestamp: new Date().toISOString()
    });

    return {
      valid: false,
      error: error.message,
      errorType: error.name,
      decoded: null
    };
  }
};

// ✅ VERIFICAR REFRESH TOKEN CON VALIDACIONES AVANZADAS
const verifyRefreshToken = (token) => {
  try {
    if (!token || typeof token !== 'string' || token.trim().length === 0) {
      throw new Error('Refresh token inválido o vacío');
    }

    const decoded = jwt.verify(token, REFRESH_SECRET, {
      issuer: TOKEN_CONFIG.issuer,
      audience: TOKEN_CONFIG.audience,
      algorithms: [TOKEN_CONFIG.algorithm]
    });

    // ✅ VALIDAR ESTRUCTURA DEL TOKEN
    if (!decoded.userId && !decoded.id) {
      throw new Error('Refresh token inválido - falta información de usuario');
    }

    // ✅ VALIDAR TIPO DE TOKEN
    if (decoded.type && decoded.type !== 'refresh') {
      throw new Error('Tipo de refresh token incorrecto');
    }

    // ✅ NORMALIZAR DATOS
    const normalizedDecoded = {
      ...decoded,
      userId: decoded.userId || decoded.id,
      id: decoded.userId || decoded.id
    };

    return {
      valid: true,
      decoded: normalizedDecoded,
      tokenId: decoded.tokenId,
      issuedAt: decoded.iat ? new Date(decoded.iat * 1000) : null,
      expiresAt: decoded.exp ? new Date(decoded.exp * 1000) : null
    };

  } catch (error) {
    console.warn('🔄 Refresh token verification failed:', {
      error: error.message,
      name: error.name,
      timestamp: new Date().toISOString()
    });

    return {
      valid: false,
      error: error.message,
      errorType: error.name,
      decoded: null
    };
  }
};

// ✅ VERIFICAR INACTIVIDAD Y SESIÓN CON MÉTRICAS DETALLADAS
const checkInactivity = (lastActivity, sessionStart = null) => {
  try {
    const now = new Date();
    const lastActivityDate = new Date(lastActivity);
    const sessionStartDate = sessionStart ? new Date(sessionStart) : lastActivityDate;

    // Validar fechas
    if (isNaN(lastActivityDate.getTime())) {
      throw new Error('Fecha de última actividad inválida');
    }

    const inactiveTime = now - lastActivityDate;
    const sessionTime = now - sessionStartDate;

    const inactiveMinutes = Math.floor(inactiveTime / (1000 * 60));
    const sessionMinutes = Math.floor(sessionTime / (1000 * 60));
    const sessionHours = Math.floor(sessionTime / (1000 * 60 * 60));

    const isInactive = inactiveTime > TOKEN_CONFIG.INACTIVITY_TIMEOUT;
    const isExpiredSession = sessionTime > TOKEN_CONFIG.MAX_SESSION_TIME;
    const isNearExpiry = inactiveTime > (TOKEN_CONFIG.INACTIVITY_TIMEOUT * 0.8); // 80% del límite

    return {
      // Estados principales
      isInactive,
      isExpiredSession,
      isNearExpiry,
      isValid: !isInactive && !isExpiredSession,
      
      // Métricas detalladas
      inactiveTime: inactiveTime,
      sessionTime: sessionTime,
      inactiveMinutes,
      sessionMinutes,
      sessionHours,
      
      // Tiempos restantes
      remainingInactiveTime: Math.max(0, TOKEN_CONFIG.INACTIVITY_TIMEOUT - inactiveTime),
      remainingSessionTime: Math.max(0, TOKEN_CONFIG.MAX_SESSION_TIME - sessionTime),
      
      // Información adicional
      lastActivity: lastActivityDate,
      sessionStart: sessionStartDate,
      checkTime: now,
      
      // Recomendaciones
      shouldRefreshToken: isNearExpiry && !isInactive,
      shouldForceLogout: isExpiredSession,
      warningMessage: isNearExpiry ? 'Sesión próxima a expirar' : null
    };

  } catch (error) {
    console.error('❌ Error verificando inactividad:', error);
    return {
      isInactive: true,
      isExpiredSession: true,
      isValid: false,
      error: error.message
    };
  }
};

// ✅ DECODIFICAR TOKEN SIN VERIFICAR (PARA DEBUGGING)
const decodeToken = (token) => {
  try {
    return jwt.decode(token, { complete: true });
  } catch (error) {
    return null;
  }
};

// ✅ OBTENER INFORMACIÓN DEL TOKEN SIN VERIFICAR
const getTokenInfo = (token) => {
  try {
    const decoded = jwt.decode(token);
    if (!decoded) return null;

    return {
      type: decoded.type || 'unknown',
      userId: decoded.userId || decoded.id,
      userRole: decoded.userRole || decoded.rol,
      tokenId: decoded.tokenId,
      issuedAt: decoded.iat ? new Date(decoded.iat * 1000) : null,
      expiresAt: decoded.exp ? new Date(decoded.exp * 1000) : null,
      issuer: decoded.iss,
      audience: decoded.aud
    };
  } catch (error) {
    return null;
  }
};

// ✅ VALIDAR CONFIGURACIÓN DEL TOKEN
const validateTokenConfig = () => {
  const errors = [];
  
  if (!JWT_SECRET || JWT_SECRET.length < 32) {
    errors.push('JWT_SECRET debe tener al menos 32 caracteres');
  }
  
  if (!REFRESH_SECRET || REFRESH_SECRET.length < 32) {
    errors.push('JWT_REFRESH_SECRET debe tener al menos 32 caracteres');
  }

  if (TOKEN_CONFIG.INACTIVITY_TIMEOUT < 60000) { // menos de 1 minuto
    errors.push('INACTIVITY_TIMEOUT muy bajo (mínimo 1 minuto)');
  }

  return {
    valid: errors.length === 0,
    errors,
    config: TOKEN_CONFIG
  };
};

// ✅ EXPORTACIONES
module.exports = {
  // Funciones principales
  generateAccessToken,
  generateRefreshToken,
  generateTokenPair,
  
  // Verificaciones
  verifyAccessToken,
  verifyRefreshToken,
  checkInactivity,
  
  // Utilidades
  decodeToken,
  getTokenInfo,
  validateTokenConfig,
  
  // Configuración
  TOKEN_CONFIG,
  
  // Retrocompatibilidad 
  generateTokens: generateTokenPair
};

// ✅ LOG DE INICIALIZACIÓN
console.log('🔐 JWT Utils inicializado:', {
  accessTokenExpiry: TOKEN_CONFIG.ACCESS_TOKEN_EXPIRY,
  refreshTokenExpiry: TOKEN_CONFIG.REFRESH_TOKEN_EXPIRY,
  inactivityTimeout: `${TOKEN_CONFIG.INACTIVITY_TIMEOUT / (1000 * 60)} minutos`,
  maxSessionTime: `${TOKEN_CONFIG.MAX_SESSION_TIME / (1000 * 60 * 60)} horas`,
  environment: process.env.NODE_ENV || 'development'
});
