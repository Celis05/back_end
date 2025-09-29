const mongoose = require('mongoose');
const moment = require('moment');

// ✅ ESQUEMA DE MOVIMIENTO PROFESIONAL
const movementSchema = new mongoose.Schema({
  // ✅ REFERENCIA AL USUARIO
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Usuario es requerido'],
    index: true
  },

  // ✅ CLASIFICACIÓN DEL MOVIMIENTO
  tipo_movimiento: {
    type: String,
    enum: {
      values: [
        'recorrido_seguridad', 
        'inspeccion_rutinaria', 
        'emergencia', 
        'mantenimiento',
        'supervision',
        'capacitacion',
        'auditoria',
        'otro'
      ],
      message: 'Tipo de movimiento debe ser una opción válida'
    },
    required: [true, 'Tipo de movimiento es requerido'],
    default: 'recorrido_seguridad',
    index: true
  },

  estado: {
    type: String,
    enum: {
      values: ['iniciado', 'en_progreso', 'pausado', 'completado', 'cancelado'],
      message: 'Estado debe ser una opción válida'
    },
    default: 'iniciado',
    index: true
  },

  // ✅ UBICACIONES MEJORADAS
  start_location: {
    latitude: { 
      type: Number, 
      required: [true, 'Latitud de inicio es requerida'],
      min: [-90, 'Latitud debe estar entre -90 y 90'],
      max: [90, 'Latitud debe estar entre -90 y 90']
    },
    longitude: { 
      type: Number, 
      required: [true, 'Longitud de inicio es requerida'],
      min: [-180, 'Longitud debe estar entre -180 y 180'],
      max: [180, 'Longitud debe estar entre -180 y 180']
    },
    timestamp: { 
      type: Date, 
      required: [true, 'Timestamp de inicio es requerido']
    },
    address: { 
      type: String,
      trim: true,
      maxlength: [200, 'Dirección no puede exceder 200 caracteres']
    },
    accuracy: { 
      type: Number,
      min: [0, 'Precisión no puede ser negativa']
    }
  },

  end_location: {
    latitude: { 
      type: Number,
      min: [-90, 'Latitud debe estar entre -90 y 90'],
      max: [90, 'Latitud debe estar entre -90 y 90']
    },
    longitude: { 
      type: Number,
      min: [-180, 'Longitud debe estar entre -180 y 180'],
      max: [180, 'Longitud debe estar entre -180 y 180']
    },
    timestamp: Date,
    address: { 
      type: String,
      trim: true,
      maxlength: [200, 'Dirección no puede exceder 200 caracteres']
    },
    accuracy: { 
      type: Number,
      min: [0, 'Precisión no puede ser negativa']
    }
  },

  // ✅ RUTA SEGUIDA CON WAYPOINTS
  waypoints: [{
    latitude: { 
      type: Number, 
      required: true,
      min: [-90, 'Latitud debe estar entre -90 y 90'],
      max: [90, 'Latitud debe estar entre -90 y 90']
    },
    longitude: { 
      type: Number, 
      required: true,
      min: [-180, 'Longitud debe estar entre -180 y 180'],
      max: [180, 'Longitud debe estar entre -180 y 180']
    },
    timestamp: { type: Date, default: Date.now },
    speed: { type: Number, min: 0 },
    accuracy: { type: Number, min: 0 },
    altitude: Number
  }],

  // ✅ MÉTRICAS CALCULADAS
  distancia_recorrida: { 
    type: Number, 
    default: 0,
    min: [0, 'Distancia no puede ser negativa'],
    max: [10000, 'Distancia excede el límite máximo (10,000 km)']
  },

  distancia_calculada: {
    type: Number,
    default: 0,
    min: [0, 'Distancia calculada no puede ser negativa']
  },

  velocidad_promedio: { 
    type: Number, 
    default: 0,
    min: [0, 'Velocidad promedio no puede ser negativa'],
    max: [300, 'Velocidad promedio excede el límite (300 km/h)']
  },

  velocidad_maxima: { 
    type: Number, 
    default: 0,
    min: [0, 'Velocidad máxima no puede ser negativa'],
    max: [400, 'Velocidad máxima excede el límite (400 km/h)']
  },

  tiempo_total: { 
    type: Number, 
    default: 0,
    min: [0, 'Tiempo total no puede ser negativo'],
    max: [2880, 'Tiempo total excede el límite (48 horas)'] // En minutos
  },

  // ✅ FECHAS Y TIEMPO
  fecha: { 
    type: Date, 
    required: [true, 'Fecha es requerida'],
    default: Date.now,
    index: true
  },

  fecha_fin: { 
    type: Date,
    validate: {
      validator: function(v) {
        return !v || v >= this.fecha;
      },
      message: 'Fecha de fin debe ser posterior a fecha de inicio'
    }
  },

  // ✅ UBICACIÓN GEOGRÁFICA
  region: {
    type: String,
    required: [true, 'Región es requerida'],
    enum: {
      values: ['Caldas', 'Risaralda', 'Quindío', 'Valle del Cauca', 'Antioquia', 'Cundinamarca', 'Nacional'],
      message: 'Región debe ser una opción válida'
    },
    index: true
  },

  municipio: {
    type: String,
    trim: true,
    maxlength: [100, 'Municipio no puede exceder 100 caracteres']
  },

  // ✅ TRANSPORTE UTILIZADO
  transporte_utilizado: {
    type: String,
    required: [true, 'Tipo de transporte es requerido'],
    enum: {
      values: ['auto', 'moto', 'bicicleta', 'pie', 'transporte_publico', 'otro'],
      message: 'Tipo de transporte debe ser una opción válida'
    }
  },

  // ✅ OBSERVACIONES Y NOTAS
  observaciones: {
    type: String,
    trim: true,
    maxlength: [1000, 'Observaciones no pueden exceder 1000 caracteres']
  },

  // ✅ INCIDENTES Y EVENTOS
  incidentes: [{
    tipo: {
      type: String,
      enum: {
        values: [
          'riesgo_detectado', 
          'accidente', 
          'falla_equipo', 
          'condicion_insegura',
          'acto_inseguro',
          'emergencia',
          'otro'
        ],
        message: 'Tipo de incidente debe ser una opción válida'
      },
      required: [true, 'Tipo de incidente es requerido']
    },
    descripcion: {
      type: String,
      required: [true, 'Descripción del incidente es requerida'],
      trim: true,
      maxlength: [500, 'Descripción no puede exceder 500 caracteres']
    },
    ubicacion: {
      latitude: {
        type: Number,
        required: true,
        min: [-90, 'Latitud debe estar entre -90 y 90'],
        max: [90, 'Latitud debe estar entre -90 y 90']
      },
      longitude: {
        type: Number,
        required: true,
        min: [-180, 'Longitud debe estar entre -180 y 180'],
        max: [180, 'Longitud debe estar entre -180 y 180']
      },
      address: String
    },
    timestamp: { 
      type: Date, 
      default: Date.now 
    },
    gravedad: {
      type: String,
      enum: {
        values: ['baja', 'media', 'alta', 'critica'],
        message: 'Gravedad debe ser una opción válida'
      },
      default: 'media'
    },
    evidencias: [{
      tipo: {
        type: String,
        enum: ['foto', 'video', 'audio', 'documento'],
        required: true
      },
      url: String,
      descripcion: String,
      timestamp: { type: Date, default: Date.now }
    }],
    resuelto: {
      type: Boolean,
      default: false
    },
    fechaResolucion: Date,
    resolucionNota: String
  }],

  // ✅ CONDICIONES AMBIENTALES
  condicionesAmbientales: {
    clima: {
      type: String,
      enum: ['soleado', 'nublado', 'lluvioso', 'tormentoso', 'neblinoso']
    },
    temperatura: {
      type: Number,
      min: [-10, 'Temperatura muy baja'],
      max: [60, 'Temperatura muy alta']
    },
    visibilidad: {
      type: String,
      enum: ['excelente', 'buena', 'regular', 'mala', 'muy_mala']
    },
    viento: {
      velocidad: { type: Number, min: 0 },
      direccion: { type: String }
    }
  },

  // ✅ METADATA Y DEVICE INFO
  metadata: {
    dispositivo: {
      plataforma: {
        type: String,
        enum: ['ios', 'android', 'web', 'unknown'],
        default: 'unknown'
      },
      version: String,
      modelo: String
    },
    app: {
      version: String,
      build: String
    },
    red: {
      tipo: {
        type: String,
        enum: ['wifi', '4g', '3g', '2g', 'unknown']
      },
      calidad: {
        type: String,
        enum: ['excelente', 'buena', 'regular', 'mala']
      }
    },
    bateria: {
      nivel: { type: Number, min: 0, max: 100 },
      modoAhorro: { type: Boolean, default: false }
    }
  },

  // ✅ CONTROL DE CALIDAD
  calidad: {
    precision_gps: {
      promedio: { type: Number, min: 0 },
      minima: { type: Number, min: 0 },
      maxima: { type: Number, min: 0 }
    },
    coherencia_datos: {
      distancia_vs_tiempo: { type: Number }, // Ratio de coherencia
      velocidad_consistente: { type: Boolean, default: true }
    },
    completitud: {
      waypoints_suficientes: { type: Boolean, default: true },
      datos_completos: { type: Boolean, default: true }
    },
    validado: {
      type: Boolean,
      default: false
    },
    validadoPor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    fechaValidacion: Date
  },

  // ✅ ESTADO Y CONTROL
  activo: {
    type: Boolean,
    default: true,
    index: true
  },

  // ✅ SOFT DELETE
  deleted: {
    type: Boolean,
    default: false,
    index: true
  },
  deletedAt: Date,
  deletedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  deletedReason: String,

  // ✅ AUDITORÍA
  auditoria: {
    creadoPor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    modificadoPor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    fechaModificacion: Date,
    version: { type: Number, default: 1 },
    cambios: [{
      campo: String,
      valorAnterior: mongoose.Schema.Types.Mixed,
      valorNuevo: mongoose.Schema.Types.Mixed,
      usuario: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      fecha: { type: Date, default: Date.now }
    }]
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// ✅ ÍNDICES COMPUESTOS PARA RENDIMIENTO
movementSchema.index({ user_id: 1, fecha: -1 });
movementSchema.index({ estado: 1, activo: 1 });
movementSchema.index({ region: 1, fecha: -1 });
movementSchema.index({ tipo_movimiento: 1, fecha: -1 });
movementSchema.index({ activo: 1, deleted: 1 });
movementSchema.index({ 'start_location.latitude': 1, 'start_location.longitude': 1 });
movementSchema.index({ 'end_location.latitude': 1, 'end_location.longitude': 1 });

// ✅ ÍNDICE GEOESPACIAL PARA CONSULTAS DE UBICACIÓN
movementSchema.index({ 
  'start_location': '2dsphere',
  'end_location': '2dsphere' 
});

// ✅ ÍNDICE TTL PARA LIMPIEZA AUTOMÁTICA (OPCIONAL)
// movementSchema.index({ "fecha": 1 }, { expireAfterSeconds: 63072000 }); // 2 años

// ✅ VIRTUALS ÚTILES
movementSchema.virtual('duracion_horas').get(function() {
  return this.tiempo_total ? (this.tiempo_total / 60).toFixed(2) : 0;
});

movementSchema.virtual('velocidad_promedio_ms').get(function() {
  return this.velocidad_promedio ? (this.velocidad_promedio / 3.6).toFixed(2) : 0;
});

movementSchema.virtual('eficiencia').get(function() {
  if (this.tiempo_total > 0) {
    return (this.distancia_recorrida / (this.tiempo_total / 60)).toFixed(2);
  }
  return 0;
});

movementSchema.virtual('estado_legible').get(function() {
  const estados = {
    'iniciado': 'Iniciado',
    'en_progreso': 'En Progreso',
    'pausado': 'Pausado',
    'completado': 'Completado',
    'cancelado': 'Cancelado'
  };
  return estados[this.estado] || this.estado;
});

movementSchema.virtual('incidentes_criticos').get(function() {
  return this.incidentes?.filter(inc => inc.gravedad === 'critica').length || 0;
});

// ✅ MIDDLEWARE PRE-SAVE
movementSchema.pre('save', function(next) {
  try {
    // ✅ CALCULAR DURACIÓN SI HAY FECHA FIN
    if (this.fecha_fin && this.fecha && !this.tiempo_total) {
      const duracionMs = this.fecha_fin - this.fecha;
      this.tiempo_total = Math.round(duracionMs / (1000 * 60)); // minutos
    }

    // ✅ VALIDAR COHERENCIA DE VELOCIDADES
    if (this.velocidad_maxima > 0 && this.velocidad_promedio > this.velocidad_maxima) {
      this.velocidad_promedio = this.velocidad_maxima;
    }

    // ✅ ACTUALIZAR AUDITORÍA
    if (this.isModified() && !this.isNew) {
      this.auditoria.fechaModificacion = new Date();
      this.auditoria.version += 1;
    }

    // ✅ VALIDAR INCIDENTES
    if (this.incidentes && this.incidentes.length > 0) {
      this.incidentes.forEach(incidente => {
        if (!incidente.timestamp) {
          incidente.timestamp = new Date();
        }
      });
    }

    next();
  } catch (error) {
    next(error);
  }
});

// ✅ MIDDLEWARE POST-SAVE
movementSchema.post('save', async function(doc) {
  // ✅ ACTUALIZAR ESTADÍSTICAS DEL USUARIO
  try {
    const User = mongoose.model('User');
    await User.findByIdAndUpdate(
      doc.user_id,
      {
        $inc: {
          'estadisticas.totalMovimientos': 1,
          'estadisticas.distanciaTotal': doc.distancia_recorrida || 0,
          'estadisticas.tiempoTotal': doc.tiempo_total || 0
        },
        $set: {
          'estadisticas.ultimaActualizacion': new Date()
        }
      }
    );
  } catch (error) {
    console.error('Error actualizando estadísticas de usuario:', error);
  }
});

// ✅ MÉTODOS DE INSTANCIA
movementSchema.methods.calcularDuracion = function() {
  if (this.fecha_fin && this.fecha) {
    const duracionMs = this.fecha_fin - this.fecha;
    this.tiempo_total = Math.round(duracionMs / (1000 * 60)); // minutos
  }
  return this.tiempo_total;
};

movementSchema.methods.puedeCompletar = function() {
  return ['iniciado', 'en_progreso', 'pausado'].includes(this.estado);
};

movementSchema.methods.completar = function(endLocation, observaciones) {
  if (!this.puedeCompletar()) {
    throw new Error('El movimiento no puede ser completado en su estado actual');
  }
  
  this.estado = 'completado';
  this.fecha_fin = new Date();
  if (endLocation) this.end_location = endLocation;
  if (observaciones) this.observaciones = observaciones;
  
  this.calcularDuracion();
  return this.save();
};

movementSchema.methods.pausar = function(motivo) {
  if (!['iniciado', 'en_progreso'].includes(this.estado)) {
    throw new Error('El movimiento no puede ser pausado en su estado actual');
  }
  
  this.estado = 'pausado';
  if (motivo) {
    this.observaciones = this.observaciones 
      ? `${this.observaciones}\n[PAUSADO] ${motivo}`
      : `[PAUSADO] ${motivo}`;
  }
  
  return this.save();
};

movementSchema.methods.reanudar = function() {
  if (this.estado !== 'pausado') {
    throw new Error('Solo se pueden reanudar movimientos pausados');
  }
  
  this.estado = 'en_progreso';
  return this.save();
};

movementSchema.methods.cancelar = function(motivo) {
  if (!this.puedeCompletar()) {
    throw new Error('El movimiento no puede ser cancelado en su estado actual');
  }
  
  this.estado = 'cancelado';
  this.fecha_fin = new Date();
  
  if (motivo) {
    this.observaciones = this.observaciones 
      ? `${this.observaciones}\n[CANCELADO] ${motivo}`
      : `[CANCELADO] ${motivo}`;
  }
  
  return this.save();
};

movementSchema.methods.agregarIncidente = function(incidenteData) {
  if (!incidenteData.tipo || !incidenteData.descripcion || !incidenteData.ubicacion) {
    throw new Error('Datos de incidente incompletos');
  }
  
  this.incidentes.push({
    ...incidenteData,
    timestamp: new Date()
  });
  
  return this.save();
};

movementSchema.methods.validar = function(validadorId) {
  this.calidad.validado = true;
  this.calidad.validadoPor = validadorId;
  this.calidad.fechaValidacion = new Date();
  
  return this.save();
};

// ✅ MÉTODOS ESTÁTICOS
movementSchema.statics.encontrarPorUsuario = function(userId, filtros = {}) {
  return this.find({
    user_id: userId,
    activo: true,
    deleted: false,
    ...filtros
  }).sort({ fecha: -1 });
};

movementSchema.statics.estadisticasPorRegion = function(fechaInicio, fechaFin) {
  return this.aggregate([
    {
      $match: {
        fecha: { $gte: fechaInicio, $lte: fechaFin },
        activo: true,
        deleted: false
      }
    },
    {
      $group: {
        _id: '$region',
        totalMovimientos: { $sum: 1 },
        distanciaTotal: { $sum: '$distancia_recorrida' },
        tiempoTotal: { $sum: '$tiempo_total' },
        velocidadPromedio: { $avg: '$velocidad_promedio' },
        incidentesTotales: { $sum: { $size: '$incidentes' } }
      }
    },
    { $sort: { totalMovimientos: -1 } }
  ]);
};

movementSchema.statics.movimientosEnProgreso = function() {
  return this.find({
    estado: { $in: ['iniciado', 'en_progreso'] },
    activo: true,
    deleted: false
  }).populate('user_id', 'nombre_completo correo_electronico');
};

// ✅ QUERY HELPERS
movementSchema.query.activos = function() {
  return this.where({ activo: true, deleted: false });
};

movementSchema.query.completados = function() {
  return this.where({ estado: 'completado' });
};

movementSchema.query.enRegion = function(region) {
  return this.where({ region });
};

movementSchema.query.conIncidentes = function() {
  return this.where({ 'incidentes.0': { $exists: true } });
};

module.exports = mongoose.model('Movement', movementSchema);
