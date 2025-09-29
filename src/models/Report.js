const mongoose = require('mongoose');

// ✅ ESQUEMA DE REPORTES GENERADOS
const reportSchema = new mongoose.Schema({
  tipo: {
    type: String,
    required: true,
    enum: [
      'mensual', 'semanal', 'diario',
      'usuario', 'region', 'incidentes',
      'personalizado', 'auditoria'
    ],
    index: true
  },

  titulo: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200
  },

  descripcion: {
    type: String,
    trim: true,
    maxlength: 500
  },

  periodo: {
    fecha_inicio: { type: Date, required: true },
    fecha_fin: { type: Date, required: true }
  },

  filtros: {
    usuarios: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    regiones: [String],
    tipos_movimiento: [String],
    estados: [String]
  },

  datos: {
    resumen: mongoose.Schema.Types.Mixed,
    detalles: mongoose.Schema.Types.Mixed,
    estadisticas: mongoose.Schema.Types.Mixed,
    graficos: [String] // URLs o datos de gráficos
  },

  archivo: {
    nombre: String,
    ruta: String,
    tamaño: Number,
    formato: {
      type: String,
      enum: ['xlsx', 'pdf', 'csv', 'json'],
      default: 'xlsx'
    },
    hash: String // Para verificar integridad
  },

  generado_por: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },

  compartido_con: [{
    usuario: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    fecha_compartido: { type: Date, default: Date.now },
    permisos: {
      type: String,
      enum: ['solo_lectura', 'descarga', 'edicion'],
      default: 'solo_lectura'
    }
  }],

  estado: {
    type: String,
    enum: ['generando', 'completado', 'error', 'archivado'],
    default: 'generando',
    index: true
  },

  error_mensaje: String,

  estadisticas_acceso: {
    veces_descargado: { type: Number, default: 0 },
    ultimo_acceso: Date,
    accesos: [{
      usuario: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      fecha: { type: Date, default: Date.now },
      ip: String,
      accion: { type: String, enum: ['visualizar', 'descargar'] }
    }]
  },

  configuracion: {
    auto_generado: { type: Boolean, default: false },
    recurrente: {
      habilitado: { type: Boolean, default: false },
      frecuencia: {
        type: String,
        enum: ['diario', 'semanal', 'mensual', 'trimestral'],
        default: 'mensual'
      },
      proximo_envio: Date
    },
    notificar_por_email: { type: Boolean, default: true },
    incluir_graficos: { type: Boolean, default: true },
    formato_fecha: { type: String, default: 'DD/MM/YYYY' }
  }
}, {
  timestamps: true
});

// ✅ ÍNDICES
reportSchema.index({ generado_por: 1, createdAt: -1 });
reportSchema.index({ tipo: 1, estado: 1 });
reportSchema.index({ 'periodo.fecha_inicio': 1, 'periodo.fecha_fin': 1 });

// ✅ MÉTODOS
reportSchema.methods.marcarDescargado = function(usuarioId, ip) {
  this.estadisticas_acceso.veces_descargado += 1;
  this.estadisticas_acceso.ultimo_acceso = new Date();
  this.estadisticas_acceso.accesos.push({
    usuario: usuarioId,
    ip,
    accion: 'descargar'
  });

  return this.save();
};

module.exports = mongoose.model('Report', reportSchema);
