// src/routes/users.js
const express = require('express');
const router = express.Router();

const User = require('../models/User');

// ✅ OBTENER TODOS LOS USUARIOS
router.get('/', async (req, res) => {
  try {
    const users = await User.find({ activo: true }).select('-contrasena').limit(50);
    
    res.json({
      success: true,
      data: users
    });
    
  } catch (error) {
    console.error('❌ Error obteniendo usuarios:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor'
    });
  }
});

module.exports = router;
