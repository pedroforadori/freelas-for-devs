import { permissionsFor, type Permission, type Role } from '@f4d/contracts';
import { AggregateRoot } from '../../../shared/kernel/aggregate-root.js';

export type UserStatus = 'ACTIVE' | 'SUSPENDED';

export interface UserSnapshot {
  id: string;
  email: string;
  passwordHash: string | null;
  displayName: string;
  status: UserStatus;
  emailVerifiedAt: Date | null;
  termsAcceptedAt: Date;
  roles: Role[];
  createdAt: Date;
  version: number;
}

export const UserEvents = {
  Registered: 'identity.UserRegistered',
  EmailVerified: 'identity.UserEmailVerified',
  PasswordChanged: 'identity.UserPasswordChanged',
  RoleGranted: 'identity.UserRoleGranted',
} as const;

/** Agregado de identidade: credenciais, papéis e situação da conta. Perfis vivem em outro módulo. */
export class User extends AggregateRoot {
  protected readonly aggregateType = 'User';

  private constructor(
    private props: Omit<UserSnapshot, 'id' | 'version'>,
    id: string,
    version: number,
  ) {
    super(id, version);
  }

  static register(input: {
    id: string;
    email: string;
    passwordHash: string;
    displayName: string;
    role: Role;
    now: Date;
  }): User {
    const user = new User(
      {
        email: input.email.trim().toLowerCase(),
        passwordHash: input.passwordHash,
        displayName: input.displayName.trim(),
        status: 'ACTIVE',
        emailVerifiedAt: null,
        termsAcceptedAt: input.now,
        roles: [input.role],
        createdAt: input.now,
      },
      input.id,
      0,
    );
    // Sem e-mail no payload: eventos circulam por filas e logs (minimização de dados, LGPD).
    user.record(UserEvents.Registered, input.now, { userId: input.id, role: input.role });
    return user;
  }

  /**
   * Conta criada por um operador (ex.: Admin via CLI): sem senha, com e-mail já confirmado.
   * A pessoa define a senha pelo link de redefinição enviado na criação.
   */
  static provision(input: {
    id: string;
    email: string;
    displayName: string;
    roles: Role[];
    now: Date;
  }): User {
    const user = new User(
      {
        email: input.email.trim().toLowerCase(),
        passwordHash: null,
        displayName: input.displayName.trim(),
        status: 'ACTIVE',
        emailVerifiedAt: input.now,
        termsAcceptedAt: input.now,
        roles: [...new Set(input.roles)],
        createdAt: input.now,
      },
      input.id,
      0,
    );
    for (const role of user.props.roles) {
      user.record(UserEvents.RoleGranted, input.now, { userId: input.id, role });
    }
    return user;
  }

  static rehydrate(snapshot: UserSnapshot): User {
    const { id, version, ...props } = snapshot;
    return new User({ ...props, roles: [...props.roles] }, id, version);
  }

  get email(): string {
    return this.props.email;
  }
  get displayName(): string {
    return this.props.displayName;
  }
  get passwordHash(): string | null {
    return this.props.passwordHash;
  }
  get roles(): readonly Role[] {
    return this.props.roles;
  }
  get permissions(): Permission[] {
    return permissionsFor(this.props.roles);
  }
  get isActive(): boolean {
    return this.props.status === 'ACTIVE';
  }
  get isEmailVerified(): boolean {
    return this.props.emailVerifiedAt !== null;
  }
  get createdAt(): Date {
    return this.props.createdAt;
  }

  hasRole(role: Role): boolean {
    return this.props.roles.includes(role);
  }

  grantRole(role: Role, now: Date): void {
    if (this.hasRole(role)) return;
    this.props.roles = [...this.props.roles, role].sort();
    this.record(UserEvents.RoleGranted, now, { userId: this.id, role });
  }

  verifyEmail(now: Date): void {
    if (this.isEmailVerified) return;
    this.props.emailVerifiedAt = now;
    this.record(UserEvents.EmailVerified, now, { userId: this.id });
  }

  changePassword(passwordHash: string, now: Date): void {
    this.props.passwordHash = passwordHash;
    this.record(UserEvents.PasswordChanged, now, { userId: this.id });
  }

  toSnapshot(): UserSnapshot {
    return { ...this.props, roles: [...this.props.roles], id: this.id, version: this.version };
  }
}
