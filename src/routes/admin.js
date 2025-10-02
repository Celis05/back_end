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
    
    // Tu código de login exitoso aquí...
    
  } catch (error) {
    console.error('❌ Error en login:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
});

module.exports = router;
