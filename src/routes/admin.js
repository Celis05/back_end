// src/routes/admin.js
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const User = require('../models/User');

// ✅ LOGIN ADMIN
router.post('/login', async (req, res) => {
  try {
    const { correo_electronico, contrasena } = req.body;

    const user = await User.findOne({ 
      correo_electronico, 
      rol: 'admin' 
    }).select('+contrasena');
    
    if (!user || !await bcrypt.compare(contrasena, user.contrasena)) {
      return res.status(401).json({
        success: false,
        message: 'Credenciales de administrador inválidas'
      });
    }

    const token = jwt.sign({ 
      id: user._id, 
      rol: user.rol 
    }, process.env.JWT_SECRET, { expiresIn: '24h' });

    res.json({
      success: true,
      message: 'Login admin exitoso',
      data: { usuario: user, token }
    });

  } catch (error) {
    console.error('❌ Error en admin login:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor'
    });
  }
});

module.exports = router;
