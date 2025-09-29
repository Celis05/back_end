const cron = require('node-cron');
const XLSX = require('xlsx');
const nodemailer = require('nodemailer');
const moment = require('moment');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');

// ✅ IMPORTACIONES LOCALES
const Movement = require('../models/Movement');
const User = require('../models/User');
const Report = require('../models/Report');

// ✅ CONFIGURACIÓN GLOBAL DE CRON JOBS
const CRON_CONFIG = {
  timezone: 'America/Bogota', // Colombia
  enableReports: process.env.ENABLE_CRON_REPORTS !== 'false',
  enableCleanup: process.env.ENABLE_CRON_CLEANUP !== 'false',
  enableNotifications: process.env.ENABLE_CRON_NOTIFICATIONS !== 'false',
  enableBackups: process.env.ENABLE_CRON_BACKUPS !== 'false'
};

// ✅ CONFIGURACIÓN DE EMAIL MEJORADA
const createEmailTransporter = () => {
  const config = {
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    },
    tls: {
      rejectUnauthorized: false
    }
  };

  return nodemailer.createTransporter(config);
};

// ✅ UTILIDADES HELPER
const ensureDirectoryExists = async (dirPath) => {
  try {
    await fs.access(dirPath);
  } catch (error) {
    if (error.code === 'ENOENT') {
      await fs.mkdir(dirPath, { recursive: true });
      console.log('📁 Directorio creado:', dirPath);
    } else {
      throw error;
    }
  }
};

const formatBytes = (bytes, decimals = 2) => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
};

const logCronActivity = (taskName, status, details = {}) => {
  const logData = {
    task: taskName,
    status,
    timestamp: new Date().toISOString(),
    details,
    serverTime: moment().tz('America/Bogota').format('YYYY-MM-DD HH:mm:ss')
  };

  if (status === 'success') {
    console.log('✅ CRON SUCCESS:', JSON.stringify(logData, null, 2));
  } else if (status === 'error') {
    console.error('❌ CRON ERROR:', JSON.stringify(logData, null, 2));
  } else {
    console.log('ℹ️ CRON INFO:', JSON.stringify(logData, null, 2));
  }
};

// ✅ GENERAR REPORTE MENSUAL COMPLETO Y PROFESIONAL
async function generarReporteMensual(mes, year) {
  try {
    logCronActivity('generarReporteMensual', 'start', { mes, year });

    // ✅ CALCULAR FECHAS DEL MES
    const startDate = new Date(year, mes - 1, 1);
    const endDate = new Date(year, mes, 1);
    const monthName = moment(startDate).format('MMMM YYYY');

    // ✅ CONSULTAS PARALELAS OPTIMIZADAS
    const [movements, users, userStats, regionStats, dailyStats] = await Promise.all([
      // Movimientos del mes con población de usuario
      Movement.find({
        fecha: { $gte: startDate, $lt: endDate }
      })
      .populate('user_id', 'nombre_completo correo_electronico region')
      .lean(),

      // Total de usuarios activos
      User.find({ activo: true })
      .select('nombre_completo correo_electronico region fechaCreacion')
      .lean(),

      // Estadísticas por usuario
      Movement.aggregate([
        { $match: { fecha: { $gte: startDate, $lt: endDate } } },
        {
          $group: {
            _id: '$user_id',
            totalMovements: { $sum: 1 },
            totalDistance: { $sum: '$distancia_recorrida' },
            totalTime: { $sum: '$tiempo_total' },
            avgSpeed: { $avg: '$velocidad_promedio' },
            maxSpeed: { $max: '$velocidad_maxima' }
          }
        },
        {
          $lookup: {
            from: 'users',
            localField: '_id',
            foreignField: '_id',
            as: 'user'
          }
        },
        { $unwind: '$user' }
      ]),

      // Estadísticas por región
      Movement.aggregate([
        { $match: { fecha: { $gte: startDate, $lt: endDate } } },
        {
          $group: {
            _id: '$region',
            totalMovements: { $sum: 1 },
            totalDistance: { $sum: '$distancia_recorrida' },
            avgSpeed: { $avg: '$velocidad_promedio' }
          }
        },
        { $sort: { totalMovements: -1 } }
      ]),

      // Estadísticas por día
      Movement.aggregate([
        { $match: { fecha: { $gte: startDate, $lt: endDate } } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$fecha' } },
            count: { $sum: 1 },
            distance: { $sum: '$distancia_recorrida' }
          }
        },
        { $sort: { _id: 1 } }
      ])
    ]);

    // ✅ CREAR WORKBOOK CON MÚLTIPLES HOJAS
    const workbook = XLSX.utils.book_new();

    // ✅ HOJA 1: RESUMEN EJECUTIVO
    const summaryData = [
      { 'Métrica': 'Período del Reporte', 'Valor': monthName },
      { 'Métrica': 'Fecha de Generación', 'Valor': moment().format('DD/MM/YYYY HH:mm:ss') },
      { 'Métrica': 'Total de Movimientos', 'Valor': movements.length },
      { 'Métrica': 'Total de Usuarios Activos', 'Valor': users.length },
      { 'Métrica': 'Usuarios con Movimientos', 'Valor': userStats.length },
      { 'Métrica': 'Regiones con Actividad', 'Valor': regionStats.length },
      { 'Métrica': 'Distancia Total (km)', 'Valor': movements.reduce((sum, m) => sum + (m.distancia_recorrida || 0), 0).toFixed(2) },
      { 'Métrica': 'Tiempo Total (min)', 'Valor': movements.reduce((sum, m) => sum + (m.tiempo_total || 0), 0) },
      { 'Métrica': 'Velocidad Promedio (km/h)', 'Valor': movements.length > 0 ? (movements.reduce((sum, m) => sum + (m.velocidad_promedio || 0), 0) / movements.length).toFixed(1) : 0 },
      { 'Métrica': 'Sistema', 'Valor': 'SupervitecApp v1.0' }
    ];

    const summaryWorksheet = XLSX.utils.json_to_sheet(summaryData);
    summaryWorksheet['!cols'] = [{ wch: 25 }, { wch: 20 }];
    XLSX.utils.book_append_sheet(workbook, summaryWorksheet, 'Resumen Ejecutivo');

    // ✅ HOJA 2: DETALLE DE MOVIMIENTOS
    const movementData = movements.map(movement => ({
      'ID Movimiento': movement._id.toString(),
      'Usuario': movement.user_id?.nombre_completo || 'Usuario eliminado',
      'Email': movement.user_id?.correo_electronico || 'N/A',
      'Región': movement.region,
      'Fecha': moment(movement.fecha).format('DD/MM/YYYY'),
      'Hora': moment(movement.fecha).format('HH:mm:ss'),
      'Lat. Inicio': movement.start_location?.latitude?.toFixed(6) || 'N/A',
      'Lng. Inicio': movement.start_location?.longitude?.toFixed(6) || 'N/A',
      'Lat. Final': movement.end_location?.latitude?.toFixed(6) || 'N/A',
      'Lng. Final': movement.end_location?.longitude?.toFixed(6) || 'N/A',
      'Distancia (km)': movement.distancia_recorrida,
      'Tiempo (min)': movement.tiempo_total,
      'Vel. Promedio (km/h)': movement.velocidad_promedio,
      'Vel. Máxima (km/h)': movement.velocidad_maxima
    }));

    if (movementData.length > 0) {
      const movementWorksheet = XLSX.utils.json_to_sheet(movementData);
      movementWorksheet['!cols'] = [
        { wch: 25 }, { wch: 30 }, { wch: 35 }, { wch: 20 }, { wch: 12 }, { wch: 10 },
        { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 15 }, { wch: 12 },
        { wch: 18 }, { wch: 16 }
      ];
      XLSX.utils.book_append_sheet(workbook, movementWorksheet, 'Detalle Movimientos');
    }

    // ✅ HOJA 3: ESTADÍSTICAS POR USUARIO
    const userStatsData = userStats.map(stat => ({
      'Usuario': stat.user.nombre_completo,
      'Email': stat.user.correo_electronico,
      'Región': stat.user.region,
      'Total Movimientos': stat.totalMovements,
      'Distancia Total (km)': stat.totalDistance.toFixed(2),
      'Tiempo Total (min)': stat.totalTime,
      'Velocidad Promedio (km/h)': stat.avgSpeed.toFixed(1),
      'Velocidad Máxima (km/h)': stat.maxSpeed.toFixed(1),
      'Eficiencia': stat.totalTime > 0 ? (stat.totalDistance / (stat.totalTime / 60)).toFixed(1) : '0'
    }));

    if (userStatsData.length > 0) {
      const userStatsWorksheet = XLSX.utils.json_to_sheet(userStatsData);
      userStatsWorksheet['!cols'] = [
        { wch: 30 }, { wch: 35 }, { wch: 20 }, { wch: 18 }, { wch: 18 },
        { wch: 16 }, { wch: 20 }, { wch: 20 }, { wch: 12 }
      ];
      XLSX.utils.book_append_sheet(workbook, userStatsWorksheet, 'Stats por Usuario');
    }

    // ✅ HOJA 4: ESTADÍSTICAS POR REGIÓN
    if (regionStats.length > 0) {
      const regionWorksheet = XLSX.utils.json_to_sheet(regionStats.map(region => ({
        'Región': region._id,
        'Total Movimientos': region.totalMovements,
        'Distancia Total (km)': region.totalDistance.toFixed(2),
        'Velocidad Promedio (km/h)': region.avgSpeed.toFixed(1)
      })));
      regionWorksheet['!cols'] = [{ wch: 25 }, { wch: 18 }, { wch: 20 }, { wch: 22 }];
      XLSX.utils.book_append_sheet(workbook, regionWorksheet, 'Stats por Región');
    }

    // ✅ HOJA 5: ACTIVIDAD DIARIA
    if (dailyStats.length > 0) {
      const dailyWorksheet = XLSX.utils.json_to_sheet(dailyStats.map(day => ({
        'Fecha': moment(day._id).format('DD/MM/YYYY'),
        'Día de Semana': moment(day._id).format('dddd'),
        'Movimientos': day.count,
        'Distancia Total (km)': day.distance.toFixed(2)
      })));
      dailyWorksheet['!cols'] = [{ wch: 12 }, { wch: 15 }, { wch: 15 }, { wch: 20 }];
      XLSX.utils.book_append_sheet(workbook, dailyWorksheet, 'Actividad Diaria');
    }

    // ✅ CREAR DIRECTORIO TEMPORAL
    const tempDir = path.join(__dirname, '..', 'temp', 'reports');
    await ensureDirectoryExists(tempDir);

    // ✅ GENERAR ARCHIVO
    const filename = `SupervitecApp_Reporte_${year}_${String(mes).padStart(2, '0')}_${moment().format('DDMMYYYY_HHmmss')}.xlsx`;
    const filepath = path.join(tempDir, filename);

    XLSX.writeFile(workbook, filepath);

    // ✅ OBTENER INFO DEL ARCHIVO
    const stats = await fs.stat(filepath);
    const fileSize = formatBytes(stats.size);

    logCronActivity('generarReporteMensual', 'success', {
      mes,
      year,
      filename,
      fileSize,
      recordCount: {
        movements: movements.length,
        users: users.length,
        regions: regionStats.length
      }
    });

    return {
      filepath,
      filename,
      fileSize,
      stats: {
        totalMovements: movements.length,
        totalUsers: users.length,
        totalDistance: movements.reduce((sum, m) => sum + (m.distancia_recorrida || 0), 0),
        period: monthName
      }
    };

  } catch (error) {
    logCronActivity('generarReporteMensual', 'error', {
      mes,
      year,
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

// ✅ ENVIAR REPORTE POR EMAIL CON PLANTILLA HTML PROFESIONAL
async function enviarReporteEmail(reportData) {
  try {
    logCronActivity('enviarReporteEmail', 'start', { filename: reportData.filename });

    const transporter = createEmailTransporter();

    // ✅ VERIFICAR CONEXIÓN
    await transporter.verify();

    // ✅ LISTA DE DESTINATARIOS DESDE ENV
    const destinatarios = process.env.REPORT_EMAIL_RECIPIENTS 
      ? process.env.REPORT_EMAIL_RECIPIENTS.split(',').map(email => email.trim())
      : ['supervitecingenieriasas@gmail.com'];

    // ✅ PLANTILLA HTML PROFESIONAL
    const htmlTemplate = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; margin: 0; padding: 20px; background-color: #f4f4f4; }
          .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 10px; overflow: hidden; box-shadow: 0 0 20px rgba(0,0,0,0.1); }
          .header { background: linear-gradient(135deg, #2196F3, #1976D2); color: white; padding: 30px; text-align: center; }
          .header h1 { margin: 0; font-size: 28px; }
          .header p { margin: 10px 0 0 0; opacity: 0.9; }
          .content { padding: 30px; }
          .stats-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 15px; margin: 20px 0; }
          .stat-card { background: #f8f9fa; padding: 15px; border-radius: 8px; text-align: center; border-left: 4px solid #2196F3; }
          .stat-number { font-size: 24px; font-weight: bold; color: #2196F3; margin-bottom: 5px; }
          .stat-label { font-size: 12px; color: #666; text-transform: uppercase; }
          .footer { background: #f8f9fa; padding: 20px; text-align: center; font-size: 12px; color: #666; }
          .download-btn { background: #2196F3; color: white; padding: 12px 25px; border-radius: 5px; text-decoration: none; display: inline-block; margin: 20px 0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>📊 Reporte Mensual SupervitecApp</h1>
            <p>${reportData.stats.period}</p>
          </div>
          <div class="content">
            <p>Estimado equipo,</p>
            <p>Se adjunta el reporte mensual automático del sistema SupervitecApp con las estadísticas de actividad.</p>
            
            <div class="stats-grid">
              <div class="stat-card">
                <div class="stat-number">${reportData.stats.totalMovements}</div>
                <div class="stat-label">Total Movimientos</div>
              </div>
              <div class="stat-card">
                <div class="stat-number">${reportData.stats.totalUsers}</div>
                <div class="stat-label">Usuarios Activos</div>
              </div>
              <div class="stat-card">
                <div class="stat-number">${reportData.stats.totalDistance.toFixed(1)} km</div>
                <div class="stat-label">Distancia Total</div>
              </div>
              <div class="stat-card">
                <div class="stat-number">${reportData.fileSize}</div>
                <div class="stat-label">Tamaño Reporte</div>
              </div>
            </div>
            
            <p><strong>📎 Archivo adjunto:</strong> ${reportData.filename}</p>
            <p><strong>📅 Generado:</strong> ${moment().format('DD/MM/YYYY HH:mm:ss')}</p>
            
            <p>El reporte incluye:</p>
            <ul>
              <li>✅ Resumen ejecutivo del período</li>
              <li>📋 Detalle completo de movimientos</li>
              <li>👥 Estadísticas por usuario</li>
              <li>🗺️ Análisis por región</li>
              <li>📈 Actividad diaria</li>
            </ul>
          </div>
          <div class="footer">
            <p>SupervitecApp - Sistema de Seguridad y Salud en el Trabajo</p>
            <p>Este reporte se genera automáticamente cada mes</p>
          </div>
        </div>
      </body>
      </html>
    `;

    // ✅ ENVIAR EMAIL
    const mailOptions = {
      from: {
        name: 'SupervitecApp Sistema',
        address: process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER
      },
      to: destinatarios.join(', '),
      subject: `📊 Reporte Mensual SupervitecApp - ${reportData.stats.period}`,
      html: htmlTemplate,
      text: `Reporte mensual SupervitecApp - ${reportData.stats.period}\n\nEstadísticas:\n- Movimientos: ${reportData.stats.totalMovements}\n- Usuarios: ${reportData.stats.totalUsers}\n- Distancia: ${reportData.stats.totalDistance.toFixed(1)} km\n\nArchivo adjunto: ${reportData.filename}`,
      attachments: [
        {
          filename: reportData.filename,
          path: reportData.filepath,
          contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        }
      ]
    };

    const result = await transporter.sendMail(mailOptions);

    logCronActivity('enviarReporteEmail', 'success', {
      filename: reportData.filename,
      messageId: result.messageId,
      recipients: destinatarios,
      stats: reportData.stats
    });

    console.log('✅ Reporte enviado por email a:', destinatarios.join(', '));
    return result;

  } catch (error) {
    logCronActivity('enviarReporteEmail', 'error', {
      filename: reportData?.filename,
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

// ✅ LIMPIAR ARCHIVOS TEMPORALES
async function limpiarArchivosTemporales() {
  try {
    const tempDir = path.join(__dirname, '..', 'temp', 'reports');
    const files = await fs.readdir(tempDir);
    
    let deletedCount = 0;
    let totalSize = 0;

    for (const file of files) {
      const filepath = path.join(tempDir, file);
      const stats = await fs.stat(filepath);
      
      // ✅ ELIMINAR ARCHIVOS MAYORES A 7 DÍAS
      const daysSinceCreated = (Date.now() - stats.mtime.getTime()) / (1000 * 60 * 60 * 24);
      
      if (daysSinceCreated > 7) {
        totalSize += stats.size;
        await fs.unlink(filepath);
        deletedCount++;
      }
    }

    logCronActivity('limpiarArchivosTemporales', 'success', {
      deletedFiles: deletedCount,
      freedSpace: formatBytes(totalSize)
    });

  } catch (error) {
    logCronActivity('limpiarArchivosTemporales', 'error', {
      error: error.message
    });
  }
}

// ✅ TAREA PROGRAMADA: REPORTE MENSUAL
function tareaReporteMensual() {
  if (!CRON_CONFIG.enableReports) {
    console.log('⏰ Reportes mensuales deshabilitados por configuración');
    return;
  }

  // Ejecutar el día 1 de cada mes a las 2:00 AM (Colombia)
  cron.schedule('0 2 1 * *', async () => {
    try {
      logCronActivity('tareaReporteMensual', 'start');

      const ahora = new Date();
      const mesActual = ahora.getMonth() + 1; // JavaScript months are 0-based
      const yearActual = ahora.getFullYear();
      
      // Reporte del mes anterior
      const mesReporte = mesActual === 1 ? 12 : mesActual - 1;
      const yearReporte = mesActual === 1 ? yearActual - 1 : yearActual;

      // ✅ GENERAR Y ENVIAR REPORTE
      const reportData = await generarReporteMensual(mesReporte, yearReporte);
      await enviarReporteEmail(reportData);

      // ✅ LIMPIAR ARCHIVO TEMPORAL DESPUÉS DEL ENVÍO
      setTimeout(async () => {
        try {
          await fs.unlink(reportData.filepath);
          console.log('🗑️ Archivo temporal eliminado:', reportData.filename);
        } catch (error) {
          console.warn('⚠️ Error eliminando archivo temporal:', error.message);
        }
      }, 5000);

      // ✅ LIMPIAR OTROS ARCHIVOS ANTIGUOS
      await limpiarArchivosTemporales();

    } catch (error) {
      logCronActivity('tareaReporteMensual', 'error', {
        error: error.message,
        stack: error.stack
      });
      
      // ✅ NOTIFICAR ERROR POR EMAIL
      try {
        const transporter = createEmailTransporter();
        await transporter.sendMail({
          from: process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER,
          to: process.env.ADMIN_EMAIL || 'supervitecingenieriasas@gmail.com',
          subject: '❌ Error en Reporte Mensual SupervitecApp',
          html: `
            <h2>Error en Tarea Programada</h2>
            <p><strong>Tarea:</strong> Reporte Mensual</p>
            <p><strong>Fecha:</strong> ${moment().format('DD/MM/YYYY HH:mm:ss')}</p>
            <p><strong>Error:</strong> ${error.message}</p>
            <p>Por favor, revisar los logs del servidor para más detalles.</p>
          `
        });
      } catch (emailError) {
        console.error('❌ Error enviando notificación de error:', emailError.message);
      }
    }
  }, {
    scheduled: true,
    timezone: CRON_CONFIG.timezone
  });

  console.log('⏰ Tarea programada iniciada: Reporte Mensual (1° día del mes, 2:00 AM)');
}

// ✅ TAREA PROGRAMADA: LIMPIEZA DE DATOS ANTIGUOS
function tareaLimpiarMovimientos() {
  if (!CRON_CONFIG.enableCleanup) {
    console.log('⏰ Limpieza de datos deshabilitada por configuración');
    return;
  }

  // Ejecutar cada domingo a las 3:00 AM
  cron.schedule('0 3 * * 0', async () => {
    try {
      logCronActivity('tareaLimpiarMovimientos', 'start');

      // ✅ CONFIGURACIÓN DE RETENCIÓN
      const retentionMonths = parseInt(process.env.DATA_RETENTION_MONTHS) || 24; // 2 años por defecto
      const fechaCorte = new Date();
      fechaCorte.setMonth(fechaCorte.getMonth() - retentionMonths);

      // ✅ SOFT DELETE DE MOVIMIENTOS ANTIGUOS
      const resultado = await Movement.updateMany(
        { 
          fecha: { $lt: fechaCorte },
          deleted: { $ne: true }
        },
        { 
          $set: {
            deleted: true,
            deletedAt: new Date(),
            deletedReason: 'automatic_cleanup',
            originalFecha: '$fecha'
          }
        }
      );

      // ✅ HARD DELETE DE MOVIMIENTOS MUY ANTIGUOS (3+ años)
      const hardDeleteDate = new Date();
      hardDeleteDate.setFullYear(hardDeleteDate.getFullYear() - 3);
      
      const hardDeleteResult = await Movement.deleteMany({
        fecha: { $lt: hardDeleteDate }
      });

      logCronActivity('tareaLimpiarMovimientos', 'success', {
        softDeleted: resultado.modifiedCount,
        hardDeleted: hardDeleteResult.deletedCount,
        retentionMonths,
        cutoffDate: fechaCorte.toISOString()
      });

      console.log(`🧹 Limpieza completada: ${resultado.modifiedCount} archivados, ${hardDeleteResult.deletedCount} eliminados`);

    } catch (error) {
      logCronActivity('tareaLimpiarMovimientos', 'error', {
        error: error.message,
        stack: error.stack
      });
    }
  }, {
    scheduled: true,
    timezone: CRON_CONFIG.timezone
  });

  console.log('⏰ Tarea programada iniciada: Limpieza de Datos (Domingos, 3:00 AM)');
}

// ✅ TAREA PROGRAMADA: NOTIFICAR USUARIOS INACTIVOS
function tareaNotificarUsuariosInactivos() {
  if (!CRON_CONFIG.enableNotifications) {
    console.log('⏰ Notificaciones de usuarios inactivos deshabilitadas');
    return;
  }

  // Ejecutar el día 15 de cada mes a las 10:00 AM
  cron.schedule('0 10 15 * *', async () => {
    try {
      logCronActivity('tareaNotificarUsuariosInactivos', 'start');

      const fechaLimite = new Date();
      fechaLimite.setMonth(fechaLimite.getMonth() - 2); // 2 meses sin actividad

      // ✅ BUSCAR USUARIOS INACTIVOS
      const usuariosInactivos = await User.find({
        activo: true,
        ultimoAcceso: { $lt: fechaLimite }
      }).select('nombre_completo correo_electronico ultimoAcceso');

      if (usuariosInactivos.length === 0) {
        logCronActivity('tareaNotificarUsuariosInactivos', 'success', {
          message: 'No hay usuarios inactivos para notificar'
        });
        return;
      }

      const transporter = createEmailTransporter();
      let notificadosExitosos = 0;
      let erroresEnvio = 0;

      // ✅ ENVIAR EMAILS INDIVIDUALES CON PLANTILLA ATRACTIVA
      for (const usuario of usuariosInactivos) {
        try {
          const diasInactivo = Math.floor((Date.now() - usuario.ultimoAcceso.getTime()) / (1000 * 60 * 60 * 24));
          
          const htmlEmail = `
            <!DOCTYPE html>
            <html>
            <head>
              <meta charset="UTF-8">
              <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; margin: 0; padding: 20px; background: #f4f4f4; }
                .container { max-width: 500px; margin: 0 auto; background: white; border-radius: 15px; overflow: hidden; box-shadow: 0 5px 25px rgba(0,0,0,0.1); }
                .header { background: linear-gradient(135deg, #FF6B6B, #FF8E53); color: white; padding: 40px 30px; text-align: center; }
                .header h1 { margin: 0; font-size: 26px; }
                .content { padding: 30px; text-align: center; }
                .emoji { font-size: 48px; margin-bottom: 20px; }
                .cta-button { background: #FF6B6B; color: white; padding: 15px 30px; border-radius: 25px; text-decoration: none; display: inline-block; margin: 20px 0; font-weight: bold; }
                .footer { background: #f8f9fa; padding: 20px; text-align: center; font-size: 12px; color: #666; }
              </style>
            </head>
            <body>
              <div class="container">
                <div class="header">
                  <h1>¡Te echamos de menos! 🚗</h1>
                </div>
                <div class="content">
                  <div class="emoji">👋</div>
                  <h2>Hola ${usuario.nombre_completo},</h2>
                  <p>Hace <strong>${diasInactivo} días</strong> que no registras movimientos en SupervitecApp.</p>
                  <p>¿Todo está bien? Nos encantaría verte de vuelta en el sistema.</p>
                  <a href="${process.env.FRONTEND_URL || 'https://supervitec-app.com'}" class="cta-button">
                    🚀 Volver a la App
                  </a>
                  <p style="font-size: 14px; color: #666;">
                    Si tienes problemas técnicos, no dudes en contactarnos.
                  </p>
                </div>
                <div class="footer">
                  <p>SupervitecApp - Sistema de Seguridad y Salud en el Trabajo</p>
                </div>
              </div>
            </body>
            </html>
          `;

          await transporter.sendMail({
            from: {
              name: 'SupervitecApp Team',
              address: process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER
            },
            to: usuario.correo_electronico,
            subject: '👋 ¡Te echamos de menos en SupervitecApp!',
            html: htmlEmail,
            text: `Hola ${usuario.nombre_completo}, hace ${diasInactivo} días que no registras movimientos. ¡Vuelve cuando puedas!`
          });

          notificadosExitosos++;
          
          // ✅ DELAY PARA NO SOBRECARGAR EMAIL SERVER
          await new Promise(resolve => setTimeout(resolve, 1000));

        } catch (emailError) {
          erroresEnvio++;
          console.warn(`⚠️ Error enviando email a ${usuario.correo_electronico}:`, emailError.message);
        }
      }

      logCronActivity('tareaNotificarUsuariosInactivos', 'success', {
        totalUsuarios: usuariosInactivos.length,
        notificadosExitosos,
        erroresEnvio,
        fechaLimite: fechaLimite.toISOString()
      });

      console.log(`📧 Notificaciones enviadas: ${notificadosExitosos}/${usuariosInactivos.length} usuarios`);

    } catch (error) {
      logCronActivity('tareaNotificarUsuariosInactivos', 'error', {
        error: error.message,
        stack: error.stack
      });
    }
  }, {
    scheduled: true,
    timezone: CRON_CONFIG.timezone
  });

  console.log('⏰ Tarea programada iniciada: Notificar Usuarios Inactivos (15° día del mes, 10:00 AM)');
}

// ✅ TAREA PROGRAMADA: BACKUP DE CONFIGURACIONES
function tareaBackupConfiguraciones() {
  if (!CRON_CONFIG.enableBackups) {
    console.log('⏰ Backups automáticos deshabilitados');
    return;
  }

  // Ejecutar cada día a las 4:00 AM
  cron.schedule('0 4 * * *', async () => {
    try {
      logCronActivity('tareaBackupConfiguraciones', 'start');

      const backupData = {
        timestamp: new Date().toISOString(),
        users: await User.countDocuments(),
        activeUsers: await User.countDocuments({ activo: true }),
        totalMovements: await Movement.countDocuments(),
        recentMovements: await Movement.countDocuments({
          fecha: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
        }),
        systemHealth: {
          uptime: process.uptime(),
          memory: process.memoryUsage(),
          version: process.env.npm_package_version || '1.0.0'
        }
      };

      // ✅ GUARDAR BACKUP LOCAL
      const backupDir = path.join(__dirname, '..', 'temp', 'backups');
      await ensureDirectoryExists(backupDir);
      
      const backupFilename = `backup_${moment().format('YYYY-MM-DD_HH-mm-ss')}.json`;
      const backupPath = path.join(backupDir, backupFilename);
      
      await fs.writeFile(backupPath, JSON.stringify(backupData, null, 2));

      // ✅ LIMPIAR BACKUPS ANTIGUOS (>30 días)
      const backupFiles = await fs.readdir(backupDir);
      let deletedBackups = 0;

      for (const file of backupFiles) {
        if (file.endsWith('.json')) {
          const filePath = path.join(backupDir, file);
          const stats = await fs.stat(filePath);
          const daysOld = (Date.now() - stats.mtime.getTime()) / (1000 * 60 * 60 * 24);
          
          if (daysOld > 30) {
            await fs.unlink(filePath);
            deletedBackups++;
          }
        }
      }

      logCronActivity('tareaBackupConfiguraciones', 'success', {
        backupFilename,
        backupData,
        deletedOldBackups: deletedBackups
      });

    } catch (error) {
      logCronActivity('tareaBackupConfiguraciones', 'error', {
        error: error.message
      });
    }
  }, {
    scheduled: true,
    timezone: CRON_CONFIG.timezone
  });

  console.log('⏰ Tarea programada iniciada: Backup Diario (4:00 AM)');
}

// ✅ FUNCIÓN PRINCIPAL PARA INICIAR TODAS LAS TAREAS
function iniciarTareasProgramadas() {
  console.log('🚀 ================================');
  console.log('⏰ INICIANDO TAREAS PROGRAMADAS');
  console.log(`🌍 Zona Horaria: ${CRON_CONFIG.timezone}`);
  console.log(`📊 Reportes: ${CRON_CONFIG.enableReports ? 'Habilitados' : 'Deshabilitados'}`);
  console.log(`🧹 Limpieza: ${CRON_CONFIG.enableCleanup ? 'Habilitada' : 'Deshabilitada'}`);
  console.log(`📧 Notificaciones: ${CRON_CONFIG.enableNotifications ? 'Habilitadas' : 'Deshabilitadas'}`);
  console.log(`💾 Backups: ${CRON_CONFIG.enableBackups ? 'Habilitados' : 'Deshabilitados'}`);
  console.log('🚀 ================================');

  try {
    tareaReporteMensual();
    tareaLimpiarMovimientos();
    tareaNotificarUsuariosInactivos();
    tareaBackupConfiguraciones();

    console.log('✅ Todas las tareas programadas iniciadas correctamente');
    
    // ✅ LOG DE PRÓXIMAS EJECUCIONES
    console.log('📅 Próximas ejecuciones programadas:');
    console.log('   📊 Reporte mensual: 1° día del mes, 2:00 AM');
    console.log('   🧹 Limpieza datos: Domingos, 3:00 AM');
    console.log('   📧 Usuarios inactivos: 15° día del mes, 10:00 AM');
    console.log('   💾 Backup diario: Todos los días, 4:00 AM');

  } catch (error) {
    console.error('❌ Error iniciando tareas programadas:', error);
    throw error;
  }
}

// ✅ MANEJO GRACEFUL DE SHUTDOWN
process.on('SIGTERM', () => {
  console.log('📴 Deteniendo tareas programadas...');
  // cron.destroy() si fuera necesario
});

process.on('SIGINT', () => {
  console.log('📴 Deteniendo tareas programadas...');
  // cron.destroy() si fuera necesario
});

module.exports = iniciarTareasProgramadas;

// ✅ EXPORTAR FUNCIONES INDIVIDUALES PARA TESTING
module.exports.generarReporteMensual = generarReporteMensual;
module.exports.enviarReporteEmail = enviarReporteEmail;
module.exports.limpiarArchivosTemporales = limpiarArchivosTemporales;
