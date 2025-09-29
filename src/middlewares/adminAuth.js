const jwt = require('jsonwebtoken');
const User = require('../models/User');

// ✅ MIDDLEWARE ESPECÍFICO PARA ADMINISTRADORES
const adminAuth = async (req, res, next) => {
  try {
    // Obtener token
    const authHeader = req.header('Authorization') || req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Token de administrador requerido',
        code: 'ADMIN_TOKEN_REQUIRED',
        timestamp: new Date().toISOString()
      });
    }

    const token = authHeader.replace('Bearer ', '').trim();
    
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Token de administrador vacío',
        code: 'EMPTY_ADMIN_TOKEN',
        timestamp: new Date().toISOString()
      });
    }

    // ✅ VERIFICAR TOKEN
    const decoded = jwt.verify(token, process.env.JWT_SECRET, {
      issuer: 'supervitec-api',
      audience: 'supervitec-app'
    });

    // ✅ VERIFICAR ROL EN TOKEN
    if (!decoded.userRole || decoded.userRole !== 'admin') {
      console.warn('🚫 Intento de acceso admin con rol insuficiente:', {
        userId: decoded.userId,
        role: decoded.userRole,
        ip: req.ip,
        endpoint: `${req.method} ${req.path}`,
        timestamp: new Date().toISOString()
      });

      return res.status(403).json({
        success: false,
        message: 'Acceso restringido a administradores únicamente',
        code: 'ADMIN_ACCESS_REQUIRED',
        currentRole: decoded.userRole,
        timestamp: new Date().toISOString()
      });
    }

    // ✅ VERIFICAR USUARIO EN BASE DE DATOS
    const user = await User.findById(decoded.userId)
      .select('-contrasena')
      .lean();

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Administrador no encontrado',
        code: 'ADMIN_USER_NOT_FOUND',
        timestamp: new Date().toISOString()
      });
    }

    if (!user.activo) {
      return res.status(403).json({
        success: false,
        message: 'Cuenta de administrador desactivada',
        code: 'ADMIN_ACCOUNT_DISABLED',
        timestamp: new Date().toISOString()
      });
    }

    if (user.rol !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Permisos de administrador revocados',
        code: 'ADMIN_PERMISSIONS_REVOKED',
        timestamp: new Date().toISOString()
      });
    }

    // ✅ LOG DE ACCESO ADMIN
    console.log('🔑 Acceso administrativo autorizado:', {
      adminId: user._id,
      email: user.correo_electronico,
      name: user.nombre_completo,
      endpoint: `${req.method} ${req.path}`,
      ip: req.ip,
      timestamp: new Date().toISOString()
    });

    // Agregar información al request
    req.admin = {
      id: user._id,
      email: user.correo_electronico,
      name: user.nombre_completo,
      role: user.rol,
      permissions: ['admin_full_access']
    };
    
    req.user = req.admin; // Compatibilidad con otros middlewares

    next();

  } catch (error) {
    console.error('❌ Error en middleware de admin:', error);
    
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Token de administrador inválido',
        code: 'INVALID_ADMIN_TOKEN',
        timestamp: new Date().toISOString()
      });
    }

    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Sesión de administrador expirada',
        code: 'ADMIN_SESSION_EXPIRED',
        expiredAt: error.expiredAt,
        timestamp: new Date().toISOString()
      });
    }

    return res.status(500).json({
      success: false,
      message: 'Error interno verificando permisos de administrador',
      code: 'ADMIN_AUTH_ERROR',
      timestamp: new Date().toISOString()
    });
  }
};

module.exports = adminAuth;
