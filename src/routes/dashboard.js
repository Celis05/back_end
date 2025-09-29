// src/routes/dashboard.js
const express = require('express');
const router = express.Router();

const User = require('../models/User');
const Movement = require('../models/Movement');

// ✅ ESTADÍSTICAS BÁSICAS
router.get('/stats', async (req, res) => {
  try {
    const totalUsers = await User.countDocuments({ activo: true });
    const totalMovements = await Movement.countDocuments();
    
    res.json({
      success: true,
      data: {
        totalUsers,
        totalMovements,
        timestamp: new Date()
      }
    });
    
  } catch (error) {
    console.error('❌ Error en stats:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor'
    });
  }
});

module.exports = router;
