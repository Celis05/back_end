const express = require('express');
const router = express.Router();

// ✅ IMPORTACIONES CORREGIDAS (SIN .default)
const authRoutes = require('./auth');
const movementRoutes = require('./movements');
const adminRoutes = require('./admin');
const userRoutes = require('./users');
const dashboardRoutes = require('./dashboard');

// ✅ RUTA DE HEALTH CHECK MEJORADA
router.get('/', (req, res) => {
  res.json({ 
    success: true,
    message: 'SupervitecApp API funcionando correctamente 🚀',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// ✅ HEALTH CHECK ENDPOINT
router.get('/health', async (req, res) => {
  try {
    const mongoose = require('mongoose');
    const dbStatus = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
    
    res.json({
      success: true,
      status: 'healthy',
      database: dbStatus,
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// ✅ RUTAS PRINCIPALES
router.use('/auth', authRoutes);
router.use('/admin', adminRoutes);
router.use('/movements', movementRoutes);
router.use('/users', userRoutes);
router.use('/dashboard', dashboardRoutes);

// ✅ MIDDLEWARE PARA 404
router.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: `Ruta ${req.method} ${req.originalUrl} no encontrada`,
    availableRoutes: {
      auth: [
        'POST /api/v1/auth/register',
        'POST /api/v1/auth/login',
        'POST /api/v1/auth/refresh',
        'POST /api/v1/auth/forgot-password'
      ],
      movements: [
        'GET /api/v1/movements',
        'POST /api/v1/movements',
        'GET /api/v1/movements/daily/:date',
        'GET /api/v1/movements/monthly/:month/:year'
      ],
      admin: [
        'POST /api/v1/admin/login',
        'GET /api/v1/admin/users',
        'GET /api/v1/admin/export/:month/:year'
      ],
      users: [
        'GET /api/v1/users',
        'GET /api/v1/users/:id',
        'POST /api/v1/users'
      ],
      dashboard: [
        'GET /api/v1/dashboard/stats',
        'GET /api/v1/dashboard/recent-activity'
      ]
    },
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
