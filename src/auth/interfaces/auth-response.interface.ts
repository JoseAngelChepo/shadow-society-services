import { UserRole, AccountTier } from '../../users/schemas/user.schema';

export interface AuthResponse {
  access_token: string;
  refresh_token: string;
  user: {
    id: string;
    email: string;
    username: string;
    firstName: string;
    lastName: string;
    role: UserRole;
    avatar?: string;
    accountTier: AccountTier;
  };
}
