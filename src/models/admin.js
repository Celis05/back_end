// ✅ NOTA: Este modelo se consolida en User.js con rol 'admin'
// No es necesario un modelo separado para admins

const mongoose = require('mongoose');

// ✅ ESQUEMA OPCIONAL DE CONFIGURACIONES DE ADMIN
const adminConfigSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  
  permisos_especiales: [{
    recurso: {
      type: String,
      required: true,
      enum: ['users', 'movements', 'reports', 'system', 'backup', 'cron']
    },
    acciones: [{
      type: String,
      enum: ['create', 'read', 'update', 'delete', 'export', 'import']
    }],
    restricciones: {
      regiones: [String],
      fechas: {
        desde: Date,
        hasta: Date
      }
    }
  }],

  configuraciones: {
    dashboard_personalizado: {
      widgets: [String],
      layout: String,
      tema: { type: String, default: 'dark' }
    },
    notificaciones: {
      email_reportes: { type: Boolean, default: true },
      email_incidentes: { type: Boolean, default: true },
      email_sistema: { type: Boolean, default: true },
      frecuencia_resumen: {
        type: String,
        enum: ['diario', 'semanal', 'mensual'],
        default: 'semanal'
      }
    },
    exportacion: {
      formato_preferido: {
        type: String,
        enum: ['xlsx', 'csv', 'pdf'],
        default: 'xlsx'
      },
      incluir_graficos: { type: Boolean, default: true },
      auto_envio: { type: Boolean, default: false }
    }
  },

  sesiones_admin: [{
    token_id: String,
    ip: String,
    user_agent: String,
    permisos_sesion: [String],
    created_at: { type: Date, default: Date.now },
    expires_at: Date,
    last_activity: { type: Date, default: Date.now }
  }],

  auditoria: {
    acciones_criticas: [{
      accion: String,
      recurso_afectado: String,
      timestamp: { type: Date, default: Date.now },
      ip: String,
      detalles: mongoose.Schema.Types.Mixed
    }],
    ultimo_backup: Date,
    ultimo_reporte: Date
  }
}, {
  timestamps: true
});

// ✅ MÉTODOS PARA ADMIN CONFIG
adminConfigSchema.methods.tienePermiso = function(recurso, accion) {
  const permiso = this.permisos_especiales.find(p => p.recurso === recurso);
  return permiso?.acciones.includes(accion) || false;
};

adminConfigSchema.methods.registrarAccion = function(accion, recurso, ip, detalles) {
  this.auditoria.acciones_criticas.push({
    accion,
    recurso_afectado: recurso,
    ip,
    detalles,
    timestamp: new Date()
  });

  // Mantener solo las últimas 1000 acciones
  if (this.auditoria.acciones_criticas.length > 1000) {
    this.auditoria.acciones_criticas = this.auditoria.acciones_criticas.slice(-1000);
  }

  return this.save();
};

module.exports = mongoose.model('AdminConfig', adminConfigSchema);

