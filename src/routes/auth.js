const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');

// ✅ IMPORTACIONES LOCALES
const User = require('../models/User');

// ✅ MIDDLEWARE DE VALIDACIÓN SIMPLE
const validarCampos = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Errores de validación',
      errors: errors.array()
    });
  }
  next();
};

// ✅ VALIDACIONES
const registerValidation = [
  body('nombre_completo').trim().isLength({ min: 2, max: 100 }).withMessage('Nombre completo requerido'),
  body('correo_electronico').isEmail().withMessage('Email válido requerido'),
  body('contrasena').isLength({ min: 6 }).withMessage('Contraseña mínimo 6 caracteres'),
  body('region').notEmpty().withMessage('Región requerida'),
  body('transporte').notEmpty().withMessage('Transporte requerido')
];

const loginValidation = [
  body('correo_electronico').isEmail().withMessage('Email válido requerido'),
  body('contrasena').notEmpty().withMessage('Contraseña requerida')
];

// ✅ REGISTRO DE USUARIO
router.post('/register', registerValidation, validarCampos, async (req, res) => {
  try {
    const { nombre_completo, correo_electronico, contrasena, region, transporte } = req.body;
    
    console.log('📝 Intento de registro:', correo_electronico);

    // Verificar si el usuario existe
    const existingUser = await User.findOne({ correo_electronico });
    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: 'El usuario ya existe'
      });
    }

    // Hash de la contraseña
    const hashedPassword = await bcrypt.hash(contrasena, 12);

    // Crear usuario
    const newUser = new User({
      nombre_completo,
      correo_electronico,
      contrasena: hashedPassword,
      region,
      transporte,
      rol: 'trabajador',
      activo: true,
      fechaCreacion: new Date()
    });

    await newUser.save();

    // Generar token
    const token = jwt.sign(
      { 
        id: newUser._id, 
        correo_electronico: newUser.correo_electronico,
        rol: newUser.rol 
      }, 
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    console.log('✅ Usuario registrado:', correo_electronico);

    res.status(201).json({
      success: true,
      message: 'Usuario registrado exitosamente',
      data: {
        usuario: {
          id: newUser._id,
          nombre_completo: newUser.nombre_completo,
          correo_electronico: newUser.correo_electronico,
          rol: newUser.rol,
          region: newUser.region,
          transporte: newUser.transporte
        },
        token
      }
    });

  } catch (error) {
    console.error('❌ Error en registro:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor'
    });
  }
});

// ✅ LOGIN DE USUARIO
router.post('/login', loginValidation, validarCampos, async (req, res) => {
  try {
    const { correo_electronico, contrasena } = req.body;
    
    console.log('🔐 Intento de login:', correo_electronico);

    // Buscar usuario
    const user = await User.findOne({ correo_electronico }).select('+contrasena');
    
    if (!user) {
      console.log('❌ Usuario no encontrado:', correo_electronico);
      return res.status(401).json({
        success: false,
        message: 'Credenciales inválidas'
      });
    }

    // Verificar si está activo
    if (!user.activo) {
      return res.status(401).json({
        success: false,
        message: 'Cuenta desactivada'
      });
    }

    // Verificar contraseña
    const isValidPassword = await bcrypt.compare(contrasena, user.contrasena);
    
    if (!isValidPassword) {
      console.log('❌ Contraseña incorrecta para:', correo_electronico);
      return res.status(401).json({
        success: false,
        message: 'Credenciales inválidas'
      });
    }

    // Generar token
    const token = jwt.sign(
      { 
        id: user._id, 
        correo_electronico: user.correo_electronico,
        rol: user.rol 
      }, 
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    // Actualizar último acceso
    user.ultimo_acceso = new Date();
    await user.save();

    console.log('✅ Login exitoso para:', correo_electronico);

    res.json({
      success: true,
      message: 'Login exitoso',
      data: {
        usuario: {
          id: user._id,
          nombre_completo: user.nombre_completo,
          correo_electronico: user.correo_electronico,
          rol: user.rol,
          region: user.region,
          transporte: user.transporte,
          ultimo_acceso: user.ultimo_acceso
        },
        token
      }
    });

  } catch (error) {
    console.error('❌ Error en login:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor'
    });
  }
});

// ✅ VERIFICAR TOKEN
router.get('/verify', async (req, res) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '') || req.header('x-access-token');

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Token requerido'
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id);

    if (!user || !user.activo) {
      return res.status(401).json({
        success: false,
        message: 'Token inválido'
      });
    }

    res.json({
      success: true,
      data: {
        usuario: {
          id: user._id,
          nombre_completo: user.nombre_completo,
          correo_electronico: user.correo_electronico,
          rol: user.rol,
          region: user.region
        },
        valid: true
      }
    });

  } catch (error) {
    console.error('❌ Error verificando token:', error);
    res.status(401).json({
      success: false,
      message: 'Token inválido'
    });
  }
});

// ✅ LOGOUT
router.post('/logout', async (req, res) => {
  try {
    res.json({
      success: true,
      message: 'Logout exitoso'
    });
  } catch (error) {
    console.error('❌ Error en logout:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor'
    });
  }
});

// ✅ RECUPERAR CONTRASEÑA (BÁSICO)
router.post('/forgot-password', async (req, res) => {
  try {
    const { correo_electronico } = req.body;

    if (!correo_electronico) {
      return res.status(400).json({
        success: false,
        message: 'Email requerido'
      });
    }

    const user = await User.findOne({ correo_electronico });
    
    if (!user) {
      // Por seguridad, no revelar si el email existe
      return res.json({
        success: true,
        message: 'Si el email existe, recibirás instrucciones de recuperación'
      });
    }

    // Implementar envío de email
    console.log('📧 Solicitud de recuperación para:', correo_electronico);

    res.json({
      success: true,
      message: 'Si el email existe, recibirás instrucciones de recuperación'
    });

  } catch (error) {
    console.error('❌ Error en forgot-password:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor'
    });
  }
});

// ✅ EXPORTAR ROUTER - ¡ESTA ES LA LÍNEA CRÍTICA!
module.exports = router;
