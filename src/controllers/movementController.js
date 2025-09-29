const mongoose = require('mongoose');
const moment = require('moment');

// ✅ IMPORTACIONES LOCALES
const Movement = require('../models/Movement');
const User = require('../models/User');

// ✅ UTILIDADES PARA GEOLOCALIZACIÓN
const calculateDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371; // Radio de la Tierra en kilómetros
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;
  return Math.round(distance * 100) / 100; // Redondear a 2 decimales
};

const deg2rad = (deg) => {
  return deg * (Math.PI / 180);
};

const validateLocation = (location) => {
  if (!location || typeof location !== 'object') {
    return false;
  }
  
  const { latitude, longitude } = location;
  
  if (typeof latitude !== 'number' || typeof longitude !== 'number') {
    return false;
  }
  
  // Validar rangos de coordenadas válidas
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return false;
  }
  
  // Colombia aproximado: lat 12.5 a -4.2, lng -66.9 a -84.8
  if (process.env.VALIDATE_COLOMBIA_BOUNDS === 'true') {
    if (latitude < -4.2 || latitude > 12.5 || longitude < -84.8 || longitude > -66.9) {
      return false;
    }
  }
  
  return true;
};

const sanitizeMovementData = (movement) => {
  const safeMovement = movement.toObject ? movement.toObject() : { ...movement };
  
  // Agregar datos calculados útiles
  safeMovement.summary = {
    distanceKm: safeMovement.distancia_recorrida,
    durationMinutes: safeMovement.tiempo_total,
    avgSpeedKmh: safeMovement.velocidad_promedio,
    maxSpeedKmh: safeMovement.velocidad_maxima,
    efficiency: safeMovement.velocidad_promedio > 0 ? 
      Math.round((safeMovement.distancia_recorrida / (safeMovement.tiempo_total / 60)) * 100) / 100 : 0
  };
  
  return safeMovement;
};

// ✅ REGISTRAR NUEVO MOVIMIENTO
exports.registerMovement = async (req, res) => {
  try {
    const {
      start_location,
      end_location,
      distancia_recorrida,
      velocidad_promedio,
      velocidad_maxima,
      tiempo_total,
      fecha,
      region,
      waypoints = [],
      metadata = {}
    } = req.body;

    const userId = req.user.id || req.user.userId;

    console.log('📍 Registrando nuevo movimiento:', {
      userId,
      region,
      distance: distancia_recorrida,
      duration: tiempo_total,
      avgSpeed: velocidad_promedio,
      ip: req.ip,
      timestamp: new Date().toISOString()
    });

    // ✅ VALIDACIONES COMPLETAS
    const errors = {};

    if (!start_location || !validateLocation(start_location)) {
      errors.start_location = 'Ubicación de inicio inválida o fuera de rango';
    }

    if (!end_location || !validateLocation(end_location)) {
      errors.end_location = 'Ubicación final inválida o fuera de rango';
    }

    if (!distancia_recorrida || distancia_recorrida <= 0 || distancia_recorrida > 1000) {
      errors.distancia_recorrida = 'Distancia debe estar entre 0.01 y 1000 km';
    }

    if (!velocidad_promedio || velocidad_promedio <= 0 || velocidad_promedio > 200) {
      errors.velocidad_promedio = 'Velocidad promedio debe estar entre 0.1 y 200 km/h';
    }

    if (!velocidad_maxima || velocidad_maxima <= 0 || velocidad_maxima > 300) {
      errors.velocidad_maxima = 'Velocidad máxima debe estar entre 0.1 y 300 km/h';
    }

    if (velocidad_maxima < velocidad_promedio) {
      errors.velocidad_maxima = 'Velocidad máxima no puede ser menor que la promedio';
    }

    if (!tiempo_total || tiempo_total <= 0 || tiempo_total > 1440) {
      errors.tiempo_total = 'Tiempo total debe estar entre 0.1 y 1440 minutos';
    }

    if (!fecha || !moment(fecha).isValid()) {
      errors.fecha = 'Fecha inválida';
    } else {
      const movementDate = moment(fecha);
      const now = moment();
      if (movementDate.isAfter(now)) {
        errors.fecha = 'La fecha no puede ser futura';
      }
      if (movementDate.isBefore(now.subtract(7, 'days'))) {
        errors.fecha = 'La fecha no puede ser mayor a 7 días en el pasado';
      }
    }

    if (!region || region.trim().length < 2 || region.trim().length > 50) {
      errors.region = 'Región debe tener entre 2 y 50 caracteres';
    }

    if (Object.keys(errors).length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Errores de validación en los datos del movimiento',
        code: 'MOVEMENT_VALIDATION_ERROR',
        errors,
        timestamp: new Date().toISOString()
      });
    }

    // ✅ VALIDAR COHERENCIA DE DATOS
    const calculatedDistance = calculateDistance(
      start_location.latitude,
      start_location.longitude,
      end_location.latitude,
      end_location.longitude
    );

    const distanceTolerance = 0.5; // 500 metros de tolerancia
    if (Math.abs(calculatedDistance - distancia_recorrida) > distanceTolerance) {
      console.warn('⚠️ Discrepancia en distancia calculada vs reportada:', {
        userId,
        reported: distancia_recorrida,
        calculated: calculatedDistance,
        difference: Math.abs(calculatedDistance - distancia_recorrida)
      });
    }

    // ✅ VERIFICAR QUE EL USUARIO EXISTE Y ESTÁ ACTIVO
    const user = await User.findById(userId).select('nombre_completo correo_electronico activo');
    
    if (!user || !user.activo) {
      return res.status(403).json({
        success: false,
        message: 'Usuario no autorizado para registrar movimientos',
        code: 'USER_NOT_AUTHORIZED',
        timestamp: new Date().toISOString()
      });
    }

    // ✅ VERIFICAR LÍMITE DE MOVIMIENTOS POR DÍA
    const todayStart = moment().startOf('day');
    const todayEnd = moment().endOf('day');
    
    const movementsToday = await Movement.countDocuments({
      user_id: userId,
      fecha: {
        $gte: todayStart.toDate(),
        $lte: todayEnd.toDate()
      }
    });

    const maxMovementsPerDay = parseInt(process.env.MAX_MOVEMENTS_PER_DAY) || 50;
    if (movementsToday >= maxMovementsPerDay) {
      return res.status(429).json({
        success: false,
        message: `Límite diario de ${maxMovementsPerDay} movimientos alcanzado`,
        code: 'DAILY_LIMIT_EXCEEDED',
        currentCount: movementsToday,
        limit: maxMovementsPerDay,
        timestamp: new Date().toISOString()
      });
    }

    // ✅ CREAR MOVIMIENTO CON DATOS ENRIQUECIDOS
    const movementData = {
      user_id: userId,
      start_location: {
        latitude: parseFloat(start_location.latitude.toFixed(6)),
        longitude: parseFloat(start_location.longitude.toFixed(6)),
        address: start_location.address || null,
        timestamp: start_location.timestamp || fecha
      },
      end_location: {
        latitude: parseFloat(end_location.latitude.toFixed(6)),
        longitude: parseFloat(end_location.longitude.toFixed(6)),
        address: end_location.address || null,
        timestamp: end_location.timestamp || fecha
      },
      distancia_recorrida: parseFloat(distancia_recorrida.toFixed(2)),
      distancia_calculada: calculatedDistance,
      velocidad_promedio: parseFloat(velocidad_promedio.toFixed(1)),
      velocidad_maxima: parseFloat(velocidad_maxima.toFixed(1)),
      tiempo_total: parseInt(tiempo_total),
      fecha: new Date(fecha),
      region: region.trim(),
      waypoints: waypoints.filter(point => validateLocation(point)),
      metadata: {
        ...metadata,
        deviceInfo: {
          userAgent: req.get('User-Agent'),
          ip: req.ip,
          platform: metadata.platform || 'unknown'
        },
        calculations: {
          efficiency: velocidad_promedio > 0 ? 
            parseFloat((distancia_recorrida / (tiempo_total / 60)).toFixed(2)) : 0,
          distanceAccuracy: Math.abs(calculatedDistance - distancia_recorrida),
          createdAt: new Date()
        }
      }
    };

    const movement = new Movement(movementData);
    await movement.save();

    // ✅ ACTUALIZAR ESTADÍSTICAS DEL USUARIO (OPCIONAL)
    setImmediate(async () => {
      try {
        const userStats = await Movement.aggregate([
          { $match: { user_id: new mongoose.Types.ObjectId(userId) } },
          {
            $group: {
              _id: null,
              totalDistance: { $sum: '$distancia_recorrida' },
              totalTime: { $sum: '$tiempo_total' },
              avgSpeed: { $avg: '$velocidad_promedio' },
              maxSpeed: { $max: '$velocidad_maxima' },
              totalMovements: { $sum: 1 }
            }
          }
        ]);

        if (userStats.length > 0) {
          const stats = userStats[0];
          // Aquí podrías actualizar un campo de estadísticas en el usuario
          console.log('📊 Estadísticas actualizadas para usuario:', userId, {
            totalDistance: stats.totalDistance,
            totalMovements: stats.totalMovements,
            avgSpeed: stats.avgSpeed
          });
        }
      } catch (statsError) {
        console.error('⚠️ Error actualizando estadísticas de usuario:', statsError);
      }
    });

    console.log('✅ Movimiento registrado exitosamente:', {
      movementId: movement._id,
      userId,
      distance: distancia_recorrida,
      region,
      timestamp: new Date().toISOString()
    });

    res.status(201).json({
      success: true,
      message: 'Movimiento registrado correctamente',
      data: {
        movement: sanitizeMovementData(movement),
        stats: {
          todayMovements: movementsToday + 1,
          remainingToday: maxMovementsPerDay - (movementsToday + 1)
        }
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error registrando movimiento:', {
      error: error.message,
      stack: error.stack,
      userId: req.user?.id,
      ip: req.ip,
      timestamp: new Date().toISOString()
    });

    if (error.name === 'ValidationError') {
      const validationErrors = Object.values(error.errors).map(e => ({
        field: e.path,
        message: e.message,
        value: e.value
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
      message: 'Error interno registrando movimiento',
      code: 'MOVEMENT_REGISTRATION_ERROR',
      timestamp: new Date().toISOString()
    });
  }
};

// ✅ OBTENER MOVIMIENTOS DEL USUARIO CON FILTROS AVANZADOS
exports.getUserMovements = async (req, res) => {
  try {
    const userId = req.user.id || req.user.userId;
    const {
      page = 1,
      limit = 20,
      startDate,
      endDate,
      region,
      minDistance,
      maxDistance,
      sortBy = 'fecha',
      sortOrder = 'desc'
    } = req.query;

    console.log('📋 Consultando movimientos de usuario:', {
      userId,
      page,
      limit,
      filters: { startDate, endDate, region, minDistance, maxDistance },
      ip: req.ip,
      timestamp: new Date().toISOString()
    });

    // ✅ CONSTRUIR FILTROS DINÁMICOS
    const filters = { user_id: userId };

    if (startDate || endDate) {
      filters.fecha = {};
      if (startDate) filters.fecha.$gte = new Date(startDate);
      if (endDate) filters.fecha.$lte = new Date(endDate);
    }

    if (region) {
      filters.region = { $regex: region, $options: 'i' };
    }

    if (minDistance || maxDistance) {
      filters.distancia_recorrida = {};
      if (minDistance) filters.distancia_recorrida.$gte = parseFloat(minDistance);
      if (maxDistance) filters.distancia_recorrida.$lte = parseFloat(maxDistance);
    }

    // ✅ PAGINACIÓN SEGURA
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
    const skip = (pageNum - 1) * limitNum;

    // ✅ ORDENAMIENTO SEGURO
    const validSortFields = ['fecha', 'distancia_recorrida', 'velocidad_promedio', 'tiempo_total'];
    const sortField = validSortFields.includes(sortBy) ? sortBy : 'fecha';
    const sortDirection = sortOrder === 'asc' ? 1 : -1;

    // ✅ CONSULTAR MOVIMIENTOS Y TOTAL
    const [movements, totalMovements, userStats] = await Promise.all([
      Movement.find(filters)
        .sort({ [sortField]: sortDirection })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      
      Movement.countDocuments(filters),
      
      // Estadísticas del usuario
      Movement.aggregate([
        { $match: { user_id: new mongoose.Types.ObjectId(userId) } },
        {
          $group: {
            _id: null,
            totalDistance: { $sum: '$distancia_recorrida' },
            totalTime: { $sum: '$tiempo_total' },
            avgSpeed: { $avg: '$velocidad_promedio' },
            maxSpeed: { $max: '$velocidad_maxima' },
            totalMovements: { $sum: 1 }
          }
        }
      ])
    ]);

    // ✅ ENRIQUECER MOVIMIENTOS CON DATOS CALCULADOS
    const enrichedMovements = movements.map(movement => sanitizeMovementData(movement));

    const totalPages = Math.ceil(totalMovements / limitNum);
    const stats = userStats[0] || {
      totalDistance: 0,
      totalTime: 0,
      avgSpeed: 0,
      maxSpeed: 0,
      totalMovements: 0
    };

    res.json({
      success: true,
      data: {
        movements: enrichedMovements,
        pagination: {
          currentPage: pageNum,
          totalPages,
          totalMovements,
          limit: limitNum,
          hasNext: pageNum < totalPages,
          hasPrev: pageNum > 1
        },
        statistics: {
          totalDistance: Math.round(stats.totalDistance * 100) / 100,
          totalTime: stats.totalTime,
          avgSpeed: Math.round(stats.avgSpeed * 100) / 100,
          maxSpeed: Math.round(stats.maxSpeed * 100) / 100,
          totalMovements: stats.totalMovements,
          avgDistancePerMovement: stats.totalMovements > 0 ? 
            Math.round((stats.totalDistance / stats.totalMovements) * 100) / 100 : 0
        },
        filters: {
          startDate,
          endDate,
          region,
          minDistance,
          maxDistance,
          sortBy: sortField,
          sortOrder
        }
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error obteniendo movimientos de usuario:', error);
    res.status(500).json({
      success: false,
      message: 'Error obteniendo movimientos del usuario',
      code: 'GET_USER_MOVEMENTS_ERROR',
      timestamp: new Date().toISOString()
    });
  }
};

// ✅ OBTENER MOVIMIENTO ESPECÍFICO POR ID
exports.getMovementById = async (req, res) => {
  try {
    const { movementId } = req.params;
    const userId = req.user.id || req.user.userId;

    console.log('🔍 Consultando movimiento específico:', {
      movementId,
      userId,
      ip: req.ip,
      timestamp: new Date().toISOString()
    });

    // ✅ VALIDAR ID
    if (!mongoose.Types.ObjectId.isValid(movementId)) {
      return res.status(400).json({
        success: false,
        message: 'ID de movimiento inválido',
        code: 'INVALID_MOVEMENT_ID',
        timestamp: new Date().toISOString()
      });
    }

    // ✅ BUSCAR MOVIMIENTO CON VALIDACIÓN DE PROPIETARIO
    const movement = await Movement.findOne({
      _id: movementId,
      user_id: userId // Solo el propietario puede ver sus movimientos
    }).lean();

    if (!movement) {
      return res.status(404).json({
        success: false,
        message: 'Movimiento no encontrado o sin permisos',
        code: 'MOVEMENT_NOT_FOUND',
        timestamp: new Date().toISOString()
      });
    }

    // ✅ ENRIQUECER CON DATOS ADICIONALES
    const enrichedMovement = sanitizeMovementData(movement);

    // ✅ AGREGAR MOVIMIENTOS RELACIONADOS (ANTERIORES Y SIGUIENTES)
    const [previousMovement, nextMovement] = await Promise.all([
      Movement.findOne({
        user_id: userId,
        fecha: { $lt: movement.fecha }
      })
      .sort({ fecha: -1 })
      .select('_id fecha distancia_recorrida region')
      .lean(),
      
      Movement.findOne({
        user_id: userId,
        fecha: { $gt: movement.fecha }
      })
      .sort({ fecha: 1 })
      .select('_id fecha distancia_recorrida region')
      .lean()
    ]);

    res.json({
      success: true,
      data: {
        movement: enrichedMovement,
        navigation: {
          previous: previousMovement,
          next: nextMovement
        }
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error obteniendo movimiento específico:', error);
    res.status(500).json({
      success: false,
      message: 'Error obteniendo movimiento',
      code: 'GET_MOVEMENT_ERROR',
      timestamp: new Date().toISOString()
    });
  }
};

// ✅ OBTENER ESTADÍSTICAS DE MOVIMIENTOS POR PERÍODO
exports.getMovementStats = async (req, res) => {
  try {
    const userId = req.user.id || req.user.userId;
    const { period = '7d', groupBy = 'day' } = req.query;

    console.log('📊 Consultando estadísticas de movimientos:', {
      userId,
      period,
      groupBy,
      ip: req.ip,
      timestamp: new Date().toISOString()
    });

    // ✅ CALCULAR FECHAS SEGÚN PERÍODO
    const now = new Date();
    let startDate;

    switch (period) {
      case '1d':
        startDate = new Date(now - 24 * 60 * 60 * 1000);
        break;
      case '7d':
        startDate = new Date(now - 7 * 24 * 60 * 60 * 1000);
        break;
      case '30d':
        startDate = new Date(now - 30 * 24 * 60 * 60 * 1000);
        break;
      case '90d':
        startDate = new Date(now - 90 * 24 * 60 * 60 * 1000);
        break;
      default:
        startDate = new Date(now - 7 * 24 * 60 * 60 * 1000);
    }

    // ✅ DETERMINAR FORMATO DE AGRUPACIÓN
    let groupFormat;
    switch (groupBy) {
      case 'hour':
        groupFormat = '%Y-%m-%d-%H';
        break;
      case 'day':
        groupFormat = '%Y-%m-%d';
        break;
      case 'week':
        groupFormat = '%Y-%U';
        break;
      case 'month':
        groupFormat = '%Y-%m';
        break;
      default:
        groupFormat = '%Y-%m-%d';
    }

    // ✅ CONSULTAS AGREGADAS PARALELAS
    const [
      totalStats,
      trendData,
      regionStats,
      timeStats,
      speedDistribution
    ] = await Promise.all([
      // Estadísticas totales del período
      Movement.aggregate([
        {
          $match: {
            user_id: new mongoose.Types.ObjectId(userId),
            fecha: { $gte: startDate, $lte: now }
          }
        },
        {
          $group: {
            _id: null,
            totalMovements: { $sum: 1 },
            totalDistance: { $sum: '$distancia_recorrida' },
            totalTime: { $sum: '$tiempo_total' },
            avgSpeed: { $avg: '$velocidad_promedio' },
            maxSpeed: { $max: '$velocidad_maxima' },
            minSpeed: { $min: '$velocidad_promedio' },
            avgDistance: { $avg: '$distancia_recorrida' },
            maxDistance: { $max: '$distancia_recorrida' }
          }
        }
      ]),

      // Datos de tendencia temporal
      Movement.aggregate([
        {
          $match: {
            user_id: new mongoose.Types.ObjectId(userId),
            fecha: { $gte: startDate, $lte: now }
          }
        },
        {
          $group: {
            _id: { $dateToString: { format: groupFormat, date: '$fecha' } },
            count: { $sum: 1 },
            distance: { $sum: '$distancia_recorrida' },
            time: { $sum: '$tiempo_total' },
            avgSpeed: { $avg: '$velocidad_promedio' }
          }
        },
        { $sort: { _id: 1 } }
      ]),

      // Estadísticas por región
      Movement.aggregate([
        {
          $match: {
            user_id: new mongoose.Types.ObjectId(userId),
            fecha: { $gte: startDate, $lte: now }
          }
        },
        {
          $group: {
            _id: '$region',
            count: { $sum: 1 },
            totalDistance: { $sum: '$distancia_recorrida' },
            avgSpeed: { $avg: '$velocidad_promedio' }
          }
        },
        { $sort: { count: -1 } }
      ]),

      // Estadísticas por hora del día
      Movement.aggregate([
        {
          $match: {
            user_id: new mongoose.Types.ObjectId(userId),
            fecha: { $gte: startDate, $lte: now }
          }
        },
        {
          $group: {
            _id: { $hour: '$fecha' },
            count: { $sum: 1 },
            avgDistance: { $avg: '$distancia_recorrida' },
            avgSpeed: { $avg: '$velocidad_promedio' }
          }
        },
        { $sort: { _id: 1 } }
      ]),

      // Distribución de velocidades
      Movement.aggregate([
        {
          $match: {
            user_id: new mongoose.Types.ObjectId(userId),
            fecha: { $gte: startDate, $lte: now }
          }
        },
        {
          $bucket: {
            groupBy: '$velocidad_promedio',
            boundaries: [0, 10, 20, 30, 40, 50, 60, 80, 100, 200],
            default: '100+',
            output: {
              count: { $sum: 1 },
              avgDistance: { $avg: '$distancia_recorrida' }
            }
          }
        }
      ])
    ]);

    const stats = totalStats[0] || {
      totalMovements: 0,
      totalDistance: 0,
      totalTime: 0,
      avgSpeed: 0,
      maxSpeed: 0,
      minSpeed: 0,
      avgDistance: 0,
      maxDistance: 0
    };

    res.json({
      success: true,
      data: {
        period,
        dateRange: {
          start: startDate,
          end: now
        },
        summary: {
          totalMovements: stats.totalMovements,
          totalDistance: Math.round(stats.totalDistance * 100) / 100,
          totalTime: stats.totalTime,
          avgSpeed: Math.round(stats.avgSpeed * 100) / 100,
          maxSpeed: Math.round(stats.maxSpeed * 100) / 100,
          minSpeed: Math.round(stats.minSpeed * 100) / 100,
          avgDistance: Math.round(stats.avgDistance * 100) / 100,
          maxDistance: Math.round(stats.maxDistance * 100) / 100,
          efficiency: stats.avgSpeed > 0 ? 
            Math.round((stats.totalDistance / (stats.totalTime / 60)) * 100) / 100 : 0
        },
        trends: trendData,
        distributions: {
          byRegion: regionStats,
          byHour: timeStats,
          bySpeed: speedDistribution
        }
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error obteniendo estadísticas de movimientos:', error);
    res.status(500).json({
      success: false,
      message: 'Error obteniendo estadísticas de movimientos',
      code: 'GET_MOVEMENT_STATS_ERROR',
      timestamp: new Date().toISOString()
    });
  }
};

// ✅ ELIMINAR MOVIMIENTO (SOFT DELETE)
exports.deleteMovement = async (req, res) => {
  try {
    const { movementId } = req.params;
    const userId = req.user.id || req.user.userId;

    console.log('🗑️ Eliminando movimiento:', {
      movementId,
      userId,
      ip: req.ip,
      timestamp: new Date().toISOString()
    });

    // ✅ VALIDAR ID
    if (!mongoose.Types.ObjectId.isValid(movementId)) {
      return res.status(400).json({
        success: false,
        message: 'ID de movimiento inválido',
        code: 'INVALID_MOVEMENT_ID',
        timestamp: new Date().toISOString()
      });
    }

    // ✅ BUSCAR Y VALIDAR PROPIETARIO
    const movement = await Movement.findOne({
      _id: movementId,
      user_id: userId
    });

    if (!movement) {
      return res.status(404).json({
        success: false,
        message: 'Movimiento no encontrado o sin permisos',
        code: 'MOVEMENT_NOT_FOUND',
        timestamp: new Date().toISOString()
      });
    }

    // ✅ SOFT DELETE (MARCAR COMO ELIMINADO)
    movement.deleted = true;
    movement.deletedAt = new Date();
    movement.deletedBy = userId;
    await movement.save();

    // ✅ O HARD DELETE SI SE PREFIERE
    // await Movement.findByIdAndDelete(movementId);

    console.log('✅ Movimiento eliminado exitosamente:', {
      movementId,
      userId,
      timestamp: new Date().toISOString()
    });

    res.json({
      success: true,
      message: 'Movimiento eliminado exitosamente',
      data: {
        movementId,
        deletedAt: movement.deletedAt
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error eliminando movimiento:', error);
    res.status(500).json({
      success: false,
      message: 'Error eliminando movimiento',
      code: 'DELETE_MOVEMENT_ERROR',
      timestamp: new Date().toISOString()
    });
  }
};

module.exports = {
  registerMovement: exports.registerMovement,
  getUserMovements: exports.getUserMovements,
  getMovementById: exports.getMovementById,
  getMovementStats: exports.getMovementStats,
  deleteMovement: exports.deleteMovement
};
