export type UserRole = 'developer' | 'user';

export const DEVELOPER_DOMAINS = ['asertio.mx', 'maity.cloud'];

export function getUserRole(email: string | null | undefined): UserRole {
  if (!email) return 'user';
  const domain = email.split('@')[1]?.toLowerCase();
  return domain && DEVELOPER_DOMAINS.includes(domain) ? 'developer' : 'user';
}

export function isDeveloper(role: UserRole): boolean {
  return role === 'developer';
}
