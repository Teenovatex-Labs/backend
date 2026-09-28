import { Router } from 'express';
import {
  register,
  login,
  refresh,
  forgotPassword,
  verifyResetCode,
  resetPassword,
  logout,
  googleAuth,
  verifyEmail,
  resendVerification,
} from '../controllers/auth.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { authLimiter, otpVerifyLimiter, otpRequestLimiter } from '../middleware/rateLimiter.js';
import {
  registerSchema,
  loginSchema,
  refreshSchema,
  forgotPasswordSchema,
  verifyResetCodeSchema,
  resetPasswordSchema,
  googleAuthSchema,
  verifyEmailSchema,
  resendVerificationSchema,
} from '../schemas/auth.js';

const router = Router();

router.post('/register', authLimiter, validate(registerSchema), register);
router.post('/verify-email', otpVerifyLimiter, validate(verifyEmailSchema), verifyEmail);
router.post('/resend-verification', otpRequestLimiter, validate(resendVerificationSchema), resendVerification);
router.post('/login', authLimiter, validate(loginSchema), login);
router.post('/google', authLimiter, validate(googleAuthSchema), googleAuth);
router.post('/refresh', refresh);
router.post('/forgot-password', otpRequestLimiter, validate(forgotPasswordSchema), forgotPassword);
router.post('/verify-reset-code', otpVerifyLimiter, validate(verifyResetCodeSchema), verifyResetCode);
router.post('/reset-password', authLimiter, validate(resetPasswordSchema), resetPassword);
router.post('/logout', requireAuth, logout);

export default router;
