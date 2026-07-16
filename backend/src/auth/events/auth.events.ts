export interface UserRegisteredEvent {
  userId: string;
  email: string;
}

export interface LoginSuccessEvent {
  userId: string;
  ip?: string;
}

export interface LoginFailedEvent {
  email: string;
  reason: 'bad_credentials';
  ip?: string;
}

export interface LogoutEvent {
  userId: string;
  sessionId: string;
}

export interface SessionRevokedEvent {
  userId: string;
  sessionId: string;
  actorUserId: string;
}

export interface RefreshRotatedEvent {
  userId: string;
  sessionId: string;
}

export interface SessionReuseDetectedEvent {
  userId: string;
  sessionId: string;
  ip?: string;
}

export interface PasswordResetRequestedEvent {
  userId: string;
  email: string;
}

export interface PasswordResetCompletedEvent {
  userId: string;
  revokedSessionCount: number;
}

export const AuthEvents = {
  USER_REGISTERED: 'auth.user.registered',
  LOGIN_SUCCESS: 'auth.login.success',
  LOGIN_FAILED: 'auth.login.failed',
  LOGOUT: 'auth.logout',
  SESSION_REVOKED: 'auth.session.revoked',
  REFRESH_ROTATED: 'auth.session.refresh_rotated',
  REUSE_DETECTED: 'auth.session.reuse_detected',
  PASSWORD_RESET_REQUESTED: 'auth.password.reset_requested',
  PASSWORD_RESET_COMPLETED: 'auth.password.reset_completed',
} as const;
