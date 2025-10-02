const nodemailer = require('nodemailer');

class EmailService {
  constructor() {
    this.transporter = null;
    this.initialize();
  }

  async initialize() {
    try {
      // ✅ CONFIGURACIÓN PARA GMAIL
      this.transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST || 'smtp.gmail.com',
        port: parseInt(process.env.SMTP_PORT) || 587,
        secure: process.env.SMTP_SECURE === 'true', // false para 587, true para 465
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS
        },
        tls: {
          rejectUnauthorized: false
        }
      });

      // ✅ VERIFICAR CONEXIÓN
      await this.transporter.verify();
      console.log('✅ Servicio de email configurado correctamente');
      console.log(`📧 Servidor SMTP: ${process.env.SMTP_HOST}:${process.env.SMTP_PORT}`);
      console.log(`👤 Usuario: ${process.env.SMTP_USER}`);

    } catch (error) {
      console.error('❌ Error configurando servicio de email:', error);
      throw error;
    }
  }

  async sendEmail(options) {
    try {
      if (!this.transporter) {
        await this.initialize();
      }

      const mailOptions = {
        from: {
          name: process.env.SMTP_FROM_NAME || 'SupervitecApp',
          address: process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER
        },
        to: options.to,
        subject: options.subject,
        html: options.html || options.text,
        text: options.text
      };

      const result = await this.transporter.sendMail(mailOptions);
      
      console.log('✅ Email enviado exitosamente:');
      console.log(`📧 Para: ${options.to}`);
      console.log(`📝 Asunto: ${options.subject}`);
      console.log(`🆔 ID: ${result.messageId}`);

      return {
        success: true,
        messageId: result.messageId,
        response: result.response
      };

    } catch (error) {
      console.error('❌ Error enviando email:', error);
      throw error;
    }
  }

  // ✅ PLANTILLAS DE EMAIL PRE-DISEÑADAS
  async sendWelcomeEmail(userEmail, userName) {
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9;">
        <div style="background-color: #2196F3; padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
          <h1 style="color: white; margin: 0; font-size: 28px;">¡Bienvenido a SupervitecApp! 🚀</h1>
        </div>
        
        <div style="background-color: white; padding: 30px; border-radius: 0 0 10px 10px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
          <h2 style="color: #333; margin-top: 0;">Hola ${userName},</h2>
          
          <p style="color: #666; font-size: 16px; line-height: 1.6;">
            Tu cuenta ha sido creada exitosamente en <strong>SupervitecApp</strong>, 
            el sistema líder en Seguridad y Salud en el Trabajo.
          </p>
          
          <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h3 style="color: #2196F3; margin-top: 0;">🔐 Datos de tu cuenta:</h3>
            <p style="margin: 5px 0;"><strong>Email:</strong> ${userEmail}</p>
            <p style="margin: 5px 0;"><strong>Estado:</strong> ✅ Activa</p>
          </div>
          
          <div style="text-align: center; margin: 30px 0;">
            <a href="${process.env.FRONTEND_URL || 'https://back-end-fjnh.onrender.com'}" 
               style="background-color: #2196F3; color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">
              🚀 Ingresar a la App
            </a>
          </div>
          
          <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
          
          <p style="color: #999; font-size: 14px; text-align: center; margin: 0;">
            SupervitecApp - Sistema de Seguridad y Salud en el Trabajo<br>
            📧 supervitecingenieriasas@gmail.com | 🌐 supervitecapp.com
          </p>
        </div>
      </div>
    `;

    return await this.sendEmail({
      to: userEmail,
      subject: '🚀 ¡Bienvenido a SupervitecApp! Tu cuenta está lista',
      html
    });
  }

  async sendPasswordResetEmail(userEmail, resetToken, userName) {
    const resetUrl = `${process.env.FRONTEND_URL || 'https://back-end-fjnh.onrender.com'}/reset-password?token=${resetToken}`;
    
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9;">
        <div style="background-color: #FF9800; padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
          <h1 style="color: white; margin: 0; font-size: 28px;">🔐 Recuperar Contraseña</h1>
        </div>
        
        <div style="background-color: white; padding: 30px; border-radius: 0 0 10px 10px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
          <h2 style="color: #333; margin-top: 0;">Hola ${userName},</h2>
          
          <p style="color: #666; font-size: 16px; line-height: 1.6;">
            Recibimos una solicitud para restablecer tu contraseña en <strong>SupervitecApp</strong>.
          </p>
          
          <div style="background-color: #fff3cd; border: 1px solid #ffeaa7; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <p style="margin: 0; color: #856404;">
              <strong>⚠️ Importante:</strong> Si no solicitaste este cambio, puedes ignorar este email. 
              Tu contraseña seguirá siendo la misma.
            </p>
          </div>
          
          <div style="text-align: center; margin: 30px 0;">
            <a href="${resetUrl}" 
               style="background-color: #FF9800; color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">
              🔑 Cambiar Contraseña
            </a>
          </div>
          
          <p style="color: #666; font-size: 14px; text-align: center;">
            Este enlace expirará en <strong>1 hora</strong> por seguridad.
          </p>
          
          <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
          
          <p style="color: #999; font-size: 14px; text-align: center; margin: 0;">
            SupervitecApp - Sistema de Seguridad y Salud en el Trabajo<br>
            📧 supervitecingenieriasas@gmail.com
          </p>
        </div>
      </div>
    `;

    return await this.sendEmail({
      to: userEmail,
      subject: '🔐 SupervitecApp - Recuperar tu contraseña',
      html
    });
  }

  async sendNotificationEmail(userEmail, title, message, type = 'info') {
    const colors = {
      info: '#2196F3',
      success: '#4CAF50',
      warning: '#FF9800',
      error: '#F44336'
    };

    const icons = {
      info: 'ℹ️',
      success: '✅',
      warning: '⚠️',
      error: '❌'
    };

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9;">
        <div style="background-color: ${colors[type]}; padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
          <h1 style="color: white; margin: 0; font-size: 24px;">${icons[type]} ${title}</h1>
        </div>
        
        <div style="background-color: white; padding: 30px; border-radius: 0 0 10px 10px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
          <div style="color: #666; font-size: 16px; line-height: 1.6;">
            ${message}
          </div>
          
          <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
          
          <p style="color: #999; font-size: 14px; text-align: center; margin: 0;">
            SupervitecApp - Sistema de Seguridad y Salud en el Trabajo<br>
            📧 supervitecingenieriasas@gmail.com
          </p>
        </div>
      </div>
    `;

    return await this.sendEmail({
      to: userEmail,
      subject: `SupervitecApp - ${title}`,
      html
    });
  }
}

module.exports = new EmailService();
