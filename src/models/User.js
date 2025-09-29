const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const moment = require('moment');

// ✅ ESQUEMA DE USUARIO PROFESIONAL
const userSchema = new mongoose.Schema({
  // ✅ INFORMACIÓN BÁSICA
  nombre_completo: {
    type: String,
    required: [true, 'Nombre completo es requerido'],
    trim: true,
    minlength: [2, 'Nombre debe tener al menos 2 caracteres'],
    maxlength: [100, 'Nombre no puede exceder 100 caracteres'],
    match: [/^[a-zA-ZáéíóúÁÉÍÓÚñÑ\s]+$/, 'Nombre solo puede contener letras y espacios']
  },

  correo_electronico: {
    type: String,
    required: [true, 'Correo electrónico es requerido'],
    unique: true,
    lowercase: true,
    trim: true,
    maxlength: [255, 'Correo no puede exceder 255 caracteres'],
    match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Correo electrónico inválido'],
    index: true
  },

  contrasena: {
    type: String,
    required: [true, 'Contraseña es requerida'],
    minlength: [8, 'Contraseña debe tener al menos 8 caracteres'],
    maxlength: [128, 'Contraseña no puede exceder 128 caracteres'],
    select: false // Por defecto no incluir en consultas
  },

  // ✅ INFORMACIÓN PROFESIONAL
  region: {
    type: String,
    required: [true, 'Región es requerida'],
    enum: {
      values: ['Caldas', 'Risaralda', 'Quindío', 'Valle del Cauca', 'Antioquia', 'Cundinamarca', 'Nacional'],
      message: 'Región debe ser una opción válida'
    },
    index: true
  },

  transporte: {
    type: String,
    required: [true, 'Tipo de transporte es requerido'],
    enum: {
      values: ['auto', 'moto', 'bicicleta', 'pie', 'transporte_publico', 'otro'],
      message: 'Tipo de transporte debe ser una opción válida'
    }
  },

  rol: {
    type: String,
    required: [true, 'Rol es requerido'],
    enum: {
      values: ['admin', 'supervisor', 'trabajador', 'invitado'],
      message: 'Rol debe ser una opción válida'
    },
    default: 'trabajador',
    index: true
  },

  // ✅ ESTADO Y ACTIVIDAD
  activo: {
    type: Boolean,
    default: true,
    index: true
  },

  fechaCreacion: {
    type: Date,
    default: Date.now,
    immutable: true // No se puede cambiar después de creado
  },

  ultimoAcceso: {
    type: Date,
    default: Date.now
  },

  ultima_actividad: {
    type: Date,
    default: Date.now
  },

  // ✅ RECUPERACIÓN DE CONTRASEÑA SEGURA
  tokenRecuperacion: {
    type: String,
    select: false
  },

  expiraTokenRecuperacion: {
    type: Date,
    select: false
  },

  // ✅ GESTIÓN DE SESIONES MEJORADA
  refreshTokens: [{
    token: {
      type: String,
      required: true
    },
    createdAt: {
      type: Date,
      default: Date.now
    },
    userAgent: String,
    ip: String,
    lastUsed: {
      type: Date,
      default: Date.now
    }
  }],

  // ✅ CONFIGURACIONES PERSONALIZADAS
  configuraciones: {
    notificaciones: {
      email: { type: Boolean, default: true },
      push: { type: Boolean, default: true },
      sms: { type: Boolean, default: false }
    },
    privacidad: {
      perfilPublico: { type: Boolean, default: false },
      ubicacionVisible: { type: Boolean, default: true },
      estadisticasPublicas: { type: Boolean, default: false }
    },
    tema: {
      type: String,
      enum: ['light', 'dark', 'auto'],
      default: 'light'
    },
    idioma: {
      type: String,
      enum: ['es', 'en'],
      default: 'es'
    }
  },

  // ✅ INFORMACIÓN ADICIONAL PROFESIONAL
  informacionAdicional: {
    telefono: {
      type: String,
      trim: true,
      match: [/^\+?[1-9]\d{1,14}$/, 'Número de teléfono inválido']
    },
    documento: {
      tipo: {
        type: String,
        enum: ['cedula', 'pasaporte', 'cedula_extranjeria'],
        default: 'cedula'
      },
      numero: {
        type: String,
        trim: true,
        sparse: true, // Permite múltiples null pero valores únicos
        index: true
      }
    },
    empresa: {
      type: String,
      trim: true,
      maxlength: [100, 'Nombre de empresa no puede exceder 100 caracteres']
    },
    cargo: {
      type: String,
      trim: true,
      maxlength: [100, 'Cargo no puede exceder 100 caracteres']
    },
    fechaNacimiento: Date,
    direccion: {
      calle: String,
      ciudad: String,
      departamento: String,
      codigoPostal: String
    }
  },

  // ✅ ESTADÍSTICAS DE USO
  estadisticas: {
    totalMovimientos: { type: Number, default: 0 },
    distanciaTotal: { type: Number, default: 0 },
    tiempoTotal: { type: Number, default: 0 },
    velocidadPromedio: { type: Number, default: 0 },
    ultimaActualizacion: { type: Date, default: Date.now }
  },

  // ✅ AUDITORÍA Y METADATA
  metadata: {
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
    notas: [{ 
      contenido: String,
      autor: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      fecha: { type: Date, default: Date.now }
    }]
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
  }
}, {
  timestamps: true,
  toJSON: { 
    virtuals: true,
    transform: function(doc, ret) {
      delete ret.contrasena;
      delete ret.tokenRecuperacion;
      delete ret.expiraTokenRecuperacion;
      delete ret.refreshTokens;
      return ret;
    }
  },
  toObject: { virtuals: true }
});

// ✅ ÍNDICES COMPUESTOS PARA RENDIMIENTO
userSchema.index({ correo_electronico: 1, activo: 1 });
userSchema.index({ rol: 1, activo: 1 });
userSchema.index({ region: 1, activo: 1 });
userSchema.index({ ultimoAcceso: -1 });
userSchema.index({ fechaCreacion: -1 });
userSchema.index({ 'informacionAdicional.documento.numero': 1 }, { sparse: true });
userSchema.index({ deleted: 1, activo: 1 });

// ✅ VIRTUALS ÚTILES
userSchema.virtual('nombreCorto').get(function() {
  return this.nombre_completo.split(' ')[0];
});

userSchema.virtual('iniciales').get(function() {
  return this.nombre_completo
    .split(' ')
    .map(name => name.charAt(0))
    .join('')
    .toUpperCase();
});

userSchema.virtual('tiempoRegistrado').get(function() {
  return moment().diff(this.fechaCreacion, 'days');
});

userSchema.virtual('estadoActividad').get(function() {
  const horasInactivo = moment().diff(this.ultimoAcceso, 'hours');
  if (horasInactivo < 1) return 'online';
  if (horasInactivo < 24) return 'reciente';
  if (horasInactivo < 168) return 'inactivo'; // 1 semana
  return 'muy_inactivo';
});

// ✅ MIDDLEWARE PRE-SAVE MEJORADO
userSchema.pre('save', async function(next) {
  try {
    // ✅ HASH DE CONTRASEÑA CON SALT ALTO
    if (this.isModified('contrasena')) {
      const saltRounds = process.env.NODE_ENV === 'production' ? 12 : 10;
      this.contrasena = await bcrypt.hash(this.contrasena, saltRounds);
    }

    // ✅ ACTUALIZAR FECHA DE MODIFICACIÓN
    if (this.isModified() && !this.isNew) {
      this.metadata.fechaModificacion = new Date();
      this.metadata.version += 1;
    }

    // ✅ LIMPIAR REFRESH TOKENS EXPIRADOS
    if (this.refreshTokens && this.refreshTokens.length > 0) {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      this.refreshTokens = this.refreshTokens.filter(tokenObj => 
        tokenObj.createdAt > sevenDaysAgo
      );
    }

    next();
  } catch (error) {
    next(error);
  }
});

// ✅ MIDDLEWARE POST-SAVE PARA LOGGING
userSchema.post('save', function(doc) {
  console.log('✅ Usuario guardado:', {
    id: doc._id,
    email: doc.correo_electronico,
    action: doc.isNew ? 'created' : 'updated',
    timestamp: new Date().toISOString()
  });
});

// ✅ MÉTODOS DE INSTANCIA MEJORADOS
userSchema.methods.comparePassword = async function(contrasenaPlana) {
  try {
    return await bcrypt.compare(contrasenaPlana, this.contrasena);
  } catch (error) {
    throw new Error('Error comparando contraseñas');
  }
};

userSchema.methods.limpiarSesionesExpiradas = function() {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  
  this.refreshTokens = this.refreshTokens.filter(tokenObj => 
    tokenObj.createdAt > sevenDaysAgo
  );
  
  return this.save();
};

userSchema.methods.registrarActividad = function(tokenId, ip, userAgent) {
  this.ultimoAcceso = new Date();
  this.ultima_actividad = new Date();
  
  // Actualizar refresh token existente
  if (tokenId && this.refreshTokens) {
    const tokenExistente = this.refreshTokens.find(t => t.token === tokenId);
    if (tokenExistente) {
      tokenExistente.lastUsed = new Date();
      tokenExistente.ip = ip;
      tokenExistente.userAgent = userAgent;
    }
  }
  
  return this.save();
};

userSchema.methods.crearTokenRecuperacion = function() {
  const resetToken = crypto.randomBytes(32).toString('hex');
  
  this.tokenRecuperacion = crypto
    .createHash('sha256')
    .update(resetToken)
    .digest('hex');
  
  this.expiraTokenRecuperacion = new Date(Date.now() + 60 * 60 * 1000); // 1 hora
  
  return resetToken; // Devolver el token original
};

userSchema.methods.actualizarEstadisticas = async function(movementData) {
  if (movementData) {
    this.estadisticas.totalMovimientos += 1;
    this.estadisticas.distanciaTotal += movementData.distancia_recorrida || 0;
    this.estadisticas.tiempoTotal += movementData.tiempo_total || 0;
    
    // Calcular nueva velocidad promedio
    if (this.estadisticas.totalMovimientos > 0) {
      this.estadisticas.velocidadPromedio = 
        this.estadisticas.distanciaTotal / (this.estadisticas.tiempoTotal / 60);
    }
    
    this.estadisticas.ultimaActualizacion = new Date();
  }
  
  return this.save();
};

userSchema.methods.puedeAcceder = function(recurso) {
  if (!this.activo || this.deleted) return false;
  
  const permisos = {
    admin: ['read', 'write', 'delete', 'export', 'admin'],
    supervisor: ['read', 'write', 'export'],
    trabajador: ['read', 'write'],
    invitado: ['read']
  };
  
  return permisos[this.rol]?.includes(recurso) || false;
};

// ✅ MÉTODOS ESTÁTICOS ÚTILES
userSchema.statics.encontrarPorEmail = function(email) {
  return this.findOne({ 
    correo_electronico: email.toLowerCase().trim(),
    activo: true,
    deleted: false
  }).select('+contrasena');
};

userSchema.statics.encontrarActivos = function() {
  return this.find({ 
    activo: true, 
    deleted: false 
  }).sort({ ultimoAcceso: -1 });
};

userSchema.statics.estadisticasGenerales = function() {
  return this.aggregate([
    { $match: { deleted: false } },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        activos: { 
          $sum: { $cond: ['$activo', 1, 0] } 
        },
        porRegion: {
          $push: {
            region: '$region',
            activo: '$activo'
          }
        }
      }
    }
  ]);
};

// ✅ QUERY HELPERS
userSchema.query.activos = function() {
  return this.where({ activo: true, deleted: false });
};

userSchema.query.porRol = function(rol) {
  return this.where({ rol });
};

userSchema.query.enRegion = function(region) {
  return this.where({ region });
};

module.exports = mongoose.model('User', userSchema);
