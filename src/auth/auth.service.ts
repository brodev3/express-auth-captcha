import {
  UniqueConstraintError,
  type User,
  type UserRepository,
} from "./user.repository.js";
import { PasswordHasher } from "./password.js";

export interface RegisterCredentials {
  email: string;
  password: string;
  username: string;
}

export interface LoginCredentials {
  login: string;
  password: string;
}

export type RegisterResult =
  | { kind: "created"; user: User }
  | { field: "username" | "email"; kind: "conflict" };

export type LoginResult =
  | { kind: "authenticated"; user: User }
  | { kind: "invalid" };

export interface AuthServiceOptions {
  passwordHasher: PasswordHasher;
  userRepository: UserRepository;
}

export class AuthService {
  private readonly passwordHasher: PasswordHasher;
  private readonly userRepository: UserRepository;

  public constructor(options: AuthServiceOptions) {
    this.passwordHasher = options.passwordHasher;
    this.userRepository = options.userRepository;
  }

  public async register(credentials: RegisterCredentials): Promise<RegisterResult> {
    if (await this.userRepository.existsByUsername(credentials.username)) {
      return { field: "username", kind: "conflict" };
    }

    if (await this.userRepository.existsByEmail(credentials.email)) {
      return { field: "email", kind: "conflict" };
    }

    const passwordHash = await this.passwordHasher.hash(credentials.password);

    try {
      const user = await this.userRepository.create({
        email: credentials.email,
        passwordHash,
        username: credentials.username,
      });

      return { kind: "created", user };
    } catch (error) {
      if (error instanceof UniqueConstraintError) {
        return { field: error.field, kind: "conflict" };
      }

      throw error;
    }
  }

  public async login(credentials: LoginCredentials): Promise<LoginResult> {
    const user = await this.userRepository.findByLogin(credentials.login);

    if (!user) {
      await this.passwordHasher.verify(credentials.password, this.passwordHasher.getDummyHash());
      return { kind: "invalid" };
    }

    const passwordIsValid = await this.passwordHasher.verify(
      credentials.password,
      user.passwordHash,
    );

    return passwordIsValid
      ? { kind: "authenticated", user }
      : { kind: "invalid" };
  }

  public async findUserById(userId: number): Promise<User | null> {
    return this.userRepository.findById(userId);
  }
}
