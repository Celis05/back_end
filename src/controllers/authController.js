const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { body, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');

// ✅ IMPORTACIONES LOCALES
const User = require('../models/User');
const { sanitizeUser, generateTokens, createEmailTransporter } = require('../utils/authUtils');

// ✅ CONFIGURACIÓN DE JWT SEGURA
const JWT_CONFIG = {
  secret: process.env.JWT_SECRET,
  refreshSecret: process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET,
  accessTokenExpiry: process.env.JWT_EXPIRE || '24h',
  refreshTokenExpiry: process.env.JWT_REFRESH_EXPIRE || '7d'
};

// ✅ VALIDAR CONFIGURACIÓN AL INICIALIZAR
if (!JWT_CONFIG.secret || JWT_CONFIG.secret.length < 32) {
  console.error('❌ CRÍTICO: JWT_SECRET debe tener al menos 32 caracteres');
  if (process.env.NODE_ENV === 'production') {
    process.exit(1);
  }
}

// ✅ EMAIL SERVICE MEJORADO
let emailService;
try {
  emailService = require('../services/emailService');
} catch (error) {
  console.warn('⚠️ EmailService no disponible, usando nodemailer básico');
  const nodemailer = require('nodemailer');
  
  emailService = {
    transporter: createEmailTransporter(),
    async sendWelcomeEmail(email, name) {
      await this.transporter.sendMail({
        from: {
          name: process.env.SMTP_FROM_NAME || 'SupervitecApp',
          address: process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER
        },
        to: email,
        subject: '🚀 ¡Bienvenido a SupervitecApp!',
        html: `
          <h2>¡Hola ${name}!</h2>
          <p>Tu cuenta ha sido creada exitosamente en SupervitecApp.</p>
          <p><strong>Email:</strong> ${email}</p>
          <p>¡Comienza a usar la aplicación ahora!</p>
          <hr>
          <p><em>SupervitecApp - Sistema de Seguridad y Salud en el Trabajo</em></p>
        `
      });
    }
  };
}

// ✅ UTILIDADES HELPER
const generateSecureTokens = (user) => {
  const payload = {
    userId: user._id,
    userRole: user.rol,
    email: user.correo_electronico,
    iat: Math.floor(Date.now() / 1000)
  };

  const accessToken = jwt.sign(
    { ...payload, type: 'access' },
    JWT_CONFIG.secret,
    { 
      expiresIn: JWT_CONFIG.accessTokenExpiry,
      issuer: 'supervitec-api',
      audience: 'supervitec-app'
    }
  );

  const refreshToken = jwt.sign(
    { ...payload, type: 'refresh' },
    JWT_CONFIG.refreshSecret,
    { 
      expiresIn: JWT_CONFIG.refreshTokenExpiry,
      issuer: 'supervitec-api',
      audience: 'supervitec-app'
    }
  );

  return { accessToken, refreshToken };
};

// ✅ REGISTRO DE USUARIO ROBUSTO
exports.register = async (req, res) => {
  try {
    const {
      nombre_completo,
      correo_electronico,
      contrasena,
      region,
      transporte,
      rol = 'trabajador'
    } = req.body;

    // Log seguro de registro (sin contraseña)
    console.log('📝 Intento de registro:', { 
      correo_electronico, 
      nombre_completo, 
      region, 
      transporte, 
      rol,
      ip: req.ip,
      timestamp: new Date().toISOString()
    });

    // ✅ VALIDACIÓN COMPLETA DE CAMPOS
    const errors = {};

    if (!nombre_completo || nombre_completo.trim().length < 2) {
      errors.nombre_completo = 'Nombre completo debe tener al menos 2 caracteres';
    }

    if (!correo_electronico || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo_electronico)) {
      errors.correo_electronico = 'Correo electrónico inválido';
    }

    if (!contrasena || contrasena.length < 8) {
      errors.contrasena = 'Contraseña debe tener al menos 8 caracteres';
    } else if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/.test(contrasena)) {
      errors.contrasena = 'Contraseña debe contener: minúscula, mayúscula, número y carácter especial';
    }

    if (!region || region.trim().length < 2) {
      errors.region = 'Región requerida';
    }

    if (!transporte || !['auto', 'moto', 'bicicleta', 'pie', 'transporte_publico', 'otro'].includes(transporte)) {
      errors.transporte = 'Tipo de transporte inválido';
    }

    if (!rol || !['admin', 'supervisor', 'trabajador', 'invitado'].includes(rol)) {
      errors.rol = 'Rol inválido';
    }

    if (Object.keys(errors).length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Errores de validación en los datos',
        code: 'VALIDATION_ERROR',
        errors,
        timestamp: new Date().toISOString()
      });
    }

    // ✅ VERIFICAR EMAIL ÚNICO
    const existingUser = await User.findOne({ 
      correo_electronico: correo_electronico.toLowerCase().trim() 
    });

    if (existingUser) {
      console.warn('❌ Intento de registro con email duplicado:', {
        email: correo_electronico,
        ip: req.ip,
        timestamp: new Date().toISOString()
      });

      return res.status(409).json({
        success: false,
        message: 'Ya existe una cuenta con este correo electrónico',
        code: 'EMAIL_ALREADY_EXISTS',
        timestamp: new Date().toISOString()
      });
    }

    // ✅ HASH SEGURO DE CONTRASEÑA
    const saltRounds = process.env.NODE_ENV === 'production' ? 12 : 10;
    const hashedPassword = await bcrypt.hash(contrasena, saltRounds);

    // ✅ CREAR USUARIO CON DATOS SEGUROS
    const newUser = new User({
      nombre_completo: nombre_completo.trim(),
      correo_electronico: correo_electronico.toLowerCase().trim(),
      contrasena: hashedPassword,
      region: region.trim(),
      transporte,
      rol: rol === 'admin' ? 'trabajador' : rol, // Prevenir auto-promoción a admin
      activo: true,
      fechaCreacion: new Date(),
      ultimoAcceso: new Date(),
      configuraciones: {
        notificaciones: {
          email: true,
          push: true,
          sms: false
        },
        privacidad: {
          perfilPublico: false,
          ubicacionVisible: true
        },
        tema: 'light',
        idioma: 'es'
      }
    });

    await newUser.save();

    // ✅ GENERAR TOKENS SEGUROS
    const { accessToken, refreshToken } = generateSecureTokens(newUser);

    // ✅ GUARDAR REFRESH TOKEN
    newUser.refreshTokens = [{ 
      token: refreshToken, 
      createdAt: new Date(),
      userAgent: req.get('User-Agent'),
      ip: req.ip
    }];
    await newUser.save();

    // ✅ ENVIAR EMAIL DE BIENVENIDA (NO BLOQUEANTE)
    setImmediate(async () => {
      try {
        await emailService.sendWelcomeEmail(correo_electronico, nombre_completo);
        console.log('✅ Email de bienvenida enviado a:', correo_electronico);
      } catch (emailError) {
        console.error('⚠️ Error enviando email de bienvenida:', emailError.message);
      }
    });

    console.log('✅ Usuario registrado exitosamente:', {
      userId: newUser._id,
      email: correo_electronico,
      role: rol,
      region,
      timestamp: new Date().toISOString()
    });

    res.status(201).json({
      success: true,
      message: 'Usuario registrado exitosamente',
      data: {
        usuario: sanitizeUser(newUser),
        token: accessToken,
        refreshToken,
        expiresIn: JWT_CONFIG.accessTokenExpiry
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error en registro:', {
      error: error.message,
      stack: error.stack,
      ip: req.ip,
      timestamp: new Date().toISOString()
    });

    // ✅ MANEJO ESPECÍFICO DE ERRORES DE MONGODB
    if (error.code === 11000) {
      const field = Object.keys(error.keyValue)[0];
      return res.status(409).json({
        success: false,
        message: `Ya existe un registro con ${field}`,
        code: 'DUPLICATE_KEY',
        field,
        timestamp: new Date().toISOString()
      });
    }

    if (error.name === 'ValidationError') {
      const validationErrors = Object.values(error.errors).map(e => ({
        field: e.path,
        message: e.message
      }));

      return res.status(400).json({
        success: false,
        message: 'Errores de validación en el modelo',
        code: 'MONGOOSE_VALIDATION_ERROR',
        errors: validationErrors,
        timestamp: new Date().toISOString()
      });
    }

    res.status(500).json({
      success: false,
      message: 'Error interno del servidor',
      code: 'REGISTRATION_ERROR',
      timestamp: new Date().toISOString()
    });
  }
};

// ✅ LOGIN MEJORADO CON SEGURIDAD AVANZADA
exports.login = async (req, res) => {
  try {
    const { correo_electronico, contrasena } = req.body;

    console.log('🔐 Intento de login:', {
      email: correo_electronico,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      timestamp: new Date().toISOString()
    });

    // ✅ VALIDACIÓN BÁSICA
    if (!correo_electronico || !contrasena) {
      return res.status(400).json({
        success: false,
        message: 'Email y contraseña son requeridos',
        code: 'MISSING_CREDENTIALS',
        timestamp: new Date().toISOString()
      });
    }

    // ✅ BUSCAR USUARIO CON CONTRASEÑA
    const user = await User.findOne({ 
      correo_electronico: correo_electronico.toLowerCase().trim() 
    }).select('+contrasena');

    if (!user) {
      // ✅ DELAY PARA PREVENIR TIMING ATTACKS
      await bcrypt.hash('dummy_password_to_prevent_timing_attack', 10);
      
      console.warn('❌ Intento login - usuario no existe:', {
        email: correo_electronico,
        ip: req.ip,
        timestamp: new Date().toISOString()
      });

      return res.status(401).json({
        success: false,
        message: 'Credenciales inválidas',
        code: 'INVALID_CREDENTIALS',
        timestamp: new Date().toISOString()
      });
    }

    // ✅ VERIFICAR CONTRASEÑA
    const isValidPassword = await bcrypt.compare(contrasena, user.contrasena);

    if (!isValidPassword) {
      console.warn('❌ Intento login - contraseña incorrecta:', {
        userId: user._id,
        email: correo_electronico,
        ip: req.ip,
        timestamp: new Date().toISOString()
      });

      return res.status(401).json({
        success: false,
        message: 'Credenciales inválidas',
        code: 'INVALID_CREDENTIALS',
        timestamp: new Date().toISOString()
      });
    }

    // ✅ VERIFICAR CUENTA ACTIVA
    if (!user.activo) {
      return res.status(403).json({
        success: false,
        message: 'Cuenta desactivada. Contacta al administrador.',
        code: 'ACCOUNT_DISABLED',
        timestamp: new Date().toISOString()
      });
    }

    // ✅ GENERAR TOKENS SEGUROS
    const { accessToken, refreshToken } = generateSecureTokens(user);

    // ✅ ACTUALIZAR INFORMACIÓN DE LOGIN
    user.ultimoAcceso = new Date();
    
    // Limpiar tokens antiguos (más de 7 días)
    user.refreshTokens = (user.refreshTokens || []).filter(
      tokenObj => tokenObj.createdAt > new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    );
    
    // Agregar nuevo refresh token
    user.refreshTokens.push({ 
      token: refreshToken, 
      createdAt: new Date(),
      userAgent: req.get('User-Agent'),
      ip: req.ip
    });

    // Limitar a máximo 5 refresh tokens por usuario
    if (user.refreshTokens.length > 5) {
      user.refreshTokens = user.refreshTokens.slice(-5);
    }

    await user.save();

    console.log('✅ Login exitoso:', {
      userId: user._id,
      email: correo_electronico,
      role: user.rol,
      ip: req.ip,
      timestamp: new Date().toISOString()
    });

    res.json({
      success: true,
      message: 'Login exitoso',
      data: {
        usuario: sanitizeUser(user),
        token: accessToken,
        refreshToken,
        expiresIn: JWT_CONFIG.accessTokenExpiry
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error en login:', {
      error: error.message,
      stack: error.stack,
      ip: req.ip,
      timestamp: new Date().toISOString()
    });

    res.status(500).json({
      success: false,
      message: 'Error interno del servidor',
      code: 'LOGIN_ERROR',
      timestamp: new Date().toISOString()
    });
  }
};

// ✅ REFRESH TOKEN SEGURO
exports.refresh = async (req, res) => {
  try {
    const { refresh_token } = req.body;

    if (!refresh_token) {
      return res.status(400).json({
        success: false,
        message: 'Refresh token es requerido',
        code: 'MISSING_REFRESH_TOKEN',
        timestamp: new Date().toISOString()
      });
    }

    // ✅ VERIFICAR REFRESH TOKEN
    let decoded;
    try {
      decoded = jwt.verify(refresh_token, JWT_CONFIG.refreshSecret, {
        issuer: 'supervitec-api',
        audience: 'supervitec-app'
      });
    } catch (jwtError) {
      return res.status(401).json({
        success: false,
        message: 'Refresh token inválido o expirado',
        code: 'INVALID_REFRESH_TOKEN',
        timestamp: new Date().toISOString()
      });
    }

    // ✅ BUSCAR USUARIO Y VERIFICAR TOKEN EN LISTA
    const user = await User.findById(decoded.userId);

    if (!user || !user.activo) {
      return res.status(401).json({
        success: false,
        message: 'Usuario no válido',
        code: 'INVALID_USER',
        timestamp: new Date().toISOString()
      });
    }

    const tokenExists = user.refreshTokens?.some(
      tokenObj => tokenObj.token === refresh_token
    );

    if (!tokenExists) {
      return res.status(401).json({
        success: false,
        message: 'Refresh token no autorizado',
        code: 'UNAUTHORIZED_REFRESH_TOKEN',
        timestamp: new Date().toISOString()
      });
    }

    // ✅ GENERAR NUEVOS TOKENS
    const { accessToken, refreshToken: newRefreshToken } = generateSecureTokens(user);

    // ✅ ACTUALIZAR REFRESH TOKENS
    user.refreshTokens = user.refreshTokens.filter(
      tokenObj => tokenObj.token !== refresh_token
    );
    user.refreshTokens.push({ 
      token: newRefreshToken, 
      createdAt: new Date(),
      userAgent: req.get('User-Agent'),
      ip: req.ip
    });

    await user.save();

    console.log('🔄 Token refrescado exitosamente:', {
      userId: user._id,
      email: user.correo_electronico,
      ip: req.ip,
      timestamp: new Date().toISOString()
    });

    res.json({
      success: true,
      data: {
        token: accessToken,
        refreshToken: newRefreshToken,
        expiresIn: JWT_CONFIG.accessTokenExpiry
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error en refresh token:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor',
      code: 'REFRESH_ERROR',
      timestamp: new Date().toISOString()
    });
  }
};

// ✅ SOLICITAR RECUPERACIÓN DE CONTRASEÑA MEJORADO
exports.solicitarRecuperacion = async (req, res) => {
  try {
    const { correo_electronico } = req.body;

    console.log('🔑 Solicitud de recuperación:', {
      email: correo_electronico,
      ip: req.ip,
      timestamp: new Date().toISOString()
    });

    // ✅ SIEMPRE RESPONDER EXITOSO (SEGURIDAD)
    const successResponse = {
      success: true,
      message: 'Si el correo existe, se ha enviado un enlace de recuperación',
      timestamp: new Date().toISOString()
    };

    if (!correo_electronico) {
      return res.json(successResponse);
    }

    // ✅ BUSCAR USUARIO
    const user = await User.findOne({ 
      correo_electronico: correo_electronico.toLowerCase().trim() 
    });

    if (!user || !user.activo) {
      console.log('❌ Recuperación - usuario no encontrado o inactivo:', correo_electronico);
      return res.json(successResponse);
    }

    // ✅ GENERAR TOKEN SEGURO
    const resetToken = crypto.randomBytes(32).toString('hex');
    const hashedToken = crypto.createHash('sha256').update(resetToken).digest('hex');

    // ✅ CONFIGURAR TOKEN CON EXPIRACIÓN
    user.tokenRecuperacion = hashedToken;
    user.expiraTokenRecuperacion = new Date(Date.now() + 60 * 60 * 1000); // 1 hora
    await user.save();

    // ✅ ENVIAR EMAIL (NO BLOQUEANTE)
    setImmediate(async () => {
      try {
        const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;

        if (emailService.sendPasswordResetEmail) {
          await emailService.sendPasswordResetEmail(correo_electronico, resetToken, user.nombre_completo);
        } else {
          await emailService.transporter.sendMail({
            from: {
              name: process.env.SMTP_FROM_NAME || 'SupervitecApp',
              address: process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER
            },
            to: correo_electronico,
            subject: '🔐 SupervitecApp - Recuperar tu contraseña',
            html: `
              <h2>🔐 Recuperar Contraseña</h2>
              <p>Hola <strong>${user.nombre_completo}</strong>,</p>
              <p>Recibimos una solicitud para restablecer tu contraseña.</p>
              <div style="text-align: center; margin: 30px 0;">
                <a href="${resetUrl}" style="background-color: #2196F3; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px;">
                  🔑 Cambiar Contraseña
                </a>
              </div>
              <p><strong>⚠️ Este enlace expira en 1 hora</strong></p>
              <p>Si no solicitaste este cambio, ignora este email.</p>
              <hr>
              <p><em>SupervitecApp - Sistema SST</em></p>
            `
          });
        }
        console.log('✅ Email de recuperación enviado a:', correo_electronico);
      } catch (emailError) {
        console.error('⚠️ Error enviando email de recuperación:', emailError.message);
      }
    });

    res.json(successResponse);

  } catch (error) {
    console.error('❌ Error en recuperación:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor',
      code: 'RECOVERY_ERROR',
      timestamp: new Date().toISOString()
    });
  }
};

// ✅ CAMBIO DE CONTRASEÑA PARA USUARIO AUTENTICADO
exports.changePasswordLogged = async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    const userId = req.user.id || req.user.userId;

    console.log('🔄 Cambio de contraseña:', {
      userId,
      ip: req.ip,
      timestamp: new Date().toISOString()
    });

    // ✅ VALIDACIONES
    if (!oldPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Contraseña actual y nueva contraseña son requeridas',
        code: 'MISSING_PASSWORDS',
        timestamp: new Date().toISOString()
      });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'La nueva contraseña debe tener al menos 8 caracteres',
        code: 'PASSWORD_TOO_SHORT',
        timestamp: new Date().toISOString()
      });
    }

    // ✅ OBTENER USUARIO CON CONTRASEÑA
    const user = await User.findById(userId).select('+contrasena');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Usuario no encontrado',
        code: 'USER_NOT_FOUND',
        timestamp: new Date().toISOString()
      });
    }

    // ✅ VERIFICAR CONTRASEÑA ACTUAL
    const isValidPassword = await bcrypt.compare(oldPassword, user.contrasena);

    if (!isValidPassword) {
      return res.status(400).json({
        success: false,
        message: 'Contraseña actual incorrecta',
        code: 'INVALID_OLD_PASSWORD',
        timestamp: new Date().toISOString()
      });
    }

    // ✅ VERIFICAR QUE LA NUEVA CONTRASEÑA SEA DIFERENTE
    const isSamePassword = await bcrypt.compare(newPassword, user.contrasena);

    if (isSamePassword) {
      return res.status(400).json({
        success: false,
        message: 'La nueva contraseña debe ser diferente a la actual',
        code: 'SAME_PASSWORD',
        timestamp: new Date().toISOString()
      });
    }

    // ✅ HASH NUEVA CONTRASEÑA
    const saltRounds = process.env.NODE_ENV === 'production' ? 12 : 10;
    const hashedPassword = await bcrypt.hash(newPassword, saltRounds);

    // ✅ ACTUALIZAR CONTRASEÑA E INVALIDAR TOKENS
    user.contrasena = hashedPassword;
    user.refreshTokens = []; // Invalidar todas las sesiones activas
    await user.save();

    console.log('✅ Contraseña cambiada exitosamente:', {
      userId,
      email: user.correo_electronico,
      timestamp: new Date().toISOString()
    });

    res.json({
      success: true,
      message: 'Contraseña actualizada exitosamente',
      code: 'PASSWORD_CHANGED',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error en cambio de contraseña:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor',
      code: 'PASSWORD_CHANGE_ERROR',
      timestamp: new Date().toISOString()
    });
  }
};

module.exports = {
  register: exports.register,
  login: exports.login,
  refresh: exports.refresh,
  solicitarRecuperacion: exports.solicitarRecuperacion,
  changePasswordLogged: exports.changePasswordLogged
};
