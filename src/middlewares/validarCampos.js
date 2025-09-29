const { validationResult } = require('express-validator');

// ✅ MIDDLEWARE PRINCIPAL DE VALIDACIÓN
const validarCampos = (req, res, next) => {
  try {
    const errors = validationResult(req);
    
    if (!errors.isEmpty()) {
      // ✅ FORMATEAR ERRORES DE MANERA AMIGABLE
      const formattedErrors = errors.array().map(error => ({
        field: error.path || error.param,
        message: error.msg,
        value: error.value,
        location: error.location
      }));

      // ✅ AGRUPAR ERRORES POR CAMPO
      const errorsByField = {};
      formattedErrors.forEach(error => {
        if (!errorsByField[error.field]) {
          errorsByField[error.field] = [];
        }
        errorsByField[error.field].push(error.message);
      });

      console.warn('❌ Errores de validación:', {
        endpoint: `${req.method} ${req.path}`,
        errors: formattedErrors,
        ip: req.ip,
        timestamp: new Date().toISOString()
      });

      return res.status(400).json({
        success: false,
        message: 'Errores de validación en los datos enviados',
        code: 'VALIDATION_ERROR',
        errors: formattedErrors,
        errorsByField,
        timestamp: new Date().toISOString()
      });
    }

    next();
  } catch (error) {
    console.error('❌ Error en validación de campos:', error);
    return res.status(500).json({
      success: false,
      message: 'Error interno en validación',
      code: 'VALIDATION_INTERNAL_ERROR',
      timestamp: new Date().toISOString()
    });
  }
};

// ✅ MIDDLEWARE PARA SANITIZAR DATOS
const sanitizeInput = (req, res, next) => {
  try {
    // Sanitizar strings en body, query y params
    const sanitizeObject = (obj) => {
      if (!obj || typeof obj !== 'object') return obj;
      
      const sanitized = {};
      for (const [key, value] of Object.entries(obj)) {
        if (typeof value === 'string') {
          // Remover espacios extra y caracteres peligrosos
          sanitized[key] = value
            .trim()
            .replace(/[\x00-\x1F\x7F]/g, '') // Caracteres de control
            .replace(/\s+/g, ' '); // Múltiples espacios
        } else if (Array.isArray(value)) {
          sanitized[key] = value.map(item => 
            typeof item === 'string' ? item.trim() : item
          );
        } else {
          sanitized[key] = value;
        }
      }
      return sanitized;
    };

    if (req.body) req.body = sanitizeObject(req.body);
    if (req.query) req.query = sanitizeObject(req.query);
    if (req.params) req.params = sanitizeObject(req.params);

    next();
  } catch (error) {
    console.error('❌ Error sanitizando input:', error);
    next(); // Continuar aunque falle la sanitización
  }
};

// ✅ MIDDLEWARE PARA VALIDAR JSON
const validateJSON = (err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({
      success: false,
      message: 'JSON inválido en el cuerpo de la petición',
      code: 'INVALID_JSON',
      error: 'Verifica la sintaxis del JSON enviado',
      timestamp: new Date().toISOString()
    });
  }
  next(err);
};

// ✅ VALIDACIONES COMUNES REUTILIZABLES
const commonValidations = {
  email: {
    isEmail: { errorMessage: 'Correo electrónico inválido' },
    normalizeEmail: true,
    isLength: { 
      options: { max: 255 }, 
      errorMessage: 'Correo demasiado largo (máximo 255 caracteres)' 
    }
  },
  
  password: {
    isLength: { 
      options: { min: 8, max: 128 }, 
      errorMessage: 'Contraseña debe tener entre 8 y 128 caracteres' 
    },
    matches: {
      options: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/,
      errorMessage: 'Contraseña debe contener al menos: una minúscula, una mayúscula, un número y un carácter especial'
    }
  },
  
  name: {
    trim: true,
    isLength: { 
      options: { min: 2, max: 100 }, 
      errorMessage: 'Nombre debe tener entre 2 y 100 caracteres' 
    },
    matches: {
      options: /^[a-zA-ZáéíóúÁÉÍÓÚñÑ\s]+$/,
      errorMessage: 'Nombre solo puede contener letras y espacios'
    }
  },
  
  mongoId: {
    isMongoId: { errorMessage: 'ID de MongoDB inválido' }
  },
  
  dateISO: {
    isISO8601: { 
      options: { strict: true },
      errorMessage: 'Fecha debe estar en formato ISO 8601' 
    }
  }
};

module.exports = {
  validarCampos,
  sanitizeInput,
  validateJSON,
  commonValidations
};

// Exportación por defecto para compatibilidad
module.exports.default = validarCampos;
