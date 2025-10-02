const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');

const User = require('../models/User');

// ✅ MIDDLEWARE DE VALIDACIÓN
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

// ✅ REGISTRO CORREGIDO (SIN DOBLE HASH)
router.post('/register', async (req, res) => {
  try {
    const { nombre_completo, correo_electronico, contrasena, region, transporte } = req.body;
    
    console.log('📝 Intento de registro:', correo_electronico);

    // Verificar usuario existente
    const existingUser = await User.findOne({ correo_electronico });
    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: 'El usuario ya existe'
      });
    }

    // ✅ CREAR USUARIO SIN HASHEAR MANUALMENTE
    // El middleware pre-save del modelo lo hará automáticamente
    const newUser = new User({
      nombre_completo,
      correo_electronico,
      contrasena, // ← SIN HASH MANUAL
      region,
      transporte,
      rol: 'trabajador',
      activo: true
    });

    await newUser.save(); // ← Aquí se ejecuta el middleware pre-save

    // Generar token
    const token = jwt.sign(
      { id: newUser._id, correo_electronico: newUser.correo_electronico, rol: newUser.rol },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    console.log('✅ Usuario registrado:', correo_electronico);
    
    res.status(201).json({
      success: true,
      message: 'Usuario registrado exitosamente',
      data: { usuario: { id: newUser._id, nombre_completo: newUser.nombre_completo, correo_electronico: newUser.correo_electronico, rol: newUser.rol }, token }
    });

  } catch (error) {
    console.error('❌ Error en registro:', error);
    res.status(500).json({ success: false, message: 'Error interno del servidor' });
  }
});

// ✅ LOGIN CORREGIDO CON DEBUG COMPLETO
router.post('/login', async (req, res) => {
  try {
    const { correo_electronico, contrasena } = req.body;
    
    // 🔍 LOGS DE DEBUG DETALLADOS
    console.log('🔐 Intento de login:', correo_electronico);
    console.log('🔍 Password recibido (length):', contrasena?.length);
    console.log('🔍 Password tipo:', typeof contrasena);

    // Buscar usuario con contraseña
    const user = await User.findOne({ correo_electronico }).select('+contrasena');
    
    if (!user) {
      console.log('❌ Usuario no encontrado:', correo_electronico);
      return res.status(401).json({
        success: false,
        message: 'Credenciales inválidas'
      });
    }

    console.log('🔍 Usuario encontrado:', user._id);
    console.log('🔍 Hash almacenado (length):', user.contrasena?.length);
    console.log('🔍 Hash starts with $2b$:', user.contrasena?.startsWith('$2b$'));

    // Verificar cuenta activa
    if (!user.activo) {
      return res.status(401).json({
        success: false,
        message: 'Cuenta desactivada'
      });
    }

    // ✅ COMPARAR CONTRASEÑA CON LOGS DETALLADOS
    console.log('🔍 Comparando contraseña...');
    const isValidPassword = await bcrypt.compare(contrasena, user.contrasena);
    console.log('🔍 Resultado comparación:', isValidPassword);

    if (!isValidPassword) {
      // Probar diferentes variaciones para debug
      const testPlain = await bcrypt.compare(contrasena.toString(), user.contrasena);
      const testTrim = await bcrypt.compare(contrasena.trim(), user.contrasena);
      
      console.log('🔍 Test toString():', testPlain);
      console.log('🔍 Test trim():', testTrim);
      console.log('❌ Contraseña incorrecta para:', correo_electronico);
      
      return res.status(401).json({
        success: false,
        message: 'Credenciales inválidas'
      });
    }

    // Generar token
    const token = jwt.sign(
      { id: user._id, correo_electronico: user.correo_electronico, rol: user.rol },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    // Actualizar último acceso
    user.ultimoAcceso = new Date();
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
          rol: user.rol
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

// ✅ ENDPOINT TEMPORAL PARA DEBUG
router.post('/debug-password', async (req, res) => {
  try {
    const { correo_electronico, contrasena_test } = req.body;
    
    const user = await User.findOne({ correo_electronico }).select('+contrasena');
    if (!user) {
      return res.json({ error: 'Usuario no encontrado' });
    }

    // Crear un hash fresco para comparar
    const freshHash = await bcrypt.hash(contrasena_test, 12);
    const compareOriginal = await bcrypt.compare(contrasena_test, user.contrasena);
    const compareFresh = await bcrypt.compare(contrasena_test, freshHash);

    res.json({
      email: correo_electronico,
      storedHash: user.contrasena,
      storedHashLength: user.contrasena.length,
      storedHashPrefix: user.contrasena.substring(0, 10),
      freshHash: freshHash,
      compareOriginal: compareOriginal,
      compareFresh: compareFresh,
      testPassword: contrasena_test,
      testPasswordLength: contrasena_test.length
    });

  } catch (error) {
    res.json({ error: error.message });
  }
});

// ✅ RESTO DE RUTAS...
router.get('/verify', async (req, res) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ success: false, message: 'Token requerido' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id);
    
    if (!user || !user.activo) {
      return res.status(401).json({ success: false, message: 'Token inválido' });
    }

    res.json({
      success: true,
      data: { usuario: { id: user._id, nombre_completo: user.nombre_completo, correo_electronico: user.correo_electronico, rol: user.rol }, valid: true }
    });
  } catch (error) {
    res.status(401).json({ success: false, message: 'Token inválido' });
  }
});

module.exports = router;
