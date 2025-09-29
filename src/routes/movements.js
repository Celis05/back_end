// src/routes/movements.js
const express = require('express');
const router = express.Router();

const Movement = require('../models/Movement');

// ✅ CREAR MOVIMIENTO
router.post('/', async (req, res) => {
  try {
    const movementData = {
      ...req.body,
      fecha: new Date()
    };

    const movement = new Movement(movementData);
    await movement.save();

    res.status(201).json({
      success: true,
      message: 'Movimiento creado exitosamente',
      data: movement
    });

  } catch (error) {
    console.error('❌ Error creando movimiento:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor'
    });
  }
});

// ✅ OBTENER MOVIMIENTOS
router.get('/', async (req, res) => {
  try {
    const movements = await Movement.find().limit(50).sort({ fecha: -1 });
    
    res.json({
      success: true,
      data: movements
    });
    
  } catch (error) {
    console.error('❌ Error obteniendo movimientos:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor'
    });
  }
});

module.exports = router;
