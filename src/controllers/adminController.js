const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const XLSX = require('xlsx');
const moment = require('moment');

// ✅ IMPORTACIONES LOCALES
const User = require('../models/User');
const Movement = require('../models/Movement');
const Report = require('../models/Report');

// ✅ CONFIGURACIÓN JWT SEGURA
const JWT_CONFIG = {
  secret: process.env.JWT_SECRET,
  refreshSecret: process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET,
  accessTokenExpiry: process.env.JWT_EXPIRE || '24h',
  refreshTokenExpiry: process.env.JWT_REFRESH_EXPIRE || '7d'
};

// ✅ UTILIDADES HELPER PARA ADMIN
const generateAdminTokens = (adminUser) => {
  const payload = {
    userId: adminUser._id,
    userRole: 'admin',
    email: adminUser.correo_electronico,
    adminLevel: adminUser.adminLevel || 'full',
    iat: Math.floor(Date.now() / 1000)
  };

  const accessToken = jwt.sign(
    { ...payload, type: 'access' },
    JWT_CONFIG.secret,
    { 
      expiresIn: '8h', // Tokens admin más cortos por seguridad
      issuer: 'supervitec-api',
      audience: 'supervitec-admin'
    }
  );

  const refreshToken = jwt.sign(
    { ...payload, type: 'refresh' },
    JWT_CONFIG.refreshSecret,
    { 
      expiresIn: '24h', // Refresh admin también más corto
      issuer: 'supervitec-api',
      audience: 'supervitec-admin'
    }
  );

  return { accessToken, refreshToken };
};

const sanitizeUserForAdmin = (user) => {
  const { contrasena, tokenRecuperacion, expiraTokenRecuperacion, ...safeUser } = user.toObject ? user.toObject() : user;
  return {
    ...safeUser,
    hasPassword: !!contrasena,
    lastLogin: user.ultimoAcceso,
    createdAt: user.fechaCreacion
  };
};

// ✅ LOGIN ADMINISTRATIVO SEGURO
exports.adminLogin = async (req, res) => {
  try {
    const { correo_electronico, contrasena } = req.body;

    console.log('🔑 Intento de login administrativo:', {
      email: correo_electronico,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      timestamp: new Date().toISOString()
    });

    // ✅ VALIDACIÓN ESTRICTA
    if (!correo_electronico || !contrasena) {
      return res.status(400).json({
        success: false,
        message: 'Email y contraseña de administrador son obligatorios',
        code: 'MISSING_ADMIN_CREDENTIALS',
        timestamp: new Date().toISOString()
      });
    }

    // ✅ BUSCAR ADMIN CON VALIDACIONES EXTRA
    const admin = await User.findOne({ 
      correo_electronico: correo_electronico.toLowerCase().trim(),
      rol: 'admin',
      activo: true
    }).select('+contrasena');

    if (!admin) {
      // ✅ DELAY PARA PREVENIR TIMING ATTACKS
      await bcrypt.hash('dummy_admin_password_protection', 12);
      
      console.warn('❌ Intento login admin - usuario no encontrado o sin permisos:', {
        email: correo_electronico,
        ip: req.ip,
        timestamp: new Date().toISOString()
      });

      return res.status(401).json({
        success: false,
        message: 'Credenciales de administrador inválidas',
        code: 'INVALID_ADMIN_CREDENTIALS',
        timestamp: new Date().toISOString()
      });
    }

    // ✅ VERIFICAR CONTRASEÑA CON SALT ALTO
    const isValidPassword = await bcrypt.compare(contrasena, admin.contrasena);

    if (!isValidPassword) {
      console.warn('❌ Intento login admin - contraseña incorrecta:', {
        adminId: admin._id,
        email: correo_electronico,
        ip: req.ip,
        timestamp: new Date().toISOString()
      });

      return res.status(401).json({
        success: false,
        message: 'Credenciales de administrador inválidas',
        code: 'INVALID_ADMIN_CREDENTIALS',
        timestamp: new Date().toISOString()
      });
    }

    // ✅ GENERAR TOKENS ADMINISTRATIVOS
    const { accessToken, refreshToken } = generateAdminTokens(admin);

    // ✅ ACTUALIZAR SESIÓN ADMIN CON TRACKING COMPLETO
    admin.ultimoAcceso = new Date();
    admin.refreshTokens = (admin.refreshTokens || []).filter(
      tokenObj => tokenObj.createdAt > new Date(Date.now() - 24 * 60 * 60 * 1000) // Solo 1 día para admin
    );
    
    admin.refreshTokens.push({ 
      token: refreshToken, 
      createdAt: new Date(),
      userAgent: req.get('User-Agent'),
      ip: req.ip,
      type: 'admin_session'
    });

    // Limitar a máximo 3 sesiones admin simultáneas
    if (admin.refreshTokens.length > 3) {
      admin.refreshTokens = admin.refreshTokens.slice(-3);
    }

    await admin.save();

    // ✅ LOG DE SEGURIDAD ADMINISTRATIVO
    console.log('✅ Login administrativo exitoso:', {
      adminId: admin._id,
      email: correo_electronico,
      name: admin.nombre_completo,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      timestamp: new Date().toISOString()
    });

    // ✅ ESTADÍSTICAS RÁPIDAS PARA DASHBOARD ADMIN
    const [totalUsers, activeUsers, totalMovements, recentMovements] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ activo: true }),
      Movement.countDocuments(),
      Movement.countDocuments({ 
        fecha: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } 
      })
    ]);

    res.json({
      success: true,
      message: 'Login administrativo exitoso',
      data: {
        admin: sanitizeUserForAdmin(admin),
        token: accessToken,
        refreshToken,
        expiresIn: '8h',
        permissions: ['admin_full_access'],
        dashboardStats: {
          totalUsers,
          activeUsers,
          totalMovements,
          recentMovements
        }
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error en login administrativo:', {
      error: error.message,
      stack: error.stack,
      ip: req.ip,
      timestamp: new Date().toISOString()
    });

    res.status(500).json({
      success: false,
      message: 'Error interno del servidor administrativo',
      code: 'ADMIN_LOGIN_ERROR',
      timestamp: new Date().toISOString()
    });
  }
};

// ✅ OBTENER TODOS LOS USUARIOS (CON PAGINACIÓN Y FILTROS)
exports.getAllUsers = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      search = '',
      region = '',
      rol = '',
      activo = '',
      sortBy = 'fechaCreacion',
      sortOrder = 'desc'
    } = req.query;

    console.log('👥 Admin consultando usuarios:', {
      adminId: req.user.id,
      filters: { page, limit, search, region, rol, activo },
      ip: req.ip,
      timestamp: new Date().toISOString()
    });

    // ✅ CONSTRUIR FILTROS DINÁMICOS
    const filters = {};

    if (search) {
      filters.$or = [
        { nombre_completo: { $regex: search, $options: 'i' } },
        { correo_electronico: { $regex: search, $options: 'i' } }
      ];
    }

    if (region) {
      filters.region = { $regex: region, $options: 'i' };
    }

    if (rol && ['admin', 'supervisor', 'trabajador', 'invitado'].includes(rol)) {
      filters.rol = rol;
    }

    if (activo !== '') {
      filters.activo = activo === 'true';
    }

    // ✅ PAGINACIÓN SEGURA
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit))); // Máximo 100 por página
    const skip = (pageNum - 1) * limitNum;

    // ✅ ORDENAMIENTO SEGURO
    const validSortFields = ['fechaCreacion', 'ultimoAcceso', 'nombre_completo', 'correo_electronico', 'region'];
    const sortField = validSortFields.includes(sortBy) ? sortBy : 'fechaCreacion';
    const sortDirection = sortOrder === 'asc' ? 1 : -1;

    // ✅ CONSULTA OPTIMIZADA
    const [users, totalUsers] = await Promise.all([
      User.find(filters)
        .select('-contrasena -tokenRecuperacion -expiraTokenRecuperacion -refreshTokens')
        .sort({ [sortField]: sortDirection })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      User.countDocuments(filters)
    ]);

    // ✅ AGREGAR ESTADÍSTICAS DE ACTIVIDAD
    const usersWithStats = await Promise.all(
      users.map(async (user) => {
        const [movementCount, lastMovement] = await Promise.all([
          Movement.countDocuments({ user_id: user._id }),
          Movement.findOne({ user_id: user._id }).sort({ fecha: -1 }).lean()
        ]);

        return {
          ...user,
          stats: {
            totalMovements: movementCount,
            lastMovement: lastMovement?.fecha || null,
            lastActivity: user.ultimoAcceso
          }
        };
      })
    );

    const totalPages = Math.ceil(totalUsers / limitNum);

    res.json({
      success: true,
      data: {
        users: usersWithStats,
        pagination: {
          currentPage: pageNum,
          totalPages,
          totalUsers,
          limit: limitNum,
          hasNext: pageNum < totalPages,
          hasPrev: pageNum > 1
        },
        filters: {
          search,
          region,
          rol,
          activo,
          sortBy: sortField,
          sortOrder
        }
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error obteniendo usuarios:', error);
    res.status(500).json({
      success: false,
      message: 'Error obteniendo lista de usuarios',
      code: 'GET_USERS_ERROR',
      timestamp: new Date().toISOString()
    });
  }
};

// ✅ OBTENER ESTADÍSTICAS DEL DASHBOARD
exports.getDashboardStats = async (req, res) => {
  try {
    const { period = '7d' } = req.query;

    console.log('📊 Admin consultando estadísticas:', {
      adminId: req.user.id,
      period,
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

    // ✅ CONSULTAS PARALELAS OPTIMIZADAS
    const [
      totalUsers,
      activeUsers,
      inactiveUsers,
      newUsers,
      totalMovements,
      recentMovements,
      usersByRegion,
      usersByRole,
      movementsByDate,
      topActiveUsers
    ] = await Promise.all([
      // Usuarios totales
      User.countDocuments(),
      
      // Usuarios activos (estado)
      User.countDocuments({ activo: true }),
      
      // Usuarios inactivos
      User.countDocuments({ activo: false }),
      
      // Nuevos usuarios en el período
      User.countDocuments({ fechaCreacion: { $gte: startDate } }),
      
      // Movimientos totales
      Movement.countDocuments(),
      
      // Movimientos recientes en el período
      Movement.countDocuments({ fecha: { $gte: startDate } }),
      
      // Distribución por región
      User.aggregate([
        { $group: { _id: '$region', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 }
      ]),
      
      // Distribución por rol
      User.aggregate([
        { $group: { _id: '$rol', count: { $sum: 1 } } },
        { $sort: { count: -1 } }
      ]),
      
      // Movimientos por día
      Movement.aggregate([
        { $match: { fecha: { $gte: startDate } } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$fecha' } },
            count: { $sum: 1 }
          }
        },
        { $sort: { _id: 1 } }
      ]),
      
      // Top usuarios más activos
      Movement.aggregate([
        { $match: { fecha: { $gte: startDate } } },
        { $group: { _id: '$user_id', movementCount: { $sum: 1 } } },
        { $sort: { movementCount: -1 } },
        { $limit: 10 },
        {
          $lookup: {
            from: 'users',
            localField: '_id',
            foreignField: '_id',
            as: 'user'
          }
        },
        { $unwind: '$user' },
        {
          $project: {
            userId: '$_id',
            movementCount: 1,
            userName: '$user.nombre_completo',
            userEmail: '$user.correo_electronico',
            userRegion: '$user.region'
          }
        }
      ])
    ]);

    // ✅ CALCULAR MÉTRICAS ADICIONALES
    const activeUserPercentage = totalUsers > 0 ? ((activeUsers / totalUsers) * 100).toFixed(1) : 0;
    const newUserGrowth = totalUsers > newUsers ? (((newUsers / (totalUsers - newUsers)) * 100).toFixed(1)) : 0;
    const avgMovementsPerUser = totalUsers > 0 ? (totalMovements / totalUsers).toFixed(1) : 0;

    // ✅ CALCULAR MÉTRICAS DE ACTIVIDAD
    const recentActiveUsers = await User.countDocuments({
      ultimoAcceso: { $gte: startDate }
    });

    const movementGrowth = totalMovements > recentMovements ? 
      (((recentMovements / (totalMovements - recentMovements)) * 100).toFixed(1)) : 0;

    res.json({
      success: true,
      data: {
        period,
        dateRange: {
          start: startDate,
          end: now
        },
        overview: {
          totalUsers,
          activeUsers,
          inactiveUsers,
          newUsers,
          recentActiveUsers,
          totalMovements,
          recentMovements,
          metrics: {
            activeUserPercentage: parseFloat(activeUserPercentage),
            newUserGrowth: parseFloat(newUserGrowth),
            avgMovementsPerUser: parseFloat(avgMovementsPerUser),
            movementGrowth: parseFloat(movementGrowth)
          }
        },
        distributions: {
          byRegion: usersByRegion,
          byRole: usersByRole
        },
        trends: {
          movementsByDate,
          topActiveUsers
        },
        lastUpdated: new Date().toISOString()
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error obteniendo estadísticas:', error);
    res.status(500).json({
      success: false,
      message: 'Error obteniendo estadísticas del dashboard',
      code: 'DASHBOARD_STATS_ERROR',
      timestamp: new Date().toISOString()
    });
  }
};

// ✅ EXPORTAR DATOS A EXCEL CON FORMATO PROFESIONAL
exports.exportToExcel = async (req, res) => {
  try {
    const { type = 'users', startDate, endDate, format = 'xlsx' } = req.query;

    console.log('📊 Admin exportando datos:', {
      adminId: req.user.id,
      type,
      startDate,
      endDate,
      format,
      ip: req.ip,
      timestamp: new Date().toISOString()
    });

    // ✅ VALIDAR TIPO DE EXPORTACIÓN
    if (!['users', 'movements', 'reports', 'all'].includes(type)) {
      return res.status(400).json({
        success: false,
        message: 'Tipo de exportación inválido',
        code: 'INVALID_EXPORT_TYPE',
        validTypes: ['users', 'movements', 'reports', 'all'],
        timestamp: new Date().toISOString()
      });
    }

    // ✅ CONSTRUIR FILTROS DE FECHA
    const dateFilters = {};
    if (startDate) {
      dateFilters.$gte = new Date(startDate);
    }
    if (endDate) {
      dateFilters.$lte = new Date(endDate);
    }

    let workbook = XLSX.utils.book_new();
    let filename = `supervitec_${type}_${moment().format('YYYY-MM-DD_HH-mm-ss')}`;

    // ✅ EXPORTAR USUARIOS
    if (type === 'users' || type === 'all') {
      const users = await User.find(
        Object.keys(dateFilters).length > 0 ? { fechaCreacion: dateFilters } : {}
      )
      .select('-contrasena -tokenRecuperacion -expiraTokenRecuperacion -refreshTokens')
      .lean();

      const usersData = users.map(user => ({
        'ID': user._id.toString(),
        'Nombre Completo': user.nombre_completo,
        'Correo Electrónico': user.correo_electronico,
        'Región': user.region,
        'Transporte': user.transporte,
        'Rol': user.rol,
        'Estado': user.activo ? 'Activo' : 'Inactivo',
        'Fecha Creación': moment(user.fechaCreacion).format('YYYY-MM-DD HH:mm:ss'),
        'Último Acceso': user.ultimoAcceso ? moment(user.ultimoAcceso).format('YYYY-MM-DD HH:mm:ss') : 'Nunca'
      }));

      const worksheet = XLSX.utils.json_to_sheet(usersData);
      
      // ✅ AJUSTAR ANCHOS DE COLUMNA
      const colWidths = [
        { wch: 25 }, // ID
        { wch: 30 }, // Nombre
        { wch: 35 }, // Email
        { wch: 20 }, // Región
        { wch: 15 }, // Transporte
        { wch: 12 }, // Rol
        { wch: 10 }, // Estado
        { wch: 20 }, // Fecha Creación
        { wch: 20 }  // Último Acceso
      ];
      worksheet['!cols'] = colWidths;

      XLSX.utils.book_append_sheet(workbook, worksheet, 'Usuarios');
    }

    // ✅ EXPORTAR MOVIMIENTOS
    if (type === 'movements' || type === 'all') {
      const movements = await Movement.find(
        Object.keys(dateFilters).length > 0 ? { fecha: dateFilters } : {}
      )
      .populate('user_id', 'nombre_completo correo_electronico region')
      .lean();

      const movementsData = movements.map(movement => ({
        'ID': movement._id.toString(),
        'Usuario': movement.user_id?.nombre_completo || 'Usuario eliminado',
        'Email Usuario': movement.user_id?.correo_electronico || 'N/A',
        'Región': movement.region,
        'Ubicación Inicio': `${movement.start_location?.latitude}, ${movement.start_location?.longitude}`,
        'Ubicación Final': `${movement.end_location?.latitude}, ${movement.end_location?.longitude}`,
        'Distancia (km)': movement.distancia_recorrida,
        'Velocidad Promedio': movement.velocidad_promedio,
        'Velocidad Máxima': movement.velocidad_maxima,
        'Tiempo Total (min)': movement.tiempo_total,
        'Fecha': moment(movement.fecha).format('YYYY-MM-DD HH:mm:ss')
      }));

      const worksheet = XLSX.utils.json_to_sheet(movementsData);
      
      const colWidths = [
        { wch: 25 }, // ID
        { wch: 30 }, // Usuario
        { wch: 35 }, // Email
        { wch: 20 }, // Región
        { wch: 25 }, // Inicio
        { wch: 25 }, // Final
        { wch: 15 }, // Distancia
        { wch: 18 }, // Vel Prom
        { wch: 15 }, // Vel Max
        { wch: 15 }, // Tiempo
        { wch: 20 }  // Fecha
      ];
      worksheet['!cols'] = colWidths;

      XLSX.utils.book_append_sheet(workbook, worksheet, 'Movimientos');
    }

    // ✅ AGREGAR HOJA DE RESUMEN
    const summaryData = [
      { 'Métrica': 'Total Usuarios', 'Valor': await User.countDocuments() },
      { 'Métrica': 'Usuarios Activos', 'Valor': await User.countDocuments({ activo: true }) },
      { 'Métrica': 'Total Movimientos', 'Valor': await Movement.countDocuments() },
      { 'Métrica': 'Fecha Exportación', 'Valor': moment().format('YYYY-MM-DD HH:mm:ss') },
      { 'Métrica': 'Exportado Por', 'Valor': req.user.email || 'Admin' },
      { 'Métrica': 'Tipo de Exportación', 'Valor': type },
      { 'Métrica': 'Rango de Fechas', 'Valor': startDate && endDate ? `${startDate} a ${endDate}` : 'Todas' }
    ];

    const summaryWorksheet = XLSX.utils.json_to_sheet(summaryData);
    summaryWorksheet['!cols'] = [{ wch: 25 }, { wch: 30 }];
    XLSX.utils.book_append_sheet(workbook, summaryWorksheet, 'Resumen');

    // ✅ CONFIGURAR HEADERS PARA DESCARGA
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: format });
    
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.${format}"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Length', buffer.length);

    console.log('✅ Datos exportados exitosamente:', {
      adminId: req.user.id,
      type,
      filename: `${filename}.${format}`,
      size: buffer.length,
      timestamp: new Date().toISOString()
    });

    res.send(buffer);

  } catch (error) {
    console.error('❌ Error exportando datos:', error);
    res.status(500).json({
      success: false,
      message: 'Error exportando datos',
      code: 'EXPORT_ERROR',
      timestamp: new Date().toISOString()
    });
  }
};

// ✅ ACTIVAR/DESACTIVAR USUARIO
exports.toggleUserStatus = async (req, res) => {
  try {
    const { userId } = req.params;
    const { activo, razon } = req.body;

    console.log('🔄 Admin cambiando estado de usuario:', {
      adminId: req.user.id,
      targetUserId: userId,
      newStatus: activo,
      reason: razon,
      ip: req.ip,
      timestamp: new Date().toISOString()
    });

    // ✅ VALIDACIONES
    if (!userId || typeof activo !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: 'ID de usuario y estado son requeridos',
        code: 'MISSING_PARAMETERS',
        timestamp: new Date().toISOString()
      });
    }

    // ✅ BUSCAR USUARIO
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Usuario no encontrado',
        code: 'USER_NOT_FOUND',
        timestamp: new Date().toISOString()
      });
    }

    // ✅ PREVENIR AUTO-DESACTIVACIÓN
    if (user._id.toString() === req.user.id && !activo) {
      return res.status(400).json({
        success: false,
        message: 'No puedes desactivar tu propia cuenta',
        code: 'CANNOT_DEACTIVATE_SELF',
        timestamp: new Date().toISOString()
      });
    }

    // ✅ ACTUALIZAR ESTADO
    const oldStatus = user.activo;
    user.activo = activo;
    
    // Si se desactiva, limpiar tokens de sesión
    if (!activo) {
      user.refreshTokens = [];
    }

    await user.save();

    console.log('✅ Estado de usuario actualizado:', {
      adminId: req.user.id,
      userId: user._id,
      email: user.correo_electronico,
      oldStatus,
      newStatus: activo,
      reason: razon,
      timestamp: new Date().toISOString()
    });

    res.json({
      success: true,
      message: `Usuario ${activo ? 'activado' : 'desactivado'} exitosamente`,
      data: {
        userId: user._id,
        email: user.correo_electronico,
        nombre: user.nombre_completo,
        oldStatus,
        newStatus: activo,
        updatedBy: req.user.email,
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('❌ Error cambiando estado de usuario:', error);
    res.status(500).json({
      success: false,
      message: 'Error actualizando estado del usuario',
      code: 'UPDATE_USER_STATUS_ERROR',
      timestamp: new Date().toISOString()
    });
  }
};

module.exports = {
  adminLogin: exports.adminLogin,
  getAllUsers: exports.getAllUsers,
  getDashboardStats: exports.getDashboardStats,
  exportToExcel: exports.exportToExcel,
  toggleUserStatus: exports.toggleUserStatus
};
