// src/routes/admin.js
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const User = require('../models/User');

// ✅ LOGIN 
router.post('/login', async (req, res) => {
  try {
    const { correo_electronico, contrasena } = req.body;
    
    console.log('🔍 DEBUG LOGIN:');
    console.log('correo_electronico recibido:', correo_electronico);
    console.log('contrasena recibido:', JSON.stringify(contrasena));
    console.log('contrasena length:', contrasena.length);
    console.log('contrasena tipo:', typeof contrasena);
    
    const user = await User.findOne({ correo_electronico: correo_electronico.toLowerCase() });
    
    if (!user) {
      console.log('❌ Usuario no encontrado:', correo_electronico);
      return res.status(401).json({ message: 'Usuario no encontrado' });
    }
    
    // 🔍 LOGS DE LA CONTRASEÑA HASHEADA
    console.log('🔍 contrasena HASHEADO EN DB:');
    console.log('Hash stored:', user.contrasena);
    console.log('Hash length:', user.contrasena.length);
    
    // 🔍 COMPARACIÓN CON LOGS
    const isMatch = await bcrypt.compare(contrasena, user.contrasena);
    console.log('🔍 COMPARACIÓN:');
    console.log('bcrypt.compare resultado:', isMatch);
    
    // INTENTAR FIXES COMUNES
    if (!isMatch) {
      console.log('❌ Intento 1 falló, probando con toString...');
      const isMatch2 = await bcrypt.compare(contrasena.toString(), user.contrasena.toString());
      console.log('🔍 Intento 2 (toString):', isMatch2);
      
      if (!isMatch2) {
        console.log('❌ Intento 2 falló, probando con trim...');
        const isMatch3 = await bcrypt.compare(contrasena.trim(), user.contrasena);
        console.log('🔍 Intento 3 (trim):', isMatch3);
        
        if (isMatch3) {
          console.log('✅ SOLUCIÓN ENCONTRADA: Usar contrasena.trim()');
          // Continuar con login exitoso
        } else {
          console.log('❌ TODOS LOS INTENTOS FALLARON');
          return res.status(401).json({ message: 'Contraseña incorrecta' });
        }
      } else {
        console.log('✅ SOLUCIÓN ENCONTRADA: Usar toString()');
        // Continuar con login exitoso
      }
    } else {
      console.log('✅ Login exitoso con método normal');
    }
    
    
  } catch (error) {
    console.error('❌ Error en login:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
});

// ✅ OBTENER TODOS LOS USUARIOS (Lista para admin)
router.get('/users', async (req, res) => {
  try {
    const users = await User.find({})
      .select('-contrasena -tokenRecuperacion -expiraTokenRecuperacion -refreshTokens')
      .sort({ fechaCreacion: -1 })
      .limit(100);
    
    console.log('👥 Admin consultando usuarios:', users.length);
    
    res.json({
      success: true,
      data: users,
      total: users.length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Error obteniendo usuarios:', error);
    res.status(500).json({
      success: false,
      message: 'Error obteniendo usuarios'
    });
  }
});

// ✅ OBTENER USUARIO ESPECÍFICO
router.get('/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    console.log('🔍 Admin consultando usuario:', id);
    
    const user = await User.findById(id)
      .select('-contrasena -tokenRecuperacion -expiraTokenRecuperacion -refreshTokens');
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Usuario no encontrado'
      });
    }
    
    // Estadísticas del usuario
    const Movement = require('../models/Movement');
    const stats = await Movement.countDocuments({ user_id: id });
    
    res.json({
      success: true,
      data: {
        ...user.toObject(),
        stats: {
          totalMovements: stats
        }
      }
    });
  } catch (error) {
    console.error('❌ Error obteniendo usuario:', error);
    res.status(500).json({
      success: false,
      message: 'Error obteniendo usuario específico'
    });
  }
});

// ✅ ACTUALIZAR USUARIO
router.put('/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;
    
    console.log('📝 Admin actualizando usuario:', id);
    
    // Remover campos sensibles
    delete updateData.contrasena;
    delete updateData._id;
    
    const user = await User.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    ).select('-contrasena');
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Usuario no encontrado'
      });
    }
    
    res.json({
      success: true,
      data: user,
      message: 'Usuario actualizado correctamente'
    });
  } catch (error) {
    console.error('❌ Error actualizando usuario:', error);
    res.status(500).json({
      success: false,
      message: 'Error actualizando usuario'
    });
  }
});

// ✅ ELIMINAR USUARIO 
router.delete('/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    console.log('🗑️ Admin desactivando usuario:', id);
    
    const user = await User.findByIdAndUpdate(
      id,
      { activo: false },
      { new: true }
    ).select('-contrasena');
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Usuario no encontrado'
      });
    }
    
    res.json({
      success: true,
      data: user,
      message: 'Usuario desactivado correctamente'
    });
  } catch (error) {
    console.error('❌ Error desactivando usuario:', error);
    res.status(500).json({
      success: false,
      message: 'Error desactivando usuario'
    });
  }
});


router.get('/debug-users', async (req, res) => {
  try {
    const users = await User.find({}).select('correo_electronico nombre_completo rol activo createdAt');
    console.log('👥 USUARIOS EN BASE DE DATOS:', users);
    
    res.json({
      success: true,
      total: users.length,
      currentDB: require('mongoose').connection.db.databaseName,
      users: users
    });
  } catch (error) {
    console.error('Error:', error);
    res.json({ error: error.message });
  }
});


module.exports = router;
